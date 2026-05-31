# 多用户实时同步设计

## 概述

将单机 PWA 聊天式记账应用改造为多人协作记账应用。用户可以创建多个账本，通过邀请码分享给好友，实时共同记账。支持离线写入和断线恢复。

## 架构

- **前端**：Vue 3 PWA（现有），部署到 Cloudflare Pages
- **后端**：Hono + Cloudflare Workers + D1 (SQLite) + Durable Objects (WebSocket)
- **共享**：monorepo 中 `packages/shared` 存放共享 TypeScript 类型
- **实时同步**：通过 Durable Objects 建立 WebSocket，向所有在线成员广播变更；基于事件 ID 实现断线恢复
- **认证**：邮箱 + 密码，双 JWT（Access + Refresh）存储在 HttpOnly Cookie 中，Refresh Token 有状态管理

## Monorepo 结构

```
chat-budget/
├── apps/
│   ├── web/                          # Vue 3 PWA
│   │   ├── src/
│   │   │   ├── pages/
│   │   │   │   ├── LoginPage.vue
│   │   │   │   ├── RegisterPage.vue
│   │   │   │   ├── LedgersPage.vue
│   │   │   │   ├── HomePage.vue          # 聊天式记账页（改造）
│   │   │   │   ├── SettingsPage.vue      # 账本设置页（改造）
│   │   │   │   └── JoinPage.vue
│   │   │   ├── stores/
│   │   │   │   ├── auth.ts
│   │   │   │   ├── ledgers.ts
│   │   │   │   ├── transaction.ts        # 改造
│   │   │   │   ├── settings.ts           # 改造
│   │   │   │   └── websocket.ts
│   │   │   ├── composables/
│   │   │   │   ├── useRealtimeSync.ts
│   │   │   │   └── ...现有
│   │   │   └── ...现有组件
│   │   └── vite.config.ts
│   └── api/                          # Hono + Cloudflare Workers
│       ├── src/
│       │   ├── index.ts
│       │   ├── middleware/
│       │   │   ├── auth.ts
│       │   │   └── rate-limit.ts
│       │   ├── routes/
│       │   │   ├── auth.ts
│       │   │   ├── ledgers.ts
│       │   │   ├── transactions.ts
│       │   │   ├── members.ts
│       │   │   ├── invites.ts
│       │   │   └── events.ts
│       │   ├── do/
│       │   │   └── sync.ts
│       │   └── db/
│       │       ├── schema.ts
│       │       └── queries.ts
│       ├── migrations/
│       └── wrangler.toml
├── packages/
│   └── shared/
│       └── src/
│           ├── types.ts
│           └── ws-protocol.ts
├── .github/workflows/deploy.yml
├── pnpm-workspace.yaml
├── turbo.json
├── package.json
└── tsconfig.base.json
```

## 数据模型（D1）

### 表结构

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  nickname TEXT NOT NULL,
  avatar TEXT,  -- URL 字符串，指向 R2 或第三方头像服务（如 Gravatar）
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE ledgers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  daily_limit INTEGER NOT NULL DEFAULT 0,
  start_date TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  FOREIGN KEY (owner_id) REFERENCES users(id)
);

CREATE TABLE ledger_members (
  ledger_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  joined_at INTEGER NOT NULL,
  removed_at INTEGER,
  PRIMARY KEY (ledger_id, user_id),
  FOREIGN KEY (ledger_id) REFERENCES ledgers(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE ledger_invites (
  id TEXT PRIMARY KEY,
  ledger_id TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  created_by TEXT NOT NULL,
  expires_at INTEGER,
  revoked_at INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (ledger_id) REFERENCES ledgers(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE transactions (
  id TEXT PRIMARY KEY,  -- 客户端生成 ULID
  ledger_id TEXT NOT NULL,
  user_id TEXT NOT NULL,  -- 交易归属人（这笔收支属于谁）
  amount INTEGER NOT NULL CHECK (amount != 0),
  note TEXT NOT NULL,
  date TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  created_by TEXT NOT NULL,  -- 操作者（谁录入的这笔交易）
  updated_by TEXT,
  deleted_by TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY (ledger_id) REFERENCES ledgers(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE ledger_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,  -- 全局自增，作为断线恢复游标
  ledger_id TEXT NOT NULL,
  type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  client_mutation_id TEXT,
  payload TEXT NOT NULL,  -- JSON，保存完整快照（非 patch）
  created_at INTEGER NOT NULL
);

CREATE TABLE client_mutations (
  id TEXT NOT NULL,  -- 客户端生成的 UUID
  ledger_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  operation_type TEXT NOT NULL,  -- 'create_transaction' | 'update_transaction' | 'delete_transaction' | 'update_settings'
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  status TEXT NOT NULL DEFAULT 'completed',  -- 'completed' | 'failed'
  event_id INTEGER,
  response_payload TEXT,  -- JSON，首次请求的完整响应，重试时直接返回
  expires_at INTEGER NOT NULL,  -- 写入时 NOW + 30 天，用于定期清理
  created_at INTEGER NOT NULL,
  PRIMARY KEY (ledger_id, user_id, id)
);

CREATE TABLE refresh_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  user_agent TEXT,
  ip_hash TEXT,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE limit_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ledger_id TEXT NOT NULL,
  effective_date TEXT NOT NULL,
  daily_limit INTEGER NOT NULL,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (ledger_id, effective_date)
);

-- 索引
CREATE INDEX idx_transactions_ledger_date ON transactions(ledger_id, deleted_at, date DESC, created_at DESC);
CREATE INDEX idx_transactions_ledger_updated ON transactions(ledger_id, updated_at);
CREATE INDEX idx_ledger_members_user ON ledger_members(user_id, removed_at);
CREATE INDEX idx_ledger_members_ledger ON ledger_members(ledger_id);
CREATE INDEX idx_ledger_events_ledger_id ON ledger_events(ledger_id, id);
CREATE INDEX idx_client_mutations_ledger ON client_mutations(ledger_id, expires_at);
CREATE INDEX idx_limit_history_ledger_date ON limit_history(ledger_id, effective_date);
CREATE INDEX idx_ledger_invites_code ON ledger_invites(code, revoked_at, expires_at);
CREATE INDEX idx_ledgers_owner ON ledgers(owner_id, deleted_at);
CREATE INDEX idx_refresh_sessions_user ON refresh_sessions(user_id, revoked_at);
```

### 字段说明

- **transactions.id**：客户端生成的 ULID，全局唯一且天然有序。幂等通过 `client_mutations` 表保证，不依赖 `INSERT OR IGNORE`
- **transactions.user_id**：交易归属人，表示这笔收支属于谁（如 A 帮 B 记账时，user_id 是 B）
- **transactions.created_by**：操作者，表示谁录入的这笔交易（如 A 帮 B 记账时，created_by 是 A）
- **transactions.version**：乐观锁版本号，每次编辑递增。PUT 请求携带当前 version，服务端不匹配返回 409
- **transactions.amount**：支出为负整数，收入为正整数；不允许为 0；前端展示时取绝对值并按符号区分颜色。默认输入为支出（负数），用户输入"收入/工资/报销"等关键词时存为正数
- **transactions.deleted_at**：软删除时间戳，非 NULL 表示已删除。查询时自动过滤
- **ledger_events.id**：全局 AUTOINCREMENT，作为断线恢复游标。客户端记录 lastSeenEventId，断线后查询 `WHERE ledger_id = ? AND id > ?`
- **ledger_events.payload**：JSON 完整快照（非 patch），例如 `transaction_updated` 保存更新后的完整 transaction 对象
- **client_mutations.id**：客户端生成的 UUID，复合主键 `(ledger_id, user_id, id)` 防止跨用户/跨账本冲突。重试时若已存在且 status=completed，直接返回 response_payload
- **client_mutations.expires_at**：写入时 `NOW + 30天`，定期清理过期记录（Workers Cron Trigger）
- **ledger_invites.code**：8 位随机码（字符集：大写字母 + 数字，排除 O/0/I/1/l），使用 `crypto.getRandomValues()` 生成，24 小时过期
- **users.avatar**：URL 字符串，头像文件上传到 R2 或使用第三方头像服务（如 Gravatar），不存 base64
- **refresh_sessions**：Refresh Token 的服务端记录，支持登出时撤销和改密码后批量失效

### 原子写入流程

所有写操作必须在同一个 D1 batch/transaction 中完成：

1. 校验用户是否为账本成员（`ledger_members` 中 `removed_at IS NULL`）
2. 校验账本未删除（`ledgers.deleted_at IS NULL`）
3. 查询 `client_mutations`，判断是否重复请求（若已存在且 status=completed，直接返回 response_payload；若 status=failed，允许重试，覆盖旧记录）
4. 校验业务约束（version、交易归属、权限）
5. 写入业务表
6. 写入 `ledger_events`（id 由 AUTOINCREMENT 生成）
7. 写入 `client_mutations`（记录 operation_type、entity_id、response_payload）
8. 提交事务
9. 事务成功后通知 Durable Object 广播事件（广播失败不影响数据一致性，客户端可通过 GET /events 补偿）

## API 路由

### 认证

- `POST /api/auth/register` — 注册（邮箱 + 密码 + 昵称）
- `POST /api/auth/login` — 登录（通过 HttpOnly Cookie 返回 Access Token 和 Refresh Token，同时创建 refresh_sessions 记录）
- `POST /api/auth/refresh` — 刷新 Access Token（读取 Refresh Cookie，校验 refresh_sessions 未撤销，签发新 Access Cookie，更新 last_used_at）
- `POST /api/auth/logout` — 登出（清除 Cookie，将 refresh_sessions.revoked_at 置为当前时间）
- `GET /api/auth/me` — 获取当前用户信息

### 账本

- `GET /api/ledgers` — 我的账本列表（排除已删除）
- `POST /api/ledgers` — 创建账本
- `GET /api/ledgers/:id` — 账本详情
- `PUT /api/ledgers/:id` — 更新账本（名称/限额，仅 owner）
- `DELETE /api/ledgers/:id` — 删除账本（软删除，仅 owner；广播 ledger_deleted 事件后关闭所有 WebSocket 连接）
- `POST /api/ledgers/:id/transfer` — 转让 ownership（仅 owner，将 owner_id 改为目标成员，自身降为 member）

### 成员

- `GET /api/ledgers/:id/members` — 成员列表（含已退出成员，removed_at 标识状态）
- `DELETE /api/ledgers/:id/members/:uid` — 移除成员（仅 owner）
- `DELETE /api/ledgers/:id/members/me` — 成员主动退出账本（owner 不可退出，需先转让或删除账本；退出后历史交易保留，退出成员不能再访问账本）

### 交易

- `GET /api/ledgers/:id/transactions` — 分页获取交易列表（默认排除已删除）
  - 查询参数：`cursor`（base64 编码的复合游标 `{ date, createdAt, id }`）、`limit`（默认 30）
  - 排序：`date DESC, created_at DESC, id DESC`
- `POST /api/ledgers/:id/transactions` — 新增交易
- `PUT /api/ledgers/:id/transactions/:tid` — 编辑交易（携带 version，乐观锁校验）
- `DELETE /api/ledgers/:id/transactions/:tid` — 删除交易（软删除）

### 邀请

- `GET /api/ledgers/:id/invite` — 获取当前邀请码/链接（仅 owner）
- `POST /api/ledgers/:id/invite/rotate` — 重新生成邀请码（仅 owner，旧码自动 revoked）
- `GET /api/invites/:code` — 通过邀请码查询账本基本信息（名称、成员数，供 JoinPage 预览）
- `POST /api/invites/join` — 通过邀请码加入账本（限流：每 IP+每 userId 每分钟各 10 次，每 code 每分钟 20 次）

### 事件

- `GET /api/ledgers/:id/events?afterId=123&limit=100` — 拉取指定 ID 之后的事件（断线恢复）

### WebSocket

- `WS /api/ws/:ledgerId` — 实时同步连接

## 认证方案

### 双 Token 机制

- **Access Token**：JWT，15 分钟过期，载荷 `{ userId, email, exp }`
- **Refresh Token**：JWT，7 天过期，载荷 `{ userId, sessionId, type: 'refresh', exp }`
- 两个 token 分别存入独立的 HttpOnly Cookie：
  - Access Cookie：`Path=/`，`HttpOnly`，`Secure`，`SameSite=Lax`
  - Refresh Cookie：`Path=/api/auth/refresh`，`HttpOnly`，`Secure`，`SameSite=Lax`（路径限定，只在刷新请求时发送）

### 前端 Token 刷新

HTTP 客户端（fetch wrapper）拦截 401 响应，自动调用 `POST /api/auth/refresh` 获取新 Access Token，再重试原请求。若刷新也失败，跳转到登录页。

### CSRF 防护

- 当前同站部署下（CF Pages + Workers 路由在同一域名下），`SameSite=Lax` 可接受
- 若未来需要跨站部署，需增加 CSRF Token（Double Submit Cookie 模式）并改用 `SameSite=None; Secure`

### WebSocket 认证

- WebSocket 升级请求（同域）浏览器自动携带 HttpOnly Cookie
- Worker 在 upgrade 时解析 Cookie 验证 Access Token，提取 userId
- Worker 查询 D1 确认 userId 是该 ledgerId 的成员（`removed_at IS NULL`）
- 校验通过后，Worker 将 userId 通过 DO stub 传递给 Durable Object
- Worker 增加 Origin 校验，拒绝非白名单域名的连接
- DO 无需再做权限校验，只负责管理连接和广播

## 权限矩阵

| 操作 | owner | member |
|---|---|---|
| 查看账本 | 是 | 是 |
| 新增交易 | 是 | 是 |
| 编辑自己的交易 | 是 | 是 |
| 编辑他人交易 | 是 | 否 |
| 删除自己的交易 | 是 | 是 |
| 删除他人交易 | 是 | 否 |
| 修改账本名称/限额 | 是 | 否 |
| 查看成员 | 是 | 是 |
| 移除成员 | 是 | 否 |
| 生成/重新生成邀请码 | 是 | 否 |
| 删除账本 | 是 | 否 |
| 转让 ownership | 是 | 否 |
| 主动退出账本 | 否（需先转让） | 是 |

后端所有接口统一走权限校验函数：

```ts
requireLedgerMember(ledgerId, userId)
requireLedgerOwner(ledgerId, userId)
requireTransactionOwnerOrLedgerOwner(transactionId, userId)
```

## 实时同步

### WebSocket 消息协议

```ts
// 客户端 → 服务器
type ClientMessage =
  | { type: 'ping' }
  | { type: 'subscribe'; ledgerId: string }
  | { type: 'unsubscribe' }

// 服务器 → 客户端（拆分控制消息和业务事件）
type ServerMessage = ControlMessage | LedgerEventMessage

type ControlMessage =
  | {
      type: 'connected'
      ledgerId: string
      lastEventId: number
      onlineMembers: Array<{ userId: string; nickname: string }>
    }
  | { type: 'pong'; ts: number }
  | { type: 'error'; code: string; message: string }

type LedgerEventMessage = {
  type:
    | 'transaction_added'
    | 'transaction_updated'
    | 'transaction_deleted'
    | 'settings_updated'
    | 'member_joined'
    | 'member_left'
    | 'ledger_deleted'
  ledgerId: string
  eventId: number       // ledger_events.id，用于断线恢复游标
  entityId: string
  actorUserId: string   // 操作发起者，用于跳过自己的乐观更新回声
  clientMutationId?: string
  occurredAt: number
  payload: LedgerEventPayload  // 完整快照
}

// 事件 payload 类型
type LedgerEventPayload =
  | { transaction: TransactionDTO }
  | { transactionId: string; deletedAt: number; version: number }
  | { settings: LedgerSettingsDTO }
  | { member: LedgerMemberDTO }
  | { ledgerId: string; deletedAt: number }
```

业务事件支持：去重（eventId）、判断消息顺序（eventId 单调递增）、断线恢复（afterId）、跳过自己的乐观更新回声（actorUserId）、离线重试幂等（clientMutationId）。

### 同步流程

1. 客户端生成 `clientMutationId`（UUID）和 `transaction.id`（ULID）
2. 写操作先写 IndexedDB（标记 `synced: false`），同时发 API 请求
3. Hono handler 校验 JWT，在 D1 batch 中执行：
   - 检查 `client_mutations` 去重（若已存在且 status=completed，直接返回 response_payload）
   - 写入业务表
   - 写入 `ledger_events`
   - 写入 `client_mutations`
4. Batch 成功后，Handler 通过 Durable Object stub 广播 `LedgerEventMessage`
5. 客户端收到成功响应后标记 `synced: true`
6. 离线时请求失败，保留在 `sync_queue` 中
7. 恢复连接后按顺序重试未同步记录

### 冲突处理策略

| 场景 | 处理方式 |
|---|---|
| 新增交易 | 无冲突，客户端生成 ID + `client_mutations` 幂等提交 |
| 编辑交易 | 携带 version 乐观锁，不匹配返回 409 Conflict，客户端展示最新版本让用户决定 |
| 编辑已删除交易 | 返回 409 Conflict |
| 删除已编辑交易 | 允许，以删除为最终状态 |
| 两人同时编辑同一笔 | 后提交者收到 409，展示冲突 |
| 删除同一笔交易 | 第二次删除幂等返回成功 |
| 设置修改 | owner-only，last write wins，记录事件 |

编辑请求示例：

```http
PUT /api/ledgers/:id/transactions/:tid
Content-Type: application/json

{
  "clientMutationId": "uuid",
  "version": 3,
  "amount": 1500,
  "note": "晚饭"
}
```

版本冲突响应：

```json
{
  "code": "VERSION_CONFLICT",
  "message": "该交易已被其他成员修改",
  "latest": { "id": "...", "version": 4, "amount": 2000, "note": "晚饭" }
}
```

### 断线恢复

客户端维护同步状态机：

```ts
type SyncState = 'disconnected' | 'connecting' | 'catching_up' | 'live'
```

恢复流程：

1. WebSocket 断开触发 `onclose`，状态变为 `disconnected`
2. `useRealtimeSync.ts` 实现指数退避自动重连（1s → 2s → 4s → 8s → 最大 30s）
3. 连接成功后状态变为 `catching_up`
4. 客户端调用 `GET /api/ledgers/:id/events?afterId=<lastSeenEventId>` 拉取缺失事件
5. `catching_up` 期间收到的 WS 事件放入 `pendingEventsBuffer`，不立即应用
6. HTTP 补偿事件按 eventId 顺序应用完成
7. 处理 `pendingEventsBuffer` 中的事件：
   - eventId <= lastSeenEventId：丢弃（重复）
   - eventId == lastSeenEventId + 1：立即应用
   - eventId > lastSeenEventId + 1：继续拉取缺失事件
8. 连续无缺口后状态变为 `live`
9. 同时重试 `sync_queue` 中未同步的写操作
10. 重试时若收到 409 Conflict，提示用户处理冲突

### Durable Object 职责

- 一个账本对应一个 DO 实例
- 管理所有在线成员的 WebSocket 连接
- 从 Worker 接收 userId（Worker 已在升级时验证 Cookie + 校验成员权限）
- 接收 subscribe 消息确认订阅
- 广播 `LedgerEventMessage` 给所有已连接的 WebSocket 客户端
- 不存储业务数据（D1 负责持久化）
- 不查询 D1（权限由 Worker 层完成）
- DO 被驱逐后客户端自动重连，无状态丢失（所有状态在 D1）

### 账本删除处理

1. Owner 请求删除账本
2. 设置 `ledgers.deleted_at`
3. 写入 `ledger_events`：type = `ledger_deleted`
4. 通知 DO 广播 `ledger_deleted` 事件
5. DO 关闭该 ledger 所有 WebSocket 连接
6. 客户端收到后：清除当前账本选择，从账本列表移除，可清理本地 IndexedDB 缓存
7. 后续访问已删除账本：返回 `410 Gone`

## 分享流程

1. 用户创建账本 → 系统在 `ledger_invites` 表生成邀请码（8 位，排除 O/0/I/1/l 字符集，使用 `crypto.getRandomValues()` 生成）
2. 邀请码 24 小时过期，owner 可随时重新生成（旧码自动 revoked）
3. 用户分享链接：`https://xxx.com/join?code=<code>`
4. 好友打开链接 → 调用 `GET /api/invites/:code` 预览账本信息
5. 好友登录 → 调用 `POST /api/invites/join` 加入账本
6. 加入成功后通过 WebSocket 实时同步

## 前端改造

### 新增 Store

- `auth.ts` — 登录状态、用户信息、token 刷新逻辑（HTTP 客户端 401 拦截自动刷新）
- `ledgers.ts` — 账本列表、当前账本
- `websocket.ts` — WebSocket 连接生命周期、同步状态机、重连逻辑

### 新增页面

- `/login` — 登录页
- `/register` — 注册页
- `/ledgers` — 我的账本列表（新首页）
- `/join?code=xxx` — 加入账本

### 改造页面

- `HomePage.vue` — 按 ledgerId 从 API 加载交易，替代本地 IndexedDB
- `SettingsPage.vue` — 账本设置 + 成员管理

### 新增 Composable

- `useRealtimeSync.ts` — 管理 WebSocket 连接，处理消息，维护 lastSeenEventId 和 SyncState 状态机，断线恢复（catching_up + pendingEventsBuffer），指数退避重连

### 数据源策略

| 场景 | 数据源 |
|---|---|
| 已登录 + 在线 | API + WebSocket（主），IndexedDB 作为缓存 |
| 已登录 + 离线 | IndexedDB（队列积攒变更），上线后同步 |
| 未登录 | 重定向到 /login |

### 离线支持

1. 写操作先写 IndexedDB（标记 `synced: false`），同时尝试发 API 请求
2. 请求携带 `clientMutationId`（UUID）保证幂等
3. 成功后标记 `synced: true`
4. 离线时请求失败，保留在 `sync_queue` 中
5. 恢复连接后按顺序重试未同步记录
6. 重试时若收到 409 Conflict，提示用户处理冲突

### IndexedDB 缓存表

- `cached_transactions` — 与 D1 相同结构，增加 `synced` 布尔字段
- `cached_settings` — 当前账本设置缓存
- `sync_queue` — 未同步的写操作队列（含 `clientMutationId`、操作类型、请求体、创建时间）

### 路由守卫

- 未登录 → 重定向到 `/login`
- 已登录 → `/ledgers` 为默认首页
- 已登录 + 已选账本 → `/ledgers/:id`

## 部署

### 前端

| 平台 | 角色 | 触发方式 |
|---|---|---|
| Cloudflare Pages | 主站 | 推送到 main 分支（自动） |

前端与 API 在同一域名下（CF Pages + Workers Routes），通过 `wrangler.toml` 配置 `/api/*` 路由到 Workers。

### 后端

| 组件 | 平台 |
|---|---|
| API | Cloudflare Workers |
| 数据库 | Cloudflare D1 |
| WebSocket | Cloudflare Durable Objects |

### CORS 配置

同站部署下不需要 CORS 配置。Workers Routes 将 `/api/*` 路由到 Workers，前端请求为同源。

### CI/CD

推送到 main 分支 → GitHub Actions：
1. 安装依赖
2. 类型检查 + Lint
3. 运行测试（Vitest）
4. 部署前端到 Cloudflare Pages
5. 部署后端到 Cloudflare Workers（`wrangler deploy`）

### 密钥管理

通过 `wrangler secret put` 管理：
- `JWT_SECRET` — Access Token 签名密钥
- `REFRESH_SECRET` — Refresh Token 签名密钥

GitHub Actions Secrets：
- `CF_API_TOKEN` — Cloudflare 部署 token
- `CF_ACCOUNT_ID` — Cloudflare 账户 ID
- `GITHUB_TOKEN`（自动提供）

### D1 数据库迁移

```bash
wrangler d1 migrations create chat-budget <名称>   # 创建迁移
wrangler d1 migrations apply chat-budget --local    # 本地应用
wrangler d1 migrations apply chat-budget --remote   # 线上应用
```

迁移文件存放在 `apps/api/migrations/`，纳入版本控制。

### 定期清理

Workers Cron Trigger 定期清理过期数据：
- `client_mutations`：`DELETE WHERE expires_at < NOW`（每日）
- `refresh_sessions`：`DELETE WHERE expires_at < NOW AND revoked_at IS NOT NULL`（每日）
- `ledger_invites`：`UPDATE SET revoked_at = NOW WHERE expires_at < NOW AND revoked_at IS NULL`（每小时）

## 本地开发

```bash
# 后端（Wrangler 本地模拟 D1 + DO）
cd apps/api && pnpm dev   # → http://localhost:8787

# 前端
cd apps/web && pnpm dev   # → http://localhost:5173

# Vite 代理 /api/* → localhost:8787
```

## 约束

- 目标用户：每个账本 2-5 人，家庭/室友使用场景
- 所有金额以分（整数）存储，避免浮点精度问题；支出为负整数，收入为正整数，不允许为 0
- MVP 阶段不需要邮箱验证（后续可加）
- Cloudflare Workers 免费层足以覆盖此规模的使用量
- 所有删除操作使用软删除（`deleted_at` 字段）
- 编辑操作使用乐观锁（`version` 字段）
- 前后端同站部署（CF Pages + Workers Routes），`SameSite=Lax` Cookie 在当前部署下可接受；若未来需要跨站部署，需增加 CSRF Token 并改用 `SameSite=None; Secure`
- Owner 不可主动退出账本，需先转让 ownership 或删除账本
- 成员退出后历史交易保留（user_id 不变），退出成员不能再访问账本

# 多用户实时同步设计

## 概述

将单机 PWA 聊天式记账应用改造为多人协作记账应用。用户可以创建多个账本，通过邀请码分享给好友，实时共同记账。支持离线写入和断线恢复。

## 架构

- **前端**：Vue 3 PWA（现有），部署到 Cloudflare Pages（主）+ GitHub Pages（备）
- **后端**：Hono + Cloudflare Workers + D1 (SQLite) + Durable Objects (WebSocket)
- **共享**：monorepo 中 `packages/shared` 存放共享 TypeScript 类型
- **实时同步**：通过 Durable Objects 建立 WebSocket，向所有在线成员广播变更；基于事件序列号实现断线恢复
- **认证**：邮箱 + 密码，双 JWT（Access + Refresh）存储在 HttpOnly Cookie 中

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
│       │   │   └── auth.ts
│       │   ├── routes/
│       │   │   ├── auth.ts
│       │   │   ├── ledgers.ts
│       │   │   ├── transactions.ts
│       │   │   ├── members.ts
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
  avatar TEXT,
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
  id TEXT PRIMARY KEY,
  ledger_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  amount INTEGER NOT NULL,
  note TEXT NOT NULL,
  date TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  created_by TEXT NOT NULL,
  updated_by TEXT,
  deleted_by TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY (ledger_id) REFERENCES ledgers(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE ledger_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ledger_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  client_mutation_id TEXT,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (ledger_id, seq)
);

CREATE TABLE client_mutations (
  id TEXT PRIMARY KEY,
  ledger_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  event_id INTEGER,
  created_at INTEGER NOT NULL
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
CREATE INDEX idx_transactions_ledger_date ON transactions(ledger_id, date);
CREATE INDEX idx_transactions_ledger_updated ON transactions(ledger_id, updated_at);
CREATE INDEX idx_ledger_members_user ON ledger_members(user_id);
CREATE INDEX idx_ledger_members_ledger ON ledger_members(ledger_id);
CREATE INDEX idx_ledger_events_ledger_seq ON ledger_events(ledger_id, seq);
CREATE INDEX idx_client_mutations_ledger ON client_mutations(ledger_id);
CREATE INDEX idx_limit_history_ledger_date ON limit_history(ledger_id, effective_date);
```

### 字段说明

- **transactions.id**：客户端生成的 ULID，全局唯一且天然有序。无论在线还是离线，客户端直接生成 ID，服务端采用 `INSERT OR IGNORE` 保证幂等
- **transactions.version**：乐观锁版本号，每次编辑递增。PUT 请求携带当前 version，服务端不匹配返回 409
- **transactions.amount**：支出为负整数，收入为正整数；前端展示时取绝对值并按符号区分颜色
- **transactions.deleted_at**：软删除时间戳，非 NULL 表示已删除。查询时自动过滤
- **ledger_events.seq**：每个账本内递增的事件序列号，用于断线恢复。客户端记录 lastSeenSeq
- **client_mutations.id**：客户端生成的 UUID，服务端通过此字段去重，保证离线重试幂等
- **ledger_invites.code**：8 位随机码（字符集：大写字母 + 数字，排除 O/0/I/1/l），24 小时过期

## API 路由

### 认证

- `POST /api/auth/register` — 注册（邮箱 + 密码 + 昵称）
- `POST /api/auth/login` — 登录（通过 HttpOnly Cookie 返回 Access Token 和 Refresh Token）
- `POST /api/auth/refresh` — 刷新 Access Token（读取 Refresh Cookie，签发新 Access Cookie）
- `POST /api/auth/logout` — 登出（清除 Cookie）
- `GET /api/auth/me` — 获取当前用户信息

### 账本

- `GET /api/ledgers` — 我的账本列表
- `POST /api/ledgers` — 创建账本
- `GET /api/ledgers/:id` — 账本详情
- `PUT /api/ledgers/:id` — 更新账本（名称/限额，仅 owner）
- `DELETE /api/ledgers/:id` — 删除账本（软删除，仅 owner）

### 成员

- `POST /api/ledgers/:id/join` — 通过邀请码加入账本（限流：每分钟 10 次/IP）
- `GET /api/ledgers/:id/members` — 成员列表
- `DELETE /api/ledgers/:id/members/:uid` — 移除成员（仅 owner）
- `DELETE /api/ledgers/:id/members/me` — 成员主动退出账本

### 交易

- `GET /api/ledgers/:id/transactions?cursor=<last_id>&limit=30` — 基于 cursor 分页获取交易列表
- `POST /api/ledgers/:id/transactions` — 新增交易
- `PUT /api/ledgers/:id/transactions/:tid` — 编辑交易（携带 version，乐观锁校验）
- `DELETE /api/ledgers/:id/transactions/:tid` — 删除交易（软删除）

### 邀请

- `GET /api/ledgers/:id/invite` — 获取当前邀请码/链接
- `POST /api/ledgers/:id/invite/rotate` — 重新生成邀请码（仅 owner）

### 事件

- `GET /api/ledgers/:id/events?afterSeq=123&limit=100` — 拉取指定序列号之后的事件（断线恢复）

### WebSocket

- `WS /api/ws/:ledgerId` — 实时同步连接

## 认证方案

### 双 Token 机制

- **Access Token**：JWT，15 分钟过期，载荷 `{ userId, email, exp }`
- **Refresh Token**：JWT，7 天过期，载荷 `{ userId, type: 'refresh', exp }`
- 两个 token 分别存入独立的 HttpOnly Cookie：
  - Access Cookie：`Path=/`，`HttpOnly`，`Secure`，`SameSite=Lax`
  - Refresh Cookie：`Path=/api/auth/refresh`，`HttpOnly`，`Secure`，`SameSite=Lax`（路径限定，只在刷新请求时发送）

### CSRF 防护

- Cookie 设置 `SameSite=Lax`，前后端同域（CF Pages + Workers 路由）此方案已足够
- 不使用 CORS fetch 模式携带 Cookie 的场景下，`SameSite=Lax` 阻止跨站 POST

### WebSocket 认证

- WebSocket 升级请求（同域）浏览器自动携带 HttpOnly Cookie
- Worker 在 upgrade 时解析 Cookie 验证 Access Token，提取 userId
- Worker 将 userId 通过 DO stub 传递给 Durable Object
- 连接建立后，客户端发送 `{ type: 'subscribe', ledgerId }` 消息，DO 确认订阅的账本
- DO 校验用户是否为该账本成员，非成员立即断开连接
- subscribe 之前 DO 不处理任何其他消息
- URL 中不传任何认证信息
- Worker 增加 Origin 校验，拒绝非白名单域名的连接

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
| 主动退出账本 | 是 | 是 |

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

// 服务器 → 客户端（统一事件格式）
type ServerEvent = {
  type: 'transaction_added' | 'transaction_updated' | 'transaction_deleted'
    | 'settings_updated' | 'member_joined' | 'member_left'
    | 'connected' | 'pong' | 'error'
  ledgerId: string
  eventId: string
  eventSeq: number
  entityId: string
  actorUserId: string
  clientMutationId?: string
  occurredAt: number
  payload: unknown
}
```

事件格式支持：去重（eventId）、判断消息顺序（eventSeq）、断线恢复（afterSeq）、跳过自己的乐观更新回声（actorUserId）、离线重试幂等（clientMutationId）。

### 同步流程

1. 客户端生成 `clientMutationId`（UUID）和 `transaction.id`（ULID）
2. 写操作先写 IndexedDB（标记 `synced: false`），同时发 API 请求
3. Hono handler 校验 JWT，检查 `client_mutations` 去重
4. 若未重复，写入业务表 + `ledger_events`（递增 seq）
5. 记录 `client_mutations`
6. Handler 通过 Durable Object stub 广播事件
7. 客户端收到成功响应后标记 `synced: true`
8. 离线时请求失败，保留在 `sync_queue` 中
9. 恢复连接后按顺序重试未同步记录

### 冲突处理策略

| 场景 | 处理方式 |
|---|---|
| 新增交易 | 无冲突，客户端生成 ID + 幂等提交 |
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

1. 客户端 WebSocket 断开触发 `onclose`
2. `useRealtimeSync.ts` 实现指数退避自动重连（1s → 2s → 4s → 8s → 最大 30s）
3. 重连成功后发 `GET /api/ledgers/:id/events?afterSeq=<lastSeenSeq>` 补齐断线期间的事件
4. 补齐后恢复 WS 实时推送
5. 同时重试 `sync_queue` 中未同步的写操作

### Durable Object 职责

- 一个账本对应一个 DO 实例
- 管理所有在线成员的 WebSocket 连接
- 从 Worker 接收 userId（Worker 已在升级时验证 Cookie 中的 JWT）
- 接收 subscribe 消息并验证用户是否为该账本成员
- 广播事件给所有已连接的 WebSocket 客户端
- 不存储业务数据（D1 负责持久化）
- DO 被驱逐后客户端自动重连，无状态丢失（所有状态在 D1）

## 分享流程

1. 用户创建账本 → 系统在 `ledger_invites` 表生成邀请码（8 位，排除 O/0/I/1/l 字符集）
2. 邀请码 24 小时过期，owner 可随时重新生成
3. 用户分享链接：`https://xxx.com/join?code=<code>`
4. 好友打开链接 → 登录 → 调用 `POST /api/ledgers/:id/join` 自动加入账本
5. 加入成功后通过 WebSocket 实时同步

## 前端改造

### 新增 Store

- `auth.ts` — 登录状态、用户信息、token 刷新逻辑
- `ledgers.ts` — 账本列表、当前账本
- `websocket.ts` — WebSocket 连接生命周期、重连逻辑

### 新增页面

- `/login` — 登录页
- `/register` — 注册页
- `/ledgers` — 我的账本列表（新首页）
- `/join?code=xxx` — 加入账本

### 改造页面

- `HomePage.vue` — 按 ledgerId 从 API 加载交易，替代本地 IndexedDB
- `SettingsPage.vue` — 账本设置 + 成员管理

### 新增 Composable

- `useRealtimeSync.ts` — 管理 WebSocket 连接，处理消息，维护 lastSeenSeq，断线恢复，指数退避重连

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
| GitHub Pages | 备站 | 推送到 main 分支（CI） |

两个前端地址指向同一个 Cloudflare Workers API 后端，通过环境变量 `VITE_API_BASE` 区分。

### 后端

| 组件 | 平台 |
|---|---|
| API | Cloudflare Workers |
| 数据库 | Cloudflare D1 |
| WebSocket | Cloudflare Durable Objects |

### CORS 配置

Workers 配置允许的 origins 白名单：
- Cloudflare Pages 域名（`xxx.pages.dev`）
- GitHub Pages 域名（`xxx.github.io`）
- 本地开发（`localhost:5173`）

使用 Hono `cors()` 中间件处理 `OPTIONS` 预检请求。

### CI/CD

推送到 main 分支 → GitHub Actions：
1. 安装依赖
2. 类型检查 + Lint
3. 部署前端到 Cloudflare Pages
4. 部署前端到 GitHub Pages
5. 部署后端到 Cloudflare Workers（`wrangler deploy`）

### 密钥管理

通过 `wrangler secret put` 管理：
- `JWT_SECRET` — Access Token 签名密钥
- `REFRESH_SECRET` — Refresh Token 签名密钥
- `CF_API_TOKEN` — Cloudflare 部署 token
- `CF_ACCOUNT_ID` — Cloudflare 账户 ID

GitHub Actions Secrets：
- `CF_API_TOKEN`
- `CF_ACCOUNT_ID`
- `GITHUB_TOKEN`（GitHub Pages 部署）

### GitHub Pages SPA 路由处理

在 `public/404.html` 中实现客户端 redirect：
```html
<script>
  var path = sessionStorage.redirect || location.pathname + location.search
  sessionStorage.redirect = path
  location.replace('/chat-budget/')
</script>
```

### D1 数据库迁移

```bash
wrangler d1 migrations create chat-budget <名称>   # 创建迁移
wrangler d1 migrations apply chat-budget --local    # 本地应用
wrangler d1 migrations apply chat-budget --remote   # 线上应用
```

迁移文件存放在 `apps/api/migrations/`，纳入版本控制。

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
- 所有金额以分（整数）存储，避免浮点精度问题；支出为负整数，收入为正整数
- MVP 阶段不需要邮箱验证（后续可加）
- Cloudflare Workers 免费层足以覆盖此规模的使用量
- 所有删除操作使用软删除（`deleted_at` 字段）
- 编辑操作使用乐观锁（`version` 字段）

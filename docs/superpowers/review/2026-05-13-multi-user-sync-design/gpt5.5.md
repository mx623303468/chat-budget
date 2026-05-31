# 多用户实时同步设计审查报告

审查对象：`2026-05-13-multi-user-sync-design.md`

## 1. 总体结论

该方案整体方向是合理的：  
使用 **Vue 3 PWA + Cloudflare Workers + D1 + Durable Objects + WebSocket** 来实现小规模多人协作记账，技术选型与目标场景匹配。目标用户限定为每个账本 2-5 人，家庭/室友使用场景，复杂度控制较好。

但当前设计仍存在几个关键风险：

1. **认证与 WebSocket token 传递存在安全隐患**
2. **离线同步设计过于简略，缺少冲突处理与幂等机制**
3. **交易表缺少更新、删除、同步版本字段**
4. **权限模型不够完整，API 只描述了部分 owner 权限**
5. **邀请码设计过短，容易被枚举**
6. **实时同步协议缺少事件版本、来源标识、重放恢复能力**
7. **D1 数据模型缺少必要索引、软删除和审计字段**

建议：  
**可以作为 MVP 方向通过，但不建议直接进入实现。应先补充同步一致性、安全、权限、数据模型字段后再开发。**

---

## 2. 方案优点

### 2.1 架构选型清晰

方案将前端、后端、共享类型、实时同步、认证职责拆分清楚，monorepo 结构也比较适合前后端共享 TypeScript 类型。设计中明确了 `apps/web`、`apps/api`、`packages/shared` 的分层，后续维护成本较低。

### 2.2 Cloudflare 技术栈适合小规模协作场景

目标规模是每个账本 2-5 人，使用 Workers + D1 + Durable Objects 可以满足轻量级实时协作需求。Durable Object 按账本维度管理 WebSocket 连接，这个思路是正确的。

### 2.3 金额使用整数存储是正确选择

方案明确“所有金额以分存储”，避免浮点精度问题，这是记账系统中非常重要的基础约束。

### 2.4 前端迁移路径相对平滑

保留 PWA 和 IndexedDB 缓存，并将在线数据源切换为 API + WebSocket，离线时继续使用 IndexedDB，这对现有单机应用改造成多人应用比较友好。

---

## 3. 关键问题与风险

## 3.1 认证方案风险较高

当前方案写到：

> JWT 存储在 HttpOnly Cookie 中；WebSocket 通过 query param 传递 token。

这个设计存在矛盾和安全风险。  
如果 JWT 已经放在 HttpOnly Cookie 中，前端 JavaScript 理论上无法直接读取 token，因此无法稳定地把 token 放到 WebSocket query param 中。并且 query param 里的 token 容易出现在日志、浏览器历史、代理记录中。

### 风险等级

**高**

### 建议修改

WebSocket 认证建议改为：

```md
- WebSocket 握手时直接依赖 HttpOnly Cookie
- Worker 在 upgrade 前解析 Cookie 并校验 JWT
- 不通过 query param 传递 token
- 对 WebSocket 增加 Origin 校验
- Cookie 设置 Secure、HttpOnly、SameSite=Lax 或 Strict
```

如果确实需要前端传 token，应改用短期一次性 WebSocket ticket：

```md
1. 客户端请求 POST /api/ws-ticket
2. 服务端校验 Cookie 后签发 30 秒有效的一次性 ticket
3. 客户端通过 ws://...?ticket=xxx 建连
4. DO 校验 ticket 并立即作废
```

---

## 3.2 邀请码过短，容易被枚举

方案中示例邀请码为 `"A3K9"`，只有 4 位。对于公开接口来说，4 位邀请码空间太小，容易被暴力尝试。

### 风险等级

**高**

### 建议修改

邀请码建议至少满足：

```md
- 长度不少于 8-10 位
- 使用不易混淆字符集，例如大写字母 + 数字，排除 O/0/I/1
- 服务端对 join 接口增加频率限制
- 邀请码支持重新生成
- 可选：支持过期时间
```

数据模型建议调整：

```sql
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
```

不建议长期把唯一邀请码直接放在 `ledgers.invite_code` 中。

---

## 3.3 数据模型缺少更新、删除、版本字段

当前 `transactions` 表只有：

```sql
id, ledger_id, user_id, amount, note, date, created_at
```

但 API 设计包含编辑和删除交易。

缺少以下字段会导致几个问题：

1. 无法知道记录最后更新时间
2. 删除后无法被离线客户端感知
3. WebSocket 重连后无法增量恢复
4. 客户端离线编辑时无法判断冲突
5. 无法审计谁修改或删除了交易

### 风险等级

**高**

### 建议修改

建议改为：

```sql
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
```

同时建议把 `id INTEGER AUTOINCREMENT` 改成客户端可生成的 UUID/ULID：

```md
- 客户端离线创建交易时生成 clientId
- 服务端使用该 id 落库
- 重试时天然幂等
- 避免离线队列重复提交产生重复交易
```

---

## 3.4 离线同步方案不足

当前离线方案描述为：

```md
- 写操作先写 IndexedDB，标记 synced: false
- 同时尝试发 API 请求
- 失败保留队列
- 恢复连接后自动重试
```

这个方向正确，但还不足以支撑多人协作。

缺失内容包括：

1. 同一条交易被多人同时编辑如何处理
2. 离线新增后重复提交如何幂等
3. 离线删除和远端编辑冲突如何处理
4. 客户端如何知道自己漏了哪些事件
5. WebSocket 断线期间如何补数据
6. 本地 pending 数据和远端数据如何合并

### 风险等级

**高**

### 建议补充

建议引入以下机制：

```md
- 所有写操作携带 clientMutationId
- 服务端记录已处理 mutation，避免重复执行
- 每个账本维护递增 event_seq
- WebSocket 消息包含 eventSeq
- 客户端保存 lastSeenEventSeq
- 重连后调用 GET /api/ledgers/:id/events?after=xxx 拉取缺失事件
- 每条业务记录包含 version
- 编辑时使用 If-Match/version 校验
```

建议新增表：

```sql
CREATE TABLE ledger_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ledger_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (ledger_id, seq)
);

CREATE TABLE client_mutations (
  id TEXT PRIMARY KEY,
  ledger_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  result_event_id INTEGER,
  created_at INTEGER NOT NULL
);
```

---

## 3.5 WebSocket 协议缺少关键字段

当前 WebSocket 消息只有事件类型和实体数据，例如：

```ts
{ type: 'transaction_added'; transaction: Transaction }
```

但缺少多人实时协作中很关键的元信息。

### 风险等级

**中高**

### 建议修改

建议统一事件格式：

```ts
type ServerEvent = {
  type:
    | 'transaction_added'
    | 'transaction_updated'
    | 'transaction_deleted'
    | 'settings_updated'
    | 'member_joined'
    | 'member_left'

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

这样可以支持：

```md
- 去重
- 判断消息顺序
- 断线恢复
- 跳过自己发起的乐观更新回声
- 日后做操作历史
```

---

## 3.6 API 权限描述不完整

当前只明确了删除账本、移除成员是 owner 权限。  
但其他接口权限没有完全定义，例如：

```md
- 成员是否可以修改账本名称？
- 成员是否可以修改限额？
- 成员是否可以编辑别人的交易？
- 成员是否可以删除别人的交易？
- owner 是否可以转让？
- owner 删除自己时如何处理？
```

### 风险等级

**中高**

### 建议补充权限矩阵

建议新增权限表：

| 操作 | owner | member |
|---|---:|---:|
| 查看账本 | 是 | 是 |
| 新增交易 | 是 | 是 |
| 编辑自己的交易 | 是 | 是 |
| 编辑他人交易 | 是 | 可选，建议否 |
| 删除自己的交易 | 是 | 是 |
| 删除他人交易 | 是 | 可选，建议否 |
| 修改账本名称 | 是 | 否 |
| 修改限额 | 是 | 否 |
| 查看成员 | 是 | 是 |
| 移除成员 | 是 | 否 |
| 重新生成邀请码 | 是 | 否 |
| 删除账本 | 是 | 否 |

后端所有接口都应统一走：

```ts
requireLedgerMember(ledgerId, userId)
requireLedgerOwner(ledgerId, userId)
requireTransactionOwnerOrLedgerOwner(transactionId, userId)
```

---

## 3.7 删除账本需要谨慎设计

当前有：

```md
DELETE /api/ledgers/:id — 删除账本（仅 owner）
```

但没有说明是硬删除还是软删除。对于记账数据，不建议直接硬删除。

### 风险等级

**中**

### 建议修改

建议使用软删除：

```sql
ALTER TABLE ledgers ADD COLUMN deleted_at INTEGER;
ALTER TABLE ledgers ADD COLUMN deleted_by TEXT;
```

交易、成员、事件也尽量保留历史。  
删除账本后：

```md
- 普通列表不显示
- WebSocket 断开所有连接
- API 返回 410 Gone 或 404
- 保留一定时间后再做物理清理
```

---

## 3.8 设置与限额模型不够完整

`ledgers` 表有 `daily_limit`，同时又有 `limit_history`，但缺少约束关系。

当前问题：

1. `limit_history` 是否允许同一天多条？
2. 修改限额是否同时更新 `ledgers.daily_limit`？
3. 历史限额如何用于历史日期统计？
4. `start_date` 修改后如何影响历史数据？

### 风险等级

**中**

### 建议修改

```sql
CREATE TABLE limit_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ledger_id TEXT NOT NULL,
  effective_date TEXT NOT NULL,
  daily_limit INTEGER NOT NULL,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (ledger_id, effective_date)
);
```

如果需要保留当前限额，可以继续放在 `ledgers.daily_limit`，但要明确：

```md
- ledgers.daily_limit 表示当前生效限额
- limit_history 表示按日期生效的历史限额
- 更新限额时两者同时写入一个事务
```

---

## 3.9 缺少必要索引

当前索引只有：

```sql
CREATE INDEX idx_transactions_ledger ON transactions(ledger_id, created_at);
CREATE INDEX idx_ledger_members_user ON ledger_members(user_id);
```

对于常见查询还不够。

### 建议增加

```sql
CREATE INDEX idx_transactions_ledger_date
ON transactions(ledger_id, date);

CREATE INDEX idx_transactions_ledger_updated
ON transactions(ledger_id, updated_at);

CREATE INDEX idx_ledger_members_ledger
ON ledger_members(ledger_id);

CREATE INDEX idx_limit_history_ledger_date
ON limit_history(ledger_id, date);
```

如果使用软删除：

```sql
CREATE INDEX idx_transactions_active
ON transactions(ledger_id, date)
WHERE deleted_at IS NULL;
```

---

## 3.10 部署方案中 GitHub Pages 备站价值有限

方案设计 Cloudflare Pages 为主站，GitHub Pages 为备站。

但如果后端 API 仍然只有 Cloudflare Workers，那么 Cloudflare 故障时 GitHub Pages 只能打开前端静态资源，核心功能仍可能不可用。

### 风险等级

**低到中**

### 建议

MVP 阶段可以先不做 GitHub Pages 备站，减少 CI/CD 复杂度。  
更有价值的是：

```md
- Cloudflare Pages Preview 环境
- staging / production 环境变量隔离
- D1 本地、预发、生产数据库隔离
- 回滚策略
```

---

## 4. 建议补充的核心设计

## 4.1 推荐新增“同步事件流”

当前设计只广播变更，不记录事件。建议增加事件表，作为断线恢复、离线同步、调试审计的基础。

```sql
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
```

对应 API：

```md
GET /api/ledgers/:id/events?afterSeq=123
```

客户端流程：

```md
1. WebSocket 正常接收事件
2. 每处理一个事件，保存 lastSeenSeq
3. 断线重连后先拉 events?afterSeq=lastSeenSeq
4. 补齐后再恢复实时 WebSocket
```

---

## 4.2 推荐新增幂等写入机制

离线队列一定要防止重复提交。

客户端每个写操作生成：

```ts
clientMutationId = crypto.randomUUID()
```

请求示例：

```json
{
  "clientMutationId": "uuid",
  "amount": 1200,
  "note": "午饭",
  "date": "2026-05-13"
}
```

服务端逻辑：

```md
1. 检查 client_mutations 是否已存在
2. 如果已存在，直接返回之前的结果
3. 如果不存在，执行业务写入
4. 写入 ledger_events
5. 记录 client_mutations
6. 广播事件
```

---

## 4.3 推荐明确冲突策略

MVP 可以不做复杂 CRDT，但必须明确规则。

建议：

```md
- 新增交易：无冲突，使用客户端生成 ID + 幂等提交
- 编辑交易：使用 version 乐观锁
- 删除交易：软删除
- 编辑已删除交易：返回 409 Conflict
- 删除已编辑交易：允许，以删除为最终状态
- 设置修改：owner-only，last write wins，并记录事件
```

编辑请求：

```http
PUT /api/ledgers/:id/transactions/:tid
If-Match: 3
```

或请求体：

```json
{
  "version": 3,
  "amount": 1500,
  "note": "晚饭"
}
```

版本不匹配返回：

```json
{
  "code": "VERSION_CONFLICT",
  "latest": { }
}
```

---

## 5. 建议调整后的 MVP 范围

为了降低实现风险，建议 MVP 分两阶段。

## 阶段 1：在线多人协作

先实现：

```md
- 注册 / 登录 / 当前用户
- 创建账本 / 加入账本 / 成员列表
- 交易 CRUD
- WebSocket 实时广播
- IndexedDB 只做只读缓存
- 断线后重新全量或分页拉取交易
```

暂缓：

```md
- 离线写入队列
- 冲突合并
- 历史事件流 UI
- GitHub Pages 备站
```

## 阶段 2：完整离线同步

再实现：

```md
- sync_queue
- clientMutationId
- ledger_events
- lastSeenSeq
- version 冲突检测
- 断线事件补偿
```

这样能避免一次性引入过多复杂度。

---

## 6. 修订版数据表建议

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
```

---

## 7. 审查结论

| 模块 | 结论 |
|---|---|
| 技术选型 | 通过 |
| Monorepo 结构 | 通过 |
| D1 数据模型 | 需修改 |
| API 路由设计 | 基本通过，需补权限 |
| 认证方案 | 需修改 |
| WebSocket 同步 | 需增强 |
| 离线同步 | 不建议 MVP 一次实现 |
| 邀请机制 | 需修改 |
| 部署方案 | 可简化 |
| 安全性 | 需补充 |

最终建议：

```md
该设计可以作为总体方向继续推进，但需要先修订以下内容后再进入编码：

1. WebSocket 不通过 query param 传 JWT
2. 邀请码改为长码，并增加限流/撤销/过期机制
3. transactions 改用 UUID/ULID，增加 updated_at、deleted_at、version
4. 增加 clientMutationId，保证离线重试幂等
5. 增加 ledger_events，支持断线恢复和事件补偿
6. 明确 owner/member 权限矩阵
7. MVP 阶段先做在线实时同步，离线写入放到第二阶段
```

总体评价：**方案方向正确，但当前版本更像高层设计草案，还不够作为可直接实现的技术方案。**

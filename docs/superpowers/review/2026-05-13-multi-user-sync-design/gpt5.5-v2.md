# 多用户实时同步设计二次审查报告

审查对象：`2026-05-13-multi-user-sync-design(1).md`

## 1. 总体结论

新版设计相较上一版有明显进步，已经针对上次审查中的主要问题做了系统性修正，包括：

- JWT 不再通过 WebSocket query param 传递；
- 引入 Access Token + Refresh Token；
- 邀请码从 4 位改为 8 位，并支持过期与轮换；
- `transactions` 改为客户端生成 ULID；
- 增加 `version`、`deleted_at`、`updated_at` 等字段；
- 增加 `ledger_events` 事件流；
- 增加 `client_mutations` 幂等表；
- 明确 owner/member 权限矩阵；
- 增加断线恢复、冲突处理、离线队列、指数退避重连等机制。

总体评价：

> 新版已经从“高层设计草案”提升为“可进入详细设计与实现拆分阶段”的技术方案。

但仍不建议直接无修改开工。当前版本还有一些关键细节需要进一步收敛，主要集中在：

1. Cloudflare Workers / Durable Objects / D1 的职责边界仍需再明确
2. WebSocket 与事件补偿流程存在顺序竞态
3. `ledger_events.seq` 的递增生成方式没有说明，D1 并发下可能出错
4. `client_mutations` 幂等设计还不够完整
5. Refresh Token 安全模型偏简略，缺少服务端撤销能力
6. CORS、Cookie、GitHub Pages 备站三者组合存在实际部署冲突
7. 邀请加入 API 的路径设计与邀请码流程不完全匹配
8. 离线编辑、删除、重试时的本地状态机仍需细化
9. `INSERT OR IGNORE` 用于交易幂等可能掩盖异常
10. MVP 范围仍然偏大，建议拆分交付

结论建议：

| 项目 | 结论 |
|---|---|
| 架构方向 | 通过 |
| 数据模型 | 基本通过，需补并发与约束细节 |
| 认证方案 | 基本通过，需补 Refresh Token 撤销与 CSRF 细节 |
| WebSocket 方案 | 基本通过，需修正断线补偿顺序 |
| 离线同步 | 方向正确，但实现复杂度高，建议拆阶段 |
| 权限设计 | 基本通过，需补 owner 退出/转让规则 |
| 部署方案 | 有风险，尤其是 GitHub Pages + Cookie |
| 是否可开发 | 可进入详细设计，但不建议直接全量实现 |

---

## 2. 与上一版相比的改进评估

### 2.1 认证问题已有明显修正

上一版最大问题之一是：JWT 存在 HttpOnly Cookie 中，但 WebSocket 又要求通过 query param 传 token。新版已经修正为：

```md
- WebSocket 升级请求由浏览器自动携带 HttpOnly Cookie
- Worker 在 upgrade 时解析 Cookie 验证 Access Token
- URL 中不传任何认证信息
- Worker 增加 Origin 校验
```

这是正确方向。该修改解决了 token 泄露到 URL、日志、代理记录中的问题。

**评价：通过，但需要补充 Refresh Token 服务端撤销能力。**

### 2.2 数据模型明显增强

新版增加了：

```sql
updated_at
deleted_at
version
created_by
updated_by
deleted_by
ledger_events
client_mutations
ledger_invites
```

这使系统具备了：

- 软删除能力；
- 乐观锁能力；
- 事件补偿能力；
- 离线幂等重试能力；
- 邀请码独立管理能力。

**评价：基本通过。**

但仍需要补充：

- `ledger_events.seq` 如何安全递增；
- `client_mutations` 如何绑定操作结果；
- `transactions.user_id` 与 `created_by` 是否重复；
- 软删除数据如何过滤与恢复；
- 事件 payload 是否保存完整快照还是补丁。

### 2.3 权限矩阵已补充

新版明确了 owner 与 member 的能力边界，解决了上一版权限描述不完整的问题。

**评价：基本通过。**

仍需补充：

```md
- owner 是否可以主动退出账本？
- 如果 owner 是唯一成员，退出时账本如何处理？
- 是否支持 owner 转让？
- 删除账本后成员访问返回 404、403 还是 410？
- 被移除成员的本地缓存如何清理？
```

### 2.4 离线同步方案已补强

新版补充了：

- `clientMutationId`
- `sync_queue`
- `lastSeenSeq`
- `ledger_events`
- 409 Conflict
- 指数退避重连
- 断线后拉取事件补偿

这是多人协作离线同步的正确基础。

**评价：方向正确，但实现复杂度已经明显超过普通 MVP。**

建议将离线写入拆到第二阶段，第一阶段先实现：

```md
- 在线 CRUD
- WebSocket 广播
- 断线后拉取最新数据
- IndexedDB 只做只读缓存
```

---

## 3. 当前设计仍存在的关键问题

### 3.1 `ledger_events.seq` 的递增生成方式未定义

新版设计中：

```sql
CREATE TABLE ledger_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ledger_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  ...
  UNIQUE (ledger_id, seq)
);
```

并说明：

```md
ledger_events.seq：每个账本内递增的事件序列号，用于断线恢复
```

但没有说明 `seq` 如何生成。

这是一个关键问题。

在并发写入时，如果服务端逻辑是：

```sql
SELECT MAX(seq) FROM ledger_events WHERE ledger_id = ?
INSERT INTO ledger_events(seq = max + 1)
```

则两个请求并发执行时可能同时拿到相同的 `max(seq)`，导致冲突。

**风险等级：高**

建议新增账本序列表：

```sql
CREATE TABLE ledger_counters (
  ledger_id TEXT PRIMARY KEY,
  next_event_seq INTEGER NOT NULL,
  FOREIGN KEY (ledger_id) REFERENCES ledgers(id)
);
```

每次写入事件时，在同一个事务中执行：

```sql
UPDATE ledger_counters
SET next_event_seq = next_event_seq + 1
WHERE ledger_id = ?
RETURNING next_event_seq;
```

如果 D1 当前使用环境对 `RETURNING` 支持存在限制，也可以采用：

```sql
BEGIN;

UPDATE ledger_counters
SET next_event_seq = next_event_seq + 1
WHERE ledger_id = ?;

SELECT next_event_seq
FROM ledger_counters
WHERE ledger_id = ?;

INSERT INTO ledger_events (..., seq, ...)
VALUES (...);

COMMIT;
```

更重要的是：业务表写入、事件写入、client_mutations 写入必须在同一个事务内完成。

建议在文档中明确：

```md
所有写接口必须使用 D1 transaction/batch 保证以下操作原子完成：

1. 校验 clientMutationId 是否已处理
2. 校验权限
3. 校验 version
4. 写业务表
5. 递增 ledger_counters.next_event_seq
6. 写 ledger_events
7. 写 client_mutations
8. 返回事件结果
```

### 3.2 `client_mutations` 设计还不够完整

当前表结构：

```sql
CREATE TABLE client_mutations (
  id TEXT PRIMARY KEY,
  ledger_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  event_id INTEGER,
  created_at INTEGER NOT NULL
);
```

这个设计能记录“某个 mutation 已处理”，但还不足以完整支持幂等返回。

问题包括：

1. 重试时如何返回第一次请求的完整响应？
2. 第一次写入业务成功但广播失败，重试时是否重新广播？
3. 同一个 `clientMutationId` 是否可能被不同用户误用？
4. 同一个用户在不同账本中是否可能生成相同 UUID？
5. mutation 处理中断后是否会留下半成品状态？
6. mutation 对应的操作类型是什么？

**风险等级：中高**

建议修改为：

```sql
CREATE TABLE client_mutations (
  id TEXT NOT NULL,
  ledger_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  operation_type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  status TEXT NOT NULL DEFAULT 'completed',
  event_id INTEGER,
  response_payload TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (ledger_id, user_id, id)
);
```

重试逻辑建议定义为：

```md
当收到重复 clientMutationId：

- 如果 status = completed：
  - 返回 response_payload
  - 不重新写业务表
  - 不重新创建事件
  - 是否重新广播可选，默认不重新广播

- 如果 status = processing：
  - 返回 409 或 202，让客户端稍后重试

- 如果 status = failed：
  - 根据失败类型决定是否允许重试
```

MVP 可以不做 `processing` 状态，但至少要保存 `response_payload` 或能通过 `event_id` 还原响应。

### 3.3 WebSocket 断线恢复流程存在竞态

当前断线恢复流程是：

```md
1. WebSocket 断开
2. 自动重连
3. 重连成功后 GET /events?afterSeq=lastSeenSeq 补齐事件
4. 补齐后恢复 WS 实时推送
5. 同时重试 sync_queue
```

这个描述有一个潜在竞态：客户端 WebSocket 已经连上，但还没完成 events 补偿。此时服务端又通过 WebSocket 推来了新事件。客户端可能先处理新事件，再处理旧事件补偿，导致乱序。

虽然有 `eventSeq` 可以判断顺序，但文档没有明确客户端如何处理乱序事件。

**风险等级：中高**

客户端应有明确状态机：

```ts
type SyncState =
  | 'disconnected'
  | 'connecting'
  | 'catching_up'
  | 'live'
```

推荐流程：

```md
1. WebSocket 连接成功
2. 客户端进入 catching_up
3. 客户端调用 GET /events?afterSeq=lastSeenSeq
4. catching_up 期间收到的 WS 事件先放入 pendingEventsBuffer
5. HTTP 补偿事件按 seq 应用完成
6. 再处理 pendingEventsBuffer
7. 如果发现 seq 连续，则进入 live
8. 如果发现缺口，则继续拉 events 补偿
```

事件处理必须满足：

```md
- eventSeq <= lastSeenSeq：丢弃
- eventSeq == lastSeenSeq + 1：立即应用
- eventSeq > lastSeenSeq + 1：暂停应用，拉取缺失事件
```

### 3.4 WebSocket `connected` / `pong` 与统一事件格式不完全匹配

新版定义：

```ts
type ServerEvent = {
  type: 'transaction_added' | ... | 'connected' | 'pong' | 'error'
  ledgerId: string
  eventId: string
  eventSeq: number
  entityId: string
  actorUserId: string
  ...
}
```

但 `connected`、`pong`、`error` 不一定有 `eventId`、`eventSeq`、`entityId`、`actorUserId`。例如 `pong` 只是心跳响应，不应该占用业务事件序列号。

**风险等级：中**

建议拆分业务事件与控制消息：

```ts
type ServerMessage =
  | ControlMessage
  | LedgerEventMessage

type ControlMessage =
  | { type: 'connected'; ledgerId: string; lastSeq: number; onlineMembers: OnlineMember[] }
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

### 3.5 WebSocket 权限校验职责需要再明确

新版写到：

```md
Worker 在 upgrade 时解析 Cookie 验证 Access Token，提取 userId
Worker 将 userId 通过 DO stub 传递给 Durable Object
连接建立后，客户端发送 subscribe
DO 校验用户是否为该账本成员
```

这个方向是对的，但要注意一点：Durable Object 本身是否直接访问 D1 查询成员关系？

如果 DO 需要校验用户是否为账本成员，它需要访问 D1 或请求 Worker 查询。文档没有说明 DO 的 D1 绑定与查询方式。

**风险等级：中**

建议二选一：

#### 方案 A：Worker 在 upgrade 前完成 ledger member 校验

因为 URL 已经是：

```http
WS /api/ws/:ledgerId
```

Worker 可以在升级前：

```md
1. 校验 Cookie
2. 校验 Origin
3. 查询 D1 确认 userId 是 ledgerId 成员
4. 再转发给对应 DO
```

DO 只管理连接和广播，不查权限。

优点：权限逻辑集中在 Worker/Hono 层。

#### 方案 B：DO 自己查询 D1 校验

如果采用该方案，需要在设计中明确：

```md
- DO 绑定 D1
- subscribe 时 DO 查询 ledger_members
- removed_at IS NULL
- ledgers.deleted_at IS NULL
```

建议 MVP 使用方案 A，更简单。

### 3.6 Refresh Token 缺少服务端撤销机制

新版采用：

```md
Access Token：15 分钟
Refresh Token：7 天
Refresh Token 存入 HttpOnly Cookie
```

这比单 JWT 好，但如果 Refresh Token 只是无状态 JWT，则存在问题：

```md
用户登出后，服务端无法真正使旧 Refresh Token 失效。
Refresh Token 泄露后，在 7 天内可能一直可用。
用户改密码后，旧 Refresh Token 仍可能有效。
```

**风险等级：中高**

建议增加 refresh session 表：

```sql
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
```

Refresh Token JWT payload：

```json
{
  "userId": "...",
  "sessionId": "...",
  "type": "refresh",
  "exp": 1234567890
}
```

刷新时：

```md
1. 校验 Refresh JWT 签名
2. 查询 refresh_sessions
3. 检查 revoked_at 是否为空
4. 检查 expires_at 是否有效
5. 签发新 Access Token
6. 可选：Refresh Token rotation
```

登出时：

```md
- 清除 Cookie
- 将 refresh_sessions.revoked_at 置为当前时间
```

### 3.7 CSRF 方案判断略乐观

新版写到：

```md
Cookie 设置 SameSite=Lax，前后端同域，此方案已足够
不使用 CORS fetch 模式携带 Cookie 的场景下，SameSite=Lax 阻止跨站 POST
```

这里需要更谨慎。

如果最终部署是同站，例如：

```md
https://app.example.com
https://app.example.com/api/*
```

则 `SameSite=Lax` 基本可接受。

如果最终部署是：

```md
https://xxx.pages.dev
https://api.xxx.workers.dev
```

或：

```md
https://xxx.github.io
https://api.example.com
```

那么 Cookie 策略、CORS、SameSite、Secure、Domain 都需要重新设计。

建议文档明确最终域名拓扑：

```md
推荐生产环境：

- 前端：https://budget.example.com
- API：https://budget.example.com/api/*
- WebSocket：wss://budget.example.com/api/ws/:ledgerId

通过 Cloudflare Pages Functions / Workers Routes 实现同站 API。
```

并增加 CSRF header：

```md
- 服务端设置非 HttpOnly 的 csrf_token Cookie
- 前端写请求附带 X-CSRF-Token
- 服务端校验 Cookie 与 Header 是否一致
```

对于 MVP，如果全部同站，可以暂缓 CSRF token，但文档中不建议写“已足够”，建议改为“当前同站部署下可接受，跨站部署需增加 CSRF Token”。

### 3.8 GitHub Pages 备站与 HttpOnly Cookie 认证存在部署冲突

新版仍保留：

```md
Cloudflare Pages 主站 + GitHub Pages 备站
两个前端地址指向同一个 Cloudflare Workers API
```

但认证方案依赖 HttpOnly Cookie。如果 GitHub Pages 域名是：

```md
https://xxx.github.io
```

API 是：

```md
https://api.example.com
```

那么这是跨站请求。要让 Cookie 工作，需要：

```md
fetch(..., { credentials: 'include' })
CORS Allow-Credentials
Access-Control-Allow-Origin 不能是 *
Cookie SameSite=None; Secure
```

但新版 Cookie 设置是：

```md
SameSite=Lax
```

这与 GitHub Pages 备站跨站访问 API 的场景不兼容。

**风险等级：中高**

MVP 建议删除 GitHub Pages 备站，统一使用 Cloudflare 同站部署。

如果一定要保留 GitHub Pages 备站，则需要：

```md
- 独立设计跨站 Cookie 策略
- SameSite=None; Secure
- 严格 CORS 白名单
- CSRF Token 必须加入
- WebSocket Origin 白名单必须覆盖 GitHub Pages 域名
```

但这会显著增加认证复杂度，不建议 MVP 实现。

### 3.9 邀请加入 API 路径与流程不完全匹配

新版 API 是：

```md
POST /api/ledgers/:id/join — 通过邀请码加入账本
```

但分享流程是：

```md
https://xxx.com/join?code=<code>
```

此时客户端只有 `code`，不一定知道 `ledgerId`。如果要求先通过 code 查 ledgerId，则还需要一个接口。

**风险等级：中**

建议改成：

```md
POST /api/invites/join

Request:
{
  "code": "ABCDEFGH"
}

Response:
{
  "ledgerId": "...",
  "ledgerName": "家庭账本",
  "role": "member"
}
```

可选增加：

```md
GET /api/invites/:code
```

用于加入前预览邀请信息，但注意不要泄露过多成员信息。

### 3.10 邀请码 8 位仍需配合强限流与唯一性重试

新版邀请码改为：

```md
8 位随机码，字符集排除 O/0/I/1/l，24 小时过期
join 限流：每分钟 10 次/IP
```

这是明显改善。

但仍应注意：

1. 邀请码生成时要处理唯一冲突；
2. join 限流不应只按 IP；
3. 登录用户也应限流；
4. 失败次数过多可以临时封锁；
5. rotate 后旧 code 必须 revoked。

**风险等级：低到中**

建议加入限流维度：

```md
- IP
- userId
- code
- ledgerId

例如：

- 每 IP 每分钟 10 次
- 每 userId 每分钟 10 次
- 每 code 每分钟 20 次
- 连续失败 10 次后延迟
```

### 3.11 `INSERT OR IGNORE` 用于交易幂等有副作用

新版字段说明中写到：

```md
transactions.id：客户端生成的 ULID，服务端采用 INSERT OR IGNORE 保证幂等
```

这个设计需要谨慎。

如果只是重复提交同一笔新增交易，`INSERT OR IGNORE` 可以避免重复插入。但它也可能掩盖异常，例如：

```md
- 客户端生成了相同 id，但请求体内容不同
- 恶意用户构造已存在 transaction id
- 同 id 的 transaction 属于另一个 ledger
- 第一次插入部分成功但事件未写入
```

**风险等级：中**

建议不要单纯依赖 `INSERT OR IGNORE`，应以 `client_mutations` 作为幂等主机制。

新增交易逻辑建议：

```md
1. 检查 client_mutations 是否已存在
2. 如果存在，返回之前结果
3. 如果不存在，检查 transaction.id 是否已存在
4. 如果 transaction.id 已存在：
   - 若 ledger_id/user_id/body 完全一致，可视为幂等
   - 否则返回 409 ID_CONFLICT
5. 插入 transaction
6. 写 event
7. 写 client_mutations
```

### 3.12 `transactions.user_id` 与 `created_by` 字段语义重复

当前表中有：

```sql
user_id TEXT NOT NULL,
created_by TEXT NOT NULL,
updated_by TEXT,
deleted_by TEXT
```

对于交易来说，`user_id` 和 `created_by` 很可能都表示“创建这笔交易的人”。

除非业务上存在“代记账”场景，例如 A 帮 B 记录一笔支出，否则这两个字段会重复。

**风险等级：低到中**

建议二选一：

#### 简化方案

```sql
created_by TEXT NOT NULL,
updated_by TEXT,
deleted_by TEXT
```

删除 `user_id`。

#### 保留方案

明确语义：

```md
user_id：交易归属人，表示这笔收支属于谁
created_by：记录这笔交易的操作者
```

如果是家庭记账，保留这两个字段可能有价值，但文档必须说明清楚。

### 3.13 成员退出与交易归属关系需明确

新版支持：

```md
DELETE /api/ledgers/:id/members/me — 成员主动退出账本
```

但如果成员退出后，TA 创建的交易如何处理？

可能方案：

```md
方案 A：保留历史交易，显示为“已退出成员”
方案 B：退出时禁止，如果还有交易需 owner 移除
方案 C：退出后匿名化用户信息
方案 D：交易仍保留 user_id，但 members 中 removed_at 非空
```

**风险等级：中**

推荐：

```md
- 成员退出不删除历史交易
- ledger_members.removed_at 标记退出
- 历史交易仍显示原昵称快照
- 退出成员不能再访问账本
- owner 可在成员列表看到已退出历史成员，或仅在交易中展示
```

这要求交易事件或交易表中保留必要展示快照：

```sql
ALTER TABLE transactions ADD COLUMN created_by_nickname_snapshot TEXT;
```

或者每次展示时通过 users 表查昵称，但如果用户改名，历史展示也会变化。两种都可以，需要明确。

### 3.14 账本删除后的事件和客户端处理需明确

新版支持软删除账本：

```md
DELETE /api/ledgers/:id — 删除账本（软删除，仅 owner）
```

但删除后：

```md
- 是否写入 ledger_events？
- 在线成员是否收到 ledger_deleted？
- WebSocket 是否关闭？
- 客户端本地 IndexedDB 缓存是否清理？
- 后续 GET /events 返回什么？
```

**风险等级：中**

WebSocket 事件增加：

```ts
| 'ledger_deleted'
```

删除流程：

```md
1. owner 请求删除账本
2. 设置 ledgers.deleted_at
3. 写入 ledger_events: ledger_deleted
4. DO 广播 ledger_deleted
5. DO 关闭该 ledger 所有连接
6. 客户端收到后：
   - 清除当前账本选择
   - 从账本列表移除
   - 可选择保留只读本地缓存或清理
```

API 返回建议：

```md
GET /api/ledgers/:id
- 成员访问已删除账本：410 Gone
- 非成员访问：404 或 403
```

### 3.15 事件 payload 结构需要明确

当前 `ledger_events.payload` 是：

```sql
payload TEXT NOT NULL
```

但没有说明保存什么。

如果要支持断线恢复，建议事件 payload 能让客户端直接重放，不需要再额外查询。

**风险等级：中**

定义事件 payload：

```ts
type LedgerEventPayload =
  | { transaction: TransactionDTO }
  | { transactionId: string; deletedAt: number; version: number }
  | { settings: LedgerSettingsDTO }
  | { member: LedgerMemberDTO }
  | { ledgerId: string; deletedAt: number }
```

建议：事件 payload 尽量保存“重放所需的完整结果状态”，而不是 patch。例如 `transaction_updated` 应保存更新后的完整 transaction，而不是只保存修改字段。

### 3.16 分页 cursor 使用 `last_id` 与 ULID/排序规则需明确

新版交易分页：

```md
GET /api/ledgers/:id/transactions?cursor=<last_id>&limit=30
```

但交易列表通常按 `date` 或 `created_at` 倒序展示。如果 cursor 只是 `last_id`，而排序又不是按 `id`，会出现分页不稳定。

**风险等级：中**

建议明确排序规则：

```md
默认排序：date DESC, created_at DESC, id DESC
```

cursor 应包含复合字段：

```json
{
  "date": "2026-05-13",
  "createdAt": 1715600000000,
  "id": "01HX..."
}
```

可以 base64 编码为 cursor。

SQL 类似：

```sql
WHERE ledger_id = ?
  AND deleted_at IS NULL
  AND (
    date < :cursorDate
    OR (date = :cursorDate AND created_at < :cursorCreatedAt)
    OR (date = :cursorDate AND created_at = :cursorCreatedAt AND id < :cursorId)
  )
ORDER BY date DESC, created_at DESC, id DESC
LIMIT :limit;
```

如果 MVP 简化，也可以明确：cursor 暂时使用 created_at + id，不使用单独 last_id。

### 3.17 金额正负设计需要前端输入约束

新版明确：

```md
支出为负整数，收入为正整数
```

这是合理的。

但聊天式记账应用可能从自然语言解析金额，例如：

```md
午饭 25
工资 5000
退货 30
```

需要明确：

```md
- 默认输入是支出还是收入？
- 收入如何标识？
- 转账/退款是否支持？
- amount = 0 是否允许？
```

**风险等级：低**

MVP 规则建议：

```md
- amount 不允许为 0
- 普通记账默认支出，存为负数
- 用户明确输入“收入/工资/报销到账”等关键词时存为正数
- 退款作为收入处理，后续再支持关联原交易
```

数据库可增加约束：

```sql
CHECK (amount != 0)
```

### 3.18 索引仍可进一步优化

当前索引已经比上一版好，但如果默认查询过滤软删除：

```sql
WHERE ledger_id = ?
  AND deleted_at IS NULL
ORDER BY date DESC
```

建议增加带 `deleted_at` 的组合索引。

**风险等级：低到中**

建议：

```sql
CREATE INDEX idx_transactions_active_date
ON transactions(ledger_id, deleted_at, date DESC, created_at DESC);

CREATE INDEX idx_ledgers_owner_active
ON ledgers(owner_id, deleted_at);

CREATE INDEX idx_ledger_members_active_user
ON ledger_members(user_id, removed_at);

CREATE INDEX idx_invites_code_active
ON ledger_invites(code, revoked_at, expires_at);
```

也可以使用部分索引：

```sql
CREATE INDEX idx_transactions_active
ON transactions(ledger_id, date DESC, created_at DESC)
WHERE deleted_at IS NULL;
```

是否采用部分索引取决于 D1 当前兼容情况和迁移测试结果。

---

## 4. 模块级详细评分

### 4.1 架构设计

| 项目 | 评分 | 说明 |
|---|---:|---|
| 技术选型 | 8.5/10 | Cloudflare 栈适合小规模协作 |
| 分层清晰度 | 8/10 | web/api/shared 清晰 |
| 可扩展性 | 7.5/10 | 事件流设计增强了扩展性 |
| 实现复杂度控制 | 6/10 | 离线同步 + 实时同步 + 双 token 对 MVP 偏重 |

结论：架构方向正确。建议 MVP 降低范围，不要第一版同时实现完整离线写入。

### 4.2 数据模型

| 项目 | 评分 | 说明 |
|---|---:|---|
| 基础实体设计 | 8/10 | users/ledgers/members/transactions 合理 |
| 同步支持 | 7.5/10 | ledger_events/client_mutations 方向正确 |
| 并发安全 | 6/10 | seq 生成方式未定义 |
| 软删除支持 | 8/10 | 主要表已考虑 deleted_at/removed_at |
| 索引设计 | 7/10 | 需要针对软删除和分页进一步优化 |

结论：数据模型已经基本可用，但必须补充 `ledger_counters`、`client_mutations response/status`、事件 payload DTO、分页 cursor 规则。

### 4.3 认证与安全

| 项目 | 评分 | 说明 |
|---|---:|---|
| HttpOnly Cookie | 8/10 | 正确 |
| WebSocket 认证 | 8/10 | 已避免 URL token |
| Refresh Token | 6.5/10 | 缺少服务端会话与撤销 |
| CSRF | 6/10 | 同站可接受，跨站不充分 |
| 邀请码安全 | 7.5/10 | 8 位 + 过期 + 限流可接受 |
| CORS | 6.5/10 | 与 GitHub Pages 备站存在冲突 |

结论：认证方向正确，但生产可用还需补 `refresh_sessions`、明确同站部署、CSRF 策略、跨站情况下 Cookie/CORS 的取舍。

### 4.4 实时同步

| 项目 | 评分 | 说明 |
|---|---:|---|
| DO 按账本管理连接 | 8.5/10 | 合理 |
| 事件格式 | 7/10 | 业务事件字段完整，但应拆控制消息 |
| 断线恢复 | 7/10 | 有 afterSeq，但缺少乱序缓冲状态机 |
| 去重能力 | 7.5/10 | eventId/clientMutationId 支持去重 |
| 顺序一致性 | 6.5/10 | seq 生成和客户端处理需细化 |

结论：实时同步设计基本正确，但要补充 catching_up 状态、pending event buffer、seq gap detection、控制消息与业务事件拆分。

### 4.5 离线同步

| 项目 | 评分 | 说明 |
|---|---:|---|
| 本地队列 | 7.5/10 | 有 sync_queue |
| 幂等重试 | 7/10 | 有 clientMutationId，但表结构需增强 |
| 冲突处理 | 7/10 | version + 409 正确 |
| 用户体验 | 5.5/10 | 冲突展示与 pending 状态未细化 |
| 实现复杂度 | 5/10 | 对 MVP 偏复杂 |

结论：设计方向对，但第一版实现风险较高。建议拆阶段。

---

## 5. 建议补充的关键设计片段

### 5.1 原子写入流程

```md
所有写操作必须在同一个 D1 事务中完成：

1. 校验用户是否为账本成员
2. 校验账本未删除
3. 查询 client_mutations，判断是否重复请求
4. 校验业务约束，例如 version、交易归属、权限
5. 写入业务表
6. 更新 ledger_counters 获取新的 eventSeq
7. 写入 ledger_events
8. 写入 client_mutations
9. 提交事务
10. 事务成功后通知 Durable Object 广播事件
```

注意：

```md
广播不能发生在事务提交前。
如果事务成功但广播失败，客户端仍可通过 GET /events 补偿。
```

### 5.2 推荐新增 `ledger_counters`

```sql
CREATE TABLE ledger_counters (
  ledger_id TEXT PRIMARY KEY,
  next_event_seq INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (ledger_id) REFERENCES ledgers(id)
);
```

创建账本时同时插入：

```sql
INSERT INTO ledger_counters (ledger_id, next_event_seq)
VALUES (?, 0);
```

写事件时：

```md
1. next_event_seq + 1
2. 使用新值作为 ledger_events.seq
```

### 5.3 推荐修订 `client_mutations`

```sql
CREATE TABLE client_mutations (
  id TEXT NOT NULL,
  ledger_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  operation_type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  status TEXT NOT NULL DEFAULT 'completed',
  event_id INTEGER,
  response_payload TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (ledger_id, user_id, id)
);
```

### 5.4 推荐拆分 WebSocket 消息协议

```ts
type ServerMessage =
  | ControlMessage
  | LedgerEventMessage

type ControlMessage =
  | {
      type: 'connected'
      ledgerId: string
      lastSeq: number
      onlineMembers: Array<{
        userId: string
        nickname: string
      }>
    }
  | {
      type: 'pong'
      ts: number
    }
  | {
      type: 'error'
      code: string
      message: string
    }

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
  eventId: string
  eventSeq: number
  entityId: string
  actorUserId: string
  clientMutationId?: string
  occurredAt: number
  payload: LedgerEventPayload
}
```

### 5.5 推荐客户端事件处理规则

```ts
function handleLedgerEvent(event: LedgerEventMessage) {
  if (event.eventSeq <= lastSeenSeq) {
    return
  }

  if (event.eventSeq === lastSeenSeq + 1) {
    applyEvent(event)
    lastSeenSeq = event.eventSeq
    flushBufferedEvents()
    return
  }

  if (event.eventSeq > lastSeenSeq + 1) {
    bufferEvent(event)
    fetchMissingEvents(lastSeenSeq)
  }
}
```

### 5.6 推荐修订邀请加入接口

```md
POST /api/invites/join

Request:
{
  "code": "ABCDEFGH"
}

Response:
{
  "ledgerId": "...",
  "ledgerName": "家庭账本",
  "role": "member"
}
```

可选：

```md
GET /api/invites/:code
```

用于加入前预览邀请信息。

---

## 6. MVP 范围建议

当前新版设计试图一次性完成：

```md
- 多用户认证
- 多账本
- 成员权限
- 邀请
- 实时 WebSocket
- 事件流
- 离线写入
- 冲突处理
- GitHub Pages 备站
- Access + Refresh Token
```

这对 MVP 来说仍偏大。

### 建议 MVP 1：在线多人实时记账

优先实现：

```md
- 注册 / 登录 / 登出 / me
- 创建账本
- 邀请加入
- 成员列表
- 交易新增 / 编辑 / 删除
- owner/member 权限
- WebSocket 广播
- Soft delete
- version 乐观锁
- ledger_events 事件表
- 断线后拉取 events 补偿
```

暂不实现：

```md
- 完整离线写入
- sync_queue 自动重试
- Refresh Token rotation
- GitHub Pages 备站
- 复杂冲突 UI
```

### 建议 MVP 2：离线写入

再实现：

```md
- IndexedDB sync_queue
- clientMutationId 完整幂等
- 本地 pending 状态
- 失败重试
- 409 冲突处理 UI
- event gap buffer
```

### 建议 MVP 3：增强安全与运维

再实现：

```md
- refresh_sessions
- 多设备登录管理
- 邀请码高级限流
- GitHub Pages 备站
- CSRF token
- 操作审计
```

---

## 7. 最终审查结论

### 7.1 已解决的问题

| 上次问题 | 当前状态 |
|---|---|
| WebSocket query param 传 token 不安全 | 已解决 |
| 邀请码过短 | 已改善 |
| transactions 缺少 version/deleted_at | 已解决 |
| 缺少离线幂等机制 | 已引入 clientMutationId |
| 缺少事件流 | 已引入 ledger_events |
| 权限模型不完整 | 已补权限矩阵 |
| 删除缺少软删除 | 已补充 |
| 断线恢复缺失 | 已补充 afterSeq |
| 索引不足 | 已明显改善 |

### 7.2 仍需修改的问题

| 问题 | 优先级 | 建议 |
|---|---:|---|
| `ledger_events.seq` 生成方式未定义 | 高 | 增加 `ledger_counters` 与事务流程 |
| `client_mutations` 表不够完整 | 高 | 增加组合主键、status、response_payload |
| WebSocket 补偿与实时事件存在竞态 | 高 | 增加 catching_up 状态和事件缓冲 |
| GitHub Pages 备站与 Cookie 认证冲突 | 中高 | MVP 移除备站或改跨站 Cookie 策略 |
| Refresh Token 无服务端撤销 | 中高 | 增加 `refresh_sessions` |
| 控制消息和业务事件混用 | 中 | 拆分 `ControlMessage` 和 `LedgerEventMessage` |
| 加入邀请 API 不匹配分享流程 | 中 | 改为 `POST /api/invites/join` |
| 分页 cursor 不稳定 | 中 | 使用复合 cursor |
| owner 退出/转让未定义 | 中 | 补业务规则 |
| 交易归属字段语义重复 | 低中 | 明确 `user_id` 与 `created_by` 语义 |

---

## 8. 审查意见

新版设计已经具备较好的工程可行性，核心方向是正确的。尤其是事件流、乐观锁、软删除、幂等 ID、WebSocket Cookie 认证这些修改，显著提升了系统可靠性。

但当前方案仍然有两个主要风险：

第一，同步系统的细节复杂度被低估了。只要支持离线写入，就必须认真处理幂等、事件顺序、冲突、重试、乱序、断线补偿，否则会出现偶发但难排查的数据不一致。

第二，部署拓扑和认证策略还没有完全对齐。如果坚持 Cloudflare Pages + GitHub Pages 双前端，同时使用 HttpOnly Cookie，就必须认真处理跨站 Cookie、CORS、CSRF。否则主站能用，备站可能登录失败或 WebSocket 无法认证。

最终建议：

```md
该方案建议“有条件通过”。

进入实现前，至少应补充以下 6 项：

1. 增加 ledger_counters，明确 eventSeq 原子递增方式
2. 完善 client_mutations 表和重复请求返回策略
3. 明确 WebSocket catching_up / live 状态机，解决乱序事件问题
4. 拆分 WebSocket 控制消息与业务事件
5. 修订邀请加入 API，改为基于 code 加入
6. 暂缓 GitHub Pages 备站，优先保证 Cloudflare 同站部署闭环
```

综合评分：**8/10**。

该版本已经可以作为技术实现蓝本，但建议先把上述高优先级问题补齐，再开始编码。

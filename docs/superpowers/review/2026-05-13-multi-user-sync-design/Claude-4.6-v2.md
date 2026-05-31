# 设计审查报告（第二轮）

**文档**：`2026-05-13-multi-user-sync-design.md`（修订版）  
**审查日期**：2026-05-31  
**对照**：基于第一轮审查报告逐项核查

---

## 一、上轮问题修复核查

### 严重问题（4 项）

| # | 问题 | 状态 | 说明 |
|---|---|---|---|
| S1 | WebSocket Token 走 Query Param | ✅ 完全修复 | 改为 WS 升级时读 Cookie 验证，subscribe 消息不再携带 token，URL 干净 |
| S2 | transactions.id 自增整数 | ✅ 完全修复 | 改为客户端生成 ULID，字段说明清晰，INSERT OR IGNORE 保证幂等 |
| S3 | 邀请码过短/无过期 | ✅ 基本修复 | 独立 `ledger_invites` 表，8位码，24小时过期，新增 rotate 接口；一处遗留见下方新问题 |
| S4 | 缺少 CSRF 防护 | ⚠️ 部分修复 | SameSite=Lax 已设置，但与 GH Pages 备站跨域场景存在根本矛盾，见下方新问题 N1 |

### 重要问题（7 项）

| # | 问题 | 状态 | 说明 |
|---|---|---|---|
| M1 | transactions 缺 updated_at/冲突检测 | ✅ 完全修复 | 加了 `updated_at`、`version` 乐观锁，冲突矩阵完整，409 响应体携带最新版本 |
| M2 | 离线冲突策略未定义 | ✅ 完全修复 | 7种场景的冲突矩阵已覆盖，clientMutationId 去重链路闭环 |
| M3 | JWT 无过期/刷新机制 | ✅ 完全修复 | 双 Token 方案设计合理，Refresh Cookie 路径限定 `/api/auth/refresh` 是正确实践 |
| M4 | 缺少成员主动退出接口 | ✅ 完全修复 | 新增 `DELETE /api/ledgers/:id/members/me` |
| M5 | 分页参数未定义 | ✅ 完全修复 | cursor 分页，参数名和默认值均已标注 |
| M6 | DO 驱逐后重连未处理 | ✅ 完全修复 | 指数退避重连 + `GET /events?afterSeq=` 补齐断线事件，链路完整 |
| M7 | CORS 配置未提及 | ✅ 完全修复 | 明确 origin 白名单，使用 Hono `cors()` 中间件 |

### 建议改进（6 项）

| # | 问题 | 状态 | 说明 |
|---|---|---|---|
| B1 | amount 正负约定 | ✅ 完全修复 | 约束章节明确"支出为负，收入为正" |
| B2 | 索引按 date 而非 created_at | ✅ 完全修复 | 新增 `idx_transactions_ledger_date`，另加 `idx_transactions_ledger_updated` |
| B3 | limit_history 缺 changed_by | ✅ 完全修复 | 改为 `created_by` 字段并加 `UNIQUE(ledger_id, effective_date)` |
| B4 | CI/CD 无测试步骤 | ❌ 未修复 | 流程仍为：安装 → 类型检查/Lint → 部署，没有任何测试阶段 |
| B5 | GH Pages SPA 路由 404 | ⚠️ 部分修复 | 提供了 `404.html` 的跳转代码，但缺少配套的 `index.html` 恢复逻辑，见下方新问题 N6 |
| B6 | Secrets 列表不完整 | ✅ 完全修复 | `wrangler secret` 与 GitHub Actions Secrets 分开列出，覆盖完整 |

**修复率：15/17（已修复或部分修复），2 项遗留（S4 有新矛盾，B4 未动）**

---

## 二、新发现问题

### 重要问题

#### N1：SameSite=Lax Cookie 与 GH Pages 跨域备站根本不兼容 ⚠️

**位置**：认证方案 → CSRF 防护；部署 → CORS 配置

文档同时持有两个互斥的主张：

> "Cookie 设置 SameSite=Lax，前后端同域（CF Pages + Workers 路由）此方案已足够"

> "GitHub Pages 域名（`xxx.github.io`）" — 列在 CORS 白名单中

`SameSite=Lax` 的语义是：**跨站 fetch/XHR 请求不携带 Cookie**，仅顶级导航（用户点击链接）时携带。用户从 `xxx.github.io`（GH Pages）通过 `fetch` 调用 Workers API 时，浏览器不会附带 Cookie，身份验证直接失败，备站实际上无法正常工作。

CORS 白名单只解决了"服务端允许哪些 origin 发请求"，但无法绕过浏览器的 `SameSite` 限制，两个问题在不同层面，配置 CORS 不等于 Cookie 可以跨域发送。

**可选解决路径（三选一，需要明确决策）：**

- **路径 A（推荐）**：CF Pages + Workers 配置在同一自定义域名下（如 `chat-budget.example.com`，`/api/*` 路由到 Workers），GH Pages 仅作静态备份，不提供登录功能（或登录后跳回主站）。这样主站同域，SameSite=Lax 有效，备站降级为只读或引导入口。
- **路径 B**：改用 `SameSite=None; Secure`（允许跨域携带 Cookie），同时引入 CSRF Token（Double Submit Cookie 模式），两个前端都能正常认证。
- **路径 C**：放弃 Cookie 方案，改用 `Authorization: Bearer` 请求头，token 存 `sessionStorage`（牺牲部分 XSS 防护，换取多域兼容）。

---

#### N2：`POST /api/ledgers/:id/join` 路径中的 `:id` 来源不明，join 流程存在逻辑缺口

**位置**：API 路由 → 成员；分享流程

分享链接格式是：

```
https://xxx.com/join?code=<code>
```

但加入接口是：

```
POST /api/ledgers/:id/join
```

客户端持有的是 `code`（8位邀请码），不是 `ledger_id`。要拼出这个 URL，客户端需要先知道 `:id`，这要求额外调用一次查询接口，但文档没有对应的"通过邀请码查账本基本信息"接口。

完整的join流程在文档中写的是：

> 好友打开链接 → 登录 → 调用 `POST /api/ledgers/:id/join` 自动加入账本

但 `:id` 从哪来？这一步被跳过了。

**建议**：将接口改为不依赖 `:id` 的形式：

```
POST /api/join
Body: { "code": "ABCD1234" }
```

服务端通过 code 查 `ledger_invites` 表获取 `ledger_id`，再完成加入操作。或者保留 `:id` 但增加一个前置接口 `GET /api/invite/:code` 返回账本基本信息（名称、成员数），供 JoinPage 展示确认界面。

---

#### N3：`ledger_events.seq` 在并发场景下的生成安全性未说明

**位置**：数据模型 → `ledger_events`

```sql
ledger_id TEXT NOT NULL,
seq INTEGER NOT NULL,
...
UNIQUE (ledger_id, seq)
```

`seq` 是每个账本内部递增的序列号，需要原子性地获取"当前最大 seq + 1"。在 Workers 多实例环境下，两个 Worker 并发写入同一 ledger 时，若都读到相同的 `MAX(seq)` 然后各自 +1，会产生序列号冲突，`UNIQUE` 约束会导致其中一个写入失败。

D1 底层是 SQLite（WAL 模式），写入确实是串行的，高并发下不会出现真正的竞争写，但失败重试会让 seq 产生空洞（gap），断线恢复的 `afterSeq` 查询需要能处理空洞。

**建议**：在文档中明确说明此处的并发处理策略，例如：

- 利用 D1 单写入串行的特性，使用 `SELECT MAX(seq) + 1` 在事务中生成 seq，并说明"因 D1 写入串行，此方案在当前规模下是安全的"
- 或者直接用 `ledger_events.id`（AUTOINCREMENT 主键）作为全局事件 ID，客户端按 `(ledger_id, id)` 查询，放弃 per-ledger seq，设计更简单

---

#### N4：`ledger_events.id` 与 `seq` 存在语义重叠，设计复杂度偏高

**位置**：数据模型 → `ledger_events`

```sql
id INTEGER PRIMARY KEY AUTOINCREMENT,  -- 全局唯一自增
seq INTEGER NOT NULL,                   -- 每个 ledger 内部递增
UNIQUE (ledger_id, seq)
```

两个字段各自解决不同问题：`id` 用于全局唯一标识，`seq` 用于 per-ledger 断线恢复。但同时维护两个自增序号会增加写入复杂度和出错概率（seq 需要额外一次 `SELECT MAX` 才能获取）。

对于 2-5 人的家庭账本，全局自增 `id` 完全可以替代 per-ledger `seq`——客户端记录 `lastSeenEventId`，断线恢复时查 `WHERE ledger_id = ? AND id > ?` 即可，不需要维护额外的 `seq` 字段。

**建议**：去掉 `seq` 字段，直接用 `id`（全局 AUTOINCREMENT）作为断线恢复的游标，协议中 `eventSeq` 字段改为 `eventId`。如果确实需要 per-ledger 有序编号，则去掉 `id`，用 `(ledger_id, seq)` 作为复合主键。二者保留其一即可。

---

#### N5：`client_mutations` 表无清理策略，数据无限增长

**位置**：数据模型 → `client_mutations`

该表用于离线重试去重，每次写操作都会插入一条记录。长期运行后数据量持续增长，没有任何清理机制（无 TTL、无过期字段、无定时清理说明）。

对于目标规模（2-5 人，家庭日常记账），每天约 10-30 条交易，一年下来约 1 万条，量不大，但缺乏机制本身是设计缺陷。若未来多账本、多用户扩展，增长会加速。

**建议**：增加 `expires_at INTEGER` 字段，写入时设为 `NOW + 30天`，定期清理过期记录（Workers 可用 Cron Trigger），或在迁移文档中说明手动清理策略。

---

### 建议改进

#### N6：GH Pages `404.html` 仅给出了跳转代码，缺少 `index.html` 的接收端逻辑

**位置**：部署 → GitHub Pages SPA 路由处理

文档提供的 `404.html` 脚本将路径存入 `sessionStorage.redirect` 并跳回根路径，但没有在 `index.html` 中添加读取 `sessionStorage.redirect` 并调用 `router.replace()` 的代码。这是 GH Pages SPA 路由的标准两段式方案，只给一半的实现是不完整的，上线后 deep link 依然会失效。

**建议**：在文档中补充 `index.html` 的 `<head>` 中需要添加的还原脚本，或指向成熟的实现参考（如 `rafgraph/spa-github-pages` 方案）。

---

#### N7：邀请码生成未指定密码学安全随机源

**位置**：字段说明 → `ledger_invites.code`

文档说明了字符集和长度，但没有说明使用哪种随机数生成器。若使用 `Math.random()`（非密码学安全），邀请码可被预测。

**建议**：明确写明使用 `crypto.randomUUID()` 或 `crypto.getRandomValues()` 生成，例如：

```ts
// Workers 环境可直接使用 Web Crypto API
const bytes = crypto.getRandomValues(new Uint8Array(8))
// 映射到字符集...
```

---

#### N8：Access Token 过期后的前端静默刷新流程未定义

**位置**：认证方案 → 双 Token 机制

文档定义了 15 分钟的 Access Token，Refresh 接口也有了，但没有说明前端如何无缝处理 token 过期。实际体验中，用户在用了 15 分钟后突然所有请求都返回 401，如果没有自动刷新拦截器，用户体验会很差。

**建议**：在前端改造章节或 `auth.ts` store 说明中补充：HTTP 客户端（axios/fetch wrapper）拦截 401 响应，自动调用 `/api/auth/refresh` 获取新 Access Token，再重试原请求；重试失败则跳转到登录页。

---

#### N9：Refresh Token 无服务端撤销机制

Refresh Token 7 天有效，存储在 HttpOnly Cookie 中，登出时仅清除 Cookie。若 Cookie 在客户端被清除之前的某个时刻已被截获（例如中间人攻击），泄露的 Refresh Token 在 7 天内仍然有效，服务端无法主动失效。

对家庭账本场景，风险相对可接受，但建议在文档约束章节中做一条明确的风险说明，避免将来被遗忘。若后续要修复，可在 KV 中维护一个 revoked token 黑名单（key 为 `jti`，TTL 与 token 过期时间一致）。

---

#### N10：`users.avatar` 字段类型和使用方式仍未定义

上一轮审查已提出，本次修订未处理。TEXT 类型存 base64 会导致单行数据过大（一张头像可达几十 KB），影响查询性能。建议明确规定 `avatar` 存 URL 字符串，头像文件本身上传到 R2 或直接使用第三方头像服务（如 Gravatar）。

---

## 三、总结

### 修复质量评价

本次修订整体质量较高，覆盖了上轮所有严重问题和大部分重要问题。新增的 `ledger_events` + `client_mutations` 事件溯源设计思路正确，冲突矩阵和乐观锁方案是亮点。

### 遗留与新增问题汇总

| 类别 | 数量 | 最高优先级 |
|---|---|---|
| 上轮遗留（未修复） | 1 | B4（CI/CD 无测试）|
| 上轮修复引入的新矛盾 | 1 | N1（SameSite=Lax 与备站不兼容）|
| 新发现重要问题 | 3 | N2（join 流程缺口）、N3（seq 并发）、N4（id/seq 冗余）|
| 新发现建议改进 | 6 | N5~N10 |

### 必须在编码前解决的 2 项

**第一优先级：N1（SameSite=Lax 与 GH Pages 备站不兼容）**  
这是架构级矛盾，会导致备站完全不可用。需要在三条路径中做出明确决策，决策会影响认证层的实现方式。

**第二优先级：N2（join 流程 `:id` 来源缺失）**  
JoinPage 拿到的是邀请码，没有 API 可以解析出 ledger_id，join 功能无法实现，是功能性缺口。

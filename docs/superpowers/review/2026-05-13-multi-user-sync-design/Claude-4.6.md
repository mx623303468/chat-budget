# 设计审查报告

**文档**：`2026-05-13-multi-user-sync-design.md`  
**审查日期**：2026-05-31  
**结论**：整体架构选型合理，Cloudflare 全家桶对此规模是恰当的；但存在若干**必须在编码前修复**的设计缺陷，以及若干建议改进项。

---

## 严重问题（阻断性，编码前必须解决）

### 1. WebSocket 认证通过 URL Query Param 传 Token

**位置**：认证方案 → "WebSocket：通过 query param 传递 token"

认证方案花了专门的篇幅将 JWT 存入 HttpOnly Cookie，目的是防止 JS 读取 token；但 WebSocket 握手却把 token 拼进 URL，等于前功尽弃。URL query param 会出现在：

- Cloudflare Workers / Nginx 访问日志
- 浏览器历史记录
- 可能的 Referer 请求头

**建议**：WebSocket 连接建立后，立即发送一条 `subscribe` 消息（协议里已有此消息类型），在消息体中携带 token 完成鉴权，DO 在收到 `subscribe` 之前不处理任何其他消息。URL 中不传 token。

---

### 2. `transactions.id` 使用自增整数，与离线优先架构根本冲突

**位置**：数据模型 → `transactions` 表；离线支持

```sql
id INTEGER PRIMARY KEY AUTOINCREMENT  -- ❌
```

离线新增记录时，客户端无法预知服务端将分配什么 ID。当前方案隐含的问题链：

1. 离线新增记录 → 本地用什么作临时 ID？
2. 同步到服务端后拿到真实 ID → 本地所有引用该记录的地方（`sync_queue`、`cached_transactions`、已推送的 WS 消息）如何批量更新？
3. 两条离线记录之间若有顺序依赖（先增后删），删除操作引用的是哪个 ID？

**建议**：改用客户端生成的 UUID/ULID：

```sql
id TEXT PRIMARY KEY  -- 客户端生成 ULID，天然有序且全局唯一
```

客户端无论在线还是离线，都在本地生成 ID，直接上传，服务端采用 `INSERT OR IGNORE` 语义保证幂等。

---

### 3. 邀请码过短、无过期机制，可被枚举爆破

**位置**：分享流程 → "如 'A3K9'"；`ledgers` 表 `invite_code`

4 位大写字母数字组合空间约 `36^4 ≈ 170 万`，对自动化脚本几乎没有阻力。且：

- 邀请码永久有效，没有过期时间字段
- 没有限制单个 IP/账号的尝试次数
- `POST /api/ledgers/:id/join` 没有速率限制说明

**建议**：

- 邀请码改为 8 位以上（`36^8 ≈ 2800 亿`），或改用签名 URL（`/join?code=<uuid>+<hmac>`）
- `ledgers` 表增加 `invite_expires_at INTEGER` 和 `invite_code` 重置接口（`POST /api/ledgers/:id/invite/rotate`）
- `join` 接口加速率限制（Cloudflare Workers 可用 KV 或 Rate Limiting API）

---

### 4. Cookie 认证缺少 CSRF 防护

**位置**：认证方案

HttpOnly Cookie 能防 XSS 读取，但无法防止 CSRF。若攻击者诱导用户打开恶意页面，浏览器会自动带上 Cookie，从而以用户身份发出 `POST /api/ledgers/:id/transactions` 等修改请求。

**建议**：选择以下任一方案：

- **SameSite=Strict/Lax Cookie**（最低成本，适合同域场景）
- **Double Submit Cookie**（前端读取不敏感 cookie 作为 CSRF token，随请求头发送）
- 若前端与 API 同域（CF Pages + Workers 路由），SameSite=Lax 通常已足够

---

## 重要问题（实现前需要明确决策）

### 5. `transactions` 缺少 `updated_at`，并发编辑无从判断胜负

两个用户同时编辑同一笔交易，服务端没有版本信息无法检测冲突，只能静默 Last-Write-Wins。对家庭记账场景这可能导致数据悄然丢失。

**建议**：增加 `updated_at INTEGER` 字段，PUT 请求携带客户端已知的 `updated_at` 值，服务端以此做乐观锁校验（若不匹配返回 `409 Conflict`）。

---

### 6. 离线冲突解决策略未定义

**位置**：离线支持

文档描述了离线队列的写入和重试，但对以下场景没有定义行为：

- 用户 A 离线编辑了交易 #X，用户 B 在线删除了交易 #X，A 重新上线后 PUT 请求到达时该如何处理？
- 两个用户同时离线编辑同一笔交易，谁的版本保留？

**建议**：在文档中明确声明冲突策略（如 "Last-Write-Wins by `created_at`"），并在 `sync_queue` 中记录操作时的本地时间戳，供服务端判断顺序。如果决定不支持冲突合并，至少要在 UI 层给用户冲突提示。

---

### 7. 缺少 JWT 过期与刷新机制

**位置**：认证方案 → `{ userId, email }`

JWT payload 中没有 `exp` 字段，意味着 token 永不失效。若某用户的 Cookie 泄露，攻击者拥有永久有效的凭证。

**建议**：

- Access Token 加 `exp`，建议 15 分钟～1 小时
- 增加 Refresh Token（可存入 HttpOnly Cookie，路径限定为 `/api/auth/refresh`）
- 或简化为：Session Cookie（浏览器关闭即失效）+ 服务端 session 存 KV

---

### 8. 缺少成员主动离开账本的接口

**位置**：API 路由 → 成员

当前只有 owner 可以踢出成员（`DELETE /api/ledgers/:id/members/:uid`），普通成员无法主动退出账本。

**建议**：增加 `DELETE /api/ledgers/:id/members/me`，或允许成员调用 `DELETE /api/ledgers/:id/members/:uid` 且 `:uid === self`。

---

### 9. 分页参数未定义

**位置**：API 路由 → 交易 → `GET /api/ledgers/:id/transactions`

文档注明"分页获取"，但分页方式（offset/cursor）、参数名、默认 page size 均未定义，前后端实现时容易各自理解不同。

**建议**：明确分页约定，例如：

```
GET /api/ledgers/:id/transactions?cursor=<last_id>&limit=30
```

推荐 cursor 分页（基于 `transactions.id` 或 `created_at`），避免 offset 在数据变化时的跳页问题。

---

### 10. Durable Object 驱逐（Hibernation）后的重连处理未定义

**位置**：Durable Object 职责

Cloudflare DO 在空闲一段时间后会被驱逐，内存中的 WebSocket 连接列表清空。客户端长连接会断开并触发 `onclose`。文档没有说明：

- 客户端如何实现自动重连（指数退避）
- 重连后是否需要重新拉取一次全量数据（防止断线期间遗漏的事件）

**建议**：`useRealtimeSync.ts` 中实现自动重连，重连成功后发一次 `GET /api/ledgers/:id/transactions?since=<last_seen_at>` 补充断线期间的数据，再依赖 WS 推送后续变更。

---

### 11. 两个前端域名共用一个 API，CORS 配置未提及

**位置**：部署 → 前端

CF Pages（`xxx.pages.dev`）和 GitHub Pages（`xxx.github.io`）两个 origin 都要访问同一 Workers API，Workers 需要配置 `Access-Control-Allow-Origin` 白名单，并正确处理 `OPTIONS` 预检请求（Hono 有 `cors()` 中间件）。目前文档完全未提，容易在上线时触发跨域错误。

**建议**：在 `wrangler.toml` 或 `index.ts` 中明确列出允许的 origins，并补充到部署章节。

---

## 建议改进（不影响核心功能，但值得关注）

### 12. `amount` 正负约定未定义

文档说"以分存储"，但没有说明支出是负数、收入是正数，还是全部存正数另加 `type` 字段。前后端开发时若各自理解不一致会出现符号 bug。建议在约束章节或数据模型中明确一行说明，例如：

> 支出为负整数，收入为正整数；前端展示时取绝对值并按符号区分颜色。

---

### 13. 索引建在 `created_at`，但查询很可能按 `date` 过滤

```sql
CREATE INDEX idx_transactions_ledger ON transactions(ledger_id, created_at);
```

`date` 是用户填写的记账日期（可以填"昨天"），`created_at` 是写入时间戳。若查询语句为 `WHERE ledger_id = ? AND date BETWEEN ? AND ?`，此索引失效，变成全表扫描。

**建议**：增加 `(ledger_id, date)` 索引，视实际查询模式保留或删除 `(ledger_id, created_at)` 索引。

---

### 14. `limit_history` 缺少 `changed_by` 字段

无法追溯谁修改了每日限额，对家庭多人记账场景有一定审计价值。

---

### 15. CI/CD 缺少测试步骤

当前流程：安装依赖 → 类型检查 + Lint → 部署。没有单元测试/集成测试环节，合并 PR 时对回归没有保护。哪怕只是简单的 Vitest 冒烟测试也建议加上。

---

### 16. GitHub Pages 的 SPA 路由 404 问题

GitHub Pages 不支持服务端 rewrite，用户直接访问 `https://xxx.github.io/ledgers/abc` 会返回 404。需要在 `public/404.html` 中实现客户端 redirect hack，或在文档中说明备站只作为根路径入口。

---

### 17. `wrangler secret put` 列表不完整

文档只列了 `JWT_SECRET`，但 GitHub Actions 部署时还需要：

- `CF_API_TOKEN`（Cloudflare 部署 token）
- `CF_ACCOUNT_ID`
- 可能还有 `GITHUB_TOKEN`（GH Pages 部署）

建议在部署章节补全所有需要预置的 secrets 列表，避免 CI 第一次运行时才发现缺失。

---

## 总结

| 类别 | 数量 | 处理建议 |
|---|---|---|
| 严重问题（阻断） | 4 | 编码前修改设计文档并评审 |
| 重要问题 | 7 | 在对应模块开发前明确决策 |
| 建议改进 | 6 | 可在 issue backlog 中跟踪，不阻断 MVP |

优先级最高的三项：**WebSocket token 暴露**、**transactions 自增 ID**、**邀请码强度**，这三项若不修正，前两项会直接影响安全性和离线架构可行性，第三项会在功能上线后产生难以修复的安全漏洞。

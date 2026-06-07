# 设计审查报告

**文档**：`2026-06-01-user-profile-design.md`（用户资料编辑：昵称修改 + 头像上传）  
**审查日期**：2026-06-01  
**结论**：功能流程整体清晰，文件变更清单完整；但存在 **3 个安全/数据一致性问题必须在编码前修复**，另有若干实现细节缺口需要补充。

---

## 严重问题（阻断性，编码前必须修复）

### 1. 头像代理接口存在路径遍历风险

**位置**：后端 → `GET /api/auth/avatar/*`

接口路径为 `/api/auth/avatar/{userId}/{timestamp}.{ext}`，通配符 `*` 直接来自用户输入。Worker 实现时若不做路径校验，攻击者可以构造如下请求：

```
GET /api/auth/avatar/../../wrangler.toml
GET /api/auth/avatar/%2e%2e%2f%2e%2e%2fconfig
```

R2 的 key 就是一个字符串，`avatars/../config` 在部分 SDK 实现中会被规范化为 `config`，从而访问到 bucket 中预期以外的对象。虽然这是专用 bucket，当前风险有限，但专用 bucket 不是安全边界，属于"现在无害、将来可能致命"的隐患。

**建议**：Worker 在拼接 R2 key 之前，用正则严格校验 path segment 仅允许字母数字、连字符和点，不允许 `..`、`/` 及 URL 编码变体：

```ts
const SAFE_PATH = /^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+\.[a-zA-Z]{3,4}$/
if (!SAFE_PATH.test(rawPath)) return c.json({ error: 'Invalid path' }, 400)
```

---

### 2. 缺少服务端 MIME 类型魔数校验，存在 XSS 风险

**位置**：后端 → `PUT /api/auth/profile` → 字段校验

文档只说"仅 JPG/PNG/WebP"，但这句话如何实现未说明。仅检查文件扩展名或 Content-Type header 是不够的——攻击者可以将一个 SVG 文件（可内嵌 `<script>`）重命名为 `.jpg` 上传，Worker 把它存入 R2 后，代理接口直接将文件内容返回给浏览器。若 R2 返回时 Content-Type 是 `image/jpeg`（按请求声明），浏览器通常不会执行；但若 Worker 按文件扩展名设置 Content-Type，或 R2 嗅探内容类型，就可能导致 SVG 被渲染并执行脚本。

**建议**：服务端读取文件前几个字节，校验魔数（magic bytes）：

| 格式 | 魔数（十六进制前几字节） |
|---|---|
| JPEG | `FF D8 FF` |
| PNG | `89 50 4E 47 0D 0A 1A 0A` |
| WebP | `52 49 46 46 ... 57 45 42 50` |

校验通过后，Worker 代理接口应**强制按检测到的实际类型**设置 `Content-Type`，而非信任客户端或文件扩展名。

---

### 3. 旧头像删除操作未在流程中定位，存在数据不一致风险

**位置**：后端 → `PUT /api/auth/profile` → 流程

文档将旧头像删除描述为独立说明（"如果用户已有旧头像，上传新头像时从 R2 删除旧文件"），而非 5 步流程的一部分，导致实现时无法确定执行时机。不同的执行顺序有不同的风险：

| 执行顺序 | 若 D1 更新失败 | 若 R2 删除失败 |
|---|---|---|
| 上传新 R2 → 删除旧 R2 → 更新 D1 | D1 仍指向旧路径，但旧文件已被删除 → **用户头像消失** | — |
| 上传新 R2 → 更新 D1 → 删除旧 R2 | D1 回滚仍指向旧路径，旧文件完好 → ✅ | 旧文件孤立于 R2，轻微存储泄漏 → ✅ |

正确顺序是第二种：先确保 D1 更新成功，再删除旧 R2 文件，且 R2 删除失败不应导致整个请求失败（best-effort）。

**建议**：在流程中明确写出步骤顺序，并说明 R2 删除失败时的处理策略（例如：记录错误日志，不影响响应）。

---

## 重要问题（实现前需要明确决策）

### 4. D1 存储路径与代理 URL 路径存在隐性不一致

**位置**：数据库 → avatar 字段说明；后端 → R2 配置 + 代理接口

R2 存储 key 为 `avatars/{userId}/{timestamp}.{ext}`，D1 字段也存储 `avatars/{userId}/{timestamp}.ext`（含 `avatars/` 前缀）。

但代理 URL 的路径格式是 `/api/auth/avatar/{userId}/{timestamp}.{ext}`（**不含** `avatars/` 段）。

这意味着前端要把 D1 中读出的 `avatars/abc/123.jpg` 转换成代理 URL `/api/auth/avatar/abc/123.jpg`，需要在某处做 `replace('avatars/', '')` 的字符串操作。这种隐性约定很脆弱，一旦两端约定漂移就产生 404。

**建议**：二选一，消除不一致：
- D1 字段改为只存 `{userId}/{timestamp}.ext`（不含前缀），Worker 拼 key 时统一补 `avatars/`
- 或代理 URL 路径改为 `/api/auth/avatar/avatars/{userId}/{timestamp}.{ext}`，与 R2 key 完全对应

后者直观但 URL 有点奇怪，推荐前者。

---

### 5. `cropperjs` 输出画布尺寸无上限，服务端 2MB 限制形同虚设

**位置**：前端 → 裁剪状态；技术选型

`cropperjs` 的 `getCroppedCanvas()` 默认输出裁剪区域的**原始像素尺寸**。若用户上传了一张 3000×3000 的手机照片，裁剪中间 2000×2000 区域，输出画布就是 2000×2000px，转为 JPEG 后轻松超过 2MB，服务端拒绝，用户困惑。

**建议**：调用 `getCroppedCanvas()` 时指定输出尺寸上限：

```ts
cropper.getCroppedCanvas({
  width: 400,
  height: 400,
  imageSmoothingEnabled: true,
  imageSmoothingQuality: 'high'
})
```

400×400 像素对头像缩略图已绰绰有余，JPEG 质量 0.85 下文件大小约 30-80KB，远低于 2MB。

---

### 6. 大文件在客户端验证前就已被加载进内存，移动端可能崩溃

**位置**：前端 → 裁剪状态

目前的流程是：用户选择文件 → 直接传给 `cropperjs` 初始化 → 渲染裁剪界面。如果用户选择了一张 30MB 的原始照片，浏览器需要把完整文件解码为位图加载到内存，在低端 Android 手机上可能导致标签页崩溃，之后才有机会提示"文件过大"。

**建议**：在触发 `cropperjs` 初始化之前，先做客户端预校验：

```ts
const file = e.target.files[0]
if (file.size > 10 * 1024 * 1024) { // 客户端宽松限制 10MB
  showError('图片文件过大，请选择 10MB 以内的图片')
  return
}
if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
  showError('仅支持 JPG、PNG、WebP 格式')
  return
}
// 然后再初始化 cropperjs
```

客户端校验不替代服务端校验，只用于快速拒绝明显不合法的文件。

---

### 7. `PUT /api/auth/profile` 响应体 `{ user }` 未定义字段范围，有 `password_hash` 泄露风险

**位置**：后端 → API 端点 → 返回值

文档只写"返回更新后的用户信息 `{ user }`"，未列明包含哪些字段。若直接把 D1 查询结果序列化返回，`password_hash` 字段会一并暴露给前端。

**建议**：明确定义响应 schema，并在 `packages/shared/src/types.ts` 中维护 `UserProfile` 类型，明确排除 `password_hash`：

```ts
// packages/shared/src/types.ts
export type UserProfile = {
  id: string
  email: string
  nickname: string
  avatar: string | null
  createdAt: number
  updatedAt: number
}
```

服务端响应前显式 pick 字段，不使用 `SELECT *`。

---

### 8. 不支持移除头像（恢复无头像状态）

**位置**：前端 → 编辑资料弹窗

弹窗只支持"上传新头像"，没有"移除头像"的操作。用户若想恢复为默认头像（昵称首字母）或删除已上传的头像，目前的设计无法做到。

**建议**：在裁剪确认后的编辑状态增加"移除头像"入口（小的文字按钮），点击后将头像预览替换为默认头像占位，提交时发送 `avatar: null` 信号（可用额外的 `removeAvatar: true` 字段或约定空字符串），服务端收到后删除 R2 文件、清空 D1 `avatar` 字段。

---

### 9. R2 上传失败时的行为未定义

**位置**：后端 → `PUT /api/auth/profile` → 流程

文档没有说明 `env.AVATARS.put()` 抛出异常时如何处理：是返回 500、回滚 D1、还是只跳过头像更新仅保存昵称？三种选择对用户体验的影响不同，需要明确。

**建议**：在流程中补充：R2 上传失败时，整个请求返回 `500`，D1 不写入；服务端记录结构化错误日志（包含 userId 和操作时间）供排查。昵称更新和头像上传是同一事务性操作，不做部分成功。

---

### 10. `cropperjs` 实例未提及销毁时机，有内存泄漏风险

**位置**：前端 → `AvatarCropper.vue`

`cropperjs` 在初始化时会创建 canvas、绑定 DOM 事件和设置 `ResizeObserver`。若组件卸载时不调用 `cropper.destroy()`，这些资源会持续占用内存，在单页应用中尤其明显（用户多次打开/关闭弹窗）。

**建议**：在 `AvatarCropper.vue` 的 `onUnmounted` 钩子和"重选"按钮的处理函数中调用 `cropper.destroy()`，并在初始化新实例前确保旧实例已销毁。

---

## 建议改进

### 11. 头像代理接口语义命名不当

`GET /api/auth/avatar/*` 挂在 `/auth` 命名空间下，但它本质是静态资源代理，与认证没有关系。`/auth` 路由通常对应认证流程（login、logout、refresh、me），掺入资源代理会让路由意图模糊，也可能被误认为需要认证。

**建议**：将代理接口独立出来，例如改为 `/api/media/avatar/{userId}/{filename}` 或 `/api/users/:id/avatar`；或若未来 R2 bucket 开放 public domain，直接用 R2 public URL 绕过 Worker 代理，减少一个请求路径。

---

### 12. Access Token 15 分钟过期期间头像上传会静默失败

依据同步设计文档，Access Token 15 分钟过期，前端需要拦截 401 自动刷新。但该设计文档未提及 `updateProfile()` 方法是否经过带刷新逻辑的 HTTP 客户端。若直接调用原始 `fetch`，用户在 token 过期时点击保存，请求静默失败，loading 状态卡住。

**建议**：确认 `apps/web/src/lib/api.ts` 中的统一 HTTP 客户端已实现 401 自动刷新拦截，`updateProfile` 必须通过该客户端发送请求。

---

### 13. 成功后 auth store 更新 `user.avatar` 的值类型需统一

保存成功后，`user.value.avatar` 会被更新为服务端返回的路径字符串（如 `abc/123.jpg`，按建议 11 去掉 `avatars/` 前缀后）。但在裁剪预览阶段，组件内部用的是本地 Blob URL（`URL.createObjectURL(canvas.toBlob(...))`）。需要确认：保存成功后 auth store 写入的是**服务端路径字符串**，而非本地 Blob URL，否则页面刷新后头像会丢失。

---

### 14. `UserProfile` 响应类型未加入 `packages/shared`

**位置**：文件变更清单

后端返回的 `UserProfile`、前端的 `updateProfile` 方法签名、`auth.ts` 中的 `user` 类型，三处共享同一个数据结构，但文件变更清单只修改了 `apps/api` 和 `apps/web`，没有更新 `packages/shared/src/types.ts`。若类型不共享，前后端可能各自维护不同版本，日后出现字段漂移。

---

## 总结

| 类别 | 数量 | 最高优先级 |
|---|---|---|
| 严重问题（阻断） | 3 | 路径遍历、MIME 魔数校验、旧文件删除时序 |
| 重要问题 | 7 | D1/URL 不一致、画布尺寸无限制、响应体字段泄露 |
| 建议改进 | 4 | 命名语义、刷新拦截、类型共享 |

**编码前必须处理的最高优先级三项**：

- **路径遍历（S1）**：一旦上线，任何人可以枚举 R2 bucket 内容，修复成本极低，不加会留下永久隐患
- **MIME 魔数校验（S2）**：缺失校验会让 R2 成为任意文件托管桶，修复需要增加约 10 行服务端代码
- **D1/URL 路径不一致（M4）**：这是架构级约定，一旦编码后两端实现不一致会直接导致所有头像 404，且难以排查

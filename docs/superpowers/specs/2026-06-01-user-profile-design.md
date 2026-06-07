# 用户资料编辑：昵称修改 + 头像上传

## 概述

为已登录用户添加修改昵称和上传头像的功能。入口在账本列表页顶部用户名下拉菜单，通过弹窗编辑，头像支持圆形裁剪预览。

## 后端设计

### 新增 API 端点

**`PATCH /api/auth/profile`** — 更新用户资料

- Content-Type: `multipart/form-data`
- 需要认证（authMiddleware）
- 字段：
  - `nickname` (string, 可选) — 新昵称
  - `avatar` (File, 可选) — 图片文件
  - `removeAvatar` (string, 可选) — 值为 `"true"` 时移除头像
- 昵称校验规则：
  - trim 后长度 1-20
  - 禁止控制字符和换行
- 头像校验规则（前端校验仅用于体验，后端校验是安全边界）：
  - 文件大小 <= 2MB
  - **校验 magic bytes**（不信任 Content-Type 和扩展名）：
    - JPEG: `FF D8 FF`
    - PNG: `89 50 4E 47 0D 0A 1A 0A`
    - WebP: `52 49 46 46 ... 57 45 42 50`
  - 拒绝 SVG 和 GIF
- 流程（严格按此顺序执行）：
  1. authMiddleware 校验登录
  2. 解析 multipart/form-data
  3. 校验 nickname（如果传了）
  4. 如果有 avatar 文件：
     1. 校验大小 <= 2MB
     2. 校验 magic bytes
     3. 生成新 R2 key：`{userId}/{uuid}.webp`
     4. 上传新头像到 R2
     5. 如果 R2 上传失败：整个请求返回 500，D1 不写入
  5. 更新 D1 users.nickname/avatar/updated_at（SELECT 明确字段，排除 password_hash）
  6. 如果 D1 更新失败且有新头像：删除刚上传的新 R2 文件，返回错误
  7. D1 更新成功后：**尽力（best-effort）删除旧 R2 头像**，失败不影响响应
  8. 返回 `{ user }` （明确字段：id, email, nickname, avatar, createdAt, updatedAt）

**`GET /api/avatars/:userId/:avatarId`** — 代理访问 R2 头像图片

- 路径参数严格校验，仅允许 `[a-zA-Z0-9_-]`，拒绝 `..`、`/`、URL 编码变体
- 服务端拼接 R2 key：`avatars/${userId}/${avatarId}`
- 无需认证（头像是公开资源）
- 响应头：
  ```
  Content-Type: 按实际文件类型设置（从 magic bytes 检测，不信任上传时声明）
  Cache-Control: public, max-age=86400, immutable
  X-Content-Type-Options: nosniff
  ETag: <r2-etag>
  ```
- 头像隐私边界：头像 URL 不包含邮箱或昵称等个人信息，avatarId 使用 UUID 不可枚举

### Cloudflare R2 配置

- Bucket 名称：`chat-budget-avatars`
- Worker binding：`AVATARS`
- 存储路径：`avatars/{userId}/{uuid}.webp`（UUID 不可预测，每次上传生成新路径）
- 更新 `wrangler.toml` 添加 R2 binding
- 更新 `env.ts` 添加 `AVATARS: R2Bucket` 类型

### 数据库

无需 schema 变更，`users` 表已有 `avatar TEXT` 字段。
avatar 字段存储相对路径 `{userId}/{uuid}.webp`（不含 `avatars/` 前缀），Worker 代理时统一补前缀。
这样 D1 字段值和前端 URL 路径完全对应，前端直接用 `/api/avatars/${user.avatar}` 拼接。

### 上传限流

MVP 阶段使用简单限流：同一 userId 每分钟最多 5 次资料更新请求。

## 前端设计

### 入口交互

LedgersPage 顶部右侧用户名区域改为可点击：
- 默认显示：用户头像缩略图 + 昵称
- 点击弹出下拉菜单，包含：
  - 用户信息区（头像、昵称、邮箱）
  - 「编辑资料」按钮
  - 「退出登录」按钮
- 点击「编辑资料」打开 Dialog 弹窗

### 编辑资料弹窗

使用 shadcn-vue Dialog 组件：

**第一步 — 编辑状态**：
- 顶部居中大头像（80px），右上角有相机图标，点击触发文件选择
- 选择文件前先做客户端预校验（不替代后端校验）：
  - 文件大小 <= 10MB（宽松限制，防止低端设备内存溢出）
  - MIME 为 image/jpeg、image/png、image/webp
- 如果已有头像，显示「移除头像」文字按钮
- 昵称输入框（预填当前昵称）
- 底部「取消」「保存」按钮

**选择图片后 — 裁剪状态**：
- 显示裁剪预览区域，圆形裁剪框
- 支持拖动调整位置、双指/滚轮缩放
- **输出画布限制为 400x400 像素**（getCroppedCanvas 指定 width/height），避免输出过大
- 底部「重选」「确认」按钮
- 确认后输出 WebP 格式，质量 0.85，文件名 `avatar.webp`
- 确认后回到编辑状态，头像预览更新为裁剪结果（本地 Blob URL）

**保存逻辑**：
- 将裁剪后的图片（Blob）和昵称一起提交（multipart/form-data）
- 保存中按钮 loading + 禁用，防止重复提交
- 通过 api.ts 统一 HTTP 客户端发送（已含 401 自动刷新拦截）
- 成功后更新 auth store：写入**服务端返回的路径字符串**（非本地 Blob URL）
- 关闭弹窗，toast 提示「保存成功」
- 失败恢复按钮状态，显示错误信息

**移除头像**：
- 点击「移除头像」后预览切换为默认头像（昵称首字母）
- 提交时发送 `removeAvatar: true`

### 默认头像策略

- avatar 为空时：显示昵称首字母 + 随机背景色（复用 ChatBubble 已有逻辑）
- 图片 404 或加载失败时：fallback 到默认头像
- avatar URL 为空时不发起图片请求

### 状态管理

auth store 新增 `updateProfile(data: FormData)` 方法：
- 通过 api.ts 统一客户端提交到 `PATCH /api/auth/profile`
- 成功后用响应中的 `user` 更新 `user.value`
- 所有引用昵称/头像的地方（ChatBubble、LedgersPage 顶部栏）自动响应更新

### 类型定义

`packages/shared/src/types.ts` 新增：
```ts
export type UserProfile = {
  id: string
  email: string
  nickname: string
  avatar: string | null  // "{userId}/{uuid}.webp" 或 null
  createdAt: number
  updatedAt: number
}
```
后端响应和前端 store 统一使用此类型。

### 组件生命周期

AvatarCropper.vue 中 cropperjs 实例：
- `onUnmounted` 钩子中调用 `cropper.destroy()`
- 重新初始化前确保旧实例已销毁
- 防止多次打开/关闭弹窗导致内存泄漏

### 技术选型

- 图片裁剪：`cropperjs`（轻量、成熟、无框架依赖）
- 头像 URL 拼接：`/api/avatars/${user.avatar}`

## 文件变更清单

**共享**：
- `packages/shared/src/types.ts` — 新增 UserProfile 类型，确保后端响应和前端 store 共享

**后端**：
- `apps/api/wrangler.toml` — 添加 R2 binding
- `apps/api/src/env.ts` — 添加 AVATARS 类型
- `apps/api/src/routes/auth.ts` — 添加 PATCH /api/auth/profile
- `apps/api/src/routes/avatars.ts` — 新建，处理 GET /api/avatars/:userId/:avatarId（独立路由文件，与 auth 职责分离）
- `apps/api/src/index.ts` — 注册 avatars 路由
- `apps/api/src/lib/upload.ts` — 新建，头像校验工具函数（magic bytes 检测、路径校验）
- `apps/api/migrations/` — 无需变更

**前端**：
- `apps/web/src/stores/auth.ts` — 添加 updateProfile 方法
- `apps/web/src/lib/api.ts` — 添加 profile API 方法
- `apps/web/src/pages/LedgersPage.vue` — 添加用户名下拉菜单
- `apps/web/src/components/UserMenu.vue` — 新建下拉菜单组件
- `apps/web/src/components/ProfileDialog.vue` — 新建编辑资料弹窗组件
- `apps/web/src/components/AvatarCropper.vue` — 新建头像裁剪组件

**依赖**：
- `apps/web` 添加 `cropperjs`

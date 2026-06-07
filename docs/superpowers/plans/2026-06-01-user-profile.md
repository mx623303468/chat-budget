# 用户资料编辑 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为已登录用户添加修改昵称和上传头像功能，入口为账本列表页用户名下拉菜单，头像支持裁剪后存储到 Cloudflare R2。

**Architecture:** 后端新增 R2 bucket 存储头像，PATCH /api/auth/profile 处理昵称和头像更新，GET /api/avatars/:userId/:avatarId 代理读取头像。前端新增 UserMenu 下拉组件、ProfileDialog 编辑弹窗和 AvatarCropper 裁剪组件。

**Tech Stack:** Hono (Cloudflare Workers), Cloudflare R2, Vue 3 + Pinia, cropperjs, shadcn-vue

---

## 文件结构

| 文件 | 职责 |
|---|---|
| `apps/api/wrangler.toml` | 添加 R2 binding |
| `apps/api/src/env.ts` | 添加 AVATARS 类型 |
| `apps/api/src/lib/upload.ts` | **新建** — magic bytes 校验、路径校验工具函数 |
| `apps/api/src/routes/avatars.ts` | **新建** — GET /api/avatars/:userId/:avatarId |
| `apps/api/src/routes/auth.ts` | 添加 PATCH /api/auth/profile |
| `apps/api/src/index.ts` | 注册 avatars 路由 |
| `packages/shared/src/types.ts` | 添加 UserProfile 类型（User 已包含 avatar 字段，无需修改） |
| `apps/web/src/lib/api.ts` | 添加 profileApi |
| `apps/web/src/stores/auth.ts` | 添加 updateProfile 方法 |
| `apps/web/src/lib/avatar.ts` | **新建** — 头像颜色/初始字母工具函数（从 ChatBubble 提取） |
| `apps/web/src/components/UserAvatar.vue` | **新建** — 可复用头像组件（图片 + fallback） |
| `apps/web/src/components/UserMenu.vue` | **新建** — 用户名下拉菜单 |
| `apps/web/src/components/AvatarCropper.vue` | **新建** — 头像裁剪组件 |
| `apps/web/src/components/ProfileDialog.vue` | **新建** — 编辑资料弹窗 |
| `apps/web/src/pages/LedgersPage.vue` | 替换顶栏用户区域为 UserMenu |

---

## Task 1: 后端基础设施 — R2 配置 + 环境类型

**Files:**
- Modify: `apps/api/wrangler.toml`
- Modify: `apps/api/src/env.ts`

- [ ] **Step 1: 修改 wrangler.toml 添加 R2 binding**

在 `[[migrations]]` 块之前添加：

```toml
[[r2_buckets]]
binding = "AVATARS"
bucket_name = "chat-budget-avatars"
```

- [ ] **Step 2: 修改 env.ts 添加 AVATARS 类型**

```ts
export type Env = {
  DB: D1Database
  JWT_SECRET: string
  REFRESH_SECRET: string
  ENVIRONMENT: string
  SYNC_DO: DurableObjectNamespace
  AVATARS: R2Bucket
}
```

- [ ] **Step 3: 创建 R2 bucket**

```bash
cd apps/api && npx wrangler r2 bucket create chat-budget-avatars
```

预期输出：`Created bucket "chat-budget-avatars"`

- [ ] **Step 4: Commit**

```bash
git add apps/api/wrangler.toml apps/api/src/env.ts
git commit -m "feat(api): 添加 R2 bucket 配置用于头像存储"
```

---

## Task 2: 后端工具函数 — 文件校验

**Files:**
- Create: `apps/api/src/lib/upload.ts`

- [ ] **Step 1: 创建 upload.ts**

```ts
/**
 * 校验图片文件的 magic bytes
 * 不信任 Content-Type 和文件扩展名
 */
export function validateImageMagicBytes(buffer: ArrayBuffer): 'image/jpeg' | 'image/png' | 'image/webp' | null {
  const bytes = new Uint8Array(buffer)

  // JPEG: FF D8 FF
  if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) {
    return 'image/jpeg'
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes[0] === 0x89 && bytes[1] === 0x50 &&
    bytes[2] === 0x4E && bytes[3] === 0x47 &&
    bytes[4] === 0x0D && bytes[5] === 0x0A &&
    bytes[6] === 0x1A && bytes[7] === 0x0A
  ) {
    return 'image/png'
  }

  // WebP: RIFF....WEBP
  if (
    bytes[0] === 0x52 && bytes[1] === 0x49 &&
    bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes.length > 11 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 &&
    bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return 'image/webp'
  }

  return null
}

/** 文件大小限制 2MB */
export const MAX_AVATAR_SIZE = 2 * 1024 * 1024

/**
 * 校验头像代理路径参数
 * 仅允许 [a-zA-Z0-9_-] 加一个点号分隔的扩展名
 */
const SAFE_SEGMENT = /^[a-zA-Z0-9_-]+$/
const SAFE_EXT = /^\.(jpg|jpeg|png|webp)$/i

export function validateAvatarPath(userId: string, avatarId: string): boolean {
  if (!SAFE_SEGMENT.test(userId)) return false
  if (!SAFE_SEGMENT.test(avatarId)) return false
  return true
}

/**
 * 校验昵称
 * trim 后长度 1-20，禁止控制字符和换行
 */
export function validateNickname(nickname: string): string | null {
  const trimmed = nickname.trim()
  if (trimmed.length < 1 || trimmed.length > 20) return null
  // 禁止控制字符 (0x00-0x1F) 和 DEL (0x7F)，但允许空格 (0x20)
  if (/[\x00-\x1F\x7F]/.test(trimmed)) return null
  return trimmed
}

/**
 * 生成 R2 存储路径
 * avatarId 使用 UUID，不可预测
 */
export function generateAvatarKey(userId: string): string {
  const avatarId = crypto.randomUUID()
  return `${userId}/${avatarId}.webp`
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/api/src/lib/upload.ts
git commit -m "feat(api): 添加头像文件校验工具函数"
```

---

## Task 3: 后端 API — 头像代理路由

**Files:**
- Create: `apps/api/src/routes/avatars.ts`
- Modify: `apps/api/src/index.ts`

- [ ] **Step 1: 创建 avatars.ts 路由**

```ts
import { Hono } from 'hono'
import type { Env } from '../env'
import { validateAvatarPath } from '../lib/upload'

const avatars = new Hono<{ Bindings: Env }>()

avatars.get('/:userId/:avatarId', async (c) => {
  const userId = c.req.param('userId')
  const avatarId = c.req.param('avatarId')

  if (!validateAvatarPath(userId, avatarId)) {
    return c.json({ error: '无效路径' }, 400)
  }

  const key = `avatars/${userId}/${avatarId}`
  const object = await c.env.AVATARS.get(key)

  if (!object) {
    return c.json({ error: '头像不存在' }, 404)
  }

  const headers = new Headers()
  object.writeHttpMetadata(headers)
  headers.set('Cache-Control', 'public, max-age=86400, immutable')
  headers.set('X-Content-Type-Options', 'nosniff')

  return new Response(object.body, { headers })
})

export default avatars
```

- [ ] **Step 2: 在 index.ts 注册 avatars 路由**

在 `apps/api/src/index.ts` 中，import 并注册路由。在现有的 `import` 区域添加：

```ts
import avatars from './routes/avatars'
```

在路由注册区域（`app.route('/api/auth', auth)` 之后）添加：

```ts
app.route('/api/avatars', avatars)
```

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/routes/avatars.ts apps/api/src/index.ts
git commit -m "feat(api): 添加头像代理路由 GET /api/avatars/:userId/:avatarId"
```

---

## Task 4: 后端 API — 用户资料更新端点

**Files:**
- Modify: `apps/api/src/routes/auth.ts`

- [ ] **Step 1: 在 auth.ts 中添加 PATCH /profile 端点**

在文件顶部的 import 区域添加：

```ts
import { validateNickname, validateImageMagicBytes, MAX_AVATAR_SIZE, generateAvatarKey } from '../lib/upload'
```

在 `auth.get('/me', ...)` 之前添加以下路由：

```ts
auth.patch('/profile', authMiddleware, async (c) => {
  const userId = c.get('userId')

  const formData = await c.req.formData()
  const nicknameRaw = formData.get('nickname') as string | null
  const avatarFile = formData.get('avatar') as File | null
  const removeAvatar = formData.get('removeAvatar') as string | null

  // 至少要有一个更新字段
  if (!nicknameRaw && !avatarFile && removeAvatar !== 'true') {
    return c.json({ error: '没有需要更新的字段' }, 400)
  }

  // 校验昵称
  let nickname: string | undefined
  if (nicknameRaw !== null) {
    nickname = validateNickname(nicknameRaw)
    if (!nickname) {
      return c.json({ error: '昵称长度需在 1-20 之间，且不能包含特殊字符' }, 400)
    }
  }

  // 处理头像
  let newAvatarKey: string | undefined
  let detectedMimeType: string | undefined

  if (avatarFile) {
    if (avatarFile.size > MAX_AVATAR_SIZE) {
      return c.json({ error: '头像文件不能超过 2MB' }, 400)
    }

    const buffer = await avatarFile.arrayBuffer()
    const mimeType = validateImageMagicBytes(buffer)
    if (!mimeType) {
      return c.json({ error: '仅支持 JPG、PNG、WebP 格式的图片' }, 400)
    }
    detectedMimeType = mimeType

    // 生成新 R2 key
    const oldUser = await c.env.DB.prepare(
      'SELECT avatar FROM users WHERE id = ?'
    ).bind(userId).first<{ avatar: string | null }>()

    newAvatarKey = generateAvatarKey(userId)

    // 上传新头像到 R2
    await c.env.AVATARS.put(`avatars/${newAvatarKey}`, buffer, {
      httpMetadata: { contentType: detectedMimeType },
    })

    // 更新 D1
    const now = Date.now()
    await c.env.DB.prepare(
      'UPDATE users SET nickname = COALESCE(?, nickname), avatar = ?, updated_at = ? WHERE id = ?'
    ).bind(nickname ?? null, newAvatarKey, now, userId).run()

    // best-effort 删除旧头像
    if (oldUser?.avatar) {
      await c.env.AVATARS.delete(`avatars/${oldUser.avatar}`).catch(() => {})
    }
  } else if (removeAvatar === 'true') {
    const oldUser = await c.env.DB.prepare(
      'SELECT avatar FROM users WHERE id = ?'
    ).bind(userId).first<{ avatar: string | null }>()

    const now = Date.now()
    await c.env.DB.prepare(
      'UPDATE users SET nickname = COALESCE(?, nickname), avatar = NULL, updated_at = ? WHERE id = ?'
    ).bind(nickname ?? null, now, userId).run()

    // best-effort 删除旧头像
    if (oldUser?.avatar) {
      await c.env.AVATARS.delete(`avatars/${oldUser.avatar}`).catch(() => {})
    }
  } else {
    // 只更新昵称
    const now = Date.now()
    await c.env.DB.prepare(
      'UPDATE users SET nickname = ?, updated_at = ? WHERE id = ?'
    ).bind(nickname!, now, userId).run()
  }

  // 返回更新后的用户信息（排除 password_hash）
  const user = await c.env.DB.prepare(
    'SELECT id, email, nickname, avatar, created_at, updated_at FROM users WHERE id = ?'
  ).bind(userId).first()

  return c.json({ user })
})
```

- [ ] **Step 2: Commit**

```bash
git add apps/api/src/routes/auth.ts
git commit -m "feat(api): 添加 PATCH /api/auth/profile 用户资料更新端点"
```

---

## Task 5: 前端基础设施 — API 客户端 + Auth Store

**Files:**
- Modify: `apps/web/src/lib/api.ts`
- Modify: `apps/web/src/stores/auth.ts`

- [ ] **Step 1: 在 api.ts 添加 profileApi**

注意：`request` 函数会自动设置 `Content-Type: application/json`，但 FormData 需要 `multipart/form-data`。需要新增一个不设置 Content-Type 的请求方法。

在 `request` 函数之后、`ApiClientError` 类之前添加：

```ts
/**
 * 上传专用请求方法，不设置 Content-Type（浏览器自动设置 multipart boundary）
 */
async function uploadRequest<T>(
  url: string,
  formData: FormData,
): Promise<T> {
  const res = await fetch(url, {
    method: 'PATCH',
    credentials: 'include',
    body: formData,
  })

  if (res.status === 401) {
    const refreshed = await tryRefresh()
    if (refreshed) {
      const retryRes = await fetch(url, {
        method: 'PATCH',
        credentials: 'include',
        body: formData,
      })
      if (retryRes.ok) {
        return retryRes.json() as Promise<T>
      }
      const err: ApiError = await retryRes.json().catch(() => ({ error: '请求失败' }))
      throw new ApiClientError(err.error, retryRes.status, err.code, err.latest)
    }
    throw new ApiClientError('登录已过期，请重新登录', 401)
  }

  if (!res.ok) {
    const err: ApiError = await res.json().catch(() => ({ error: '请求失败' }))
    throw new ApiClientError(err.error, res.status, err.code, err.latest)
  }

  return res.json() as Promise<T>
}
```

在文件底部的 `membersApi` 之后添加：

```ts
// ─── Profile API ──────────────────────────────────────────

export const profileApi = {
  update(formData: FormData): Promise<AuthResponse> {
    return uploadRequest('/api/auth/profile', formData)
  },
}

/**
 * 拼接头像代理 URL
 * avatar 字段格式："{userId}/{uuid}.webp"
 */
export function getAvatarUrl(avatar: string | null): string | null {
  if (!avatar) return null
  return `/api/avatars/${avatar}`
}
```

- [ ] **Step 2: 在 auth store 添加 updateProfile 方法**

在 `apps/web/src/stores/auth.ts` 的 import 中修改：

```ts
import { authApi, profileApi, ApiClientError } from '@/lib/api'
```

在 `requireLogin` 函数之后、`return` 之前添加：

```ts
  /**
   * 更新用户资料（昵称 + 头像）
   */
  async function updateProfile(data: {
    nickname?: string
    avatar?: Blob
    removeAvatar?: boolean
  }): Promise<void> {
    const formData = new FormData()
    if (data.nickname !== undefined) {
      formData.set('nickname', data.nickname)
    }
    if (data.avatar) {
      formData.set('avatar', data.avatar, 'avatar.webp')
    }
    if (data.removeAvatar) {
      formData.set('removeAvatar', 'true')
    }

    const res = await profileApi.update(formData)
    user.value = res.user
  }
```

在 `return` 对象中添加 `updateProfile`。

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/api.ts apps/web/src/stores/auth.ts
git commit -m "feat(web): 添加 profileApi 和 auth store updateProfile 方法"
```

---

## Task 6: 前端组件 — 头像工具函数 + UserAvatar 组件

**Files:**
- Create: `apps/web/src/lib/avatar.ts`
- Create: `apps/web/src/components/UserAvatar.vue`

- [ ] **Step 1: 创建 avatar.ts 工具函数**

从 ChatBubble 提取头像颜色和初始字母逻辑：

```ts
const AVATAR_COLORS = [
  '#7EBAD7', '#F0B96A', '#E07B7B', '#8BC58B', '#C49ADB',
  '#6BB8C4', '#D4A45A', '#B07B9E', '#7BAFB0', '#C4946B',
]

export function avatarColor(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]!
}

export function avatarInitial(name: string): string {
  return name.charAt(0) || '?'
}
```

- [ ] **Step 2: 创建 UserAvatar.vue 组件**

```vue
<script setup lang="ts">
import { computed, ref } from 'vue'
import { avatarColor, avatarInitial } from '@/lib/avatar'
import { getAvatarUrl } from '@/lib/api'

const props = withDefaults(defineProps<{
  avatar?: string | null
  nickname: string
  size?: number
}>(), {
  avatar: null,
  size: 32,
})

const imgError = ref(false)
const showImage = computed(() => props.avatar && !imgError.value)
const avatarSrc = computed(() => getAvatarUrl(props.avatar))
const bg = computed(() => avatarColor(props.nickname))
const initial = computed(() => avatarInitial(props.nickname))
</script>

<template>
  <img
    v-if="showImage"
    :src="avatarSrc!"
    :alt="nickname"
    class="rounded-full object-cover"
    :style="{ width: `${size}px`, height: `${size}px` }"
    @error="imgError = true"
  />
  <div
    v-else
    class="rounded-full flex items-center justify-center text-white font-medium"
    :style="{
      width: `${size}px`,
      height: `${size}px`,
      backgroundColor: bg,
      fontSize: `${size * 0.45}px`,
    }"
  >
    {{ initial }}
  </div>
</template>
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/avatar.ts apps/web/src/components/UserAvatar.vue
git commit -m "feat(web): 添加头像工具函数和 UserAvatar 可复用组件"
```

---

## Task 7: 前端组件 — AvatarCropper 裁剪组件

**Files:**
- Create: `apps/web/src/components/AvatarCropper.vue`

- [ ] **Step 1: 安装 cropperjs 依赖**

```bash
cd apps/web && pnpm add cropperjs
```

- [ ] **Step 2: 创建 AvatarCropper.vue**

```vue
<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, nextTick } from 'vue'
import Cropper from 'cropperjs'
import 'cropperjs/dist/cropper.css'

const props = defineProps<{
  file: File
}>()

const emit = defineEmits<{
  confirm: [blob: Blob]
  cancel: []
}>()

const imgRef = ref<HTMLImageElement>()
let cropper: Cropper | null = null

function destroyCropper() {
  if (cropper) {
    cropper.destroy()
    cropper = null
  }
}

onMounted(async () => {
  await nextTick()
  if (!imgRef.value) return

  cropper = new Cropper(imgRef.value, {
    aspectRatio: 1,
    viewMode: 1,
    dragMode: 'move',
    autoCropArea: 1,
    responsive: true,
    restore: false,
    guides: true,
    center: true,
    highlight: false,
    cropBoxMovable: true,
    cropBoxResizable: true,
    toggleDragModeOnDblclick: false,
    background: true,
  })
})

onUnmounted(() => {
  destroyCropper()
})

function handleConfirm() {
  if (!cropper) return

  const canvas = cropper.getCroppedCanvas({
    width: 400,
    height: 400,
    imageSmoothingEnabled: true,
    imageSmoothingQuality: 'high',
  })

  if (!canvas) return

  canvas.toBlob(
    (blob) => {
      if (blob) emit('confirm', blob)
    },
    'image/webp',
    0.85,
  )
}

function handleCancel() {
  emit('cancel')
}
</script>

<template>
  <div>
    <div class="w-full h-64 bg-black/5 rounded-lg overflow-hidden">
      <img ref="imgRef" class="block max-w-full" :src="URL.createObjectURL(file)" alt="裁剪预览" />
    </div>
    <div class="flex gap-2 mt-3">
      <button
        class="flex-1 py-2 rounded-lg border border-border text-sm hover:bg-muted transition-colors"
        @click="handleCancel"
      >
        重选
      </button>
      <button
        class="flex-1 py-2 rounded-lg bg-primary text-primary-foreground text-sm hover:bg-primary/90 transition-colors"
        @click="handleConfirm"
      >
        确认
      </button>
    </div>
  </div>
</template>
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/AvatarCropper.vue apps/web/package.json pnpm-lock.yaml
git commit -m "feat(web): 添加 AvatarCropper 头像裁剪组件"
```

---

## Task 8: 前端组件 — ProfileDialog 编辑弹窗

**Files:**
- Create: `apps/web/src/components/ProfileDialog.vue`

- [ ] **Step 1: 创建 ProfileDialog.vue**

```vue
<script setup lang="ts">
import { ref, computed } from 'vue'
import { Camera, Trash2 } from 'lucide-vue-next'
import { useAuthStore } from '@/stores/auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import UserAvatar from '@/components/UserAvatar.vue'
import AvatarCropper from '@/components/AvatarCropper.vue'

const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()

const auth = useAuthStore()
const nickname = ref('')
const saving = ref(false)
const error = ref('')

// 裁剪状态
const selectedFile = ref<File | null>(null)
const croppedBlob = ref<Blob | null>(null)
const previewUrl = ref<string | null>(null)

// 打开时初始化
function onOpenChange(open: boolean) {
  if (open) {
    nickname.value = auth.user?.nickname ?? ''
    resetCropState()
    error.value = ''
  }
  emit('update:open', open)
}

function resetCropState() {
  selectedFile.value = null
  croppedBlob.value = null
  previewUrl.value = null
}

// 选择文件（带预校验）
function handleFileSelect(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  // 客户端预校验
  if (file.size > 10 * 1024 * 1024) {
    error.value = '图片文件过大，请选择 10MB 以内的图片'
    return
  }
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    error.value = '仅支持 JPG、PNG、WebP 格式'
    return
  }

  error.value = ''
  selectedFile.value = file
  croppedBlob.value = null
}

function handleCropConfirm(blob: Blob) {
  croppedBlob.value = blob
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value)
  previewUrl.value = URL.createObjectURL(blob)
  selectedFile.value = null
}

function handleCropCancel() {
  selectedFile.value = null
}

const showRemoveAvatar = computed(() => {
  return auth.user?.avatar && !croppedBlob.value
})

function handleRemoveAvatar() {
  croppedBlob.value = null
  previewUrl.value = '__removed__'
}

// 保存
async function handleSave() {
  const trimmedNickname = nickname.value.trim()
  if (!trimmedNickname) {
    error.value = '昵称不能为空'
    return
  }

  saving.value = true
  error.value = ''

  try {
    const isAvatarRemoved = previewUrl.value === '__removed__'
    await auth.updateProfile({
      nickname: trimmedNickname,
      avatar: croppedBlob.value ?? undefined,
      removeAvatar: isAvatarRemoved || undefined,
    })
    emit('update:open', false)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : '保存失败'
    error.value = msg
  } finally {
    saving.value = false
  }
}

// 当前显示的头像
const currentAvatar = computed(() => {
  if (previewUrl.value === '__removed__') return null
  if (previewUrl.value) return previewUrl.value
  return auth.user?.avatar ?? null
})
</script>

<template>
  <Dialog :open="open" @update:open="onOpenChange">
    <DialogContent class="sm:max-w-[360px]">
      <DialogHeader>
        <DialogTitle>编辑资料</DialogTitle>
      </DialogHeader>

      <!-- 裁剪状态 -->
      <div v-if="selectedFile" class="py-2">
        <AvatarCropper
          :file="selectedFile"
          @confirm="handleCropConfirm"
          @cancel="handleCropCancel"
        />
      </div>

      <!-- 编辑状态 -->
      <div v-else class="space-y-4 py-2">
        <!-- 头像 -->
        <div class="flex flex-col items-center gap-2">
          <div class="relative">
            <UserAvatar
              :avatar="currentAvatar"
              :nickname="nickname || auth.user?.nickname || ''"
              :size="80"
            />
            <label
              class="absolute -bottom-1 -right-1 w-7 h-7 bg-primary text-primary-foreground rounded-full flex items-center justify-center cursor-pointer hover:bg-primary/90 transition-colors"
            >
              <Camera :size="14" />
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                class="hidden"
                @change="handleFileSelect"
              />
            </label>
          </div>
          <button
            v-if="showRemoveAvatar"
            class="text-xs text-muted-foreground hover:text-destructive flex items-center gap-1"
            @click="handleRemoveAvatar"
          >
            <Trash2 :size="12" />
            移除头像
          </button>
        </div>

        <!-- 昵称 -->
        <div>
          <label class="text-sm font-medium block mb-1">昵称</label>
          <Input v-model="nickname" maxlength="20" placeholder="输入昵称" />
        </div>

        <!-- 错误信息 -->
        <p v-if="error" class="text-sm text-destructive">{{ error }}</p>
      </div>

      <DialogFooter v-if="!selectedFile">
        <Button variant="outline" :disabled="saving" @click="emit('update:open', false)">取消</Button>
        <Button :disabled="saving || !nickname.trim()" @click="handleSave">
          {{ saving ? '保存中...' : '保存' }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/components/ProfileDialog.vue
git commit -m "feat(web): 添加 ProfileDialog 编辑资料弹窗组件"
```

---

## Task 9: 前端组件 — UserMenu 下拉菜单

**Files:**
- Create: `apps/web/src/components/UserMenu.vue`

- [ ] **Step 1: 创建 UserMenu.vue**

```vue
<script setup lang="ts">
import { ref } from 'vue'
import { ChevronDown, UserPen, LogOut } from 'lucide-vue-next'
import { useAuthStore } from '@/stores/auth'
import UserAvatar from '@/components/UserAvatar.vue'
import ProfileDialog from '@/components/ProfileDialog.vue'

const emit = defineEmits<{
  logout: []
}>()

const auth = useAuthStore()
const open = ref(false)
const showProfile = ref(false)

function toggle() {
  open.value = !open.value
}

function close() {
  open.value = false
}

function openProfile() {
  close()
  showProfile.value = true
}

function handleLogout() {
  close()
  emit('logout')
}

// 点击外部关闭
function onBackdropClick() {
  close()
}
</script>

<template>
  <div class="relative">
    <!-- 触发器 -->
    <button
      class="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-muted/50 transition-colors"
      @click="toggle"
    >
      <UserAvatar
        :avatar="auth.user?.avatar ?? null"
        :nickname="auth.user?.nickname ?? ''"
        :size="24"
      />
      <span class="text-xs text-muted-foreground max-w-[80px] truncate">
        {{ auth.user?.nickname }}
      </span>
      <ChevronDown :size="14" class="text-muted-foreground" />
    </button>

    <!-- 遮罩 -->
    <div v-if="open" class="fixed inset-0 z-40" @click="onBackdropClick" />

    <!-- 下拉菜单 -->
    <Transition
      enter-active-class="transition duration-150 ease-out"
      enter-from-class="opacity-0 scale-95"
      enter-to-class="opacity-100 scale-100"
      leave-active-class="transition duration-100 ease-in"
      leave-from-class="opacity-100 scale-100"
      leave-to-class="opacity-0 scale-95"
    >
      <div
        v-if="open"
        class="absolute right-0 top-full mt-1 w-56 bg-popover border rounded-lg shadow-lg z-50 overflow-hidden"
      >
        <!-- 用户信息 -->
        <div class="flex items-center gap-3 p-3 border-b">
          <UserAvatar
            :avatar="auth.user?.avatar ?? null"
            :nickname="auth.user?.nickname ?? ''"
            :size="36"
          />
          <div class="min-w-0">
            <div class="text-sm font-medium truncate">{{ auth.user?.nickname }}</div>
            <div class="text-xs text-muted-foreground truncate">{{ auth.user?.email }}</div>
          </div>
        </div>

        <!-- 操作 -->
        <div class="p-1">
          <button
            class="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md hover:bg-muted/50 transition-colors"
            @click="openProfile"
          >
            <UserPen :size="15" class="text-muted-foreground" />
            编辑资料
          </button>
          <button
            class="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md hover:bg-muted/50 transition-colors text-destructive"
            @click="handleLogout"
          >
            <LogOut :size="15" />
            退出登录
          </button>
        </div>
      </div>
    </Transition>

    <!-- 编辑资料弹窗 -->
    <ProfileDialog v-model:open="showProfile" :open="showProfile" />
  </div>
</template>
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/components/UserMenu.vue
git commit -m "feat(web): 添加 UserMenu 用户名下拉菜单组件"
```

---

## Task 10: 前端集成 — LedgersPage 接入 UserMenu

**Files:**
- Modify: `apps/web/src/pages/LedgersPage.vue`

- [ ] **Step 1: 替换顶栏用户区域**

在 `<script setup>` 中：
- 移除 `import { LogOut }` （从 lucide import 中删除 LogOut）
- 添加 `import UserMenu from '@/components/UserMenu.vue'`
- 移除 `import { useAuthStore }` 以及 `const auth = useAuthStore()` （如果只是用于 logout 和 nickname 显示的话）

实际上 auth store 仍被使用（`auth.user?.id` 比较和 ledgersStore），所以保留 auth import，只移除 LogOut。

修改 import 行：
```ts
import { Plus, Users } from 'lucide-vue-next'
```

添加 import：
```ts
import UserMenu from '@/components/UserMenu.vue'
```

在 template 中，将顶栏的按钮区域（`<div class="flex items-center gap-1">` 及其内容）替换为：

```html
<div class="flex items-center gap-1">
  <Button variant="ghost" size="icon" title="加入账本" @click="goJoin">
    <Users :size="18" />
  </Button>
  <UserMenu @logout="handleLogout" />
</div>
```

同时移除顶栏中 `<p v-if="auth.user">` 的昵称显示（已移到 UserMenu 中）。

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/pages/LedgersPage.vue
git commit -m "feat(web): LedgersPage 接入 UserMenu 下拉菜单"
```

---

## Task 11: 更新 ChatBubble 头像显示逻辑

**Files:**
- Modify: `apps/web/src/components/ChatBubble.vue`

- [ ] **Step 1: 使用统一的头像工具和 UserAvatar 组件**

在 `<script setup>` 中：
- 添加 `import { getAvatarUrl } from '@/lib/api'`
- 添加 `import UserAvatar from '@/components/UserAvatar.vue'`
- 移除 `AVATAR_COLORS` 常量和 `avatarColor` 函数（已提取到 `lib/avatar.ts`）
- 移除 `avatarBg` 和 `initial` computed

添加一个 computed 将 avatar 字段转为 URL：

```ts
const avatarSrc = computed(() => getAvatarUrl(props.avatar))
```

在 template 中，将两处头像显示（自己和他人）的 `<img>` + fallback `<div>` 替换为：

```html
<!-- 他人头像 -->
<div v-if="!isMine && showAvatar" class="shrink-0 pb-5">
  <UserAvatar :avatar="avatarSrc" :nickname="nickname ?? ''" :size="32" />
</div>

<!-- 自己头像 -->
<div v-if="isMine && showAvatar" class="shrink-0 pb-5">
  <UserAvatar :avatar="avatarSrc" :nickname="nickname ?? ''" :size="32" />
</div>
```

注意：这里传给 UserAvatar 的 `avatar` prop 是 URL 字符串（getAvatarUrl 返回的），而 UserAvatar 组件中 getAvatarUrl 会再次调用。需要调整策略：直接传原始 avatar 字段给 UserAvatar，让 UserAvatar 内部处理 URL 转换。

因此不使用 `avatarSrc` computed，直接：

```html
<UserAvatar :avatar="avatar" :nickname="nickname ?? ''" :size="32" />
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/components/ChatBubble.vue
git commit -m "refactor(web): ChatBubble 使用 UserAvatar 统一头像组件"
```

---

## Task 12: 本地验证 + 部署

**Files:** 无变更

- [ ] **Step 1: 本地构建检查**

```bash
cd /d/FE/code/chat-budget && pnpm install && pnpm --filter @chat-budget/web run build-only
```

预期：构建成功无报错。

- [ ] **Step 2: 本地运行开发环境验证**

```bash
cd apps/api && npx wrangler dev
```

在另一个终端：
```bash
cd apps/web && pnpm dev
```

验证：
1. 打开 http://localhost:5173 → 注册/登录
2. 查看 UserMenu 下拉菜单显示
3. 点击「编辑资料」→ 修改昵称 → 保存
4. 再次打开 → 上传头像 → 裁剪 → 保存
5. 确认头像在 ChatBubble 和 UserMenu 中正确显示
6. 测试「移除头像」功能

- [ ] **Step 3: 部署到 Cloudflare**

```bash
cd apps/api && npx wrangler r2 bucket create chat-budget-avatars 2>/dev/null; npx wrangler deploy
```

- [ ] **Step 4: Commit 全部变更**

```bash
git add -A
git commit -m "feat: 完成用户资料编辑功能（昵称修改 + 头像上传裁剪）"
```

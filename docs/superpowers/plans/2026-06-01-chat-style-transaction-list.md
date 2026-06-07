# 微信风格聊天式记账列表 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将记账列表改造为微信风格聊天布局，自己的记录在右侧（绿色主色），其他用户的在左侧（灰色），并显示头像和昵称。

**Architecture:** 在现有 ChatBubble 组件内部通过 `isMine` prop 控制左右布局方向。VirtualChatList 的分组逻辑增加用户切换判断，计算 `showNickname`/`showAvatar`。HomePage 获取成员列表构建 memberMap 传递给子组件。

**Tech Stack:** Vue 3 Composition API, Pinia, TypeScript, TailwindCSS

---

### Task 1: 修复 addTransaction 中 userId 硬编码问题

**Files:**
- Modify: `apps/web/src/stores/transaction.ts:63-97`

API 创建交易只返回 `{ id, version }`，不返回完整交易。所以需要从 auth store 获取当前用户 ID，在本地构造时正确填充 `userId` 和 `createdBy`。

- [ ] **Step 1: 修改 addTransaction 方法**

在 `apps/web/src/stores/transaction.ts` 中：

1. 在文件顶部导入 auth store：

```typescript
import { useAuthStore } from './auth'
```

2. 在 `addTransaction` 函数内部，获取当前用户 ID 并构造正确的交易对象：

```typescript
async function addTransaction(
  ledgerId: string,
  amount: number,
  note: string,
): Promise<void> {
  const authStore = useAuthStore()
  const currentUserId = authStore.user?.id ?? ''

  const id = uuid()
  const clientMutationId = uuid()
  const date = getTodayStr()

  const res = await transactionsApi.create(ledgerId, {
    id,
    clientMutationId,
    amount,
    note,
    date,
  })

  const now = Date.now()
  const tx: Transaction = {
    id: res.id,
    ledgerId,
    userId: currentUserId,
    amount,
    note,
    date,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    createdBy: currentUserId,
    updatedBy: null,
    deletedBy: null,
    version: res.version,
  }
  transactions.value = [...transactions.value, tx]
}
```

- [ ] **Step 2: 验证编译通过**

Run: `cd apps/web && npx vue-tsc --noEmit 2>&1 | head -20`
Expected: 无新增错误

- [ ] **Step 3: 提交**

```bash
git add apps/web/src/stores/transaction.ts
git commit -m "fix: 修复 addTransaction 中 userId/createdBy 硬编码为空字符串的问题"
```

---

### Task 2: 扩展 GroupItem 类型

**Files:**
- Modify: `apps/web/src/composables/useVirtualList.ts:10-12`

扩展 `GroupItem` 联合类型，在 `transaction` 分支增加用户信息字段。

- [ ] **Step 1: 修改 GroupItem 类型**

在 `apps/web/src/composables/useVirtualList.ts` 中，将现有的 `GroupItem` 类型：

```typescript
export type GroupItem =
  | { type: 'date'; date: string; label: string }
  | { type: 'transaction'; data: { id: string; [k: string]: unknown } }
```

替换为：

```typescript
export type DateGroupItem = { type: 'date'; date: string; label: string }

export type TransactionGroupItem = {
  type: 'transaction'
  data: { id: string; [k: string]: unknown }
  isMine: boolean
  nickname?: string
  avatar?: string | null
  showNickname: boolean
  showAvatar: boolean
}

export type GroupItem = DateGroupItem | TransactionGroupItem
```

- [ ] **Step 2: 更新 estimateHeight 函数**

将 `EST_BUBBLE_H` 预估高度从 72 调整为 80（增加头像区域空间），将 `EST_DATE_H` 保持 32 不变：

```typescript
const EST_BUBBLE_H = 80
```

- [ ] **Step 3: 验证编译通过**

Run: `cd apps/web && npx vue-tsc --noEmit 2>&1 | head -20`
Expected: VirtualChatList.vue 会有类型错误（因为 grouped 计算属性还没更新），这是预期的，下一个 Task 会修复

- [ ] **Step 4: 提交**

```bash
git add apps/web/src/composables/useVirtualList.ts
git commit -m "feat: 扩展 GroupItem 类型以支持聊天式布局的用户信息"
```

---

### Task 3: 更新 VirtualChatList 分组逻辑和 props

**Files:**
- Modify: `apps/web/src/components/VirtualChatList.vue`

VirtualChatList 需要接收 `memberMap` 和 `currentUserId` props，在分组时判断用户切换，并将新字段传给 ChatBubble。

- [ ] **Step 1: 添加新 props 和类型**

在 `<script setup>` 中，更新 `defineProps`：

```typescript
export type MemberMap = Record<string, { nickname: string; avatar: string | null }>

const props = defineProps<{
  transactions: Transaction[]
  hasMore: boolean
  loading: boolean
  memberMap: MemberMap
  currentUserId: string
}>()
```

- [ ] **Step 2: 更新 grouped 计算属性**

将现有的 `grouped` computed 替换为：

```typescript
const grouped = computed<GroupItem[]>(() => {
  const result: GroupItem[] = []
  let lastDate = ''
  let lastUserId = ''

  for (const t of props.transactions) {
    if (t.date !== lastDate) {
      result.push({ type: 'date', date: t.date, label: formatDateLabel(t.date) })
      lastDate = t.date
      lastUserId = ''
    }

    const isMine = t.userId === props.currentUserId
    const member = props.memberMap[t.userId]
    const showNickname = t.userId !== lastUserId
    const showAvatar = t.userId !== lastUserId

    result.push({
      type: 'transaction',
      data: t,
      isMine,
      nickname: member?.nickname,
      avatar: member?.avatar ?? null,
      showNickname,
      showAvatar,
    })

    lastUserId = t.userId
  }

  return result
})
```

- [ ] **Step 3: 更新简单模式模板中的 ChatBubble 调用**

将简单模式（非虚拟滚动）中的 ChatBubble 替换为：

```vue
<ChatBubble
  v-else
  :transaction="(item as TransactionGroupItem).data"
  :is-mine="(item as TransactionGroupItem).isMine"
  :nickname="(item as TransactionGroupItem).nickname"
  :avatar="(item as TransactionGroupItem).avatar"
  :show-nickname="(item as TransactionGroupItem).showNickname"
  :show-avatar="(item as TransactionGroupItem).showAvatar"
  :animate="idx === grouped.length - 1"
  @delete="emit('delete', $event)"
  @edit="emit('edit', $event)"
/>
```

- [ ] **Step 4: 更新虚拟滚动模式模板中的 ChatBubble 调用**

将虚拟滚动模式中的 ChatBubble 替换为：

```vue
<ChatBubble
  v-else
  :animate="false"
  :transaction="(vi.item as TransactionGroupItem).data"
  :is-mine="(vi.item as TransactionGroupItem).isMine"
  :nickname="(vi.item as TransactionGroupItem).nickname"
  :avatar="(vi.item as TransactionGroupItem).avatar"
  :show-nickname="(vi.item as TransactionGroupItem).showNickname"
  :show-avatar="(vi.item as TransactionGroupItem).showAvatar"
  @delete="emit('delete', $event)"
  @edit="emit('edit', $event)"
/>
```

- [ ] **Step 5: 更新 script 中的 import**

在 `<script setup>` 顶部，更新 import 以引入 `TransactionGroupItem`：

```typescript
import { useVirtualList, type GroupItem, type TransactionGroupItem } from '@/composables/useVirtualList'
```

- [ ] **Step 6: 验证编译通过**

Run: `cd apps/web && npx vue-tsc --noEmit 2>&1 | head -20`
Expected: ChatBubble.vue 会有类型错误（缺少新 props 定义），这是预期的，下一个 Task 会修复

- [ ] **Step 7: 提交**

```bash
git add apps/web/src/components/VirtualChatList.vue
git commit -m "feat: VirtualChatList 增加用户切换判断，传递用户信息给 ChatBubble"
```

---

### Task 4: 改造 ChatBubble 布局

**Files:**
- Modify: `apps/web/src/components/ChatBubble.vue`

ChatBubble 是改动最大的组件。需要：根据 isMine 控制左右布局、添加头像显示、添加昵称显示、调整气泡颜色和圆角。

- [ ] **Step 1: 更新 props 定义**

将现有的 props 从：

```typescript
const props = defineProps<{
  transaction: Transaction
  animate?: boolean
}>()
```

替换为：

```typescript
const props = defineProps<{
  transaction: Transaction
  animate?: boolean
  isMine?: boolean
  nickname?: string
  avatar?: string | null
  showNickname?: boolean
  showAvatar?: boolean
}>()
```

- [ ] **Step 2: 添加头像颜色计算逻辑**

在 `const emit = ...` 之后，添加头像颜色辅助函数：

```typescript
const AVATAR_COLORS = [
  '#7EBAD7', '#F0B96A', '#E07B7B', '#8BC58B', '#C49ADB',
  '#6BB8C4', '#D4A45A', '#B07B9E', '#7BAFB0', '#C4946B',
]

function avatarColor(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}

const initial = computed(() => props.nickname?.charAt(0) ?? '?')
const avatarBg = computed(() => avatarColor(props.nickname ?? ''))
```

- [ ] **Step 3: 添加气泡圆角计算**

在圆角计算中，根据 isMine 使用不同的圆角方向：

```typescript
const bubbleRadius = computed(() => {
  if (swipeX.value < 0) {
    return props.isMine ? '16px 0 0 16px' : '0 16px 16px 0'
  }
  return props.isMine
    ? '16px 4px 16px 16px'
    : '4px 16px 16px 16px'
})
```

- [ ] **Step 4: 重写 template**

将整个 `<template>` 替换为：

```vue
<template>
  <div class="mb-1" :class="{ 'animate-bubble-in': animate !== false }">
    <!-- 昵称（仅他人且 showNickname 时显示） -->
    <div
      v-if="!isMine && showNickname && nickname"
      class="text-[11px] text-muted-foreground mb-0.5 pl-10"
    >
      {{ nickname }}
    </div>

    <div class="flex items-end gap-2" :class="isMine ? 'justify-end' : 'justify-start'">
      <!-- 左侧头像（他人） -->
      <div v-if="!isMine && showAvatar" class="shrink-0 pb-5">
        <img
          v-if="avatar"
          :src="avatar"
          :alt="nickname"
          class="w-8 h-8 rounded-full object-cover"
        />
        <div
          v-else
          class="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-medium"
          :style="{ backgroundColor: avatarBg }"
        >
          {{ initial }}
        </div>
      </div>
      <!-- 占位（他人连续消息不显示头像时保持间距） -->
      <div v-else-if="!isMine" class="w-8 shrink-0" />

      <!-- 气泡滑动区域 -->
      <div class="overflow-hidden" :class="isMine ? 'flex justify-end' : 'flex justify-start'">
        <div
          class="flex"
          :class="isMine ? '' : 'flex-row-reverse'"
          :style="{
            transform: `translateX(${isMine ? swipeX : -swipeX}px)`,
            transition: trans,
            marginRight: isMine ? `-${DELETE_W}px` : undefined,
            marginLeft: isMine ? undefined : `-${DELETE_W}px`,
          }"
          @touchstart="onTouchStart"
          @touchmove="onTouchMove"
          @touchend="onTouchEnd"
        >
          <!-- 气泡主体 -->
          <div
            class="pl-4 pr-4 py-2.5 shadow-sm shrink-0 transition-[border-radius] duration-300"
            :class="isMine ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground'"
            :style="{ minWidth: '60px', borderRadius: bubbleRadius }"
          >
            <div class="text-base font-medium tabular-nums leading-snug">
              {{ amountYuan }}
            </div>
            <div class="text-[13px] opacity-80 leading-snug mt-0.5">
              {{ transaction.note }}
            </div>
          </div>

          <!-- 删除按钮 -->
          <div
            data-delete-area
            class="flex items-center justify-center bg-red-500 shrink-0"
            :style="{
              width: `${DELETE_W}px`,
              borderRadius: isMine ? '0 12px 12px 0' : '12px 0 0 12px',
            }"
          >
            <button
              class="w-full h-full flex items-center justify-center text-white text-[13px] font-medium tracking-wide active:bg-red-600 transition-colors"
              @click="onDeleteClick"
            >
              删除
            </button>
          </div>
        </div>
      </div>

      <!-- 右侧头像（自己） -->
      <div v-if="isMine && showAvatar" class="shrink-0 pb-5">
        <img
          v-if="avatar"
          :src="avatar"
          :alt="nickname"
          class="w-8 h-8 rounded-full object-cover"
        />
        <div
          v-else
          class="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-medium"
          :style="{ backgroundColor: avatarBg }"
        >
          {{ initial }}
        </div>
      </div>
      <!-- 占位（自己连续消息不显示头像时保持间距） -->
      <div v-else-if="isMine" class="w-8 shrink-0" />
    </div>

    <!-- 时间戳 -->
    <div :class="isMine ? 'flex justify-end' : 'flex justify-start pl-10'">
      <div class="text-[11px] text-muted-foreground text-right mt-0.5 pr-1">
        {{ timeStr }}
      </div>
    </div>
  </div>
</template>
```

- [ ] **Step 5: 更新滑动逻辑以支持左对齐气泡**

在 `onTouchMove` 函数中，他人气泡的滑动方向是反转的。将现有 onTouchMove 中的滑动逻辑替换为：

```typescript
function onTouchMove(e: TouchEvent) {
  const t = e.touches[0]
  if (!t) return
  const dx = t.clientX - startX
  const dy = t.clientY - startY

  if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
    cancelLP()
    moved = true
  }

  // 自己的气泡：左滑打开删除；他人的气泡：右滑打开删除
  const openDir = props.isMine ? -1 : 1
  const closeDir = props.isMine ? 1 : -1

  if (dx * openDir > 4 && Math.abs(dx) > Math.abs(dy)) {
    e.preventDefault()
    swiping.value = true
    const base = isOpen.value ? DELETE_W * openDir : 0
    const raw = base + dx * openDir
    const maxSwipe = DELETE_W + 10
    swipeX.value = openDir * Math.min(Math.abs(raw), maxSwipe)
  }

  // 已打开时反向滑动关闭
  if (isOpen.value && dx * closeDir > 4 && Math.abs(dx) > Math.abs(dy)) {
    e.preventDefault()
    swiping.value = true
    const raw = dx * openDir
    swipeX.value = Math.max(0, Math.min(-maxSwipe, raw))
    // 重新计算：关闭方向
    swipeX.value = closeDir * Math.min(Math.abs(dx), DELETE_W)
  }
}
```

同时更新 `onTouchEnd` 中的阈值判断：

```typescript
function onTouchEnd(e: TouchEvent) {
  e.stopPropagation()
  cancelLP()
  swiping.value = false

  if (Math.abs(swipeX.value) > DELETE_W * 0.4) {
    swipeX.value = props.isMine ? -DELETE_W : DELETE_W
    isOpen.value = true
  } else {
    close()
  }
}
```

- [ ] **Step 6: 验证编译通过**

Run: `cd apps/web && npx vue-tsc --noEmit 2>&1 | head -20`
Expected: HomePage.vue 会有类型错误（VirtualChatList 缺少新 props），这是预期的，下一个 Task 会修复

- [ ] **Step 7: 提交**

```bash
git add apps/web/src/components/ChatBubble.vue
git commit -m "feat: ChatBubble 支持左右布局、头像和昵称显示"
```

---

### Task 5: 更新 HomePage 传递成员数据

**Files:**
- Modify: `apps/web/src/pages/HomePage.vue`

HomePage 需要获取账本成员列表，构建 memberMap，并将 memberMap 和 currentUserId 传给 VirtualChatList。

- [ ] **Step 1: 添加成员获取逻辑**

在 `<script setup>` 中：

1. 导入 `membersApi` 和 `useAuthStore`：

```typescript
import { membersApi } from '@/lib/api'
import { useAuthStore } from '@/stores/auth'
import type { MemberMap } from '@/components/VirtualChatList.vue'
```

注意：`MemberMap` 类型需要从 VirtualChatList 导出。如果无法直接从 `.vue` 文件导入类型，则改为在 `VirtualChatList.vue` 的 `<script setup>` 中通过 `defineExpose` 或将类型定义移到独立文件。更简单的做法是在 HomePage 中直接定义类型：

```typescript
type MemberMap = Record<string, { nickname: string; avatar: string | null }>
```

2. 添加成员状态和获取逻辑：

```typescript
const authStore = useAuthStore()
const memberMap = ref<MemberMap>({})

async function fetchMembers() {
  try {
    const res = await membersApi.list(ledgerId)
    const map: MemberMap = {}
    for (const m of res.members) {
      map[m.userId] = { nickname: m.nickname, avatar: null }
    }
    // 当前用户的头像从 auth store 获取
    if (authStore.user) {
      map[authStore.user.id] = {
        nickname: authStore.user.nickname,
        avatar: authStore.user.avatar,
      }
    }
    memberMap.value = map
  } catch {
    // 成员列表获取失败不阻塞页面
  }
}
```

3. 在 `onMounted` 中调用 `fetchMembers`：

```typescript
onMounted(async () => {
  if (!ledgersStore.currentLedger || ledgersStore.currentLedgerId !== ledgerId) {
    ledgersStore.selectLedger(ledgerId)
    await ledgersStore.fetchLedgers()
  }
  await Promise.all([
    transactionStore.loadTransactions(ledgerId),
    fetchMembers(),
  ])
  connectWs(ledgerId)
})
```

- [ ] **Step 2: 更新模板中的 VirtualChatList 调用**

将模板中的 VirtualChatList 从：

```vue
<VirtualChatList
  :transactions="transactionStore.transactions"
  :has-more="transactionStore.hasMore"
  :loading="transactionStore.loading"
  @delete="onDelete"
  @edit="onEdit"
  @load-more="onLoadMore"
/>
```

替换为：

```vue
<VirtualChatList
  :transactions="transactionStore.transactions"
  :has-more="transactionStore.hasMore"
  :loading="transactionStore.loading"
  :member-map="memberMap"
  :current-user-id="authStore.user?.id ?? ''"
  @delete="onDelete"
  @edit="onEdit"
  @load-more="onLoadMore"
/>
```

- [ ] **Step 3: 验证编译通过**

Run: `cd apps/web && npx vue-tsc --noEmit 2>&1 | head -20`
Expected: 无错误

- [ ] **Step 4: 启动开发服务器验证视觉效果**

Run: `cd apps/web && npm run dev`
在浏览器中检查：
1. 只有自己时，所有气泡仍在右侧，显示头像
2. 多人时，自己的在右侧绿色，他人在左侧灰色
3. 同一用户连续记录时，只在第一条显示头像和昵称
4. 滑动删除和长按编辑仍正常工作

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/pages/HomePage.vue
git commit -m "feat: HomePage 获取成员映射并传递给 VirtualChatList"
```

---

### Task 6: 导出 MemberMap 类型

**Files:**
- Modify: `apps/web/src/components/VirtualChatList.vue`

由于 Task 5 中 HomePage 需要使用 `MemberMap` 类型，需要在 VirtualChatList 中导出该类型。由于 `<script setup>` 中的类型无法直接被其他文件导入，我们在 VirtualChatList 中添加一个普通的 `<script>` 块来导出类型。

- [ ] **Step 1: 在 VirtualChatList.vue 中添加类型导出**

在 `<script setup>` 标签之前，添加：

```vue
<script lang="ts">
export type MemberMap = Record<string, { nickname: string; avatar: string | null }>
</script>
```

同时更新 `defineProps` 使用导入的类型：

```typescript
const props = defineProps<{
  transactions: Transaction[]
  hasMore: boolean
  loading: boolean
  memberMap: MemberMap
  currentUserId: string
}>()
```

- [ ] **Step 2: 更新 HomePage 中的导入**

在 `apps/web/src/pages/HomePage.vue` 中，将 Task 5 中的本地类型定义替换为：

```typescript
import VirtualChatList, { type MemberMap } from '@/components/VirtualChatList.vue'
```

- [ ] **Step 3: 验证编译通过**

Run: `cd apps/web && npx vue-tsc --noEmit 2>&1 | head -20`
Expected: 无错误

- [ ] **Step 4: 提交**

```bash
git add apps/web/src/components/VirtualChatList.vue apps/web/src/pages/HomePage.vue
git commit -m "refactor: 导出 MemberMap 类型供 HomePage 使用"
```

---

## 自审清单

**Spec 覆盖：**
1. ✅ 自己的记录在右侧（Task 4）
2. ✅ 其他用户的记录在左侧（Task 4）
3. ✅ 显示头像（有头像显示图片，无则首字+颜色）（Task 4）
4. ✅ 同一用户连续记录只显示一次昵称和头像（Task 3 grouped 逻辑）
5. ✅ 保留滑动删除和长按编辑（Task 4 保留交互逻辑）
6. ✅ 保留虚拟滚动（Task 2 类型扩展兼容）
7. ✅ 修复 addTransaction 硬编码 userId（Task 1）

**占位符扫描：** 无 TBD/TODO

**类型一致性：**
- `TransactionGroupItem` 在 Task 2 定义，Task 3 使用 ✅
- `MemberMap` 在 Task 6 导出，Task 5 导入 ✅
- ChatBubble props 在 Task 4 定义，与 Task 3 传参一致 ✅

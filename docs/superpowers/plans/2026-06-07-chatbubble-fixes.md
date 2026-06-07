# 聊天气泡与输入解析修复 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 5 项聊天界面问题：气泡颜色、输入解析、金额显示、编辑权限、编辑弹窗时间字段

**Architecture:** 5 项独立修复，每项改动 1-3 个文件。纯前端修复（Task 1-4）和一个全栈修改（Task 5，涉及 API 层增加 createdAt 更新支持）。

**Tech Stack:** Vue 3, TypeScript, Tailwind CSS 4, Hono (API), Cloudflare D1

---

## Task 1: 修复金额显示去掉末尾零

**Files:**
- Modify: `apps/web/src/lib/input-parser.ts:54-59`

**说明：** 最简单且无风险的修改，先做这个验证流程。

- [ ] **Step 1: 修改 fenToYuan 函数**

将 `apps/web/src/lib/input-parser.ts` 第 54-59 行替换为：

```ts
export function fenToYuan(fen: number): string {
  const abs = Math.abs(fen)
  const yuan = abs / 100
  const formatted = yuan % 1 === 0 ? yuan.toFixed(0) : String(parseFloat(yuan.toFixed(2)))
  return fen < 0 ? `-${formatted}` : formatted
}
```

- [ ] **Step 2: 验证**

启动 dev server 并检查：
- 输入 `15.9 买菜`，确认气泡显示 `15.9`（不是 `15.90`）
- 输入 `15 买菜`，确认气泡显示 `15`（不是 `15.00`）
- 输入 `15.95 买菜`，确认气泡显示 `15.95`

Run: `cd apps/web && npm run dev`

- [ ] **Step 3: 提交**

```bash
git add apps/web/src/lib/input-parser.ts
git commit -m "fix(web): 金额显示去掉末尾多余的零"
```

---

## Task 2: 修复输入解析支持全角小数点

**Files:**
- Modify: `apps/web/src/lib/input-parser.ts:6-15`

- [ ] **Step 1: 在 normalize 函数中增加全角标点转换**

在 `apps/web/src/lib/input-parser.ts` 的 normalize 函数中，在全角数字转换（第 8-10 行）之后、补空格之前，增加一行：

```ts
.replace(/[．。]/g, '.')
```

完整的 normalize 函数变为：

```ts
export function normalize(input: string): string {
  return input
    .replace(/[０-９]/g, (s) =>
      String.fromCharCode(s.charCodeAt(0) - 65248),
    )
    .replace(/[．。]/g, '.')
    .replace(/^(\d+\.?\d*)([^\s\d]+)/, '$1 $2')
    .replace(/^([^\d]+)(\d+\.?\d*)/, '$2 $1')
    .replace(/\s+/g, ' ')
    .trim()
}
```

- [ ] **Step 2: 验证**

在 dev server 中测试以下输入：
- `13.5 买菜`（半角点）→ 解析为 13.5 元，说明"买菜"
- `13．5 买菜`（全角点）→ 解析为 13.5 元，说明"买菜"
- `13。5 买菜`（中文句号）→ 解析为 13.5 元，说明"买菜"
- `13.5买菜`（无空格）→ 解析为 13.5 元，说明"买菜"

- [ ] **Step 3: 提交**

```bash
git add apps/web/src/lib/input-parser.ts
git commit -m "fix(web): 输入解析支持全角小数点和中文句号"
```

---

## Task 3: 限制编辑和删除权限为仅自己的消息

**Files:**
- Modify: `apps/web/src/components/ChatBubble.vue:53-73` (onTouchStart)
- Modify: `apps/web/src/components/ChatBubble.vue:75-106` (onTouchMove)

- [ ] **Step 1: 在 onTouchStart 开头增加权限守卫**

在 `ChatBubble.vue` 的 `onTouchStart` 函数开头（第 54 行 `e.stopPropagation()` 之后）增加：

```ts
if (!props.isMine) return
```

修改后的 onTouchStart 开头变为：

```ts
function onTouchStart(e: TouchEvent) {
  e.stopPropagation()
  if (!props.isMine) return

  const target = e.target as HTMLElement
  // ... 后续不变
```

- [ ] **Step 2: 在 onTouchMove 开头增加权限守卫**

在 `onTouchMove` 函数开头（第 76 行 `const t = e.touches[0]` 之前）增加：

```ts
if (!props.isMine) return
```

- [ ] **Step 3: 验证**

在手机或模拟器上测试：
- 长按自己的消息 → 弹出编辑弹窗 ✓
- 长按他人的消息 → 无反应 ✓
- 滑动自己的消息 → 显示删除按钮 ✓
- 滑动他人的消息 → 无反应 ✓

- [ ] **Step 4: 提交**

```bash
git add apps/web/src/components/ChatBubble.vue
git commit -m "fix(web): 限制编辑和删除操作仅对自己的消息生效"
```

---

## Task 4: 统一气泡颜色

**Files:**
- Modify: `apps/web/src/assets/main.css:52-85` (`:root` 部分)
- Modify: `apps/web/src/components/ChatBubble.vue:175` (class 绑定)

- [ ] **Step 1: 在 main.css 的 `:root` 中增加 other 颜色变量**

在 `apps/web/src/assets/main.css` 的 `:root` 块中（第 85 行 `--sidebar-ring` 之后）增加：

```css
--other: #E0E7F1;
--other-foreground: oklch(0.145 0 0);
```

在 `@theme inline` 块中（第 45 行 `--color-background` 之后）增加：

```css
--color-other-foreground: var(--other-foreground);
--color-other: var(--other);
```

- [ ] **Step 2: 修改 ChatBubble.vue 的气泡颜色 class**

将 `ChatBubble.vue` 第 175 行的：

```vue
:class="isMine ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground'"
```

替换为：

```vue
:class="isMine ? 'bg-muted text-foreground' : 'bg-other text-foreground'"
```

- [ ] **Step 3: 验证**

在 dev server 中检查：
- 自己的消息气泡 → 浅灰色背景（bg-muted），右对齐 ✓
- 他人的消息气泡 → 淡蓝灰色背景（#E0E7F1），左对齐 ✓

- [ ] **Step 4: 提交**

```bash
git add apps/web/src/assets/main.css apps/web/src/components/ChatBubble.vue
git commit -m "fix(web): 统一气泡颜色，自己用浅灰，他人用淡蓝灰"
```

---

## Task 5: 编辑弹窗增加创建时间字段

**Files:**
- Modify: `apps/api/src/routes/transactions.ts:175-257` (PUT handler)
- Modify: `apps/web/src/lib/api.ts:302-317` (transactionsApi.update 类型)
- Modify: `apps/web/src/stores/transaction.ts:118-138` (updateTransaction)
- Modify: `apps/web/src/pages/HomePage.vue:92-94` (onSaveEdit)
- Modify: `apps/web/src/components/EditDialog.vue` (增加时间字段)

**说明：** API 层的 update 端点已支持 `date` 字段，但不支持 `createdAt`。需要增加 `createdAt` 的更新能力。前端编辑弹窗增加 `datetime-local` 输入框。

### 5a: API 层增加 createdAt 更新支持

- [ ] **Step 1: 修改 API update 端点**

在 `apps/api/src/routes/transactions.ts` 的 PUT handler 中：

1. 在 body 类型声明（第 179-185 行）增加 `createdAt?: number`：

```ts
const body = await c.req.json<{
  clientMutationId: string
  version: number
  amount?: number
  note?: string
  date?: string
  createdAt?: number
}>()
```

2. 在构建新值的位置（第 225-227 行之后）增加：

```ts
const newCreatedAt = body.createdAt ?? tx.created_at
const newDate = body.date ?? (body.createdAt ? `${new Date(body.createdAt).getFullYear()}-${String(new Date(body.createdAt).getMonth() + 1).padStart(2, '0')}-${String(new Date(body.createdAt).getDate()).padStart(2, '0')}` : tx.date)
```

同时将第 227 行 `const newDate = body.date ?? tx.date` 替换为上面的逻辑（处理 createdAt 变更时自动同步 date）。

3. 修改 UPDATE SQL（第 233 行）增加 `created_at`：

```ts
'UPDATE transactions SET amount = ?, note = ?, date = ?, created_at = ?, updated_at = ?, updated_by = ?, version = ? WHERE id = ?'
```

bind 参数增加 `newCreatedAt`：

```ts
.bind(newAmount, newNote, newDate, newCreatedAt, now, userId, newVersion, transactionId)
```

4. 更新 broadcast payload 中的 `createdAt` 字段使用 `newCreatedAt as number`。

### 5b: 前端 API 类型更新

- [ ] **Step 2: 更新 transactionsApi.update 的类型**

在 `apps/web/src/lib/api.ts` 的 `transactionsApi.update` 方法（第 302-317 行），在 data 参数类型中增加 `createdAt?: number`：

```ts
data: {
  clientMutationId: string
  version: number
  amount?: number
  note?: string
  date?: string
  createdAt?: number
}
```

### 5c: Transaction Store 更新

- [ ] **Step 3: 更新 updateTransaction 支持新字段**

在 `apps/web/src/stores/transaction.ts` 的 `updateTransaction`（第 118-138 行）：

1. 修改 data 参数类型：

```ts
data: { amount?: number; note?: string; createdAt?: number },
```

2. 在调用 API 时传入 createdAt：

```ts
const res = await transactionsApi.update(ledgerId, transactionId, {
  clientMutationId,
  version: existing.version,
  ...data,
})
```

3. 更新本地状态映射，增加 `date` 字段同步：

```ts
transactions.value = transactions.value.map((t) => {
  if (t.id !== transactionId) return t
  const newCreatedAt = data.createdAt ?? t.createdAt
  const newDate = new Date(newCreatedAt)
  const dateStr = `${newDate.getFullYear()}-${String(newDate.getMonth() + 1).padStart(2, '0')}-${String(newDate.getDate()).padStart(2, '0')}`
  return {
    ...t,
    ...data,
    date: data.createdAt ? dateStr : t.date,
    version: res.version,
    updatedAt: Date.now(),
  }
})
```

### 5d: EditDialog 增加 datetime-local 输入

- [ ] **Step 4: 修改 EditDialog.vue**

完整替换 `apps/web/src/components/EditDialog.vue`：

```vue
<script setup lang="ts">
import { ref, watch } from 'vue'
import type { Transaction } from '@/types'
import { fenToYuan } from '@/lib/input-parser'

const props = defineProps<{
  open: boolean
  transaction: Transaction | null
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  save: [id: string, data: { amount: number; note: string; createdAt?: number }]
}>()

const amountStr = ref('')
const noteStr = ref('')
const createdAtStr = ref('')

watch(
  () => props.transaction,
  (t) => {
    if (t) {
      amountStr.value = fenToYuan(t.amount)
      noteStr.value = t.note
      const d = new Date(t.createdAt)
      createdAtStr.value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    }
  },
)

function handleSave() {
  if (!props.transaction) return
  const yuan = parseFloat(amountStr.value)
  if (Number.isNaN(yuan) || yuan <= 0) return
  const fen = Math.round(yuan * 100)
  const data: { amount: number; note: string; createdAt?: number } = {
    amount: fen,
    note: noteStr.value || '未命名',
  }
  if (createdAtStr.value) {
    data.createdAt = new Date(createdAtStr.value).getTime()
  }
  emit('save', props.transaction.id, data)
  emit('update:open', false)
}
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent class="sm:max-w-[360px]">
      <DialogHeader>
        <DialogTitle>编辑记录</DialogTitle>
      </DialogHeader>
      <div class="grid gap-3 py-2">
        <div>
          <label class="text-sm text-muted-foreground mb-1 block">金额（元）</label>
          <Input v-model="amountStr" type="number" step="0.01" min="0" />
        </div>
        <div>
          <label class="text-sm text-muted-foreground mb-1 block">说明</label>
          <Input v-model="noteStr" placeholder="说明" />
        </div>
        <div>
          <label class="text-sm text-muted-foreground mb-1 block">时间</label>
          <Input v-model="createdAtStr" type="datetime-local" />
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" @click="emit('update:open', false)">取消</Button>
        <Button @click="handleSave">保存</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
```

### 5e: HomePage 更新 save 事件类型

- [ ] **Step 5: 更新 HomePage.vue 的 onSaveEdit**

将 `apps/web/src/pages/HomePage.vue` 第 92-94 行的 `onSaveEdit` 替换为：

```ts
async function onSaveEdit(id: string, data: { amount: number; note: string; createdAt?: number }) {
  await transactionStore.updateTransaction(ledgerId, id, data)
}
```

- [ ] **Step 6: 验证**

1. 启动 dev server 和 API
2. 长按自己的消息 → 编辑弹窗显示金额、说明、时间三个字段
3. 修改时间为其他日期时间 → 保存后消息在列表中重新排序到正确位置
4. 气泡下方的时间戳显示更新后的时间

- [ ] **Step 7: 提交**

```bash
git add apps/api/src/routes/transactions.ts apps/web/src/lib/api.ts apps/web/src/stores/transaction.ts apps/web/src/pages/HomePage.vue apps/web/src/components/EditDialog.vue
git commit -m "feat: 编辑弹窗增加创建时间字段，支持修改记录时间"
```

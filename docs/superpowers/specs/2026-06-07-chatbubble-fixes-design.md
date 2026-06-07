# 聊天气泡与输入解析修复设计

日期：2026-06-07

## 概述

5 项独立的 UI/逻辑修复，涉及气泡颜色、输入解析、金额显示、编辑权限和编辑弹窗。

---

## 1. 气泡颜色统一

**当前：** 自己=深色(bg-primary)，他人=浅灰(bg-muted)
**目标：** 自己→浅灰(bg-muted)，他人→淡蓝灰(#E0E7F1)

### 修改文件

- `apps/web/src/assets/main.css` — 增加 CSS 变量 `--other` / `--other-foreground`
- `apps/web/src/components/ChatBubble.vue` 第 203 行 — 修改 class 绑定

### 实现

```css
/* main.css */
:root {
  --other: #E0E7F1;
  --other-foreground: oklch(0.145 0 0);  /* 与 foreground 一致 */
}
```

```vue
<!-- ChatBubble.vue -->
:class="isMine ? 'bg-muted text-foreground' : 'text-foreground'"
:style="!isMine ? { backgroundColor: 'var(--other)' } : undefined"
```

或者直接在 Tailwind 配置中注册 `bg-other` / `text-other-foreground` 工具类。

---

## 2. 输入解析支持全角小数点

**当前：** normalize 只处理全角数字，不处理全角标点
**目标：** 支持半角 `.`、全角 `．`、中文句号 `。`

### 修改文件

- `apps/web/src/lib/input-parser.ts` — normalize 函数

### 实现

在全角数字转换之后增加一行：

```ts
.replace(/[．。]/g, '.')
```

处理流程：全角数字 → 标点转换 → 补空格 → 交换顺序 → 正常解析

---

## 3. 金额显示去掉末尾零

**当前：** `15.90`（toFixed(2) 固定两位小数）
**目标：** `15.9`（去掉无意义的末尾零）

### 修改文件

- `apps/web/src/lib/input-parser.ts` — fenToYuan 函数

### 实现

```ts
export function fenToYuan(fen: number): string {
  const abs = Math.abs(fen)
  const yuan = abs / 100
  const formatted = yuan % 1 === 0 ? yuan.toFixed(0) : String(parseFloat(yuan.toFixed(2)))
  return fen < 0 ? `-${formatted}` : formatted
}
```

`parseFloat("15.90")` → `15.9`，`parseFloat("15.50")` → `15.5`，`parseFloat("15.00")` → `15`（由整数分支处理）。

---

## 4. 限制编辑和删除权限

**当前：** 任何消息都可以长按编辑、滑动删除
**目标：** 只有 isMine 的消息才能编辑和删除

### 修改文件

- `apps/web/src/components/ChatBubble.vue` — onTouchStart、滑动逻辑

### 实现

在 `onTouchStart` 开头加入守卫：

```ts
if (!props.isMine) return
```

他人消息的长按和滑动交互全部禁用，只保留查看功能。

---

## 5. 编辑弹窗增加创建时间字段

**当前：** 编辑弹窗只有金额和说明
**目标：** 增加创建时间（日期+时间）的显示和编辑

### 修改文件

- `apps/web/src/components/EditDialog.vue` — 增加日期时间输入
- `apps/web/src/pages/HomePage.vue` — save 事件增加 createdAt
- `apps/web/src/stores/transaction.ts` — updateTransaction 支持 createdAt
- API 层 — update 接口需支持 createdAt 字段更新

### 实现

EditDialog.vue 中增加：

```vue
<div>
  <label class="text-sm text-muted-foreground mb-1 block">时间</label>
  <Input type="datetime-local" v-model="createdAtStr" />
</div>
```

- `createdAtStr` 初始值从 `transaction.createdAt`（Unix 时间戳）转换为 `datetime-local` 格式
- 保存时转换回 Unix 时间戳
- save 事件签名变为 `save: [id: string, data: { amount: number; note: string; createdAt?: number }]`

---

## 影响范围

| 修改项 | 前端 | API | 数据库 |
|--------|------|-----|--------|
| 1. 气泡颜色 | ChatBubble, CSS | - | - |
| 2. 输入解析 | input-parser | - | - |
| 3. 金额显示 | input-parser | - | - |
| 4. 编辑权限 | ChatBubble | - | - |
| 5. 编辑时间 | EditDialog, HomePage, store | update 接口 | createdAt 字段（已有） |

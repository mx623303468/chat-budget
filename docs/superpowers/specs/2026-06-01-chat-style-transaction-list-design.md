# 微信风格聊天式记账列表设计

## 背景

当前记账列表中所有交易气泡都是右对齐的，无法区分不同用户记录的交易。需要改造为类似微信聊天的布局：自己的记录在右侧，其他用户的记录在左侧，并显示用户头像和昵称。

## 需求

1. 自己的交易记录显示在右侧（绿色主色气泡）
2. 其他用户的交易记录显示在左侧（灰色气泡）
3. 每条记录旁显示用户头像（有头像显示图片，无头像显示昵称首字 + 固定颜色背景）
4. 同一用户连续记录时，只在第一条显示昵称和头像
5. 保留现有的滑动删除、长按编辑交互
6. 保留虚拟滚动性能优化

## 数据层

### 成员映射

在 HomePage 中获取账本成员列表，建立 `userId → { nickname, avatar }` 映射，传递给 VirtualChatList 和 ChatBubble。

当前用户通过 `useAuthStore().user.id` 判断 `isMine`。

### 交易数据修复

`stores/transaction.ts` 中 `addTransaction` 方法当前将 `userId` 和 `createdBy` 硬编码为空字符串。改为使用 API 返回的完整数据。

## ChatBubble 改造

### 布局方向

- `isMine = true`（userId === 当前用户 id）：右对齐，头像在右侧
- `isMine = false`：左对齐，头像在左侧

### 头像显示

- 有 `avatar` → 显示圆形图片（32px）
- 无 `avatar` → 显示昵称首字 + 随机固定颜色背景
- 通过 `showAvatar` prop 控制是否显示（连续同一用户时不显示）

### 昵称显示

- 通过 `showNickname` prop 控制
- 显示在气泡上方，小字灰色（11px，text-muted-foreground）
- 仅他人的气泡显示昵称（自己的不需要）

### 气泡颜色

- 自己：`bg-primary text-primary-foreground`（保持现有主色）
- 他人：`bg-muted text-foreground`（浅灰背景）

### Props 变更

```typescript
// 新增 props
isMine: boolean
nickname?: string
avatar?: string | null
showNickname?: boolean
showAvatar?: boolean
```

### 交互保留

滑动删除（左滑 64px 显示删除按钮）和长按编辑（500ms）对左右气泡都适用。

## VirtualChatList 分组改造

### 当前分组逻辑

按 `date` 字段分组，每组显示日期标签。

### 改造后分组逻辑

遍历 transactions 时，跟踪 `lastUserId`：
- 日期变化 → 插入日期分隔符
- userId 变化 → 标记 `showNickname = true`，`showAvatar = true`
- userId 未变化 → `showNickname = false`，`showAvatar = false`

### GroupItem 类型扩展

```typescript
type GroupItem =
  | { type: 'date'; date: string; label: string }
  | {
      type: 'transaction'
      data: Transaction
      isMine: boolean
      nickname?: string
      avatar?: string | null
      showNickname: boolean
      showAvatar: boolean
    }
```

## 影响范围

| 文件 | 改动 |
|------|------|
| `ChatBubble.vue` | 添加左右布局、头像、昵称显示 |
| `VirtualChatList.vue` | 分组逻辑增加用户切换判断，传递新 props |
| `HomePage.vue` | 获取成员映射，传给 VirtualChatList |
| `stores/transaction.ts` | 修复 addTransaction 使用 API 返回数据 |

## 视觉规范

- 头像：圆形 32px，间距 8px
- 昵称：11px，text-muted-foreground，位于气泡上方
- 自己的气泡：右上圆角减小（微信尾巴效果）
- 他人的气泡：左上圆角减小
- 日期分隔符：保持现有样式不变

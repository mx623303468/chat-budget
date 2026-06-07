// 用户
export type User = {
  id: string
  email: string
  nickname: string
  avatar: string | null
  createdAt: number
  updatedAt: number
}

// 账本
export type Ledger = {
  id: string
  name: string
  ownerId: string
  dailyLimit: number
  startDate: string
  createdAt: number
  updatedAt: number
  deletedAt: number | null
}

// 账本成员
export type LedgerMember = {
  ledgerId: string
  userId: string
  role: 'owner' | 'member'
  joinedAt: number
  removedAt: number | null
}

// 邀请
export type LedgerInvite = {
  id: string
  ledgerId: string
  code: string
  createdBy: string
  expiresAt: number | null
  revokedAt: number | null
  createdAt: number
}

// 交易
export type Transaction = {
  id: string
  ledgerId: string
  userId: string
  amount: number
  note: string
  date: string
  createdAt: number
  updatedAt: number
  deletedAt: number | null
  createdBy: string
  updatedBy: string | null
  deletedBy: string | null
  version: number
}

// 事件
export type LedgerEvent = {
  id: number
  ledgerId: string
  type: string
  entityType: string
  entityId: string
  actorUserId: string
  clientMutationId: string | null
  payload: string
  createdAt: number
}

// 限额历史
export type LimitHistory = {
  id: number
  ledgerId: string
  effectiveDate: string
  dailyLimit: number
  createdBy: string
  createdAt: number
}

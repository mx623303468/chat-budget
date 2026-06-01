// 从共享包重新导出共享类型
export type {
  User,
  Ledger,
  LedgerMember,
  LedgerInvite,
  Transaction,
  LedgerEvent,
} from '@chat-budget/shared'

// 纯前端类型（本地 IndexedDB 使用）
export type Settings = {
  id?: number
  dailyLimit: number
  startDate: string
}

export type LimitHistory = {
  id?: number
  date: string
  limit: number
}

export type ParseResult =
  | { ok: true; amount: number; note: string }
  | { ok: false; hint: string }

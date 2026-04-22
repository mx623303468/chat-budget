export type Transaction = {
  id?: number
  amount: number
  note: string
  date: string
  createdAt: number
}

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

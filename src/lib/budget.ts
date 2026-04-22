import type { Settings, Transaction } from '@/types'

export function getTodayStr(): string {
  return new Date().toISOString().slice(0, 10)
}

/**
 * 计算从起始日期到今天的天数（含起始日和今天）
 */
export function calcTotalDays(startDate: string): number {
  const start = new Date(startDate)
  const today = new Date(getTodayStr())
  const diffMs = today.getTime() - start.getTime()
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24)) + 1
  return Math.max(days, 0)
}

/**
 * 计算今日总支出（分）
 */
export function calcTodaySpend(transactions: Transaction[]): number {
  const today = getTodayStr()
  return transactions
    .filter((t) => t.date === today)
    .reduce((sum, t) => sum + t.amount, 0)
}

/**
 * 计算总支出（分）
 */
export function calcTotalSpend(transactions: Transaction[]): number {
  return transactions.reduce((sum, t) => sum + t.amount, 0)
}

/**
 * 计算总余额（分）
 * balance = totalDays * dailyLimit - totalSpend
 */
export function calcBalance(
  settings: Settings,
  transactions: Transaction[],
): number {
  const totalDays = calcTotalDays(settings.startDate)
  const totalSpend = calcTotalSpend(transactions)
  return totalDays * settings.dailyLimit - totalSpend
}

/**
 * 计算今日余额（分）
 * todayBalance = balance + todaySpend (因为 todaySpend 已经包含在 totalSpend 中)
 * 实际上就是: totalBalance（已经减去了今日支出）
 */
export function calcTodayBalance(
  settings: Settings,
  transactions: Transaction[],
): number {
  return calcBalance(settings, transactions)
}

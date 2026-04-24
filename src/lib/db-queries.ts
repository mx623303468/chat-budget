import { db } from './db'

/**
 * 查询最近的 N 条交易（按 createdAt 降序）
 */
export function queryLatest(count: number) {
  return db.transactions
    .orderBy('createdAt')
    .reverse()
    .limit(count)
    .toArray()
}

/**
 * 查询指定时间之前的 N 条交易（按 createdAt 降序）
 */
export function queryBefore(beforeCreatedAt: number, count: number) {
  return db.transactions
    .where('createdAt')
    .below(beforeCreatedAt)
    .reverse()
    .limit(count)
    .toArray()
}

/**
 * 查询交易总数
 */
export function queryCount() {
  return db.transactions.count()
}

import Dexie, { type EntityTable } from 'dexie'
import type { Transaction, Settings, LimitHistory } from '@/types'

const db = new Dexie('ChatBudgetDB') as Dexie & {
  transactions: EntityTable<Transaction, 'id'>
  settings: EntityTable<Settings, 'id'>
  limitHistory: EntityTable<LimitHistory, 'id'>
}

db.version(1).stores({
  transactions: '++id, date, createdAt',
  settings: '++id',
  limitHistory: '++id, date',
})

// 请求持久化存储，防止浏览器 LRU 清理 IndexedDB 数据
// 浏览器根据启发式规则自动决定是否授权（如已安装 PWA），无用户弹窗
navigator.storage?.persist?.()

export { db }

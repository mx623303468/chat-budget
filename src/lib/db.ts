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
if (navigator.storage?.persist) {
  navigator.storage.persist().then((granted) => {
    if (!granted) {
      console.warn('持久化存储未获授权，数据可能被浏览器清理')
    }
  })
}

export { db }

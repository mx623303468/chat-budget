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

export { db }

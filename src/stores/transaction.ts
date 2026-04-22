import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import { db } from '@/lib/db'
import { getTodayStr, calcTodaySpend, calcTotalSpend, calcBalance } from '@/lib/budget'
import { useSettingsStore } from './settings'
import type { Transaction } from '@/types'

export const useTransactionStore = defineStore('transaction', () => {
  const transactions = ref<Transaction[]>([])

  async function loadTransactions(): Promise<void> {
    transactions.value = await db.transactions.orderBy('createdAt').toArray()
  }

  async function addTransaction(amount: number, note: string): Promise<void> {
    const record: Transaction = {
      amount,
      note,
      date: getTodayStr(),
      createdAt: Date.now(),
    }
    const id = await db.transactions.add(record)
    transactions.value = [...transactions.value, { ...record, id }]
  }

  async function deleteTransaction(id: number): Promise<void> {
    await db.transactions.delete(id)
    transactions.value = transactions.value.filter((t) => t.id !== id)
  }

  async function updateTransaction(
    id: number,
    data: { amount?: number; note?: string },
  ): Promise<void> {
    await db.transactions.update(id, data)
    transactions.value = transactions.value.map((t) =>
      t.id === id ? { ...t, ...data } : t,
    )
  }

  const todaySpend = computed(() => calcTodaySpend(transactions.value))

  const totalSpend = computed(() => calcTotalSpend(transactions.value))

  const balance = computed(() => {
    const settings = useSettingsStore()
    if (!settings.isConfigured) return 0
    return calcBalance(
      { dailyLimit: settings.dailyLimit, startDate: settings.startDate },
      transactions.value,
    )
  })

  const todayTransactions = computed(() => {
    const today = getTodayStr()
    return transactions.value.filter((t) => t.date === today)
  })

  return {
    transactions,
    loadTransactions,
    addTransaction,
    deleteTransaction,
    updateTransaction,
    todaySpend,
    totalSpend,
    balance,
    todayTransactions,
  }
})

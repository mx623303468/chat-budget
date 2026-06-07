import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import { transactionsApi } from '@/lib/api'
import { getTodayStr, calcTodaySpend, calcTotalSpend, calcBalance } from '@/lib/budget'
import { useLedgersStore } from './ledgers'
import { useAuthStore } from './auth'
import type { Transaction } from '@chat-budget/shared'

function uuid(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export const useTransactionStore = defineStore('transaction', () => {
  const transactions = ref<Transaction[]>([])
  const currentCursor = ref<string | null>(null)
  const hasMore = ref(true)
  const loading = ref(false)

  /**
   * 从 API 加载交易列表（首次加载）
   */
  async function loadTransactions(ledgerId: string): Promise<void> {
    loading.value = true
    try {
      const res = await transactionsApi.list(ledgerId, { limit: 50 })
      // API 返回降序（新 → 旧），反转为升序（旧 → 新）
      transactions.value = [...res.transactions].reverse()
      currentCursor.value = res.nextCursor
      hasMore.value = res.nextCursor !== null
    } finally {
      loading.value = false
    }
  }

  /**
   * 加载更早的交易（向上翻页）
   */
  async function loadOlder(ledgerId: string): Promise<number> {
    if (loading.value || !hasMore.value || !currentCursor.value) return 0

    loading.value = true
    try {
      const res = await transactionsApi.list(ledgerId, {
        cursor: currentCursor.value!,
        limit: 50,
      })
      const older = [...res.transactions].reverse()
      transactions.value = [...transactions.value, ...older]
      currentCursor.value = res.nextCursor
      hasMore.value = res.nextCursor !== null
      return older.length
    } finally {
      loading.value = false
    }
  }

  /**
   * 新增交易
   */
  async function addTransaction(
    ledgerId: string,
    amount: number,
    note: string,
  ): Promise<void> {
    const authStore = useAuthStore()
    const currentUserId = authStore.user?.id ?? ''

    const id = uuid()
    const clientMutationId = uuid()
    const date = getTodayStr()

    const res = await transactionsApi.create(ledgerId, {
      id,
      clientMutationId,
      amount,
      note,
      date,
    })

    const now = Date.now()
    const tx: Transaction = {
      id: res.id,
      ledgerId,
      userId: currentUserId,
      amount,
      note,
      date,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      createdBy: currentUserId,
      updatedBy: null,
      deletedBy: null,
      version: res.version,
    }
    transactions.value = [...transactions.value, tx]
  }

  /**
   * 删除交易
   */
  async function deleteTransaction(
    ledgerId: string,
    transactionId: string,
  ): Promise<void> {
    const clientMutationId = uuid()
    await transactionsApi.delete(ledgerId, transactionId, clientMutationId)
    transactions.value = transactions.value.filter((t) => t.id !== transactionId)
  }

  /**
   * 更新交易
   */
  async function updateTransaction(
    ledgerId: string,
    transactionId: string,
    data: { amount?: number; note?: string; createdAt?: number },
  ): Promise<void> {
    const existing = transactions.value.find((t) => t.id === transactionId)
    if (!existing) return

    const clientMutationId = uuid()
    const res = await transactionsApi.update(ledgerId, transactionId, {
      clientMutationId,
      version: existing.version,
      ...data,
    })

    const updated = transactions.value.map((t) => {
      if (t.id !== transactionId) return t
      const newCreatedAt = data.createdAt ?? t.createdAt
      const newDate = new Date(newCreatedAt)
      const dateStr = `${newDate.getFullYear()}-${String(newDate.getMonth() + 1).padStart(2, '0')}-${String(newDate.getDate()).padStart(2, '0')}`
      return {
        ...t,
        ...data,
        date: data.createdAt ? dateStr : t.date,
        version: res.version,
        updatedAt: Date.now(),
      }
    })
    updated.sort((a, b) => a.createdAt - b.createdAt)
    transactions.value = updated
  }

  const todaySpend = computed(() => calcTodaySpend(transactions.value))

  const totalSpend = computed(() => calcTotalSpend(transactions.value))

  const balance = computed(() => {
    const ledgersStore = useLedgersStore()
    const ledger = ledgersStore.currentLedger
    if (!ledger || !ledger.dailyLimit || !ledger.startDate) return 0
    return calcBalance(
      { dailyLimit: ledger.dailyLimit, startDate: ledger.startDate },
      transactions.value,
    )
  })

  const todayTransactions = computed(() => {
    const today = getTodayStr()
    return transactions.value.filter((t) => t.date === today)
  })

  function handleRemoteAdd(tx: Transaction): void {
    const exists = transactions.value.some((t) => t.id === tx.id)
    if (exists) return
    const list = [...transactions.value, tx]
    list.sort((a, b) => a.createdAt - b.createdAt)
    transactions.value = list
  }

  function handleRemoteUpdate(tx: Transaction): void {
    const list = transactions.value.map((t) =>
      t.id === tx.id ? tx : t,
    )
    list.sort((a, b) => a.createdAt - b.createdAt)
    transactions.value = list
  }

  function handleRemoteDelete(transactionId: string): void {
    transactions.value = transactions.value.filter((t) => t.id !== transactionId)
  }

  return {
    transactions,
    currentCursor,
    hasMore,
    loading,
    loadTransactions,
    loadOlder,
    addTransaction,
    deleteTransaction,
    updateTransaction,
    todaySpend,
    totalSpend,
    balance,
    todayTransactions,
    handleRemoteAdd,
    handleRemoteUpdate,
    handleRemoteDelete,
  }
})

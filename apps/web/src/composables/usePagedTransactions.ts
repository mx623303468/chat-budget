import { ref, computed } from 'vue'
import { db } from '@/lib/db'
import { queryLatest, queryBefore, queryCount } from '@/lib/db-queries'
import { toDateStr } from '@/lib/date-utils'
import type { Transaction } from '@/types'

const PAGE_SIZE = 50

export function usePagedTransactions() {
  const displayItems = ref<Transaction[]>([])
  const hasMore = ref(true)
  const loading = ref(false)

  /**
   * 初始加载最近一页数据
   */
  async function loadInitial(): Promise<void> {
    loading.value = true
    try {
      const total = await queryCount()
      const items = await queryLatest(PAGE_SIZE)
      // 反转为升序（旧 → 新）
      displayItems.value = items.reverse()
      hasMore.value = displayItems.value.length < total
    } finally {
      loading.value = false
    }
  }

  /**
   * 向上加载更早的一页数据
   * 返回新加载的条数，用于 scrollTop 校正
   */
  async function loadOlder(): Promise<number> {
    if (loading.value || !hasMore.value) return 0

    loading.value = true
    try {
      const oldest = displayItems.value[0]
      if (!oldest) return 0

      const items = await queryBefore(oldest.createdAt, PAGE_SIZE)
      if (items.length === 0) {
        hasMore.value = false
        return 0
      }

      // items 是降序，反转为升序后拼到前面
      const older = items.reverse()
      displayItems.value = [...older, ...displayItems.value]

      if (items.length < PAGE_SIZE) {
        hasMore.value = false
      }

      return older.length
    } finally {
      loading.value = false
    }
  }

  /**
   * 新增交易 - 追加到末尾
   */
  async function addTransaction(amount: number, note: string): Promise<void> {
    const now = Date.now()
    const dateStr = toDateStr(new Date(now))

    const record: Transaction = {
      amount,
      note,
      date: dateStr,
      createdAt: now,
    }

    try {
      const id = await db.transactions.add(record)
      displayItems.value = [...displayItems.value, { ...record, id }]
    } catch (err) {
      throw new Error('保存失败，请重试', { cause: err })
    }
  }

  /**
   * 删除交易
   */
  async function deleteTransaction(id: number): Promise<void> {
    try {
      await db.transactions.delete(id)
      displayItems.value = displayItems.value.filter((t) => t.id !== id)
    } catch (err) {
      throw new Error('删除失败，请重试', { cause: err })
    }
  }

  /**
   * 更新交易
   */
  async function updateTransaction(
    id: number,
    data: { amount?: number; note?: string },
  ): Promise<void> {
    try {
      await db.transactions.update(id, data)
      displayItems.value = displayItems.value.map((t) =>
        t.id === id ? { ...t, ...data } : t,
      )
    } catch (err) {
      throw new Error('更新失败，请重试', { cause: err })
    }
  }

  /**
   * 获取第一条记录的 createdAt（用于 scrollTop 校正锚点）
   */
  const firstCreatedAt = computed(() =>
    displayItems.value[0]?.createdAt ?? 0,
  )

  return {
    displayItems,
    hasMore,
    loading,
    loadInitial,
    loadOlder,
    addTransaction,
    deleteTransaction,
    updateTransaction,
    firstCreatedAt,
  }
}

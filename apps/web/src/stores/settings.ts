import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import { db } from '@/lib/db'
import type { Settings, LimitHistory } from '@/types'

export const useSettingsStore = defineStore('settings', () => {
  const dailyLimit = ref(0) // 分
  const startDate = ref('')
  const limitHistory = ref<LimitHistory[]>([])
  const loaded = ref(false)

  const dailyLimitYuan = computed(() => dailyLimit.value / 100)

  async function loadSettings(): Promise<void> {
    const all = await db.settings.toArray()
    if (all.length > 0) {
      const s = all[0]!
      dailyLimit.value = s.dailyLimit
      startDate.value = s.startDate
    }
    limitHistory.value = await db.limitHistory.toArray()
    loaded.value = true
  }

  async function saveSettings(limit: number, date: string): Promise<void> {
    const all = await db.settings.toArray()
    const record: Settings = { dailyLimit: limit, startDate: date }
    if (all.length > 0) {
      await db.settings.update(all[0]!.id!, record)
    } else {
      await db.settings.add(record)
    }
    dailyLimit.value = limit
    startDate.value = date
  }

  async function addLimitHistory(date: string, limit: number): Promise<void> {
    await db.limitHistory.add({ date, limit })
    limitHistory.value = await db.limitHistory.toArray()
  }

  const isConfigured = computed(() => dailyLimit.value > 0 && startDate.value !== '')

  return {
    dailyLimit,
    startDate,
    limitHistory,
    loaded,
    dailyLimitYuan,
    isConfigured,
    loadSettings,
    saveSettings,
    addLimitHistory,
  }
})

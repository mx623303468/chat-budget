import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import { ledgersApi } from '@/lib/api'
import type { Ledger } from '@chat-budget/shared'

const STORAGE_KEY = 'chat-budget:current-ledger-id'

export const useLedgersStore = defineStore('ledgers', () => {
  const ledgers = ref<Ledger[]>([])
  const currentLedgerId = ref<string | null>(
    localStorage.getItem(STORAGE_KEY),
  )
  const loading = ref(false)

  const currentLedger = computed(() =>
    ledgers.value.find((l) => l.id === currentLedgerId.value) ?? null,
  )

  async function fetchLedgers(): Promise<void> {
    loading.value = true
    try {
      const res = await ledgersApi.list()
      ledgers.value = res.ledgers
    } finally {
      loading.value = false
    }
  }

  async function createLedger(data: {
    name: string
    dailyLimit?: number
    startDate: string
  }): Promise<Ledger> {
    const res = await ledgersApi.create(data)
    ledgers.value = [...ledgers.value, res.ledger]
    return res.ledger
  }

  async function updateLedger(
    id: string,
    data: { name?: string; dailyLimit?: number; startDate?: string },
  ): Promise<void> {
    const res = await ledgersApi.update(id, data)
    ledgers.value = ledgers.value.map((l) =>
      l.id === id ? res.ledger : l,
    )
  }

  async function deleteLedger(id: string): Promise<void> {
    await ledgersApi.delete(id)
    ledgers.value = ledgers.value.filter((l) => l.id !== id)
    if (currentLedgerId.value === id) {
      selectLedger(null)
    }
  }

  function selectLedger(id: string | null): void {
    currentLedgerId.value = id
    if (id) {
      localStorage.setItem(STORAGE_KEY, id)
    } else {
      localStorage.removeItem(STORAGE_KEY)
    }
  }

  function handleRemoteSettingsUpdate(
    ledgerId: string,
    settings: { name: string; dailyLimit: number; startDate: string },
  ): void {
    ledgers.value = ledgers.value.map((l) =>
      l.id === ledgerId
        ? { ...l, name: settings.name, dailyLimit: settings.dailyLimit, startDate: settings.startDate }
        : l,
    )
  }

  function handleRemoteLedgerDelete(ledgerId: string): void {
    ledgers.value = ledgers.value.filter((l) => l.id !== ledgerId)
    if (currentLedgerId.value === ledgerId) {
      selectLedger(null)
    }
  }

  return {
    ledgers,
    currentLedgerId,
    currentLedger,
    loading,
    fetchLedgers,
    createLedger,
    updateLedger,
    deleteLedger,
    selectLedger,
    handleRemoteSettingsUpdate,
    handleRemoteLedgerDelete,
  }
})

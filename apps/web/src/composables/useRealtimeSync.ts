import { ref, onUnmounted } from 'vue'
import type { ServerMessage } from '@chat-budget/shared'
import { useTransactionStore } from '@/stores/transaction'
import { useLedgersStore } from '@/stores/ledgers'
import { useAuthStore } from '@/stores/auth'

export type SyncState = 'disconnected' | 'connecting' | 'live'

const MAX_RETRIES = 10
const BASE_DELAY = 1000
const MAX_DELAY = 30000

export function useRealtimeSync() {
  const syncState = ref<SyncState>('disconnected')
  let ws: WebSocket | null = null
  let retryCount = 0
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let currentLedgerId: string | null = null
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null

  function getWsUrl(ledgerId: string): string {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${proto}//${window.location.host}/api/ws/${ledgerId}`
  }

  function connect(ledgerId: string) {
    if (ws?.readyState === WebSocket.OPEN) return
    disconnect()

    currentLedgerId = ledgerId
    syncState.value = 'connecting'
    ws = new WebSocket(getWsUrl(ledgerId))

    ws.onopen = () => {
      retryCount = 0
      syncState.value = 'live'
      ws!.send(JSON.stringify({ type: 'subscribe', ledgerId }))
      startHeartbeat()
    }

    ws.onmessage = (event) => {
      try {
        const msg: ServerMessage = JSON.parse(event.data)
        handleMessage(msg)
      } catch {
        // ignore
      }
    }

    ws.onclose = () => {
      syncState.value = 'disconnected'
      stopHeartbeat()
      ws = null
      scheduleReconnect()
    }

    ws.onerror = () => {
      // onclose fires after this
    }
  }

  function disconnect() {
    if (retryTimer) {
      clearTimeout(retryTimer)
      retryTimer = null
    }
    stopHeartbeat()
    retryCount = 0
    if (ws) {
      ws.onclose = null
      ws.close()
      ws = null
    }
    syncState.value = 'disconnected'
  }

  function scheduleReconnect() {
    if (!currentLedgerId || retryCount >= MAX_RETRIES) return
    const delay = Math.min(BASE_DELAY * Math.pow(2, retryCount), MAX_DELAY)
    retryCount++
    retryTimer = setTimeout(() => {
      if (currentLedgerId) connect(currentLedgerId)
    }, delay)
  }

  function startHeartbeat() {
    stopHeartbeat()
    heartbeatTimer = setInterval(() => {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ping' }))
      }
    }, 30000)
  }

  function stopHeartbeat() {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer)
      heartbeatTimer = null
    }
  }

  function handleMessage(msg: ServerMessage) {
    if (msg.type === 'pong' || msg.type === 'connected' || msg.type === 'error') return

    const auth = useAuthStore()
    if ('actorUserId' in msg && msg.actorUserId === auth.user?.id) return

    const transactionStore = useTransactionStore()
    const ledgersStore = useLedgersStore()

    switch (msg.type) {
      case 'transaction_added': {
        const tx = (msg.payload as { transaction: any }).transaction
        if (tx) transactionStore.handleRemoteAdd(tx)
        break
      }
      case 'transaction_updated': {
        const tx = (msg.payload as { transaction: any }).transaction
        if (tx) transactionStore.handleRemoteUpdate(tx)
        break
      }
      case 'transaction_deleted': {
        const { transactionId } = msg.payload as { transactionId: string }
        transactionStore.handleRemoteDelete(transactionId)
        break
      }
      case 'settings_updated': {
        const settings = (msg.payload as { settings: any }).settings
        if (settings && currentLedgerId) {
          ledgersStore.handleRemoteSettingsUpdate(currentLedgerId, settings)
        }
        break
      }
      case 'ledger_deleted': {
        ledgersStore.handleRemoteLedgerDelete(currentLedgerId!)
        break
      }
    }
  }

  onUnmounted(() => {
    disconnect()
  })

  return {
    syncState,
    connect,
    disconnect,
  }
}

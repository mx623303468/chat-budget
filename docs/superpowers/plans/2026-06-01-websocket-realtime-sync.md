# 前端 WebSocket 实时同步 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现前端 WebSocket 连接，让多用户在同一账本中实时看到彼此的操作。

**Architecture:** 创建一个 `useRealtimeSync` composable 管理 WebSocket 生命周期。进入账本页面时建立 WS 连接，接收服务端广播的事件（transaction_added/updated/deleted 等），直接更新 transaction store。离开账本时断开连接。使用指数退避重连。

**Tech Stack:** Vue 3 Composition API, 原生 WebSocket, Pinia store, @chat-budget/shared 类型

---

### Task 1: 创建 useRealtimeSync composable

**Files:**
- Create: `apps/web/src/composables/useRealtimeSync.ts`

- [ ] **Step 1: 创建 composable 文件**

```typescript
import { ref, onUnmounted } from 'vue'
import type { ServerMessage, LedgerEventMessage } from '@chat-budget/shared'
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
      // onclose will fire after this
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

    // LedgerEventMessage
    const auth = useAuthStore()
    // 跳过自己的操作回声（本地已乐观更新）
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
```

- [ ] **Step 2: 验证构建通过**

Run: `pnpm --filter web build 2>&1 | tail -5`
Expected: 构建成功（可能缺少 store 方法，下一步补）

---

### Task 2: 给 transaction store 添加远程事件处理方法

**Files:**
- Modify: `apps/web/src/stores/transaction.ts`

- [ ] **Step 1: 在 transaction store 的 return 前添加三个远程处理方法**

在 `todayTransactions` computed 之后、`return` 之前添加：

```typescript
  /**
   * 远程：其他用户添加了交易
   */
  function handleRemoteAdd(tx: Transaction): void {
    const exists = transactions.value.some((t) => t.id === tx.id)
    if (exists) return
    // 插入到正确位置（按 createdAt 升序）
    const list = [...transactions.value, tx]
    list.sort((a, b) => a.createdAt - b.createdAt)
    transactions.value = list
  }

  /**
   * 远程：其他用户更新了交易
   */
  function handleRemoteUpdate(tx: Transaction): void {
    transactions.value = transactions.value.map((t) =>
      t.id === tx.id ? tx : t,
    )
  }

  /**
   * 远程：其他用户删除了交易
   */
  function handleRemoteDelete(transactionId: string): void {
    transactions.value = transactions.value.filter((t) => t.id !== transactionId)
  }
```

- [ ] **Step 2: 在 return 对象中导出新方法**

在 return 对象中添加 `handleRemoteAdd`、`handleRemoteUpdate`、`handleRemoteDelete`。

- [ ] **Step 3: 验证构建通过**

Run: `pnpm --filter web build 2>&1 | tail -5`
Expected: 构建成功

---

### Task 3: 给 ledgers store 添加远程事件处理方法

**Files:**
- Modify: `apps/web/src/stores/ledgers.ts`

- [ ] **Step 1: 在 return 前添加远程处理方法**

```typescript
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
```

- [ ] **Step 2: 在 return 对象中导出新方法**

添加 `handleRemoteSettingsUpdate`、`handleRemoteLedgerDelete`。

- [ ] **Step 3: 验证构建通过**

Run: `pnpm --filter web build 2>&1 | tail -5`
Expected: 构建成功

---

### Task 4: 在 HomePage 中接入 WebSocket

**Files:**
- Modify: `apps/web/src/pages/HomePage.vue`

- [ ] **Step 1: 引入 composable 并在 onMounted 中连接**

在 `<script setup>` 中：

1. 添加 import：
```typescript
import { useRealtimeSync } from '@/composables/useRealtimeSync'
```

2. 初始化 composable：
```typescript
const { syncState, connect: connectWs, disconnect: disconnectWs } = useRealtimeSync()
```

3. 在 `onMounted` 末尾添加 WebSocket 连接：
```typescript
connectWs(ledgerId)
```

- [ ] **Step 2: 在 goBack 中断开连接**

修改 `goBack` 函数：
```typescript
function goBack() {
  disconnectWs()
  router.push({ name: 'ledgers' })
}
```

- [ ] **Step 3: 在顶栏添加在线状态指示**

在顶栏 h1 标签之后添加：
```html
<span
  class="w-2 h-2 rounded-full shrink-0"
  :class="syncState === 'live' ? 'bg-green-500' : 'bg-yellow-500'"
/>
```

- [ ] **Step 4: 验证构建通过**

Run: `pnpm --filter web build 2>&1 | tail -5`
Expected: 构建成功

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/composables/useRealtimeSync.ts apps/web/src/stores/transaction.ts apps/web/src/stores/ledgers.ts apps/web/src/pages/HomePage.vue
git commit -m "feat(web): 实现 WebSocket 实时同步"
```

---

### Task 5: 配置 Vite WebSocket 代理

**Files:**
- Modify: `apps/web/vite.config.ts`

- [ ] **Step 1: 添加 WebSocket 代理**

在 `server.proxy` 中添加 `/api/ws` 代理：

```typescript
proxy: {
  '/api/ws': {
    target: 'ws://localhost:8787',
    ws: true,
    changeOrigin: true,
  },
  '/api': {
    target: 'http://localhost:8787',
    changeOrigin: true,
  },
},
```

注意：`/api/ws` 必须在 `/api` 之前，确保优先匹配。

- [ ] **Step 2: 验证构建通过**

Run: `pnpm --filter web build 2>&1 | tail -5`
Expected: 构建成功

- [ ] **Step 3: 提交**

```bash
git add apps/web/vite.config.ts
git commit -m "feat(web): 配置 WebSocket 开发代理"
```

---

## 实现后行为

1. 用户进入账本 → 建立 WebSocket 连接 → 顶栏显示绿色圆点
2. 其他用户在相同账本中增删改交易 → 当前用户实时看到变化
3. 自己的操作由本地乐观更新处理，WS 事件被 `actorUserId` 过滤
4. 断线后自动重连（指数退避，1s → 2s → 4s → ... → 30s）
5. 离开账本页面 → 断开 WebSocket

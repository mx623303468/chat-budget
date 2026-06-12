<script setup lang="ts">
import { ref, onMounted, defineAsyncComponent, type Component } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft } from 'lucide-vue-next'
import BudgetHeader from '@/components/BudgetHeader.vue'
import ChatList, { type MemberMap } from '@/components/ChatList.vue'
import ChatInput from '@/components/ChatInput.vue'
import EditDialog from '@/components/EditDialog.vue'
import { useTransactionStore } from '@/stores/transaction'
import { useLedgersStore } from '@/stores/ledgers'
import { useRealtimeSync } from '@/composables/useRealtimeSync'
import { membersApi } from '@/lib/api'
import { useAuthStore } from '@/stores/auth'
import type { Transaction } from '@chat-budget/shared'

type ViewName = 'home' | 'stats' | 'settings'

const viewComponents: Record<ViewName, Component> = {
  home: {} as Component,
  stats: defineAsyncComponent(() => import('@/pages/StatsPage.vue')),
  settings: defineAsyncComponent(() => import('@/pages/SettingsPage.vue')),
}

const route = useRoute()
const router = useRouter()
const ledgersStore = useLedgersStore()
const transactionStore = useTransactionStore()
const { syncState, connect: connectWs, disconnect: disconnectWs } = useRealtimeSync({
  onProfileUpdate(data) {
    const entry = memberMap.value[data.userId]
    if (entry) {
      memberMap.value[data.userId] = { ...entry, nickname: data.nickname, avatar: data.avatar }
    }
  },
})

const currentView = ref<ViewName>('home')
const editOpen = ref(false)
const editTarget = ref<Transaction | null>(null)

const ledgerId = route.params.id as string

const authStore = useAuthStore()
const memberMap = ref<MemberMap>({})

async function fetchMembers() {
  try {
    const res = await membersApi.list(ledgerId)
    const map: MemberMap = {}
    for (const m of res.members) {
      map[m.userId] = { nickname: m.nickname, avatar: m.avatar }
    }
    if (authStore.user) {
      map[authStore.user.id] = {
        nickname: authStore.user.nickname,
        avatar: authStore.user.avatar,
      }
    }
    memberMap.value = map
  } catch {
    // 成员列表获取失败不阻塞页面
  }
}

onMounted(async () => {
  if (!ledgersStore.currentLedger || ledgersStore.currentLedgerId !== ledgerId) {
    ledgersStore.selectLedger(ledgerId)
    await ledgersStore.fetchLedgers()
  }
  await Promise.all([
    transactionStore.loadTransactions(ledgerId),
    fetchMembers(),
  ])
  connectWs(ledgerId)
})

function navigateTo(view: ViewName) {
  currentView.value = view
}

function goBack() {
  disconnectWs()
  router.push({ name: 'ledgers' })
}

async function onSubmit(amount: number, note: string) {
  await transactionStore.addTransaction(ledgerId, amount, note)
}

async function onDelete(id: string) {
  await transactionStore.deleteTransaction(ledgerId, id)
}

function onEdit(transaction: Transaction) {
  editTarget.value = { ...transaction }
  editOpen.value = true
}

async function onSaveEdit(id: string, data: { amount: number; note: string; createdAt?: number }) {
  await transactionStore.updateTransaction(ledgerId, id, data)
}

async function onLoadMore() {
  await transactionStore.loadOlder(ledgerId)
}
</script>

<template>
  <div class="h-dvh bg-background overflow-hidden">
    <!-- 统计/设置页 -->
    <component
      v-if="currentView !== 'home'"
      :is="viewComponents[currentView]"
      :ledger-id="ledgerId"
      @back="navigateTo('home')"
    />

    <template v-else>
      <!-- 首页 -->
      <div class="flex flex-col h-full">
        <!-- 顶栏 -->
        <div class="flex items-center gap-2 px-4 py-2 border-b">
          <button
            class="text-muted-foreground hover:text-foreground transition-colors p-1"
            @click="goBack"
          >
            <ArrowLeft :size="18" />
          </button>
          <h1 class="text-sm font-medium truncate text-center flex-1">
            {{ ledgersStore.currentLedger?.name ?? '账本' }}
          </h1>
          <span
            class="w-2 h-2 rounded-full shrink-0"
            :class="syncState === 'live' ? 'bg-green-500' : 'bg-yellow-500'"
          />
        </div>

        <BudgetHeader @navigate="navigateTo" />
        <ChatList
          :transactions="transactionStore.transactions"
          :has-more="transactionStore.hasMore"
          :loading="transactionStore.loading"
          :member-map="memberMap"
          :current-user-id="authStore.user?.id ?? ''"
          @delete="onDelete"
          @edit="onEdit"
          @load-more="onLoadMore"
        />
        <ChatInput @submit="onSubmit" />
      </div>
    </template>

    <EditDialog
      v-model:open="editOpen"
      :transaction="editTarget"
      @save="onSaveEdit"
    />
  </div>
</template>

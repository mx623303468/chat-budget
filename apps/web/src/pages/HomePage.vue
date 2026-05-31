<script setup lang="ts">
import { ref, onMounted, defineAsyncComponent, type Component } from 'vue'
import BudgetHeader from '@/components/BudgetHeader.vue'
import VirtualChatList from '@/components/VirtualChatList.vue'
import ChatInput from '@/components/ChatInput.vue'
import EditDialog from '@/components/EditDialog.vue'
import { useTransactionStore } from '@/stores/transaction'
import { useSettingsStore } from '@/stores/settings'
import { usePagedTransactions } from '@/composables/usePagedTransactions'
import type { Transaction } from '@/types'

type ViewName = 'home' | 'stats' | 'settings'

const viewComponents: Record<ViewName, Component> = {
  home: {} as Component,
  stats: defineAsyncComponent(() => import('@/pages/StatsPage.vue')),
  settings: defineAsyncComponent(() => import('@/pages/SettingsPage.vue')),
}

const currentView = ref<ViewName>('home')
const settingsStore = useSettingsStore()
const transactionStore = useTransactionStore()
const paged = usePagedTransactions()

const editOpen = ref(false)
const editTarget = ref<Transaction | null>(null)

onMounted(async () => {
  await settingsStore.loadSettings()
  await transactionStore.loadTransactions()
  await paged.loadInitial()
})

function navigateTo(view: ViewName) {
  currentView.value = view
}

function onSubmit(amount: number, note: string) {
  paged.addTransaction(amount, note)
  transactionStore.loadTransactions()
}

function onDelete(id: number) {
  paged.deleteTransaction(id)
  transactionStore.loadTransactions()
}

function onEdit(transaction: Transaction) {
  editTarget.value = { ...transaction }
  editOpen.value = true
}

function onSaveEdit(id: number, data: { amount: number; note: string }) {
  paged.updateTransaction(id, data)
  transactionStore.loadTransactions()
}

async function onLoadMore() {
  await paged.loadOlder()
}
</script>

<template>
  <div class="h-dvh bg-background overflow-hidden">
    <!-- 统计/设置页 -->
    <component
      v-if="currentView !== 'home'"
      :is="viewComponents[currentView]"
      @back="navigateTo('home')"
    />

    <template v-else>
      <!-- 首次使用引导 -->
      <div
        v-if="settingsStore.loaded && !settingsStore.isConfigured"
        class="h-full flex items-center justify-center"
      >
        <div class="text-center px-8">
          <div class="text-lg font-medium mb-2">欢迎使用聊天记账</div>
          <div class="text-sm text-muted-foreground mb-4">
            请先设置每日预算
          </div>
          <button
            class="inline-block px-6 py-2 bg-primary text-primary-foreground rounded-lg"
            @click="navigateTo('settings')"
          >
            去设置
          </button>
        </div>
      </div>

      <!-- 首页 -->
      <div v-else class="flex flex-col h-full">
        <BudgetHeader @navigate="navigateTo" />
        <VirtualChatList
          :transactions="paged.displayItems.value"
          :has-more="paged.hasMore.value"
          :loading="paged.loading.value"
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

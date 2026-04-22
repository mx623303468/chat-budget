<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import BudgetHeader from '@/components/BudgetHeader.vue'
import ChatList from '@/components/ChatList.vue'
import ChatInput from '@/components/ChatInput.vue'
import EditDialog from '@/components/EditDialog.vue'
import { useTransactionStore } from '@/stores/transaction'
import { useSettingsStore } from '@/stores/settings'
import { useSwipeNav } from '@/composables/useSwipeNav'
import type { Transaction } from '@/types'

const router = useRouter()
const settingsStore = useSettingsStore()
const transactionStore = useTransactionStore()

const editOpen = ref(false)
const editTarget = ref<Transaction | null>(null)

const { onTouchStart, onTouchMove, onTouchEnd, style, ripple, phase } = useSwipeNav(
  () => router.push('/settings'),
  () => router.push('/stats'),
)

onMounted(async () => {
  await settingsStore.loadSettings()
  await transactionStore.loadTransactions()
})

function onSubmit(amount: number, note: string) {
  transactionStore.addTransaction(amount, note)
}

function onDelete(id: number) {
  transactionStore.deleteTransaction(id)
}

function onEdit(transaction: Transaction) {
  editTarget.value = { ...transaction }
  editOpen.value = true
}

function onSaveEdit(id: number, data: { amount: number; note: string }) {
  transactionStore.updateTransaction(id, data)
}

function rippleTransition(): string {
  return phase.value !== 'dragging'
    ? 'width 0.35s cubic-bezier(0, 0.55, 0.45, 1), height 0.35s cubic-bezier(0, 0.55, 0.45, 1), left 0.35s cubic-bezier(0, 0.55, 0.45, 1)'
    : 'none'
}
</script>

<template>
  <div class="h-dvh bg-background overflow-hidden">
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
        <router-link
          to="/settings"
          class="inline-block px-6 py-2 bg-primary text-primary-foreground rounded-lg"
        >
          去设置
        </router-link>
      </div>
    </div>

    <!-- 主界面 -->
    <template v-else>
      <div
        class="flex flex-col h-full"
        :style="style"
        @touchstart="onTouchStart"
        @touchmove="onTouchMove"
        @touchend="onTouchEnd"
      >
        <BudgetHeader />
        <ChatList
          :transactions="transactionStore.transactions"
          @delete="onDelete"
          @edit="onEdit"
        />
        <ChatInput @submit="onSubmit" />
      </div>

      <!-- 水波纹：从屏幕边缘向内扩散，径向渐变 -->
      <div
        v-if="ripple.active"
        class="fixed inset-0 z-50 pointer-events-none overflow-hidden"
      >
        <div
          class="ripple-wave"
          :style="{
            left: ripple.centerX + 'px',
            top: ripple.centerY + 'px',
            width: ripple.width + 'px',
            height: ripple.height + 'px',
            transition: rippleTransition(),
          }"
        />
      </div>
    </template>

    <EditDialog
      v-model:open="editOpen"
      :transaction="editTarget"
      @save="onSaveEdit"
    />
  </div>
</template>

<style scoped>
/* 水波纹：填充椭圆 + 径向渐变，圆心处深、边缘处浅 */
.ripple-wave {
  position: absolute;
  border-radius: 50%;
  transform: translate(-50%, -50%);
  pointer-events: none;
  background: radial-gradient(
    ellipse at center,
    color-mix(in oklch, var(--primary) 14%, transparent) 0%,
    color-mix(in oklch, var(--primary) 8%, transparent) 30%,
    color-mix(in oklch, var(--primary) 3%, transparent) 60%,
    transparent 85%
  );
}
</style>

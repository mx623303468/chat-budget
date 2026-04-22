<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { DotLottieVue } from '@lottiefiles/dotlottie-vue'
import { fenToYuan } from '@/lib/input-parser'
import { useTransactionStore } from '@/stores/transaction'
import { useSettingsStore } from '@/stores/settings'
import { Separator } from '@/components/ui/separator'

const settings = useSettingsStore()
const transactionStore = useTransactionStore()

const balanceYuan = computed(() => fenToYuan(transactionStore.balance))
const spendYuan = computed(() => fenToYuan(transactionStore.todaySpend))

const balanceColor = computed(() => {
  const b = transactionStore.balance
  if (b > 0) return 'text-green-600'
  if (b === 0) return 'text-yellow-500'
  return 'text-red-500'
})

// 超支警告 Lottie
const showWarning = ref(false)
const warningKey = ref(0)

watch(
  () => transactionStore.balance,
  (newVal, oldVal) => {
    if (newVal < 0 && oldVal >= 0) {
      showWarning.value = true
      warningKey.value++
      setTimeout(() => {
        showWarning.value = false
      }, 1200)
    }
  },
)
</script>

<template>
  <div class="px-4 py-3 bg-background">
    <div class="flex justify-between items-center">
      <div class="flex items-center gap-2">
        <div>
          <div class="text-xs text-muted-foreground mb-1">今日余额</div>
          <div
            class="text-3xl font-bold tabular-nums transition-colors duration-300"
            :class="balanceColor"
          >
            {{ balanceYuan }}
          </div>
        </div>
        <Transition name="fade">
          <DotLottieVue
            v-if="showWarning"
            :key="warningKey"
            src="/animations/warning.json"
            :autoplay="true"
            :loop="false"
            style="width: 48px; height: 48px"
          />
        </Transition>
      </div>
      <div class="text-right">
        <div class="text-xs text-muted-foreground mb-1">今日支出</div>
        <div class="text-lg font-semibold tabular-nums text-foreground">
          {{ spendYuan }}
        </div>
      </div>
    </div>
    <Separator class="mt-3" />
  </div>
</template>

<style scoped>
.fade-enter-active { transition: opacity 0.2s ease; }
.fade-leave-active { transition: opacity 0.3s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>

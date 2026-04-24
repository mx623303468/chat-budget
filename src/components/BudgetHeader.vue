<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { DotLottieVue } from '@lottiefiles/dotlottie-vue'
import { fenToYuan } from '@/lib/input-parser'
import { useTransactionStore } from '@/stores/transaction'
import { useSettingsStore } from '@/stores/settings'
import { Separator } from '@/components/ui/separator'
import { BarChart3, Settings } from 'lucide-vue-next'

const emit = defineEmits<{
  navigate: [view: 'home' | 'stats' | 'settings']
}>()
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

// --- 下拉展开 ---
const expanded = ref(false)
const pullY = ref(0)
const pulling = ref(false)
const EXPAND_H = 52 // 展开后额外高度
let touchStartY = 0

function onTouchStart(e: TouchEvent) {
  touchStartY = e.touches[0]?.clientY ?? 0
  pulling.value = true
}

function onTouchMove(e: TouchEvent) {
  const y = e.touches[0]?.clientY ?? 0
  const dy = y - touchStartY

  if (!expanded.value && dy > 0) {
    e.preventDefault()
    // 弹性阻尼
    const damped = dy * 0.5
    pullY.value = Math.min(damped, EXPAND_H + 10)
  }

  if (expanded.value && dy < -20) {
    expanded.value = false
  }
}

function onTouchEnd() {
  pulling.value = false
  if (pullY.value > EXPAND_H * 0.4) {
    expanded.value = true
  }
  pullY.value = 0
}

function collapse() {
  expanded.value = false
}
</script>

<template>
  <div
    class="px-4 bg-background select-none"
    @touchstart="onTouchStart"
    @touchmove="onTouchMove"
    @touchend="onTouchEnd"
  >
    <div class="flex justify-between items-center pt-3 pb-2">
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
            src="animations/warning.json"
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

    <!-- 下拉展开区域：设置/统计入口 -->
    <div
      class="overflow-hidden transition-[max-height] duration-300 ease-out"
      :style="{ maxHeight: expanded ? EXPAND_H + 'px' : pullY > 0 ? pullY + 'px' : '0px' }"
    >
      <div class="flex gap-3 pb-2">
        <button
          class="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg bg-secondary text-secondary-foreground text-sm font-medium active:bg-secondary/80 transition-colors"
          @click="emit('navigate', 'stats'); collapse()"
        >
          <BarChart3 :size="16" />
          统计
        </button>
        <button
          class="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg bg-secondary text-secondary-foreground text-sm font-medium active:bg-secondary/80 transition-colors"
          @click="emit('navigate', 'settings'); collapse()"
        >
          <Settings :size="16" />
          设置
        </button>
      </div>
    </div>

    <Separator />
  </div>
</template>

<style scoped>
.fade-enter-active { transition: opacity 0.2s ease; }
.fade-leave-active { transition: opacity 0.3s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>

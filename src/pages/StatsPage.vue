<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { ArrowLeft, TrendingUp, TrendingDown, Clock, Wallet } from 'lucide-vue-next'
import { useTransactionStore } from '@/stores/transaction'
import { useSettingsStore } from '@/stores/settings'
import { fenToYuan } from '@/lib/input-parser'
import { Separator } from '@/components/ui/separator'

const emit = defineEmits<{
  back: []
}>()
const settingsStore = useSettingsStore()
const transactionStore = useTransactionStore()

onMounted(async () => {
  await settingsStore.loadSettings()
  await transactionStore.loadTransactions()
})

const totalSpendYuan = computed(() => fenToYuan(transactionStore.totalSpend))
const balanceYuan = computed(() => fenToYuan(transactionStore.balance))
const todaySpendYuan = computed(() => fenToYuan(transactionStore.todaySpend))

const totalDays = computed(() => {
  if (!settingsStore.startDate) return 0
  const start = new Date(settingsStore.startDate)
  const today = new Date(new Date().toISOString().slice(0, 10))
  const diff = Math.floor((today.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1
  return Math.max(diff, 0)
})

const dailyLimitYuan = computed(() => fenToYuan(settingsStore.dailyLimit))

const avgDailySpend = computed(() => {
  if (totalDays.value === 0) return '0'
  const avgFen = Math.round(transactionStore.totalSpend / totalDays.value)
  return fenToYuan(avgFen)
})

// 按日期分组统计（最近 7 天）
const dailyStats = computed(() => {
  const map = new Map<string, number>()
  const today = new Date()

  // 初始化最近7天
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    const key = d.toISOString().slice(0, 10)
    map.set(key, 0)
  }

  // 累加支出
  for (const t of transactionStore.transactions) {
    if (map.has(t.date)) {
      map.set(t.date, (map.get(t.date) ?? 0) + t.amount)
    }
  }

  const entries = Array.from(map.entries())
  const maxAmount = Math.max(...entries.map(([, v]) => v), 1)

  return entries.map(([date, amount]) => ({
    date,
    label: date.slice(5), // MM-DD
    amountYuan: fenToYuan(amount),
    percent: Math.round((amount / maxAmount) * 100),
    isToday: date === new Date().toISOString().slice(0, 10),
  }))
})

// 按说明分组统计（支出排行）
const noteStats = computed(() => {
  const map = new Map<string, number>()
  for (const t of transactionStore.transactions) {
    map.set(t.note, (map.get(t.note) ?? 0) + t.amount)
  }
  return Array.from(map.entries())
    .map(([note, amount]) => ({ note, amountYuan: fenToYuan(amount) }))
    .sort((a, b) => {
      const aVal = parseFloat(a.amountYuan)
      const bVal = parseFloat(b.amountYuan)
      return bVal - aVal
    })
    .slice(0, 10)
})
</script>

<template>
  <div class="flex flex-col h-dvh bg-background">
    <!-- 顶部导航 -->
    <div class="relative flex items-center justify-center px-4 py-3 border-b">
      <button
        class="absolute left-4 text-muted-foreground hover:text-foreground transition-colors p-1"
        @click="emit('back')"
      >
        <ArrowLeft :size="20" />
      </button>
      <h1 class="text-lg font-medium">统计</h1>
    </div>

    <div class="flex-1 overflow-y-auto px-4 py-4 space-y-6">
      <!-- 总览 -->
      <div class="grid grid-cols-2 gap-3">
        <div class="bg-card rounded-xl p-4">
          <div class="flex items-center gap-1 text-xs text-muted-foreground mb-1">
            <Wallet :size="12" />
            <span>总余额</span>
          </div>
          <div class="text-xl font-bold tabular-nums">
            {{ balanceYuan }}
          </div>
        </div>
        <div class="bg-card rounded-xl p-4">
          <div class="flex items-center gap-1 text-xs text-muted-foreground mb-1">
            <TrendingDown :size="12" />
            <span>今日支出</span>
          </div>
          <div class="text-xl font-bold tabular-nums">
            {{ todaySpendYuan }}
          </div>
        </div>
        <div class="bg-card rounded-xl p-4">
          <div class="flex items-center gap-1 text-xs text-muted-foreground mb-1">
            <TrendingUp :size="12" />
            <span>累计支出</span>
          </div>
          <div class="text-xl font-bold tabular-nums">
            {{ totalSpendYuan }}
          </div>
        </div>
        <div class="bg-card rounded-xl p-4">
          <div class="flex items-center gap-1 text-xs text-muted-foreground mb-1">
            <Clock :size="12" />
            <span>日均支出</span>
          </div>
          <div class="text-xl font-bold tabular-nums">
            {{ avgDailySpend }}
          </div>
        </div>
      </div>

      <Separator />

      <!-- 最近 7 天 -->
      <div>
        <h2 class="text-sm font-medium mb-3">近 7 天支出</h2>
        <div class="space-y-2">
          <div
            v-for="day in dailyStats"
            :key="day.date"
            class="flex items-center gap-3"
          >
            <span
              class="text-xs w-12 text-right"
              :class="day.isToday ? 'font-medium text-foreground' : 'text-muted-foreground'"
            >
              {{ day.isToday ? '今日' : day.label }}
            </span>
            <div class="flex-1 h-5 bg-muted rounded-full overflow-hidden">
              <div
                class="h-full rounded-full transition-all duration-300"
                :class="day.isToday ? 'bg-primary' : 'bg-primary/60'"
                :style="{ width: day.percent + '%' }"
              />
            </div>
            <span class="text-xs tabular-nums w-12 text-right">{{ day.amountYuan }}</span>
          </div>
        </div>
      </div>

      <Separator />

      <!-- 支出排行 -->
      <div>
        <h2 class="text-sm font-medium mb-3">支出排行</h2>
        <div v-if="noteStats.length === 0" class="text-sm text-muted-foreground">暂无数据</div>
        <div v-else class="space-y-2">
          <div
            v-for="item in noteStats"
            :key="item.note"
            class="flex justify-between items-center py-1"
          >
            <span class="text-sm">{{ item.note }}</span>
            <span class="text-sm tabular-nums text-muted-foreground">{{ item.amountYuan }}</span>
          </div>
        </div>
      </div>

      <!-- 预算信息 -->
      <Separator />
      <div class="text-xs text-muted-foreground space-y-1 pb-4">
        <div>每日限额：{{ dailyLimitYuan }} 元</div>
        <div>起始日期：{{ settingsStore.startDate }}</div>
        <div>已累计：{{ totalDays }} 天</div>
      </div>
    </div>
  </div>
</template>

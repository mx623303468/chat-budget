<script setup lang="ts">
import { ref, computed } from 'vue'
import type { Transaction } from '@/types'
import { fenToYuan } from '@/lib/input-parser'
import { toDateStr } from '@/lib/date-utils'

const props = defineProps<{
  transaction: Transaction
  animate?: boolean
}>()

const emit = defineEmits<{
  delete: [id: number]
  edit: [transaction: Transaction]
}>()

const amountYuan = computed(() => fenToYuan(props.transaction.amount))

const timeStr = computed(() => {
  const d = new Date(props.transaction.createdAt)
  const hhmm = d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  return props.transaction.date === toDateStr(new Date()) ? `今天 ${hhmm}` : hhmm
})

// --- 滑动 ---
const DELETE_W = 64
const swipeX = ref(0)
const swiping = ref(false)
const isOpen = ref(false)

// --- 长按 ---
let lpTimer: ReturnType<typeof setTimeout> | null = null
let startX = 0
let startY = 0
let moved = false

function onTouchStart(e: TouchEvent) {
  e.stopPropagation()

  // 触摸删除按钮区域时不启动手势
  const target = e.target as HTMLElement
  if (target.closest('[data-delete-area]')) return

  // 阻止 iOS 长按弹出系统菜单
  target.addEventListener('contextmenu', (ev) => ev.preventDefault(), { once: true })

  const t = e.touches[0]
  if (!t) return
  startX = t.clientX
  startY = t.clientY
  moved = false

  lpTimer = setTimeout(() => {
    if (!moved) {
      close()
      emit('edit', props.transaction)
    }
  }, 500)
}

function onTouchMove(e: TouchEvent) {
  const t = e.touches[0]
  if (!t) return
  const dx = t.clientX - startX
  const dy = t.clientY - startY

  if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
    cancelLP()
    moved = true
  }

  if (dx < -4 && Math.abs(dx) > Math.abs(dy)) {
    e.preventDefault()
    swiping.value = true
    const base = isOpen.value ? -DELETE_W : 0
    const raw = base + dx
    const clamped = Math.max(raw, -(DELETE_W + 10))
    swipeX.value = clamped
  }

  // 已打开时右滑关闭
  if (isOpen.value && dx > 4 && Math.abs(dx) > Math.abs(dy)) {
    e.preventDefault()
    swiping.value = true
    const raw = dx - DELETE_W
    swipeX.value = Math.min(raw, 0)
  }
}

function onTouchEnd(e: TouchEvent) {
  e.stopPropagation()
  cancelLP()
  swiping.value = false

  if (swipeX.value < -(DELETE_W * 0.4)) {
    swipeX.value = -DELETE_W
    isOpen.value = true
  } else {
    close()
  }
}

function close() {
  swipeX.value = 0
  isOpen.value = false
}

function cancelLP() {
  if (lpTimer) { clearTimeout(lpTimer); lpTimer = null }
}

function onDeleteClick() {
  emit('delete', props.transaction.id!)
}

const trans = computed(() =>
  swiping.value ? 'none' : 'transform 0.3s cubic-bezier(0.32, 0.72, 0, 1)',
)
</script>

<template>
  <div class="mb-1" :class="{ 'animate-bubble-in': animate !== false }">
    <!-- 滑动区域：右对齐，overflow-hidden 裁剪右侧删除按钮 -->
    <div class="flex justify-end overflow-hidden">
      <!-- 并排容器：气泡 + 删除，整体左滑 -->
      <div
        class="flex"
        :style="{
          transform: `translateX(${swipeX}px)`,
          transition: trans,
          marginRight: `-${DELETE_W}px`,
        }"
        @touchstart="onTouchStart"
        @touchmove="onTouchMove"
        @touchend="onTouchEnd"
      >
        <!-- 气泡主体 -->
        <div
          class="bg-primary text-primary-foreground pl-4 pr-4 py-2.5 shadow-sm shrink-0 transition-[border-radius] duration-300"
          :style="{ minWidth: '60px', borderRadius: swipeX < 0 ? '16px 0 0 16px' : '16px 4px 16px 16px' }"
        >
          <div class="text-base font-medium tabular-nums leading-snug">
            {{ amountYuan }}
          </div>
          <div class="text-[13px] opacity-80 leading-snug mt-0.5">
            {{ transaction.note }}
          </div>
        </div>

        <!-- 删除按钮：紧贴气泡右侧，初始被 overflow-hidden 裁剪 -->
        <div
          data-delete-area
          class="flex items-center justify-center bg-red-500 shrink-0"
          :style="{ width: `${DELETE_W}px`, borderRadius: '0 12px 12px 0' }"
        >
          <button
            class="w-full h-full flex items-center justify-center text-white text-[13px] font-medium tracking-wide active:bg-red-600 transition-colors"
            @click="onDeleteClick"
          >
            删除
          </button>
        </div>
      </div>
    </div>

    <!-- 时间戳 -->
    <div class="flex justify-end">
      <div class="text-[11px] text-muted-foreground text-right mt-0.5 pr-1">
        {{ timeStr }}
      </div>
    </div>
  </div>
</template>

<style scoped>
@keyframes bubble-in {
  from { opacity: 0; transform: translateY(10px); }
  to   { opacity: 1; transform: translateY(0); }
}
.animate-bubble-in {
  animation: bubble-in 0.2s ease-out;
  -webkit-touch-callout: none;
  -webkit-user-select: none;
  user-select: none;
}
</style>

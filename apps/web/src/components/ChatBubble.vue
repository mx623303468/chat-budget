<script setup lang="ts">
import { ref, computed } from 'vue'
import type { Transaction } from '@/types'
import { fenToYuan } from '@/lib/input-parser'
import { toDateStr } from '@/lib/date-utils'
import UserAvatar from '@/components/UserAvatar.vue'

const props = defineProps<{
  transaction: Transaction
  animate?: boolean
  isMine?: boolean
  nickname?: string
  avatar?: string | null
  showNickname?: boolean
  showAvatar?: boolean
}>()

const emit = defineEmits<{
  delete: [id: string]
  edit: [transaction: Transaction]
}>()

const amountYuan = computed(() => fenToYuan(props.transaction.amount))

const timeStr = computed(() => {
  const d = new Date(props.transaction.createdAt)
  const hhmm = d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  return props.transaction.date === toDateStr(new Date()) ? `今天 ${hhmm}` : hhmm
})

// --- 气泡圆角 ---
const bubbleRadius = computed(() => {
  if (swipeX.value !== 0) {
    return props.isMine ? '16px 0 0 16px' : '0 16px 16px 0'
  }
  return props.isMine
    ? '16px 4px 16px 16px'
    : '4px 16px 16px 16px'
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
  if (!props.isMine) return

  const target = e.target as HTMLElement
  if (target.closest('[data-delete-area]')) return

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
  if (!props.isMine) return
  const t = e.touches[0]
  if (!t) return
  const dx = t.clientX - startX
  const dy = t.clientY - startY

  if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
    cancelLP()
    moved = true
  }

  const openDir: number = props.isMine !== false ? -1 : 1

  if (dx * openDir > 4 && Math.abs(dx) > Math.abs(dy)) {
    e.preventDefault()
    swiping.value = true
    const base = isOpen.value ? DELETE_W * openDir : 0
    const raw = base + dx
    const maxSwipe = DELETE_W + 10
    swipeX.value = props.isMine !== false
      ? Math.max(raw, -maxSwipe)
      : Math.min(raw, maxSwipe)
  }

  if (isOpen.value && dx * (-openDir) > 4 && Math.abs(dx) > Math.abs(dy)) {
    e.preventDefault()
    swiping.value = true
    swipeX.value = props.isMine !== false
      ? Math.min(dx, 0)
      : Math.max(dx, 0)
  }
}

function onTouchEnd(e: TouchEvent) {
  e.stopPropagation()
  cancelLP()
  swiping.value = false

  if (Math.abs(swipeX.value) > DELETE_W * 0.4) {
    swipeX.value = props.isMine !== false ? -DELETE_W : DELETE_W
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
  emit('delete', props.transaction.id)
}

const trans = computed(() =>
  swiping.value ? 'none' : 'transform 0.3s cubic-bezier(0.32, 0.72, 0, 1)',
)
</script>

<template>
  <div class="mb-1" :class="{ 'animate-bubble-in': animate !== false }">
    <!-- 昵称（仅他人且 showNickname 时显示） -->
    <div
      v-if="!isMine && showNickname && nickname"
      class="text-[11px] text-muted-foreground mb-0.5 pl-10"
    >
      {{ nickname }}
    </div>

    <div class="flex items-end gap-2" :class="isMine ? 'justify-end' : 'justify-start'">
      <!-- 左侧头像（他人） -->
      <div v-if="!isMine && showAvatar" class="shrink-0 pb-5">
        <UserAvatar :avatar="avatar" :nickname="nickname ?? ''" :size="32" />
      </div>
      <!-- 占位（他人连续消息不显示头像时保持间距） -->
      <div v-else-if="!isMine" class="w-8 shrink-0" />

      <!-- 气泡滑动区域 -->
      <div class="overflow-hidden" :class="isMine ? 'flex justify-end' : 'flex justify-start'">
        <div
          class="flex"
          :class="isMine ? '' : 'flex-row-reverse'"
          :style="{
            transform: `translateX(${swipeX}px)`,
            transition: trans,
            marginRight: isMine ? `-${DELETE_W}px` : undefined,
            marginLeft: isMine ? undefined : `-${DELETE_W}px`,
          }"
          @touchstart="onTouchStart"
          @touchmove="onTouchMove"
          @touchend="onTouchEnd"
        >
          <!-- 气泡主体 -->
          <div
            class="pl-4 pr-4 py-2.5 shadow-sm shrink-0 transition-[border-radius] duration-300"
            :class="isMine ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground'"
            :style="{ minWidth: '60px', borderRadius: bubbleRadius }"
          >
            <div class="text-base font-medium tabular-nums leading-snug">
              {{ amountYuan }}
            </div>
            <div class="text-[13px] opacity-80 leading-snug mt-0.5">
              {{ transaction.note }}
            </div>
          </div>

          <!-- 删除按钮 -->
          <div
            data-delete-area
            class="flex items-center justify-center bg-red-500 shrink-0"
            :style="{
              width: `${DELETE_W}px`,
              borderRadius: isMine ? '0 12px 12px 0' : '12px 0 0 12px',
            }"
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

      <!-- 右侧头像（自己） -->
      <div v-if="isMine && showAvatar" class="shrink-0 pb-5">
        <UserAvatar :avatar="avatar" :nickname="nickname ?? ''" :size="32" />
      </div>
      <!-- 占位（自己连续消息不显示头像时保持间距） -->
      <div v-else-if="isMine" class="w-8 shrink-0" />
    </div>

    <!-- 时间戳 -->
    <div :class="isMine ? 'flex justify-end' : 'flex justify-start pl-10'">
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

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

  if (!isOpen.value && dx < -4 && Math.abs(dx) > Math.abs(dy)) {
    e.preventDefault()
    swiping.value = true
    const maxSwipe = DELETE_W + 10
    swipeX.value = Math.max(dx, -maxSwipe)
  }

  if (isOpen.value && dx > 4 && Math.abs(dx) > Math.abs(dy)) {
    e.preventDefault()
    swiping.value = true
    swipeX.value = Math.max(-DELETE_W + dx, -DELETE_W)
    swipeX.value = Math.min(swipeX.value, 0)
  }
}

function onTouchEnd(e: TouchEvent) {
  e.stopPropagation()
  cancelLP()
  swiping.value = false

  if (Math.abs(swipeX.value) > DELETE_W * 0.4) {
    swipeX.value = -DELETE_W
    isOpen.value = true
  } else {
    close()
  }
}

function cancelLP() {
  if (lpTimer) { clearTimeout(lpTimer); lpTimer = null }
}

const confirmDelete = ref(false)

function onDeleteClick() {
  confirmDelete.value = true
}

function onConfirmDelete() {
  confirmDelete.value = false
  emit('delete', props.transaction.id)
}

function onCancelDelete() {
  confirmDelete.value = false
  close()
}

function close() {
  swipeX.value = 0
  isOpen.value = false
}

const trans = computed(() =>
  swiping.value ? 'none' : 'transform 0.3s cubic-bezier(0.32, 0.72, 0, 1)',
)
</script>

<template>
  <div class="pb-1" :class="{ 'animate-bubble-in': animate !== false }">
    <div class="flex items-end gap-2" :class="isMine ? 'justify-end' : 'justify-start'">
      <!-- 左侧头像+昵称（他人） -->
      <div v-if="!isMine && showAvatar" class="shrink-0 pb-5 flex flex-col items-center gap-0.5">
        <UserAvatar :avatar="avatar" :nickname="nickname ?? ''" :size="32" />
        <span v-if="showNickname && nickname" class="text-[10px] text-muted-foreground max-w-[40px] truncate">{{ nickname }}</span>
      </div>
      <!-- 占位（他人连续消息不显示头像时保持间距） -->
      <div v-else-if="!isMine && showNickname && nickname" class="w-8 shrink-0 flex flex-col items-center">
        <div class="w-8 h-8" />
        <span class="text-[10px] text-muted-foreground max-w-[40px] truncate">{{ nickname }}</span>
      </div>
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
            :class="isMine ? 'bg-muted text-foreground' : 'bg-other text-foreground'"
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

      <!-- 删除确认弹窗 -->
      <Teleport to="body">
        <div v-if="confirmDelete" class="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40" @click.self="onCancelDelete">
          <div class="bg-popover rounded-xl shadow-lg w-72 overflow-hidden">
            <div class="px-5 pt-5 pb-3 text-center">
              <div class="text-base font-medium">确认删除</div>
              <div class="text-sm text-muted-foreground mt-1.5">删除后无法恢复，确定要删除这条记录吗？</div>
            </div>
            <div class="flex border-t">
              <button class="flex-1 py-3 text-sm hover:bg-muted/50 transition-colors" @click="onCancelDelete">取消</button>
              <button class="flex-1 py-3 text-sm text-destructive font-medium border-l hover:bg-muted/50 transition-colors" @click="onConfirmDelete">删除</button>
            </div>
          </div>
        </div>
      </Teleport>

      <!-- 右侧头像（自己） -->
      <div v-if="isMine && showAvatar" class="shrink-0 pb-5">
        <UserAvatar :avatar="avatar" :nickname="nickname ?? ''" :size="32" />
      </div>
      <!-- 占位（自己连续消息不显示头像时保持间距） -->
      <div v-else-if="isMine" class="w-8 shrink-0" />
    </div>

    <!-- 时间戳 -->
    <div :class="isMine ? 'flex justify-end pr-10' : 'flex justify-start pl-10'">
      <div class="text-[11px] text-muted-foreground text-right mt-0.5 pr-1">
        {{ timeStr }}
      </div>
    </div>
  </div>
</template>

<style scoped>
@keyframes bubble-in {
  from { opacity: 0; transform: translateY(4px); }
  to   { opacity: 1; transform: translateY(0); }
}
.animate-bubble-in {
  animation: bubble-in 0.2s ease-out;
  -webkit-touch-callout: none;
  -webkit-user-select: none;
  user-select: none;
}
</style>

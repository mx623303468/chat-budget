<script lang="ts">
export type MemberMap = Record<string, { nickname: string; avatar: string | null }>
</script>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { DotLottieVue } from '@lottiefiles/dotlottie-vue'
import type { Transaction } from '@/types'
import ChatBubble from './ChatBubble.vue'
import { formatDateLabel } from '@/lib/date-utils'

interface DateGroupItem { type: 'date'; date: string; label: string }
interface TransactionGroupItem {
  type: 'transaction'
  data: Transaction
  isMine: boolean
  nickname?: string
  avatar?: string | null
  showNickname: boolean
  showAvatar: boolean
}
type GroupItem = DateGroupItem | TransactionGroupItem

const props = defineProps<{
  transactions: Transaction[]
  hasMore: boolean
  loading: boolean
  memberMap: MemberMap
  currentUserId: string
}>()

const emit = defineEmits<{
  delete: [id: string]
  edit: [transaction: Transaction]
  'load-more': []
}>()

const containerRef = ref<HTMLElement | null>(null)

const grouped = computed<GroupItem[]>(() => {
  const result: GroupItem[] = []
  let lastDate = ''
  let lastUserId = ''

  for (const t of props.transactions) {
    if (t.date !== lastDate) {
      result.push({ type: 'date', date: t.date, label: formatDateLabel(t.date) })
      lastDate = t.date
      lastUserId = ''
    }

    const isMine = t.userId === props.currentUserId
    const member = props.memberMap[t.userId]
    const showNickname = t.userId !== lastUserId
    const showAvatar = t.userId !== lastUserId

    result.push({
      type: 'transaction',
      data: t,
      isMine,
      nickname: member?.nickname,
      avatar: member?.avatar ?? null,
      showNickname,
      showAvatar,
    })

    lastUserId = t.userId
  }

  return result
})

function itemKey(item: GroupItem): string {
  return item.type === 'date' ? `date-${item.date}` : item.data.id
}

// --- 加载更多 ---
let loadingMore = false
let lastLoadTime = 0
const LOAD_COOLDOWN = 800

function handleScroll(): void {
  const el = containerRef.value
  if (!el) return
  if (!props.hasMore || props.loading || loadingMore) return

  const now = Date.now()
  if (now - lastLoadTime < LOAD_COOLDOWN) return

  if (el.scrollTop < 50) {
    loadingMore = true
    lastLoadTime = now
    const prevHeight = el.scrollHeight
    emit('load-more')

    // 加载完成后校正位置：保持视觉不跳动
    const stop = watch(() => props.loading, (isLoading) => {
      if (isLoading) return
      stop()
      nextTick(() => {
        const el2 = containerRef.value
        if (el2) {
          el2.scrollTop = el2.scrollTop + (el2.scrollHeight - prevHeight)
        }
        loadingMore = false
      })
    })
  }
}

// --- 自动滚到底部 ---
let needsScrollToBottom = false

watch(
  () => props.transactions.length,
  (newLen, oldLen) => {
    if (newLen > oldLen) {
      needsScrollToBottom = true
    }
  },
)

watch(
  () => props.transactions.length,
  () => {
    if (!needsScrollToBottom) return
    needsScrollToBottom = false
    nextTick(() => {
      requestAnimationFrame(scrollToBottom)
    })
  },
)

function scrollToBottom(): void {
  const el = containerRef.value
  if (!el) return
  const max = el.scrollHeight - el.clientHeight
  if (max > 0 && el.scrollTop < max - 5) {
    el.scrollTop = max
  }
}

// 初始加载滚到底部
nextTick(() => requestAnimationFrame(scrollToBottom))
</script>

<template>
  <div
    ref="containerRef"
    class="flex-1 overflow-y-auto overscroll-y-none px-4 py-2"
    @scroll="handleScroll"
  >
    <!-- 空状态 -->
    <div
      v-if="transactions.length === 0"
      class="flex flex-col items-center justify-center h-full text-muted-foreground"
    >
      <DotLottieVue
        src="animations/empty.json"
        :autoplay="true"
        :loop="true"
        style="width: 120px; height: 120px"
      />
      <p class="text-sm mt-2">还没有记录，输入金额开始记账</p>
    </div>

    <!-- 顶部加载指示器 -->
    <div
      v-if="loading && hasMore"
      class="flex justify-center py-2"
    >
      <span class="text-xs text-muted-foreground">加载中...</span>
    </div>

    <!-- 列表 -->
    <div v-if="transactions.length > 0" class="flex flex-col justify-end min-h-full">
      <template v-for="(item, idx) in grouped" :key="itemKey(item)">
        <div
          v-if="item.type === 'date'"
          class="flex items-center justify-center gap-2 py-2"
        >
          <span class="text-xs text-muted-foreground whitespace-nowrap">{{ (item as DateGroupItem).label }}</span>
        </div>
        <ChatBubble
          v-else
          :transaction="(item as TransactionGroupItem).data"
          :is-mine="(item as TransactionGroupItem).isMine"
          :nickname="(item as TransactionGroupItem).nickname"
          :avatar="(item as TransactionGroupItem).avatar"
          :show-nickname="(item as TransactionGroupItem).showNickname"
          :show-avatar="(item as TransactionGroupItem).showAvatar"
          :animate="idx === grouped.length - 1"
          @delete="emit('delete', $event)"
          @edit="emit('edit', $event)"
        />
      </template>
    </div>
  </div>
</template>

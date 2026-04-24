<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { DotLottieVue } from '@lottiefiles/dotlottie-vue'
import type { Transaction } from '@/types'
import ChatBubble from './ChatBubble.vue'
import { useVirtualList, type GroupItem } from '@/composables/useVirtualList'
import { formatDateLabel } from '@/lib/date-utils'

const props = defineProps<{
  transactions: Transaction[]
  hasMore: boolean
  loading: boolean
}>()

const emit = defineEmits<{
  delete: [id: number]
  edit: [transaction: Transaction]
  'load-more': []
}>()

const containerRef = ref<HTMLElement | null>(null)

// 按天分组
const grouped = computed<GroupItem[]>(() => {
  const result: GroupItem[] = []
  let lastDate = ''

  for (const t of props.transactions) {
    if (t.date !== lastDate) {
      result.push({ type: 'date', date: t.date, label: formatDateLabel(t.date) })
      lastDate = t.date
    }
    result.push({ type: 'transaction', data: t })
  }

  return result
})

function itemKey(item: GroupItem): string | number {
  return item.type === 'date' ? `date-${item.date}` : (item.data.id ?? 0)
}

const {
  totalHeight,
  visibleItems,
  offsetY,
  onScroll,
  initViewport,
} = useVirtualList(grouped, containerRef, itemKey)

// 数据量少于阈值时直接全量渲染
const SIMPLE_THRESHOLD = 30
const useVirtual = computed(() => grouped.value.length > SIMPLE_THRESHOLD)

// 加载更多防重入
let loadingMore = false
let prevTotalHeight = 0
let lastLoadTime = 0
const LOAD_COOLDOWN = 800

function handleScroll(): void {
  onScroll()

  const el = containerRef.value
  if (!el) return
  if (!props.hasMore || props.loading || loadingMore) return

  const now = Date.now()
  if (now - lastLoadTime < LOAD_COOLDOWN) return

  if (el.scrollTop < 50) {
    loadingMore = true
    lastLoadTime = now
    prevTotalHeight = totalHeight.value
    emit('load-more')
  }
}

// 加载更多后校正 scrollTop（保持视觉位置不变）
watch(totalHeight, async (newH) => {
  if (prevTotalHeight > 0 && newH > prevTotalHeight) {
    const delta = newH - prevTotalHeight
    await nextTick()
    const el = containerRef.value
    if (el) {
      el.scrollTop = el.scrollTop + delta
    }
    prevTotalHeight = 0
    await nextTick()
    loadingMore = false
  }
})

// 追踪是否需要滚到底部
let needsScrollToBottom = false

// 自动滚到底部：watch transactions 增长时标记，等 totalHeight 更新后执行
watch(
  () => props.transactions.length,
  (newLen, oldLen) => {
    if (newLen > oldLen) {
      needsScrollToBottom = true
    }
  },
)

// totalHeight 变化时，如果标记了需要滚底，则执行
watch(totalHeight, (newH, oldH) => {
  if (needsScrollToBottom && newH !== oldH) {
    needsScrollToBottom = false
    nextTick(() => {
      requestAnimationFrame(() => {
        const el = containerRef.value
        if (el) {
          el.scrollTop = el.scrollHeight - el.clientHeight
        }
      })
    })
  }
})

// 初始加载滚到底部
nextTick(() => {
  initViewport()
  requestAnimationFrame(() => {
    const el = containerRef.value
    if (el) {
      el.scrollTop = el.scrollHeight - el.clientHeight
    }
  })
})
</script>

<template>
  <div
    ref="containerRef"
    class="flex-1 overflow-y-auto overscroll-y-contain px-4 py-2 overflow-anchor-auto"
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

    <!-- 简单模式：少量数据直接渲染 -->
    <div v-if="!useVirtual && transactions.length > 0" class="flex flex-col justify-end min-h-full">
      <template v-for="(item, idx) in grouped" :key="itemKey(item)">
        <div
          v-if="item.type === 'date'"
          class="flex items-center justify-center gap-2 my-2"
        >
          <span class="text-xs text-muted-foreground whitespace-nowrap">{{ item.label }}</span>
        </div>
        <ChatBubble
          v-else
          :transaction="(item as { type: 'transaction'; data: Transaction }).data"
          :animate="idx === grouped.length - 1"
          @delete="emit('delete', $event)"
          @edit="emit('edit', $event)"
        />
      </template>
    </div>

    <!-- 虚拟滚动模式 -->
    <div
      v-if="useVirtual"
      class="relative"
      :style="{ height: totalHeight + 'px' }"
    >
      <div
        class="absolute left-0 right-0"
        :style="{ transform: `translateY(${offsetY}px)` }"
      >
        <div
          v-for="vi in visibleItems"
          :key="itemKey(vi.item)"
          :data-virtual-index="vi.index"
        >
          <div
            v-if="vi.item.type === 'date'"
            class="flex items-center justify-center gap-2 my-2"
          >
            <span class="text-xs text-muted-foreground whitespace-nowrap">{{ (vi.item as { type: 'date'; label: string }).label }}</span>
          </div>
          <ChatBubble
            v-else
            :animate="false"
            :transaction="(vi.item as { type: 'transaction'; data: Transaction }).data"
            @delete="emit('delete', $event)"
            @edit="emit('edit', $event)"
          />
        </div>
      </div>
    </div>
  </div>
</template>

import { ref, computed, watch, nextTick, type Ref } from 'vue'
import type { Transaction } from '@/types'

export interface VirtualItem {
  index: number
  offset: number
  height: number
  measured: boolean
}

export type DateGroupItem = { type: 'date'; date: string; label: string }

export type TransactionGroupItem = {
  type: 'transaction'
  data: Transaction
  isMine: boolean
  nickname?: string
  avatar?: string | null
  showNickname: boolean
  showAvatar: boolean
}

export type GroupItem = DateGroupItem | TransactionGroupItem

const BUFFER = 5

// 每个分类的动态高度估计：首次用兜底值，测量后自动更新为实际平均值
const _estDate = ref(30)
const _estBubble = ref(80)
const _estBubbleAvatar = ref(80)

// 分类累加器（只累加首次测量，避免重复计数）
let _sDate = 0, _nDate = 0
let _sBubble = 0, _nBubble = 0
let _sBubbleAvatar = 0, _nBubbleAvatar = 0
const _measured = new Set<string | number>()

function updateEstimate(key: string | number, item: GroupItem, height: number): void {
  if (_measured.has(key)) return
  _measured.add(key)

  if (item.type === 'date') {
    _sDate += height; _nDate++
    _estDate.value = _sDate / _nDate
  } else if (item.showAvatar && item.showNickname) {
    _sBubbleAvatar += height; _nBubbleAvatar++
    _estBubbleAvatar.value = _sBubbleAvatar / _nBubbleAvatar
  } else {
    _sBubble += height; _nBubble++
    _estBubble.value = _sBubble / _nBubble
  }
}

function estimateHeight(item: GroupItem): number {
  if (item.type === 'date') return _estDate.value
  if (item.showAvatar && item.showNickname) return _estBubbleAvatar.value
  return _estBubble.value
}

export function useVirtualList(
  items: Ref<GroupItem[]>,
  containerRef: Ref<HTMLElement | null>,
  keyFn: (item: GroupItem) => string | number,
) {
  const scrollTop = ref(0)
  const viewportHeight = ref(0)
  const heightCache = new Map<string | number, number>()

  // 计算每个 item 的 offset 和高度
  const virtualItems = computed<VirtualItem[]>(() => {
    void _measureTrigger.value
    const result: VirtualItem[] = []
    let offset = 0

    for (let i = 0; i < items.value.length; i++) {
      const item = items.value[i]!
      const key = keyFn(item)
      const cached = heightCache.get(key)
      const height = cached ?? estimateHeight(item)
      result.push({
        index: i,
        offset,
        height,
        measured: cached !== undefined,
      })
      offset += height
    }

    return result
  })

  const totalHeight = computed(() => {
    const arr = virtualItems.value
    if (arr.length === 0) return 0
    const last = arr[arr.length - 1]!
    return last.offset + last.height
  })

  // 计算可见范围
  const visibleRange = computed(() => {
    const arr = virtualItems.value
    if (arr.length === 0) return { start: 0, end: 0 }

    const top = scrollTop.value
    const bottom = top + viewportHeight.value

    let start = 0
    let end = arr.length - 1

    // 二分查找 start
    let lo = 0, hi = arr.length - 1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      const item = arr[mid]!
      if (item.offset + item.height <= top) {
        lo = mid + 1
      } else {
        hi = mid - 1
      }
    }
    start = Math.max(0, lo - BUFFER)

    // 二分查找 end
    lo = 0; hi = arr.length - 1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      const item = arr[mid]!
      if (item.offset < bottom) {
        lo = mid + 1
      } else {
        hi = mid - 1
      }
    }
    end = Math.min(arr.length - 1, lo + BUFFER)

    return { start, end }
  })

  // 需要渲染的 items
  const visibleItems = computed(() => {
    const { start, end } = visibleRange.value
    const result: { item: GroupItem; index: number; offset: number; height: number }[] = []

    // 如果起始项是 transaction，向前查找并包含它的 date 分隔线
    let adjustedStart = start
    if (start > 0 && items.value[start]?.type === 'transaction') {
      for (let i = start - 1; i >= 0; i--) {
        if (items.value[i]?.type === 'date') {
          adjustedStart = i
          break
        }
      }
    }

    for (let i = adjustedStart; i <= end; i++) {
      const vi = virtualItems.value[i]
      const item = items.value[i]
      if (!vi || !item) continue
      result.push({
        item,
        index: i,
        offset: vi.offset,
        height: vi.height,
      })
    }

    return result
  })

  // 渲染区偏移量（渲染区 top 相对于总高度的偏移）
  const offsetY = computed(() => {
    const { start } = visibleRange.value
    const vi = virtualItems.value[start]
    return vi ? vi.offset : 0
  })

  // 渲染后测量实际高度
  function measureRenderedItems(): void {
    const container = containerRef.value
    if (!container) return

    // 记录视口顶部锚点 item 的旧 offset（用于测量后校正滚动位置）
    const arr = virtualItems.value
    const top = scrollTop.value
    let lo = 0, hi = arr.length - 1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (arr[mid]!.offset + arr[mid]!.height <= top) lo = mid + 1
      else hi = mid - 1
    }
    const anchorIdx = Math.min(lo, arr.length - 1)
    const oldAnchorOffset = arr[anchorIdx]?.offset ?? 0

    const rendered = container.querySelectorAll('[data-virtual-index]')
    let changed = false

    rendered.forEach((el) => {
      const idx = Number((el as HTMLElement).dataset.virtualIndex)
      if (isNaN(idx)) return
      const item = items.value[idx]
      if (!item) return
      const key = keyFn(item)
      const actual = (el as HTMLElement).getBoundingClientRect().height
      updateEstimate(key, item, actual)
      const cached = heightCache.get(key)
      if (cached !== actual) {
        heightCache.set(key, actual)
        changed = true
      }
    })

    if (changed) {
      _measureTrigger.value++

      // Scroll anchoring：校正滚动位置，防止测量导致视口内容闪跳
      const newArr = virtualItems.value
      const newAnchorOffset = anchorIdx < newArr.length
        ? newArr[anchorIdx]!.offset : 0
      const delta = newAnchorOffset - oldAnchorOffset
      if (delta !== 0) {
        container.scrollTop += delta
        scrollTop.value = container.scrollTop
      }
    }
  }

  const _measureTrigger = ref(0)

  // 滚动事件处理
  let rafId = 0

  function onScroll(): void {
    cancelAnimationFrame(rafId)
    rafId = requestAnimationFrame(() => {
      const el = containerRef.value
      if (!el) return
      scrollTop.value = el.scrollTop
      viewportHeight.value = el.clientHeight

      measureRenderedItems()
    })
  }

  // 初始化 viewport
  function initViewport(): void {
    const el = containerRef.value
    if (el) {
      scrollTop.value = el.scrollTop
      viewportHeight.value = el.clientHeight
    }
  }

  // items 变化时重新初始化
  watch(items, () => {
    nextTick(() => {
      initViewport()
      measureRenderedItems()
    })
  }, { immediate: true })

  return {
    virtualItems,
    totalHeight,
    visibleItems,
    visibleRange,
    offsetY,
    onScroll,
    measureRenderedItems,
    initViewport,
  }
}

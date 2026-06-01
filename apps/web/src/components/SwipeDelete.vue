<script setup lang="ts">
import { ref, computed } from 'vue'

const props = withDefaults(defineProps<{
  deleteWidth?: number
}>(), {
  deleteWidth: 64,
})

const emit = defineEmits<{
  delete: []
}>()

const DELETE_W = computed(() => props.deleteWidth)
const swipeX = ref(0)
const swiping = ref(false)
const isOpen = ref(false)

let startX = 0
let startY = 0
let moved = false

function onTouchStart(e: TouchEvent) {
  const target = e.target as HTMLElement
  if (target.closest('[data-delete-area]')) return
  target.addEventListener('contextmenu', (ev) => ev.preventDefault(), { once: true })

  const t = e.touches[0]
  if (!t) return
  startX = t.clientX
  startY = t.clientY
  moved = false
}

function onTouchMove(e: TouchEvent) {
  const t = e.touches[0]
  if (!t) return
  const dx = t.clientX - startX
  const dy = t.clientY - startY

  if (Math.abs(dx) > 4 || Math.abs(dy) > 4) moved = true

  const w = DELETE_W.value

  if (dx < -4 && Math.abs(dx) > Math.abs(dy)) {
    e.preventDefault()
    swiping.value = true
    const base = isOpen.value ? -w : 0
    const raw = base + dx
    swipeX.value = Math.max(raw, -(w + 10))
  }

  if (isOpen.value && dx > 4 && Math.abs(dx) > Math.abs(dy)) {
    e.preventDefault()
    swiping.value = true
    swipeX.value = Math.min(dx, 0)
  }
}

function onTouchEnd() {
  swiping.value = false
  const w = DELETE_W.value

  if (swipeX.value < -(w * 0.4)) {
    swipeX.value = -w
    isOpen.value = true
  } else {
    close()
  }
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
  <div class="overflow-hidden" @click="isOpen && close()">
    <div
      :style="{
        transform: `translateX(${swipeX}px)`,
        transition: trans,
        marginRight: `-${DELETE_W}px`,
      }"
      @touchstart="onTouchStart"
      @touchmove="onTouchMove"
      @touchend="onTouchEnd"
    >
      <div class="flex">
        <div class="flex-1 min-w-0">
          <slot />
        </div>
        <div
          data-delete-area
          class="flex items-center justify-center bg-red-500 shrink-0"
          :style="{ width: `${DELETE_W}px`, borderRadius: '0 12px 12px 0' }"
        >
          <button
            class="w-full h-full flex items-center justify-center text-white text-[13px] font-medium tracking-wide active:bg-red-600 transition-colors"
            @click="emit('delete')"
          >
            删除
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

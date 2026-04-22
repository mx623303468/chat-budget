<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'
import { DotLottieVue } from '@lottiefiles/dotlottie-vue'
import type { Transaction } from '@/types'
import ChatBubble from './ChatBubble.vue'
import { useAutoScroll } from '@/composables/useAutoScroll'

const props = defineProps<{
  transactions: Transaction[]
}>()

const emit = defineEmits<{
  delete: [id: number]
  edit: [transaction: Transaction]
}>()

const containerRef = ref<HTMLElement | null>(null)
const { scrollToBottom } = useAutoScroll(containerRef)

// 交易列表变化时自动滚动
watch(
  () => props.transactions.length,
  () => {
    scrollToBottom()
  },
)

// 初始加载也滚动到底部
nextTick(() => {
  scrollToBottom()
})
</script>

<template>
  <div
    ref="containerRef"
    class="flex-1 overflow-y-auto overscroll-y-contain px-4 py-2"
  >
    <div
      v-if="transactions.length === 0"
      class="flex flex-col items-center justify-center h-full text-muted-foreground"
    >
      <DotLottieVue
        src="/animations/empty.json"
        :autoplay="true"
        :loop="true"
        style="width: 120px; height: 120px"
      />
      <p class="text-sm mt-2">还没有记录，输入金额开始记账</p>
    </div>
    <ChatBubble
      v-for="t in transactions"
      :key="t.id"
      :transaction="t"
      @delete="emit('delete', $event)"
      @edit="emit('edit', $event)"
    />
  </div>
</template>

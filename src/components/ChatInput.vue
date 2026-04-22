<script setup lang="ts">
import { ref, computed } from 'vue'
import { DotLottieVue } from '@lottiefiles/dotlottie-vue'
import { parse, fenToYuan } from '@/lib/input-parser'
import { Input } from '@/components/ui/input'

const emit = defineEmits<{
  submit: [amount: number, note: string]
}>()

const inputValue = ref('')
const inputRef = ref<InstanceType<typeof Input> | null>(null)
const showSuccess = ref(false)
const successKey = ref(0)

const parseResult = computed(() => {
  if (!inputValue.value.trim()) return null
  return parse(inputValue.value)
})

const hint = computed(() => {
  if (!inputValue.value.trim()) return ''
  if (!parseResult.value) return ''
  if (parseResult.value.ok) {
    return `${fenToYuan(parseResult.value.amount)} ${parseResult.value.note}`
  }
  return parseResult.value.hint
})

const isReady = computed(
  () => parseResult.value?.ok === true,
)

function handleSubmit() {
  if (!parseResult.value?.ok) return
  emit('submit', parseResult.value.amount, parseResult.value.note)
  inputValue.value = ''

  // 显示成功动画
  showSuccess.value = true
  successKey.value++
  setTimeout(() => {
    showSuccess.value = false
  }, 800)

  // 保持焦点
  setTimeout(() => {
    ;(inputRef.value?.$el as HTMLInputElement)?.focus()
  }, 0)
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    e.preventDefault()
    handleSubmit()
  }
}
</script>

<template>
  <div class="border-t bg-background px-4 pb-[env(safe-area-inset-bottom)] pt-2">
    <div class="flex items-center gap-2 mb-1 min-h-[20px]">
      <div v-if="hint" class="text-xs ml-1" :class="isReady ? 'text-muted-foreground' : 'text-yellow-600'">
        {{ hint }}
      </div>
      <Transition name="pop">
        <DotLottieVue
          v-if="showSuccess"
          :key="successKey"
          src="/animations/success.json"
          :autoplay="true"
          :loop="false"
          style="width: 24px; height: 24px; flex-shrink: 0"
        />
      </Transition>
    </div>
    <div class="flex gap-2">
      <Input
        ref="inputRef"
        v-model="inputValue"
        placeholder="输入：10 早餐"
        class="flex-1"
        @keydown="onKeydown"
      />
    </div>
  </div>
</template>

<style scoped>
.pop-enter-active { transition: all 0.2s ease-out; }
.pop-leave-active { transition: all 0.3s ease; }
.pop-enter-from { opacity: 0; transform: scale(0.5); }
.pop-leave-to { opacity: 0; transform: scale(0.8); }
</style>

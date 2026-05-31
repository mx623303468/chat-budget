<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { ArrowLeft } from 'lucide-vue-next'
import { useSettingsStore } from '@/stores/settings'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

const emit = defineEmits<{
  back: []
}>()
const settingsStore = useSettingsStore()

const dailyLimitYuan = ref('')
const startDate = ref('')
const showLimitDialog = ref(false)

onMounted(async () => {
  await settingsStore.loadSettings()
  dailyLimitYuan.value =
    settingsStore.dailyLimit > 0 ? (settingsStore.dailyLimit / 100).toString() : ''
  startDate.value = settingsStore.startDate || new Date().toISOString().slice(0, 10)
})

const canSave = computed(() => {
  const limit = parseFloat(dailyLimitYuan.value)
  return limit > 0 && startDate.value
})

async function handleSave(effectMode: 'today' | 'tomorrow') {
  const limitYuan = parseFloat(dailyLimitYuan.value)
  if (Number.isNaN(limitYuan) || limitYuan <= 0 || !startDate.value) return

  const limitFen = Math.round(limitYuan * 100)
  await settingsStore.saveSettings(limitFen, startDate.value)

  if (effectMode === 'tomorrow') {
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    await settingsStore.addLimitHistory(tomorrow.toISOString().slice(0, 10), limitFen)
  }

  showLimitDialog.value = false
  emit('back')
}

function save() {
  if (!canSave.value) return

  // 如果已有设置且限额变化，弹窗选择生效方式
  if (settingsStore.isConfigured) {
    const newLimit = Math.round(parseFloat(dailyLimitYuan.value) * 100)
    if (newLimit !== settingsStore.dailyLimit) {
      showLimitDialog.value = true
      return
    }
  }

  handleSave('today')
}
</script>

<template>
  <div class="flex flex-col h-dvh bg-background">
    <div class="relative flex items-center justify-center px-4 py-3 border-b">
      <Button variant="ghost" size="sm" class="absolute left-4" @click="emit('back')">
        <ArrowLeft :size="16" />
      </Button>
      <h1 class="text-lg font-medium">设置</h1>
    </div>

    <div class="flex-1 overflow-y-auto px-4 py-4 space-y-6">
      <div>
        <label class="text-sm font-medium block mb-2">每日限额（元）</label>
        <Input v-model="dailyLimitYuan" type="number" step="0.01" min="0" placeholder="例如：50" />
      </div>

      <Separator />

      <div>
        <label class="text-sm font-medium block mb-2">起始日期</label>
        <Input v-model="startDate" type="date" />
        <p class="text-xs text-muted-foreground mt-1">用于计算预算累计天数</p>
      </div>
    </div>

    <div class="px-4 pb-6 pt-2 border-t">
      <Button class="w-full h-10" :disabled="!canSave" @click="save"> 保存 </Button>
    </div>

    <!-- 限额生效方式 Dialog -->
    <Dialog :open="showLimitDialog" @update:open="showLimitDialog = $event">
      <DialogContent class="sm:max-w-[320px]">
        <DialogHeader>
          <DialogTitle>限额生效方式</DialogTitle>
        </DialogHeader>
        <div class="py-2 text-sm text-muted-foreground">你修改了每日限额，请选择生效方式</div>
        <DialogFooter class="flex-col gap-2">
          <Button class="w-full" @click="handleSave('today')"> 今日立即生效 </Button>
          <Button variant="outline" class="w-full" @click="handleSave('tomorrow')">
            明日开始生效
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>

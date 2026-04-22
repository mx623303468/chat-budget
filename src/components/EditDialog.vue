<script setup lang="ts">
import { ref, watch } from 'vue'
import type { Transaction } from '@/types'
import { fenToYuan } from '@/lib/input-parser'
import { X } from 'lucide-vue-next'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

const props = defineProps<{
  open: boolean
  transaction: Transaction | null
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  save: [id: number, data: { amount: number; note: string }]
}>()

const amountStr = ref('')
const noteStr = ref('')

watch(
  () => props.transaction,
  (t) => {
    if (t) {
      amountStr.value = fenToYuan(t.amount)
      noteStr.value = t.note
    }
  },
)

function handleSave() {
  if (!props.transaction?.id) return
  const yuan = parseFloat(amountStr.value)
  if (Number.isNaN(yuan) || yuan <= 0) return
  const fen = Math.round(yuan * 100)
  emit('save', props.transaction.id, { amount: fen, note: noteStr.value || '未命名' })
  emit('update:open', false)
}
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent class="sm:max-w-[360px]">
      <DialogHeader>
        <DialogTitle>编辑记录</DialogTitle>
        <button
          class="absolute right-4 top-4 text-muted-foreground hover:text-foreground transition-colors"
          @click="emit('update:open', false)"
        >
          <X :size="16" />
        </button>
      </DialogHeader>
      <div class="grid gap-3 py-2">
        <div>
          <label class="text-sm text-muted-foreground mb-1 block">金额（元）</label>
          <Input v-model="amountStr" type="number" step="0.01" min="0" />
        </div>
        <div>
          <label class="text-sm text-muted-foreground mb-1 block">说明</label>
          <Input v-model="noteStr" placeholder="说明" />
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" @click="emit('update:open', false)">取消</Button>
        <Button @click="handleSave">保存</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import type { Transaction } from '@/types'
import { fenToYuan } from '@/lib/input-parser'
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
  save: [id: string, data: { amount: number; note: string; createdAt?: number }]
}>()

const amountStr = ref('')
const noteStr = ref('')
const createdAtStr = ref('')

watch(
  () => props.transaction,
  (t) => {
    if (t) {
      amountStr.value = fenToYuan(t.amount)
      noteStr.value = t.note
      const d = new Date(t.createdAt)
      createdAtStr.value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    }
  },
)

function handleSave() {
  if (!props.transaction) return
  const yuan = parseFloat(amountStr.value)
  if (Number.isNaN(yuan) || yuan <= 0) return
  const fen = Math.round(yuan * 100)
  const data: { amount: number; note: string; createdAt?: number } = {
    amount: fen,
    note: noteStr.value || '未命名',
  }
  if (createdAtStr.value) {
    data.createdAt = new Date(createdAtStr.value).getTime()
  }
  emit('save', props.transaction.id, data)
  emit('update:open', false)
}
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent class="sm:max-w-[360px]">
      <DialogHeader>
        <DialogTitle>编辑记录</DialogTitle>
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
        <div>
          <label class="text-sm text-muted-foreground mb-1 block">时间</label>
          <Input v-model="createdAtStr" type="datetime-local" />
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" @click="emit('update:open', false)">取消</Button>
        <Button @click="handleSave">保存</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

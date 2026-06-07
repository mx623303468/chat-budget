<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { Plus } from 'lucide-vue-next'
import { useLedgersStore } from '@/stores/ledgers'
import { useAuthStore } from '@/stores/auth'
import { toDateStr } from '@/lib/date-utils'
import { Button } from '@/components/ui/button'
import UserMenu from '@/components/UserMenu.vue'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

const router = useRouter()
const ledgersStore = useLedgersStore()
const auth = useAuthStore()

const showCreateDialog = ref(false)
const newLedgerName = ref('')
const newDailyLimit = ref('')
const newStartDate = ref(toDateStr(new Date()))

onMounted(async () => {
  await ledgersStore.fetchLedgers()
})

function openLedger(id: string) {
  ledgersStore.selectLedger(id)
  router.push({ name: 'ledger', params: { id } })
}

async function handleCreate() {
  const name = newLedgerName.value.trim()
  if (!name) return

  const limitYuan = parseFloat(newDailyLimit.value)
  const limitFen = Number.isNaN(limitYuan) || limitYuan <= 0 ? 0 : Math.round(limitYuan * 100)

  const ledger = await ledgersStore.createLedger({
    name,
    dailyLimit: limitFen,
    startDate: newStartDate.value,
  })

  showCreateDialog.value = false
  newLedgerName.value = ''
  newDailyLimit.value = ''
  openLedger(ledger.id)
}

async function handleLogout() {
  await auth.logout()
  router.replace({ name: 'login' })
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString('zh-CN')
}
</script>

<template>
  <div class="flex flex-col h-dvh bg-background">
    <!-- 顶栏 -->
    <div class="flex items-center justify-between px-4 py-3 border-b">
      <div>
        <h1 class="text-lg font-medium">我的账本</h1>
      </div>
      <div class="flex items-center gap-1">
        <UserMenu @logout="handleLogout" />
      </div>
    </div>

    <!-- 账本列表 -->
    <div class="flex-1 overflow-y-auto">
      <div v-if="ledgersStore.loading" class="flex items-center justify-center py-20">
        <p class="text-sm text-muted-foreground">加载中...</p>
      </div>

      <div v-else-if="ledgersStore.ledgers.length === 0" class="flex flex-col items-center justify-center py-20 px-8">
        <p class="text-muted-foreground mb-4">还没有账本</p>
        <Button @click="showCreateDialog = true">
          <Plus :size="16" class="mr-1" />
          创建第一个账本
        </Button>
      </div>

      <div v-else class="divide-y">
        <button
          v-for="ledger in ledgersStore.ledgers"
          :key="ledger.id"
          class="w-full text-left px-4 py-3 hover:bg-muted/50 transition-colors"
          @click="openLedger(ledger.id)"
        >
          <div class="flex items-center justify-between">
            <div>
              <div class="font-medium">{{ ledger.name }}</div>
              <div class="text-xs text-muted-foreground mt-0.5">
                创建于 {{ formatDate(ledger.createdAt) }}
                <span v-if="ledger.ownerId === auth.user?.id"> · 拥有者</span>
              </div>
            </div>
            <div class="text-xs text-muted-foreground">→</div>
          </div>
        </button>
      </div>
    </div>

    <!-- 底部创建按钮 -->
    <div v-if="ledgersStore.ledgers.length > 0" class="px-4 pb-6 pt-2 border-t">
      <Button class="w-full h-10" @click="showCreateDialog = true">
        <Plus :size="16" class="mr-1" />
        创建新账本
      </Button>
    </div>

    <!-- 创建账本弹窗 -->
    <Dialog :open="showCreateDialog" @update:open="showCreateDialog = $event">
      <DialogContent class="sm:max-w-[360px]">
        <DialogHeader>
          <DialogTitle>创建新账本</DialogTitle>
        </DialogHeader>
        <div class="space-y-4 py-2">
          <div>
            <label class="text-sm font-medium block mb-1">账本名称</label>
            <Input
              v-model="newLedgerName"
              placeholder="例如：日常开销"
              @keydown.enter="handleCreate"
            />
          </div>
          <div>
            <label class="text-sm font-medium block mb-1">每日限额（元，可选）</label>
            <Input v-model="newDailyLimit" type="number" step="0.01" min="0" placeholder="例如：50" />
          </div>
          <div>
            <label class="text-sm font-medium block mb-1">起始日期</label>
            <Input v-model="newStartDate" type="date" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" @click="showCreateDialog = false">取消</Button>
          <Button :disabled="!newLedgerName.trim()" @click="handleCreate">创建</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>

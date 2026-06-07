<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowLeft, Copy, RefreshCw, Check, LogOut } from 'lucide-vue-next'
import { useLedgersStore } from '@/stores/ledgers'
import { useAuthStore } from '@/stores/auth'
import { invitesApi, membersApi } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import SwipeDelete from '@/components/SwipeDelete.vue'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

const props = defineProps<{
  ledgerId: string
}>()

const emit = defineEmits<{
  back: []
}>()

const router = useRouter()
const ledgersStore = useLedgersStore()
const auth = useAuthStore()

const dailyLimitYuan = ref('')
const ledgerName = ref('')
const showLimitDialog = ref(false)
const showDeleteDialog = ref(false)
const showRemoveDialog = ref(false)
const removeTarget = ref<{ userId: string; nickname: string } | null>(null)
const showLeaveDialog = ref(false)

// 邀请码
const inviteCode = ref<string | null>(null)
const inviteExpiresAt = ref<number | null>(null)
const inviteLoading = ref(false)
const inviteLoaded = ref(false)
const copied = ref(false)

// 删除确认
const deleteConfirmName = ref('')

// 成员
const members = ref<Array<{ userId: string; nickname: string; role: string; joinedAt: number; removedAt: number | null }>>([])

const ledger = computed(() => ledgersStore.currentLedger)
const isOwner = computed(() => ledger.value?.ownerId === auth.user?.id)

const inviteLink = computed(() => {
  if (!inviteCode.value) return ''
  const base = window.location.origin + import.meta.env.BASE_URL
  return `${base}join?code=${inviteCode.value}`
})

const inviteExpired = computed(() => {
  if (!inviteExpiresAt.value) return false
  return Date.now() > inviteExpiresAt.value
})

const canDelete = computed(() =>
  deleteConfirmName.value.trim() === (ledger.value?.name ?? '')
)

// 当 ledger 数据变化时回填表单
watch(ledger, (l) => {
  if (l) {
    dailyLimitYuan.value = l.dailyLimit > 0 ? (l.dailyLimit / 100).toString() : ''
    ledgerName.value = l.name
  }
}, { immediate: true })

// 当 isOwner 变化时加载邀请码
watch(isOwner, (val) => {
  if (val && !inviteLoaded.value) loadInvite()
}, { immediate: true })

loadMembers()

async function loadInvite() {
  if (!isOwner.value) return
  inviteLoading.value = true
  try {
    const res = await invitesApi.get(props.ledgerId)
    inviteCode.value = res.code
    inviteExpiresAt.value = res.expiresAt
  } catch {
    inviteCode.value = null
  } finally {
    inviteLoading.value = false
    inviteLoaded.value = true
  }
}

async function loadMembers() {
  try {
    const res = await membersApi.list(props.ledgerId)
    members.value = res.members.filter((m) => !m.removedAt)
  } catch {
    members.value = []
  }
}

async function handleRotate() {
  inviteLoading.value = true
  try {
    const res = await invitesApi.rotate(props.ledgerId)
    inviteCode.value = res.code
    inviteExpiresAt.value = res.expiresAt
  } catch {
    // 忽略
  } finally {
    inviteLoading.value = false
  }
}

async function copyLink() {
  if (!inviteLink.value) return
  try {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(inviteLink.value)
    } else {
      const ta = document.createElement('textarea')
      ta.value = inviteLink.value
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
    }
    copied.value = true
    setTimeout(() => { copied.value = false }, 2000)
  } catch {
    // 均失败时忽略
  }
}

const canSave = computed(() => {
  const limit = parseFloat(dailyLimitYuan.value)
  return ledgerName.value.trim().length > 0 && (limit > 0 || ledger.value?.dailyLimit === 0)
})

async function handleSave(effectMode: 'today' | 'tomorrow') {
  const limitYuan = parseFloat(dailyLimitYuan.value)
  const limitFen = Number.isNaN(limitYuan) || limitYuan <= 0 ? 0 : Math.round(limitYuan * 100)

  await ledgersStore.updateLedger(props.ledgerId, {
    name: ledgerName.value.trim(),
    dailyLimit: limitFen,
  })

  showLimitDialog.value = false
  emit('back')
}

function save() {
  if (!canSave.value || !ledger.value) return

  if (ledger.value.dailyLimit > 0) {
    const newLimit = Math.round(parseFloat(dailyLimitYuan.value) * 100)
    if (newLimit !== ledger.value.dailyLimit) {
      showLimitDialog.value = true
      return
    }
  }

  handleSave('today')
}

async function handleDelete() {
  await ledgersStore.deleteLedger(props.ledgerId)
  showDeleteDialog.value = false
  router.replace({ name: 'ledgers' })
}

function confirmRemove(m: { userId: string; nickname: string; role: string }) {
  removeTarget.value = { userId: m.userId, nickname: m.nickname }
  showRemoveDialog.value = true
}

async function handleRemoveMember() {
  if (!removeTarget.value) return
  try {
    await membersApi.remove(props.ledgerId, removeTarget.value.userId)
    members.value = members.value.filter((m) => m.userId !== removeTarget.value!.userId)
  } finally {
    showRemoveDialog.value = false
    removeTarget.value = null
  }
}

async function handleLeave() {
  try {
    await membersApi.leave(props.ledgerId)
    ledgersStore.selectLedger(null)
    router.replace({ name: 'ledgers' })
  } finally {
    showLeaveDialog.value = false
  }
}
</script>

<template>
  <div class="flex flex-col h-dvh bg-background">
    <div class="relative flex items-center justify-center px-4 py-3 border-b">
      <Button variant="ghost" size="sm" class="absolute left-4" @click="emit('back')">
        <ArrowLeft :size="16" />
      </Button>
      <h1 class="text-lg font-medium">账本设置</h1>
    </div>

    <div class="flex-1 overflow-y-auto px-4 py-4 space-y-6">
      <div>
        <label class="text-sm font-medium block mb-2">账本名称</label>
        <Input v-model="ledgerName" placeholder="账本名称" />
      </div>

      <Separator />

      <div>
        <label class="text-sm font-medium block mb-2">每日限额（元）</label>
        <Input v-model="dailyLimitYuan" type="number" step="0.01" min="0" placeholder="例如：50" />
        <p class="text-xs text-muted-foreground mt-1">用于计算预算累计天数</p>
      </div>

      <Separator />

      <!-- 邀请成员（仅 owner） -->
      <div v-if="isOwner">
        <h2 class="text-sm font-medium mb-2">邀请成员</h2>

        <div v-if="inviteLoading && !inviteCode" class="text-xs text-muted-foreground">加载中...</div>

        <div v-else-if="inviteCode" class="space-y-3">
          <div class="flex items-center gap-2 p-3 bg-muted rounded-lg">
            <code class="flex-1 text-sm font-mono tracking-widest select-all">{{ inviteCode }}</code>
            <Button variant="ghost" size="sm" @click="copyLink">
              <Check v-if="copied" :size="14" class="text-green-500" />
              <Copy v-else :size="14" />
            </Button>
          </div>

          <p v-if="inviteExpired" class="text-xs text-yellow-600">邀请码已过期，请重新生成</p>
          <p v-else-if="inviteExpiresAt" class="text-xs text-muted-foreground">
            {{ Math.ceil((inviteExpiresAt - Date.now()) / 3600000) }} 小时后过期
          </p>

          <div class="flex gap-2">
            <Button variant="outline" size="sm" class="flex-1" @click="copyLink">
              <Copy :size="14" class="mr-1" />
              {{ copied ? '已复制' : '复制链接' }}
            </Button>
            <Button variant="outline" size="sm" class="flex-1" :disabled="inviteLoading" @click="handleRotate">
              <RefreshCw :size="14" class="mr-1" />
              重新生成
            </Button>
          </div>
        </div>

        <div v-else-if="inviteLoaded" class="text-xs text-muted-foreground">
          暂无有效邀请码
          <Button variant="link" size="sm" class="px-1" @click="handleRotate">生成一个</Button>
        </div>
      </div>

      <!-- 成员列表 -->
      <div>
        <h2 class="text-sm font-medium mb-2">成员</h2>
        <div v-if="members.length === 0" class="text-xs text-muted-foreground">加载中...</div>
        <div v-else class="space-y-1">
          <template v-for="m in members" :key="m.userId">
            <SwipeDelete
              v-if="isOwner && m.role !== 'owner'"
              @delete="confirmRemove(m)"
            >
              <div class="flex items-center justify-between px-3 py-2.5">
                <span class="text-sm">{{ m.nickname }}</span>
                <span class="text-xs text-muted-foreground">成员</span>
              </div>
            </SwipeDelete>
            <div v-else class="flex items-center justify-between py-2.5 px-1">
              <span class="text-sm">{{ m.nickname }}</span>
              <span class="text-xs text-muted-foreground">
                {{ m.role === 'owner' ? '拥有者' : '成员' }}
              </span>
            </div>
          </template>
        </div>
      </div>

      <!-- 危险区域（仅 owner 可见） -->
      <template v-if="isOwner">
        <Separator />
        <div>
          <Button variant="destructive" @click="showDeleteDialog = true">
            删除账本
          </Button>
          <p class="text-xs text-muted-foreground mt-1">删除后无法恢复</p>
        </div>
      </template>

      <!-- 非 owner：退出账本 -->
      <template v-else>
        <Separator />
        <div>
          <Button variant="destructive" @click="showLeaveDialog = true">
            <LogOut :size="16" class="mr-1" />
            退出账本
          </Button>
          <p class="text-xs text-muted-foreground mt-1">退出后将无法查看此账本</p>
        </div>
      </template>
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

    <!-- 删除确认 Dialog -->
    <Dialog :open="showDeleteDialog" @update:open="showDeleteDialog = $event">
      <DialogContent class="sm:max-w-[360px]">
        <DialogHeader>
          <DialogTitle>确认删除</DialogTitle>
        </DialogHeader>
        <div class="py-2 text-sm text-muted-foreground">
          请输入「{{ ledger?.name }}」以确认删除，此操作无法撤销。
        </div>
        <Input
          v-model="deleteConfirmName"
          placeholder="输入账本名称确认"
          class="mt-2"
        />
        <DialogFooter>
          <Button variant="outline" @click="showDeleteDialog = false; deleteConfirmName = ''">取消</Button>
          <Button variant="destructive" :disabled="!canDelete" @click="handleDelete">删除</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- 移除成员确认 Dialog -->
    <Dialog :open="showRemoveDialog" @update:open="showRemoveDialog = $event">
      <DialogContent class="sm:max-w-[320px]">
        <DialogHeader>
          <DialogTitle>移除成员</DialogTitle>
        </DialogHeader>
        <div class="py-2 text-sm text-muted-foreground">
          确定将「{{ removeTarget?.nickname }}」移出账本？移除后该成员将无法查看此账本。
        </div>
        <DialogFooter>
          <Button variant="outline" @click="showRemoveDialog = false">取消</Button>
          <Button variant="destructive" @click="handleRemoveMember">移除</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- 退出账本确认 Dialog -->
    <Dialog :open="showLeaveDialog" @update:open="showLeaveDialog = $event">
      <DialogContent class="sm:max-w-[320px]">
        <DialogHeader>
          <DialogTitle>退出账本</DialogTitle>
        </DialogHeader>
        <div class="py-2 text-sm text-muted-foreground">
          确定退出「{{ ledger?.name }}」？退出后将无法查看此账本。
        </div>
        <DialogFooter>
          <Button variant="outline" @click="showLeaveDialog = false">取消</Button>
          <Button variant="destructive" @click="handleLeave">退出</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>

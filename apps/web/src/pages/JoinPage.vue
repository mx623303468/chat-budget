<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft } from 'lucide-vue-next'
import { invitesApi, ApiClientError } from '@/lib/api'
import { useLedgersStore } from '@/stores/ledgers'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

const route = useRoute()
const router = useRouter()
const ledgersStore = useLedgersStore()

const inviteCode = ref((route.query.code as string) || '')
const loading = ref(false)
const joining = ref(false)
const errorMsg = ref('')
const preview = ref<{ ledgerName: string; memberCount: number } | null>(null)

onMounted(() => {
  if (inviteCode.value) {
    handlePreview()
  }
})

async function handlePreview() {
  const code = inviteCode.value.trim()
  if (!code) return

  loading.value = true
  errorMsg.value = ''
  preview.value = null

  try {
    preview.value = await invitesApi.preview(code)
  } catch (err) {
    if (err instanceof ApiClientError) {
      errorMsg.value = err.message
    } else {
      errorMsg.value = '查询邀请码失败'
    }
  } finally {
    loading.value = false
  }
}

async function handleJoin() {
  const code = inviteCode.value.trim()
  if (!code) return

  joining.value = true
  errorMsg.value = ''

  try {
    const res = await invitesApi.join(code)
    await ledgersStore.fetchLedgers()
    router.replace({ name: 'ledger', params: { id: res.ledgerId } })
  } catch (err) {
    if (err instanceof ApiClientError) {
      errorMsg.value = err.message
    } else {
      errorMsg.value = '加入失败'
    }
  } finally {
    joining.value = false
  }
}

function goBack() {
  router.push({ name: 'ledgers' })
}
</script>

<template>
  <div class="flex flex-col h-dvh bg-background">
    <!-- 顶栏 -->
    <div class="relative flex items-center justify-center px-4 py-3 border-b">
      <Button variant="ghost" size="sm" class="absolute left-4" @click="goBack">
        <ArrowLeft :size="16" />
      </Button>
      <h1 class="text-lg font-medium">加入账本</h1>
    </div>

    <div class="flex-1 overflow-y-auto px-4 py-6 space-y-6">
      <div>
        <label class="text-sm font-medium block mb-2">邀请码</label>
        <div class="flex gap-2">
          <Input
            v-model="inviteCode"
            placeholder="输入 8 位邀请码"
            class="flex-1"
            maxlength="8"
            @keydown.enter="handlePreview"
          />
          <Button :disabled="!inviteCode.trim() || loading" @click="handlePreview">
            {{ loading ? '查询中...' : '查询' }}
          </Button>
        </div>
      </div>

      <p v-if="errorMsg" class="text-sm text-red-500">{{ errorMsg }}</p>

      <!-- 预览信息 -->
      <div v-if="preview" class="bg-card rounded-xl p-4 space-y-2">
        <div class="font-medium">{{ preview.ledgerName }}</div>
        <div class="text-sm text-muted-foreground">
          {{ preview.memberCount }} 位成员
        </div>
      </div>

      <Button
        v-if="preview"
        class="w-full h-10"
        :disabled="joining"
        @click="handleJoin"
      >
        {{ joining ? '加入中...' : '加入账本' }}
      </Button>
    </div>
  </div>
</template>

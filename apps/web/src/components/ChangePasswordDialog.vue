<!-- apps/web/src/components/ChangePasswordDialog.vue -->
<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { authApi } from '@/lib/api'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ 'update:open': [value: boolean] }>()

const auth = useAuthStore()
const email = computed(() => auth.user?.email ?? '')

const code = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const errorMsg = ref('')
const successMsg = ref('')
const submitting = ref(false)
const codeSent = ref(false)
const countdown = ref(0)
const step = ref<'send' | 'reset'>('send')
let timer: ReturnType<typeof setInterval> | undefined

const canResend = computed(() => countdown.value === 0)

onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
})

function startCountdown() {
  if (timer) clearInterval(timer)
  countdown.value = 60
  codeSent.value = true
  timer = setInterval(() => {
    countdown.value--
    if (countdown.value <= 0) {
      clearInterval(timer)
      timer = undefined
    }
  }, 1000)
}

function resetForm() {
  code.value = ''
  newPassword.value = ''
  confirmPassword.value = ''
  errorMsg.value = ''
  successMsg.value = ''
  step.value = 'send'
  codeSent.value = false
  if (timer) {
    clearInterval(timer)
    timer = undefined
  }
  countdown.value = 0
}

watch(() => props.open, (val) => {
  if (val) resetForm()
})

async function onSendCode() {
  if (submitting.value) return
  errorMsg.value = ''

  submitting.value = true
  try {
    await authApi.sendResetCode({ email: email.value })
    step.value = 'reset'
    startCountdown()
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : '发送失败'
  } finally {
    submitting.value = false
  }
}

async function onResend() {
  if (!canResend.value || submitting.value) return
  errorMsg.value = ''

  submitting.value = true
  try {
    await authApi.sendResetCode({ email: email.value })
    startCountdown()
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : '发送失败'
  } finally {
    submitting.value = false
  }
}

async function onReset() {
  if (submitting.value) return
  errorMsg.value = ''

  if (!code.value) {
    errorMsg.value = '请输入验证码'
    return
  }
  if (!newPassword.value) {
    errorMsg.value = '请输入新密码'
    return
  }
  if (newPassword.value.length < 6) {
    errorMsg.value = '密码至少 6 位'
    return
  }
  if (newPassword.value !== confirmPassword.value) {
    errorMsg.value = '两次密码不一致'
    return
  }

  submitting.value = true
  try {
    await authApi.resetPassword({
      email: email.value,
      code: code.value,
      newPassword: newPassword.value,
    })
    successMsg.value = '密码修改成功'
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : '修改失败'
  } finally {
    submitting.value = false
  }
}

function handleClose() {
  emit('update:open', false)
}
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent class="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>修改密码</DialogTitle>
      </DialogHeader>

      <!-- 成功 -->
      <div v-if="successMsg" class="py-4 space-y-4">
        <p class="text-sm text-green-600 text-center">{{ successMsg }}</p>
        <DialogFooter>
          <DialogClose as-child>
            <button
              class="w-full rounded-lg bg-primary text-primary-foreground py-2 text-sm font-medium hover:bg-primary/90"
            >
              完成
            </button>
          </DialogClose>
        </DialogFooter>
      </div>

      <!-- 发送验证码 -->
      <div v-else-if="step === 'send'" class="space-y-4 py-2">
        <div class="space-y-2">
          <label class="text-sm font-medium">邮箱</label>
          <p class="text-sm text-muted-foreground">{{ email }}</p>
        </div>

        <p v-if="errorMsg" class="text-sm text-red-500">{{ errorMsg }}</p>

        <button
          :disabled="submitting"
          class="w-full rounded-lg bg-primary text-primary-foreground py-2 text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
          @click="onSendCode"
        >
          {{ submitting ? '发送中...' : '发送验证码' }}
        </button>
      </div>

      <!-- 输入验证码 + 新密码 -->
      <form v-else class="space-y-4 py-2" @submit.prevent="onReset">
        <div class="space-y-2">
          <label class="text-sm font-medium">邮箱</label>
          <p class="text-sm text-muted-foreground">{{ email }}</p>
        </div>

        <div class="space-y-2">
          <label class="text-sm font-medium" for="dialog-code">验证码</label>
          <div class="flex gap-2">
            <input
              id="dialog-code"
              v-model="code"
              type="text"
              required
              maxlength="6"
              inputmode="numeric"
              pattern="[0-9]{6}"
              placeholder="6 位数字验证码"
              class="flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
            <button
              type="button"
              :disabled="!canResend || submitting"
              class="shrink-0 rounded-lg border border-input px-3 py-2 text-sm hover:bg-muted/50 disabled:opacity-50"
              @click="onResend"
            >
              {{ canResend ? '重新发送' : `${countdown}s` }}
            </button>
          </div>
        </div>

        <div class="space-y-2">
          <label class="text-sm font-medium" for="dialog-newPassword">新密码</label>
          <input
            id="dialog-newPassword"
            v-model="newPassword"
            type="password"
            required
            autocomplete="new-password"
            placeholder="至少 6 位"
            class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        <div class="space-y-2">
          <label class="text-sm font-medium" for="dialog-confirmPassword">确认密码</label>
          <input
            id="dialog-confirmPassword"
            v-model="confirmPassword"
            type="password"
            required
            autocomplete="new-password"
            placeholder="再次输入新密码"
            class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        <p v-if="errorMsg" class="text-sm text-red-500">{{ errorMsg }}</p>

        <DialogFooter>
          <button
            type="submit"
            :disabled="submitting"
            class="w-full rounded-lg bg-primary text-primary-foreground py-2 text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
          >
            {{ submitting ? '提交中...' : '确认修改' }}
          </button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>

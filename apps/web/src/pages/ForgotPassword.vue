<!-- apps/web/src/pages/ForgotPassword.vue -->
<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { authApi } from '@/lib/api'

const router = useRouter()

const email = ref('')
const code = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const errorMsg = ref('')
const successMsg = ref('')
const submitting = ref(false)
const step = ref<'email' | 'code'>('email')

const codeSent = ref(false)
const countdown = ref(0)
let timer: ReturnType<typeof setInterval> | undefined

const canResend = computed(() => countdown.value === 0)

function startCountdown() {
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

async function onSendCode() {
  if (submitting.value) return
  errorMsg.value = ''

  if (!email.value) {
    errorMsg.value = '请输入邮箱'
    return
  }

  submitting.value = true
  try {
    await authApi.sendResetCode({ email: email.value })
    step.value = 'code'
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
    successMsg.value = '密码修改成功，请重新登录'
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : '修改失败'
  } finally {
    submitting.value = false
  }
}

function goLogin() {
  router.replace({ name: 'login' })
}

function goBack() {
  errorMsg.value = ''
  step.value = 'email'
}
</script>

<template>
  <div class="h-dvh bg-background flex items-center justify-center px-4">
    <div class="w-full max-w-sm space-y-6">
      <div class="text-center">
        <h1 class="text-2xl font-bold">聊天记账</h1>
        <p class="text-sm text-muted-foreground mt-1">忘记密码</p>
      </div>

      <!-- 成功提示 -->
      <div v-if="successMsg" class="space-y-4">
        <p class="text-sm text-green-600 text-center">{{ successMsg }}</p>
        <button
          class="w-full rounded-lg bg-primary text-primary-foreground py-2 text-sm font-medium hover:bg-primary/90"
          @click="goLogin"
        >
          返回登录
        </button>
      </div>

      <!-- 第一步——输入邮箱 -->
      <form v-else-if="step === 'email'" class="space-y-4" @submit.prevent="onSendCode">
        <div class="space-y-2">
          <label class="text-sm font-medium" for="email">邮箱</label>
          <input
            id="email"
            v-model="email"
            type="email"
            required
            autocomplete="email"
            placeholder="your@email.com"
            class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        <p v-if="errorMsg" class="text-sm text-red-500">{{ errorMsg }}</p>

        <button
          type="submit"
          :disabled="submitting"
          class="w-full rounded-lg bg-primary text-primary-foreground py-2 text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
        >
          {{ submitting ? '发送中...' : '发送验证码' }}
        </button>

        <p class="text-center text-sm text-muted-foreground">
          <button class="text-primary hover:underline" @click="goLogin">
            返回登录
          </button>
        </p>
      </form>

      <!-- 第二步——验证码 + 新密码 -->
      <form v-else class="space-y-4" @submit.prevent="onReset">
        <div class="space-y-2">
          <label class="text-sm font-medium">邮箱</label>
          <p class="text-sm text-muted-foreground">{{ email }}</p>
        </div>

        <div class="space-y-2">
          <label class="text-sm font-medium" for="code">验证码</label>
          <div class="flex gap-2">
            <input
              id="code"
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
          <label class="text-sm font-medium" for="newPassword">新密码</label>
          <input
            id="newPassword"
            v-model="newPassword"
            type="password"
            required
            autocomplete="new-password"
            placeholder="至少 6 位"
            class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        <div class="space-y-2">
          <label class="text-sm font-medium" for="confirmPassword">确认密码</label>
          <input
            id="confirmPassword"
            v-model="confirmPassword"
            type="password"
            required
            autocomplete="new-password"
            placeholder="再次输入新密码"
            class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        <p v-if="errorMsg" class="text-sm text-red-500">{{ errorMsg }}</p>

        <button
          type="submit"
          :disabled="submitting"
          class="w-full rounded-lg bg-primary text-primary-foreground py-2 text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
        >
          {{ submitting ? '提交中...' : '重置密码' }}
        </button>

        <p class="text-center text-sm text-muted-foreground">
          <button class="text-primary hover:underline" @click="goBack">
            返回上一步
          </button>
        </p>
      </form>
    </div>
  </div>
</template>

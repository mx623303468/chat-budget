<script setup lang="ts">
import { ref } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const router = useRouter()
const route = useRoute()
const auth = useAuthStore()

const email = ref('')
const password = ref('')
const errorMsg = ref('')
const submitting = ref(false)

async function onSubmit() {
  if (submitting.value) return
  errorMsg.value = ''
  submitting.value = true
  try {
    await auth.login({ email: email.value, password: password.value })
    const redirect = (route.query.redirect as string) || '/'
    router.replace(redirect)
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : '登录失败'
  } finally {
    submitting.value = false
  }
}

function goToRegister() {
  router.push({ name: 'register', query: route.query })
}
</script>

<template>
  <div class="h-dvh bg-background flex items-center justify-center px-4">
    <div class="w-full max-w-sm space-y-6">
      <div class="text-center">
        <h1 class="text-2xl font-bold">聊天记账</h1>
        <p class="text-sm text-muted-foreground mt-1">登录你的账号</p>
      </div>

      <form class="space-y-4" @submit.prevent="onSubmit">
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

        <div class="space-y-2">
          <label class="text-sm font-medium" for="password">密码</label>
          <input
            id="password"
            v-model="password"
            type="password"
            required
            autocomplete="current-password"
            placeholder="请输入密码"
            class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        <p v-if="errorMsg" class="text-sm text-red-500">{{ errorMsg }}</p>

        <button
          type="submit"
          :disabled="submitting"
          class="w-full rounded-lg bg-primary text-primary-foreground py-2 text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
        >
          {{ submitting ? '登录中...' : '登录' }}
        </button>
      </form>

      <p class="text-center text-sm text-muted-foreground">
        还没有账号？
        <button class="text-primary hover:underline" @click="goToRegister">
          注册
        </button>
      </p>
    </div>
  </div>
</template>

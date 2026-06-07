import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import { authApi, profileApi, ApiClientError } from '@/lib/api'
import type { User } from '@chat-budget/shared'

export const useAuthStore = defineStore('auth', () => {
  const user = ref<User | null>(null)
  const loading = ref(false)
  const initialized = ref(false)

  const isLoggedIn = computed(() => user.value !== null)

  /**
   * 初始化：尝试获取当前用户信息
   * cookie 有效时自动登录
   */
  async function initialize(): Promise<void> {
    if (initialized.value) return

    loading.value = true
    try {
      const res = await authApi.me()
      user.value = res.user
    } catch {
      user.value = null
    } finally {
      loading.value = false
      initialized.value = true
    }
  }

  /**
   * 注册
   */
  async function register(data: {
    email: string
    password: string
    nickname: string
  }): Promise<void> {
    loading.value = true
    try {
      const res = await authApi.register(data)
      user.value = res.user
    } finally {
      loading.value = false
    }
  }

  /**
   * 登录
   */
  async function login(data: {
    email: string
    password: string
  }): Promise<void> {
    loading.value = true
    try {
      const res = await authApi.login(data)
      user.value = res.user
    } finally {
      loading.value = false
    }
  }

  /**
   * 登出
   */
  async function logout(): Promise<void> {
    try {
      await authApi.logout()
    } catch {
      // 即使请求失败也清除本地状态
    }
    user.value = null
  }

  /**
   * 检查是否需要重新登录
   * 用于路由守卫判断
   */
  function requireLogin(): boolean {
    return !isLoggedIn.value
  }

  async function updateProfile(data: {
    nickname?: string
    avatar?: Blob
    removeAvatar?: boolean
  }): Promise<void> {
    const formData = new FormData()
    if (data.nickname !== undefined) {
      formData.set('nickname', data.nickname)
    }
    if (data.avatar) {
      formData.set('avatar', data.avatar, 'avatar.webp')
    }
    if (data.removeAvatar) {
      formData.set('removeAvatar', 'true')
    }

    const res = await profileApi.update(formData)
    user.value = res.user
  }

  return {
    user,
    loading,
    initialized,
    isLoggedIn,
    initialize,
    register,
    login,
    logout,
    requireLogin,
    updateProfile,
  }
})

import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      redirect: '/ledgers',
    },
    {
      path: '/ledgers',
      name: 'ledgers',
      component: () => import('@/pages/LedgersPage.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/ledgers/:id',
      name: 'ledger',
      component: () => import('@/pages/HomePage.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/join',
      name: 'join',
      component: () => import('@/pages/JoinPage.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/login',
      name: 'login',
      component: () => import('@/pages/LoginPage.vue'),
      meta: { guest: true },
    },
    {
      path: '/register',
      name: 'register',
      component: () => import('@/pages/RegisterPage.vue'),
      meta: { guest: true },
    },
  ],
})

// 路由守卫
router.beforeEach(async (to) => {
  const auth = useAuthStore()

  // 首次访问时初始化认证状态
  if (!auth.initialized) {
    await auth.initialize()
  }

  // 需要登录但未登录 → 重定向到登录页
  if (to.meta.requiresAuth && !auth.isLoggedIn) {
    return { name: 'login', query: { redirect: to.fullPath } }
  }

  // 已登录访问 guest 页面（登录/注册）→ 重定向到首页
  if (to.meta.guest && auth.isLoggedIn) {
    return { name: 'ledgers' }
  }
})

export default router

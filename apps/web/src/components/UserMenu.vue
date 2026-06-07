<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { ChevronDown, UserPen, Users, KeyRound, LogOut } from 'lucide-vue-next'
import { useAuthStore } from '@/stores/auth'
import UserAvatar from '@/components/UserAvatar.vue'
import ProfileDialog from '@/components/ProfileDialog.vue'
import ChangePasswordDialog from '@/components/ChangePasswordDialog.vue'

const router = useRouter()
const emit = defineEmits<{
  logout: []
}>()

const auth = useAuthStore()
const open = ref(false)
const showProfile = ref(false)
const showChangePassword = ref(false)

function toggle() {
  open.value = !open.value
}

function close() {
  open.value = false
}

function openProfile() {
  close()
  showProfile.value = true
}

function openChangePassword() {
  close()
  showChangePassword.value = true
}

function goJoin() {
  close()
  router.push({ name: 'join' })
}

function handleLogout() {
  close()
  emit('logout')
}

function onBackdropClick() {
  close()
}
</script>

<template>
  <div class="relative">
    <button
      class="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-muted/50 transition-colors"
      @click="toggle"
    >
      <UserAvatar
        :avatar="auth.user?.avatar ?? null"
        :nickname="auth.user?.nickname ?? ''"
        :size="24"
      />
      <span class="text-xs text-muted-foreground max-w-[80px] truncate">
        {{ auth.user?.nickname }}
      </span>
      <ChevronDown :size="14" class="text-muted-foreground" />
    </button>

    <div v-if="open" class="fixed inset-0 z-40" @click="onBackdropClick" />

    <Transition
      enter-active-class="transition duration-150 ease-out"
      enter-from-class="opacity-0 scale-95"
      enter-to-class="opacity-100 scale-100"
      leave-active-class="transition duration-100 ease-in"
      leave-from-class="opacity-100 scale-100"
      leave-to-class="opacity-0 scale-95"
    >
      <div
        v-if="open"
        class="absolute right-0 top-full mt-1 w-56 bg-popover border rounded-lg shadow-lg z-50 overflow-hidden"
      >
        <div class="flex items-center gap-3 p-3 border-b">
          <UserAvatar
            :avatar="auth.user?.avatar ?? null"
            :nickname="auth.user?.nickname ?? ''"
            :size="36"
          />
          <div class="min-w-0">
            <div class="text-sm font-medium truncate">{{ auth.user?.nickname }}</div>
            <div class="text-xs text-muted-foreground truncate">{{ auth.user?.email }}</div>
          </div>
        </div>

        <div class="p-1">
          <button
            class="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md hover:bg-muted/50 transition-colors"
            @click="openProfile"
          >
            <UserPen :size="15" class="text-muted-foreground" />
            编辑资料
          </button>
          <button
            class="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md hover:bg-muted/50 transition-colors"
            @click="goJoin"
          >
            <Users :size="15" class="text-muted-foreground" />
            加入账本
          </button>
          <button
            class="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md hover:bg-muted/50 transition-colors"
            @click="openChangePassword"
          >
            <KeyRound :size="15" class="text-muted-foreground" />
            修改密码
          </button>
          <button
            class="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md hover:bg-muted/50 transition-colors text-destructive"
            @click="handleLogout"
          >
            <LogOut :size="15" />
            退出登录
          </button>
        </div>
      </div>
    </Transition>

    <ProfileDialog v-model:open="showProfile" />
    <ChangePasswordDialog v-model:open="showChangePassword" />
  </div>
</template>

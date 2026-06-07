<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { Camera, Trash2 } from 'lucide-vue-next'
import { useAuthStore } from '@/stores/auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import UserAvatar from '@/components/UserAvatar.vue'
import AvatarCropper from '@/components/AvatarCropper.vue'

const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()

const auth = useAuthStore()
const nickname = ref('')
const saving = ref(false)
const error = ref('')

const selectedFile = ref<File | null>(null)
const croppedBlob = ref<Blob | null>(null)
const previewUrl = ref<string | null>(null)

watch(() => props.open, (open) => {
  if (open) {
    nickname.value = auth.user?.nickname ?? ''
    resetCropState()
    error.value = ''
  }
})

function onOpenChange(open: boolean) {
  emit('update:open', open)
}

function resetCropState() {
  selectedFile.value = null
  croppedBlob.value = null
  previewUrl.value = null
}

function handleFileSelect(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  if (file.size > 10 * 1024 * 1024) {
    error.value = '图片文件过大，请选择 10MB 以内的图片'
    return
  }
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    error.value = '仅支持 JPG、PNG、WebP 格式'
    return
  }

  error.value = ''
  selectedFile.value = file
  croppedBlob.value = null
}

function handleCropConfirm(blob: Blob) {
  croppedBlob.value = blob
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value)
  previewUrl.value = URL.createObjectURL(blob)
  selectedFile.value = null
}

function handleCropCancel() {
  selectedFile.value = null
}

const showRemoveAvatar = computed(() => {
  return auth.user?.avatar && !croppedBlob.value
})

function handleRemoveAvatar() {
  croppedBlob.value = null
  previewUrl.value = '__removed__'
}

async function handleSave() {
  const trimmedNickname = nickname.value.trim()
  if (!trimmedNickname) {
    error.value = '昵称不能为空'
    return
  }

  saving.value = true
  error.value = ''

  try {
    const isAvatarRemoved = previewUrl.value === '__removed__'
    await auth.updateProfile({
      nickname: trimmedNickname,
      avatar: croppedBlob.value ?? undefined,
      removeAvatar: isAvatarRemoved || undefined,
    })
    emit('update:open', false)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : '保存失败'
    error.value = msg
  } finally {
    saving.value = false
  }
}

const currentAvatar = computed(() => {
  if (previewUrl.value === '__removed__') return null
  if (previewUrl.value) return previewUrl.value
  return auth.user?.avatar ?? null
})
</script>

<template>
  <Dialog :open="open" @update:open="onOpenChange">
    <DialogContent class="sm:max-w-[360px]">
      <DialogHeader>
        <DialogTitle>编辑资料</DialogTitle>
      </DialogHeader>

      <div v-if="selectedFile" class="py-2">
        <AvatarCropper
          :file="selectedFile"
          @confirm="handleCropConfirm"
          @cancel="handleCropCancel"
        />
      </div>

      <div v-else class="space-y-4 py-2">
        <div class="flex flex-col items-center gap-2">
          <div class="relative">
            <UserAvatar
              :avatar="currentAvatar"
              :nickname="nickname || auth.user?.nickname || ''"
              :size="80"
            />
            <label
              class="absolute -bottom-1 -right-1 w-7 h-7 bg-primary text-primary-foreground rounded-full flex items-center justify-center cursor-pointer hover:bg-primary/90 transition-colors"
            >
              <Camera :size="14" />
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                class="hidden"
                @change="handleFileSelect"
              />
            </label>
          </div>
          <button
            v-if="showRemoveAvatar"
            class="text-xs text-muted-foreground hover:text-destructive flex items-center gap-1"
            @click="handleRemoveAvatar"
          >
            <Trash2 :size="12" />
            移除头像
          </button>
        </div>

        <div>
          <label class="text-sm font-medium block mb-1">昵称</label>
          <Input v-model="nickname" maxlength="20" placeholder="输入昵称" />
        </div>

        <p v-if="error" class="text-sm text-destructive">{{ error }}</p>
      </div>

      <DialogFooter v-if="!selectedFile">
        <Button variant="outline" :disabled="saving" @click="emit('update:open', false)">取消</Button>
        <Button :disabled="saving || !nickname.trim()" @click="handleSave">
          {{ saving ? '保存中...' : '保存' }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

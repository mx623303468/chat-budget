<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { avatarColor, avatarInitial } from '@/lib/avatar'
import { getAvatarUrl } from '@/lib/api'

const props = withDefaults(defineProps<{
  avatar?: string | null
  nickname: string
  size?: number
}>(), {
  avatar: null,
  size: 32,
})

const imgError = ref(false)
watch(() => props.avatar, () => { imgError.value = false })
const showImage = computed(() => props.avatar && !imgError.value)
const avatarSrc = computed(() => getAvatarUrl(props.avatar))
const bg = computed(() => avatarColor(props.nickname))
const initial = computed(() => avatarInitial(props.nickname))
</script>

<template>
  <img
    v-if="showImage"
    :src="avatarSrc!"
    :alt="nickname"
    class="rounded-full object-cover"
    :style="{ width: `${size}px`, height: `${size}px` }"
    @error="imgError = true"
  />
  <div
    v-else
    class="rounded-full flex items-center justify-center text-white font-medium"
    :style="{
      width: `${size}px`,
      height: `${size}px`,
      backgroundColor: bg,
      fontSize: `${size * 0.45}px`,
    }"
  >
    {{ initial }}
  </div>
</template>

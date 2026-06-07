<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import Cropper from 'cropperjs'
import 'cropperjs/dist/cropper.css'

const props = defineProps<{
  file: File
}>()

const emit = defineEmits<{
  confirm: [blob: Blob]
  cancel: []
}>()

const imgRef = ref<HTMLImageElement>()
let cropper: Cropper | null = null
const objectUrl = computed(() => URL.createObjectURL(props.file))

function destroyCropper() {
  if (cropper) {
    cropper.destroy()
    cropper = null
  }
}

onMounted(async () => {
  await nextTick()
  if (!imgRef.value) return

  cropper = new Cropper(imgRef.value, {
    aspectRatio: 1,
    viewMode: 1,
    dragMode: 'move',
    autoCropArea: 1,
    responsive: true,
    restore: false,
    guides: true,
    center: true,
    highlight: false,
    cropBoxMovable: true,
    cropBoxResizable: true,
    toggleDragModeOnDblclick: false,
    background: true,
  })
})

onUnmounted(() => {
  destroyCropper()
})

function handleConfirm() {
  if (!cropper) return

  const canvas = cropper.getCroppedCanvas({
    width: 400,
    height: 400,
    imageSmoothingEnabled: true,
    imageSmoothingQuality: 'high',
  })

  if (!canvas) return

  canvas.toBlob(
    (blob) => {
      if (blob) emit('confirm', blob)
    },
    'image/webp',
    0.85,
  )
}

function handleCancel() {
  emit('cancel')
}
</script>

<template>
  <div>
    <div class="w-full h-64 bg-black/5 rounded-lg overflow-hidden">
      <img ref="imgRef" class="block max-w-full" :src="objectUrl" alt="裁剪预览" />
    </div>
    <div class="flex gap-2 mt-3">
      <button
        class="flex-1 py-2 rounded-lg border border-border text-sm hover:bg-muted transition-colors"
        @click="handleCancel"
      >
        重选
      </button>
      <button
        class="flex-1 py-2 rounded-lg bg-primary text-primary-foreground text-sm hover:bg-primary/90 transition-colors"
        @click="handleConfirm"
      >
        确认
      </button>
    </div>
  </div>
</template>

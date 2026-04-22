import { ref, type Ref, watch, nextTick } from 'vue'

export function useAutoScroll(containerRef: Ref<HTMLElement | null>) {
  async function scrollToBottom(): Promise<void> {
    await nextTick()
    const el = containerRef.value
    if (el) {
      el.scrollTop = el.scrollHeight
    }
  }

  function isAtBottom(): boolean {
    const el = containerRef.value
    if (!el) return true
    return el.scrollHeight - el.scrollTop - el.clientHeight < 50
  }

  return { scrollToBottom, isAtBottom }
}

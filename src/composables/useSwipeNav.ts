import { ref, computed } from 'vue'

type SwipeDirection = 'left' | 'right' | null
type SwipePhase = 'idle' | 'dragging' | 'expanding' | 'shrinking'

export function useSwipeNav(
  onSwipeLeft: () => void,
  onSwipeRight: () => void,
) {
  const EDGE = 36
  const TRIGGER_RATIO = 0.3

  const phase = ref<SwipePhase>('idle')
  const dx = ref(0)
  const dir = ref<SwipeDirection>(null)

  // 波纹状态：centerX 动态外移，width/height 随进度线性增长
  const ripple = ref({
    active: false,
    centerX: 0,
    centerY: 0,
    width: 0,
    height: 0,
  })

  let startX = 0
  let startY = 0
  let w = 0
  let h = 0
  let locked: boolean | null = null

  /** 根据进度计算波纹参数 */
  function calcRipple(progress: number, expand = false) {
    const maxD = h * (expand ? 1.2 : 0.8)
    const diameter = progress * maxD
    const radius = diameter / 2
    // 圆心外移：约 1/4 圆在屏幕内 → 可见宽度 ≈ radius/2
    const edgeX = dir.value === 'right' ? 0 : w
    const cx = dir.value === 'right'
      ? edgeX - radius / 2
      : edgeX + radius / 2

    return {
      active: true,
      centerX: cx,
      centerY: startY,
      width: diameter * 1.4,  // 椭圆：宽 > 高
      height: diameter,
    }
  }

  function onTouchStart(e: TouchEvent) {
    if (phase.value !== 'idle') return

    const t = e.touches[0]
    if (!t) return

    const x = t.clientX
    w = window.innerWidth
    h = window.innerHeight

    if (x > EDGE && x < w - EDGE) return

    startX = x
    startY = t.clientY
    locked = null
    dir.value = null
    dx.value = 0
  }

  function onTouchMove(e: TouchEvent) {
    if (locked === false || phase.value === 'expanding' || phase.value === 'shrinking') return

    const t = e.touches[0]
    if (!t) return

    const curDx = t.clientX - startX
    const curDy = t.clientY - startY

    if (locked === null) {
      if (Math.abs(curDx) < 8 && Math.abs(curDy) < 8) return
      if (Math.abs(curDy) >= Math.abs(curDx)) {
        locked = false
        return
      }
      locked = true

      const fromLeft = startX <= EDGE
      const fromRight = startX >= w - EDGE

      if (fromLeft && curDx > 0) dir.value = 'right'
      else if (fromRight && curDx < 0) dir.value = 'left'
      else { locked = false; return }

      // 首次有效位移：激活波纹（初始极小）
      ripple.value = calcRipple(0.01)
      phase.value = 'dragging'
    }

    e.preventDefault()

    // 非线性阻尼
    const raw = curDx / w
    const sign = raw > 0 ? 1 : -1
    const abs = Math.abs(raw)
    const eased = sign * (1 - Math.pow(1 - Math.min(abs, 0.5) / 0.5, 2.5)) * 0.45 * w
    dx.value = Math.round(eased)

    // 进度同步波纹：直径线性变大，圆心同步外移
    const triggerPx = w * TRIGGER_RATIO
    const progress = Math.min(Math.abs(dx.value) / triggerPx, 1)
    ripple.value = calcRipple(progress)
  }

  function onTouchEnd() {
    if (phase.value !== 'dragging') return

    const triggerPx = w * TRIGGER_RATIO

    if (Math.abs(dx.value) >= triggerPx) {
      // 超过阈值：波纹扩展，导航
      phase.value = 'expanding'
      ripple.value = calcRipple(1.0, true)

      setTimeout(() => {
        if (dir.value === 'right') onSwipeRight()
        else if (dir.value === 'left') onSwipeLeft()

        setTimeout(() => {
          ripple.value = { active: false, centerX: 0, centerY: 0, width: 0, height: 0 }
          phase.value = 'idle'
          dx.value = 0
          dir.value = null
        }, 200)
      }, 350)
    } else {
      // 未达阈值：波纹收缩
      phase.value = 'shrinking'
      ripple.value = calcRipple(0)

      dx.value = 0

      setTimeout(() => {
        ripple.value = { active: false, centerX: 0, centerY: 0, width: 0, height: 0 }
        phase.value = 'idle'
        dir.value = null
      }, 350)
    }
  }

  const style = computed(() => {
    if (phase.value === 'dragging') {
      return {
        transform: `translateX(${dx.value * 0.08}px)`,
        transition: 'none',
      }
    }
    return {
      transform: 'translateX(0px)',
      transition: 'transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1)',
    }
  })

  return { onTouchStart, onTouchMove, onTouchEnd, style, ripple, phase, dir }
}

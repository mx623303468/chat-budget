import type { ParseResult } from '@/types'

/**
 * 全角数字转半角，自动补空格，交换金额和说明位置
 */
export function normalize(input: string): string {
  return input
    .replace(/[０-９]/g, (s) =>
      String.fromCharCode(s.charCodeAt(0) - 65248),
    )
    .replace(/^(\d+\.?\d*)([^\s\d]+)/, '$1 $2')
    .replace(/^([^\d]+)(\d+\.?\d*)/, '$2 $1')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * 解析用户输入为金额（分）和说明
 */
export function parse(raw: string): ParseResult {
  const input = normalize(raw)

  if (!input) {
    return { ok: false, hint: '' }
  }

  // 尝试匹配: 金额 + 空格 + 说明
  const match = input.match(/^(\d+\.?\d*)\s+(.+)$/)
  if (match && match[1] && match[2]) {
    const yuan = parseFloat(match[1])
    if (Number.isNaN(yuan) || yuan <= 0) {
      return { ok: false, hint: '金额必须大于 0' }
    }
    const fen = Math.round(yuan * 100)
    return { ok: true, amount: fen, note: match[2] }
  }

  // 只有数字
  if (/^\d+\.?\d*$/.test(input)) {
    const yuan = parseFloat(input)
    if (Number.isNaN(yuan) || yuan <= 0) {
      return { ok: false, hint: '金额必须大于 0' }
    }
    return { ok: false, hint: '请输入说明（空格后）' }
  }

  // 只有文字
  return { ok: false, hint: '请先输入金额，例如：10 早餐' }
}

/**
 * 分转元的显示格式
 */
export function fenToYuan(fen: number): string {
  const abs = Math.abs(fen)
  const yuan = abs / 100
  const formatted = yuan % 1 === 0 ? yuan.toFixed(0) : yuan.toFixed(2)
  return fen < 0 ? `-${formatted}` : formatted
}

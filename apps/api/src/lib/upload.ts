/**
 * 校验图片文件的 magic bytes
 * 不信任 Content-Type 和文件扩展名
 */
export function validateImageMagicBytes(buffer: ArrayBuffer): 'image/jpeg' | 'image/png' | 'image/webp' | null {
  const bytes = new Uint8Array(buffer)

  // JPEG: FF D8 FF
  if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) {
    return 'image/jpeg'
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes[0] === 0x89 && bytes[1] === 0x50 &&
    bytes[2] === 0x4E && bytes[3] === 0x47 &&
    bytes[4] === 0x0D && bytes[5] === 0x0A &&
    bytes[6] === 0x1A && bytes[7] === 0x0A
  ) {
    return 'image/png'
  }

  // WebP: RIFF....WEBP
  if (
    bytes[0] === 0x52 && bytes[1] === 0x49 &&
    bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes.length > 11 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 &&
    bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return 'image/webp'
  }

  return null
}

/** 文件大小限制 2MB */
export const MAX_AVATAR_SIZE = 2 * 1024 * 1024

const SAFE_SEGMENT = /^[a-zA-Z0-9_.-]+$/

export function validateAvatarPath(userId: string, avatarId: string): boolean {
  if (!SAFE_SEGMENT.test(userId)) return false
  if (!SAFE_SEGMENT.test(avatarId)) return false
  return true
}

/**
 * 校验昵称
 * trim 后长度 1-20，禁止控制字符和换行
 */
export function validateNickname(nickname: string): string | null {
  const trimmed = nickname.trim()
  if (trimmed.length < 1 || trimmed.length > 20) return null
  if (/[\x00-\x1F\x7F]/.test(trimmed)) return null
  return trimmed
}

export function generateAvatarKey(): string {
  return `${crypto.randomUUID()}.webp`
}

const CHARSET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

export function generateInviteCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8))
  return Array.from(bytes, (b) => CHARSET[b % CHARSET.length]).join('')
}

export type JWTPayload = {
  userId: string
  email?: string
  sessionId?: string
  type?: string
  exp: number
  iat: number
}

function base64url(input: string | ArrayBuffer): string {
  if (typeof input === 'string') {
    return btoa(input).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  }
  const bytes = new Uint8Array(input)
  let binary = ''
  bytes.forEach(b => binary += String.fromCharCode(b))
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64urlDecode(input: string): Uint8Array {
  const binary = atob(input.replace(/-/g, '+').replace(/_/g, '/'))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

async function sign(payload: object, secret: string, expiresIn: number): Promise<string> {
  const header = { alg: 'HS256', typ: 'JWT' }
  const now = Math.floor(Date.now() / 1000)
  const fullPayload = { ...payload, iat: now, exp: now + expiresIn }

  const encoder = new TextEncoder()
  const headerB64 = base64url(JSON.stringify(header))
  const payloadB64 = base64url(JSON.stringify(fullPayload))
  const data = `${headerB64}.${payloadB64}`

  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  )
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(data))
  return `${data}.${base64url(signature)}`
}

async function verify(token: string, secret: string): Promise<object | null> {
  const parts = token.split('.')
  if (parts.length !== 3) return null

  const [headerB64, payloadB64, signatureB64] = parts
  const data = `${headerB64}.${payloadB64}`

  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
  )
  const signature = base64urlDecode(signatureB64)
  const valid = await crypto.subtle.verify('HMAC', key, signature.buffer as ArrayBuffer, encoder.encode(data))
  if (!valid) return null

  const payload = JSON.parse(atob(payloadB64))
  if (payload.exp < Math.floor(Date.now() / 1000)) return null
  return payload
}

const ACCESS_TOKEN_EXPIRY = 15 * 60
const REFRESH_TOKEN_EXPIRY = 7 * 24 * 60 * 60

export async function signAccessToken(userId: string, email: string, secret: string): Promise<string> {
  return sign({ userId, email }, secret, ACCESS_TOKEN_EXPIRY)
}

export async function signRefreshToken(userId: string, sessionId: string, secret: string): Promise<string> {
  return sign({ userId, sessionId, type: 'refresh' }, secret, REFRESH_TOKEN_EXPIRY)
}

export async function verifyToken(token: string, secret: string): Promise<JWTPayload | null> {
  const payload = await verify(token, secret)
  return payload as JWTPayload | null
}

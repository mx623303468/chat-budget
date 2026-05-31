import { Hono } from 'hono'
import type { Env } from '../env'
import { signAccessToken, signRefreshToken, verifyToken } from '../lib/jwt'
import { hashPassword, verifyPassword } from '../lib/password'
import { setAccessCookie, setRefreshCookie, clearCookies, getRefreshToken } from '../lib/cookie'
import { authMiddleware } from '../middleware/auth'

const auth = new Hono<{ Bindings: Env; Variables: { userId: string } }>()

async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(token)
  const hash = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('')
}

auth.post('/register', async (c) => {
  const { email, password, nickname } = await c.req.json<{ email: string; password: string; nickname: string }>()

  if (!email || !password || !nickname) {
    return c.json({ error: '邮箱、密码和昵称不能为空' }, 400)
  }
  if (password.length < 6) {
    return c.json({ error: '密码至少 6 位' }, 400)
  }

  const existing = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first()
  if (existing) {
    return c.json({ error: '邮箱已被注册' }, 409)
  }

  const userId = crypto.randomUUID()
  const passwordHash = await hashPassword(password)
  const now = Date.now()

  await c.env.DB.prepare(
    'INSERT INTO users (id, email, password_hash, nickname, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(userId, email, passwordHash, nickname, now, now).run()

  const sessionId = crypto.randomUUID()
  const refreshToken = await signRefreshToken(userId, sessionId, c.env.REFRESH_SECRET)
  const refreshTokenHash = await hashToken(refreshToken)

  await c.env.DB.prepare(
    'INSERT INTO refresh_sessions (id, user_id, token_hash, expires_at, created_at, last_used_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(sessionId, userId, refreshTokenHash, now + 7 * 24 * 60 * 60 * 1000, now, now).run()

  const accessToken = await signAccessToken(userId, email, c.env.JWT_SECRET)
  setAccessCookie(c, accessToken)
  setRefreshCookie(c, refreshToken)

  return c.json({
    user: { id: userId, email, nickname, avatar: null, createdAt: now, updatedAt: now }
  }, 201)
})

auth.post('/login', async (c) => {
  const { email, password } = await c.req.json<{ email: string; password: string }>()

  if (!email || !password) {
    return c.json({ error: '邮箱和密码不能为空' }, 400)
  }

  const user = await c.env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first<{
    id: string; email: string; password_hash: string; nickname: string; avatar: string | null; created_at: number; updated_at: number
  }>()
  if (!user) {
    return c.json({ error: '邮箱或密码错误' }, 401)
  }

  const valid = await verifyPassword(password, user.password_hash)
  if (!valid) {
    return c.json({ error: '邮箱或密码错误' }, 401)
  }

  const sessionId = crypto.randomUUID()
  const refreshToken = await signRefreshToken(user.id, sessionId, c.env.REFRESH_SECRET)
  const refreshTokenHash = await hashToken(refreshToken)
  const now = Date.now()

  await c.env.DB.prepare(
    'INSERT INTO refresh_sessions (id, user_id, token_hash, expires_at, created_at, last_used_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(sessionId, user.id, refreshTokenHash, now + 7 * 24 * 60 * 60 * 1000, now, now).run()

  const accessToken = await signAccessToken(user.id, user.email, c.env.JWT_SECRET)
  setAccessCookie(c, accessToken)
  setRefreshCookie(c, refreshToken)

  return c.json({
    user: { id: user.id, email: user.email, nickname: user.nickname, avatar: user.avatar, createdAt: user.created_at, updatedAt: user.updated_at }
  })
})

auth.post('/refresh', async (c) => {
  const refreshToken = getRefreshToken(c)
  if (!refreshToken) {
    return c.json({ error: '无 Refresh Token' }, 401)
  }

  const payload = await verifyToken(refreshToken, c.env.REFRESH_SECRET) as { userId?: string; sessionId?: string; type?: string } | null
  if (!payload || payload.type !== 'refresh' || !payload.userId || !payload.sessionId) {
    return c.json({ error: 'Refresh Token 无效' }, 401)
  }

  const session = await c.env.DB.prepare(
    'SELECT * FROM refresh_sessions WHERE id = ? AND user_id = ? AND revoked_at IS NULL AND expires_at > ?'
  ).bind(payload.sessionId, payload.userId, Date.now()).first<{ id: string; user_id: string }>()

  if (!session) {
    return c.json({ error: '会话已失效' }, 401)
  }

  const user = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(payload.userId).first<{
    id: string; email: string; nickname: string; avatar: string | null; created_at: number; updated_at: number
  }>()
  if (!user) {
    return c.json({ error: '用户不存在' }, 401)
  }

  await c.env.DB.prepare('UPDATE refresh_sessions SET last_used_at = ? WHERE id = ?').bind(Date.now(), session.id).run()

  const accessToken = await signAccessToken(user.id, user.email, c.env.JWT_SECRET)
  setAccessCookie(c, accessToken)

  return c.json({
    user: { id: user.id, email: user.email, nickname: user.nickname, avatar: user.avatar, createdAt: user.created_at, updatedAt: user.updated_at }
  })
})

auth.post('/logout', authMiddleware, async (c) => {
  const userId = c.get('userId')
  const refreshToken = getRefreshToken(c)

  if (refreshToken) {
    const payload = await verifyToken(refreshToken, c.env.REFRESH_SECRET) as { sessionId?: string } | null
    if (payload?.sessionId) {
      await c.env.DB.prepare('UPDATE refresh_sessions SET revoked_at = ? WHERE id = ? AND user_id = ?')
        .bind(Date.now(), payload.sessionId, userId).run()
    }
  }

  clearCookies(c)
  return c.json({ ok: true })
})

auth.get('/me', authMiddleware, async (c) => {
  const userId = c.get('userId')
  const user = await c.env.DB.prepare('SELECT id, email, nickname, avatar, created_at, updated_at FROM users WHERE id = ?').bind(userId).first()
  if (!user) {
    return c.json({ error: '用户不存在' }, 404)
  }
  return c.json({ user })
})

export default auth

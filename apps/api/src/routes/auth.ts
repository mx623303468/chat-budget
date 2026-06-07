import { Hono } from 'hono'
import type { Env } from '../env'
import { signAccessToken, signRefreshToken, verifyToken } from '../lib/jwt'
import { hashPassword, verifyPassword } from '../lib/password'
import { setAccessCookie, setRefreshCookie, clearCookies, getRefreshToken } from '../lib/cookie'
import { authMiddleware } from '../middleware/auth'
import { validateNickname, validateImageMagicBytes, MAX_AVATAR_SIZE, generateAvatarKey } from '../lib/upload'

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

auth.patch('/profile', authMiddleware, async (c) => {
  const userId = c.get('userId')

  const formData = await c.req.formData()
  const nicknameRaw = formData.get('nickname') as string | null
  const avatarFile = formData.get('avatar') as File | null
  const removeAvatar = formData.get('removeAvatar') as string | null

  if (!nicknameRaw && !avatarFile && removeAvatar !== 'true') {
    return c.json({ error: '没有需要更新的字段' }, 400)
  }

  let nickname: string | undefined
  if (nicknameRaw !== null) {
    nickname = validateNickname(nicknameRaw)
    if (!nickname) {
      return c.json({ error: '昵称长度需在 1-20 之间，且不能包含特殊字符' }, 400)
    }
  }

  let newAvatarKey: string | undefined

  if (avatarFile) {
    if (avatarFile.size > MAX_AVATAR_SIZE) {
      return c.json({ error: '头像文件不能超过 2MB' }, 400)
    }

    const buffer = await avatarFile.arrayBuffer()
    const mimeType = validateImageMagicBytes(buffer)
    if (!mimeType) {
      return c.json({ error: '仅支持 JPG、PNG、WebP 格式的图片' }, 400)
    }

    const oldUser = await c.env.DB.prepare(
      'SELECT avatar FROM users WHERE id = ?'
    ).bind(userId).first<{ avatar: string | null }>()

    newAvatarKey = generateAvatarKey(userId)

    const now = Date.now()
    await c.env.DB.batch([
      c.env.DB.prepare(
        'INSERT OR REPLACE INTO avatars (id, user_id, data, mime_type, created_at) VALUES (?, ?, ?, ?, ?)'
      ).bind(newAvatarKey, userId, buffer, mimeType, now),
      c.env.DB.prepare(
        'UPDATE users SET nickname = COALESCE(?, nickname), avatar = ?, updated_at = ? WHERE id = ?'
      ).bind(nickname ?? null, newAvatarKey, now, userId),
    ])

    if (oldUser?.avatar) {
      await c.env.DB.prepare('DELETE FROM avatars WHERE user_id = ? AND id = ?')
        .bind(userId, oldUser.avatar).run().catch(() => {})
    }
  } else if (removeAvatar === 'true') {
    const oldUser = await c.env.DB.prepare(
      'SELECT avatar FROM users WHERE id = ?'
    ).bind(userId).first<{ avatar: string | null }>()

    const now = Date.now()
    await c.env.DB.prepare(
      'UPDATE users SET nickname = COALESCE(?, nickname), avatar = NULL, updated_at = ? WHERE id = ?'
    ).bind(nickname ?? null, now, userId).run()

    if (oldUser?.avatar) {
      await c.env.DB.prepare('DELETE FROM avatars WHERE user_id = ? AND id = ?')
        .bind(userId, oldUser.avatar).run().catch(() => {})
    }
  } else {
    const now = Date.now()
    await c.env.DB.prepare(
      'UPDATE users SET nickname = ?, updated_at = ? WHERE id = ?'
    ).bind(nickname!, now, userId).run()
  }

  const user = await c.env.DB.prepare(
    'SELECT id, email, nickname, avatar, created_at, updated_at FROM users WHERE id = ?'
  ).bind(userId).first()

  // 广播个人资料更新到所有加入的账本
  const memberships = await c.env.DB.prepare(
    'SELECT ledger_id FROM ledger_members WHERE user_id = ? AND removed_at IS NULL'
  ).bind(userId).all()

  const event = {
    type: 'profile_updated',
    ledgerId: '',
    eventId: 0,
    entityId: userId,
    actorUserId: userId,
    occurredAt: Date.now(),
    payload: { userId, nickname: (user as any).nickname, avatar: (user as any).avatar },
  }

  for (const m of memberships.results as { ledger_id: string }[]) {
    const id = c.env.SYNC_DO.idFromName(m.ledger_id)
    const stub = c.env.SYNC_DO.get(id)
    await stub.fetch(new Request('https://do/broadcast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event, excludeUserId: userId }),
    })).catch(() => {})
  }

  return c.json({ user })
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

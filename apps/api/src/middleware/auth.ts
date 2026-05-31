import { createMiddleware } from 'hono/factory'
import type { Env } from '../env'
import { verifyToken } from '../lib/jwt'
import { getAccessToken } from '../lib/cookie'

export const authMiddleware = createMiddleware<{ Bindings: Env; Variables: { userId: string } }>(
  async (c, next) => {
    const token = getAccessToken(c)
    if (!token) {
      return c.json({ error: '未登录' }, 401)
    }
    const payload = await verifyToken(token, c.env.JWT_SECRET)
    if (!payload || !payload.userId) {
      return c.json({ error: 'Token 无效或已过期' }, 401)
    }
    c.set('userId', payload.userId as string)
    await next()
  }
)

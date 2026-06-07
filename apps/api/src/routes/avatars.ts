import { Hono } from 'hono'
import type { Env } from '../env'
import { validateAvatarPath } from '../lib/upload'

const avatars = new Hono<{ Bindings: Env }>()

avatars.get('/:userId/:avatarId', async (c) => {
  const userId = c.req.param('userId')
  const avatarId = c.req.param('avatarId')

  if (!validateAvatarPath(userId, avatarId)) {
    return c.json({ error: '无效路径' }, 400)
  }

  const row = await c.env.DB.prepare(
    'SELECT data, mime_type FROM avatars WHERE user_id = ? AND id = ?'
  ).bind(userId, avatarId).first<{ data: string; mime_type: string }>()

  if (!row) {
    return c.json({ error: '头像不存在' }, 404)
  }

  const binary = Uint8Array.from(atob(row.data), (c) => c.charCodeAt(0))

  return new Response(binary, {
    headers: {
      'Content-Type': row.mime_type,
      'Cache-Control': 'public, max-age=86400, immutable',
      'X-Content-Type-Options': 'nosniff',
    },
  })
})

export default avatars

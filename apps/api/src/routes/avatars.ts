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

  const key = `avatars/${userId}/${avatarId}`
  const object = await c.env.AVATARS.get(key)

  if (!object) {
    return c.json({ error: '头像不存在' }, 404)
  }

  const headers = new Headers()
  object.writeHttpMetadata(headers)
  headers.set('Cache-Control', 'public, max-age=86400, immutable')
  headers.set('X-Content-Type-Options', 'nosniff')

  return new Response(object.body, { headers })
})

export default avatars

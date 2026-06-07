import { Hono } from 'hono'
import type { Env } from './env'
import { verifyToken } from './lib/jwt'
import { getAccessToken } from './lib/cookie'
import auth from './routes/auth'
import ledgers from './routes/ledgers'
import members from './routes/members'
import invites from './routes/invites'
import transactions from './routes/transactions'
import events from './routes/events'
import avatars from './routes/avatars'
import { SyncDO } from './do/sync'

const app = new Hono<{ Bindings: Env; Variables: { userId: string } }>()

app.get('/api/health', (c) => {
  return c.json({ status: 'ok', timestamp: Date.now() })
})

app.route('/api/auth', auth)
app.route('/api/avatars', avatars)
app.route('/api/ledgers', ledgers)
app.route('/api/ledgers/:id/members', members)
app.route('/api/ledgers/:id/transactions', transactions)
app.route('/api/ledgers/:id/events', events)
app.route('/api', invites)

app.get('/api/ws/:ledgerId', async (c) => {
  const ledgerId = c.req.param('ledgerId')!

  const token = getAccessToken(c)
  if (!token) {
    return c.json({ error: '未登录' }, 401)
  }

  const payload = await verifyToken(token, c.env.JWT_SECRET)
  if (!payload?.userId) {
    return c.json({ error: 'Token 无效' }, 401)
  }
  const userId = payload.userId

  const membership = await c.env.DB.prepare(
    'SELECT lm.role FROM ledger_members lm JOIN ledgers l ON lm.ledger_id = l.id WHERE lm.ledger_id = ? AND lm.user_id = ? AND lm.removed_at IS NULL AND l.deleted_at IS NULL'
  ).bind(ledgerId, userId).first()

  if (!membership) {
    return c.json({ error: '无权访问该账本' }, 403)
  }

  const user = await c.env.DB.prepare('SELECT nickname FROM users WHERE id = ?').bind(userId).first<{ nickname: string }>()

  const id = c.env.SYNC_DO.idFromName(ledgerId)
  const stub = c.env.SYNC_DO.get(id)

  const doUrl = new URL(c.req.url)
  doUrl.searchParams.set('userId', userId)
  doUrl.searchParams.set('nickname', user?.nickname ?? '')

  const doRequest = new Request(doUrl.toString(), {
    headers: c.req.raw.headers,
  })

  return stub.fetch(doRequest)
})

export default app
export { SyncDO }

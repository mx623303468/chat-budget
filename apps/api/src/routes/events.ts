import { Hono } from 'hono'
import type { Env } from '../env'
import { authMiddleware } from '../middleware/auth'
import { requireMember, requireLedgerNotDeleted } from '../lib/queries'

const events = new Hono<{ Bindings: Env; Variables: { userId: string } }>()

events.use('*', authMiddleware)

events.get('/', async (c) => {
  const userId = c.get('userId')
  const ledgerId = c.req.param('id')!
  const afterId = c.req.query('afterId')
  const limit = Math.min(Math.max(Number(c.req.query('limit') ?? '100'), 1), 500)

  try {
    await requireLedgerNotDeleted(c.env.DB, ledgerId)
    await requireMember(c.env.DB, ledgerId, userId)
  } catch (e) {
    const msg = (e as Error).message
    if (msg === 'LEDGER_NOT_FOUND') return c.json({ error: '账本不存在' }, 404)
    if (msg === 'NOT_MEMBER') return c.json({ error: '无权访问' }, 403)
    throw e
  }

  let rows
  if (afterId) {
    rows = await c.env.DB.prepare(
      'SELECT * FROM ledger_events WHERE ledger_id = ? AND id > ? ORDER BY id ASC LIMIT ?'
    ).bind(ledgerId, Number(afterId), limit).all()
  } else {
    rows = await c.env.DB.prepare(
      'SELECT * FROM ledger_events WHERE ledger_id = ? ORDER BY id ASC LIMIT ?'
    ).bind(ledgerId, limit).all()
  }

  return c.json({ events: rows.results })
})

export default events

import { Hono } from 'hono'
import type { Env } from '../env'
import { authMiddleware } from '../middleware/auth'
import { requireMember, requireOwner, requireLedgerNotDeleted } from '../lib/queries'

const members = new Hono<{ Bindings: Env; Variables: { userId: string } }>()

members.use('*', authMiddleware)

// GET /api/ledgers/:id/members — 成员列表
members.get('/', async (c) => {
  const userId = c.get('userId')
  const ledgerId = c.req.param('id')!

  try {
    await requireLedgerNotDeleted(c.env.DB, ledgerId)
    await requireMember(c.env.DB, ledgerId, userId)
  } catch (e) {
    if ((e as Error).message === 'LEDGER_NOT_FOUND') return c.json({ error: '账本不存在' }, 404)
    if ((e as Error).message === 'NOT_MEMBER') return c.json({ error: '无权访问' }, 403)
    throw e
  }

  const results = await c.env.DB.prepare(`
    SELECT lm.*, u.nickname, u.avatar FROM ledger_members lm
    JOIN users u ON lm.user_id = u.id
    WHERE lm.ledger_id = ?
    ORDER BY lm.removed_at ASC, lm.joined_at ASC
  `).bind(ledgerId).all()

  return c.json({ members: results.results })
})

// DELETE /api/ledgers/:id/members/:uid — 移除成员（仅 owner）
members.delete('/:uid', async (c) => {
  const userId = c.get('userId')
  const ledgerId = c.req.param('id')!
  const targetUserId = c.req.param('uid')!

  try {
    await requireLedgerNotDeleted(c.env.DB, ledgerId)
    await requireOwner(c.env.DB, ledgerId, userId)
  } catch (e) {
    if ((e as Error).message === 'LEDGER_NOT_FOUND') return c.json({ error: '账本不存在' }, 404)
    if ((e as Error).message === 'NOT_OWNER') return c.json({ error: '仅 owner 可移除成员' }, 403)
    throw e
  }

  if (targetUserId === userId) {
    return c.json({ error: '不能移除自己，请使用转让功能' }, 400)
  }

  await c.env.DB.prepare('UPDATE ledger_members SET removed_at = ? WHERE ledger_id = ? AND user_id = ? AND removed_at IS NULL')
    .bind(Date.now(), ledgerId, targetUserId).run()

  return c.json({ ok: true })
})

// DELETE /api/ledgers/:id/members/me — 成员主动退出
members.delete('/me', async (c) => {
  const userId = c.get('userId')
  const ledgerId = c.req.param('id')!

  try {
    await requireLedgerNotDeleted(c.env.DB, ledgerId)
    const membership = await requireMember(c.env.DB, ledgerId, userId)
    if (membership.role === 'owner') {
      return c.json({ error: 'owner 不可退出，请先转让或删除账本' }, 400)
    }
  } catch (e) {
    if ((e as Error).message === 'LEDGER_NOT_FOUND') return c.json({ error: '账本不存在' }, 404)
    if ((e as Error).message === 'NOT_MEMBER') return c.json({ error: '无权访问' }, 403)
    throw e
  }

  await c.env.DB.prepare('UPDATE ledger_members SET removed_at = ? WHERE ledger_id = ? AND user_id = ? AND removed_at IS NULL')
    .bind(Date.now(), ledgerId, userId).run()

  return c.json({ ok: true })
})

export default members

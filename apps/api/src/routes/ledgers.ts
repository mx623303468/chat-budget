import { Hono } from 'hono'
import type { Env } from '../env'
import { authMiddleware } from '../middleware/auth'
import { generateInviteCode } from '../lib/invite'
import { requireMember, requireOwner, requireLedgerNotDeleted } from '../lib/queries'

const ledgers = new Hono<{ Bindings: Env; Variables: { userId: string } }>()

ledgers.use('*', authMiddleware)

// GET /api/ledgers — 我的账本列表
ledgers.get('/', async (c) => {
  const userId = c.get('userId')
  const results = await c.env.DB.prepare(`
    SELECT l.* FROM ledgers l
    JOIN ledger_members lm ON l.id = lm.ledger_id
    WHERE lm.user_id = ? AND lm.removed_at IS NULL AND l.deleted_at IS NULL
    ORDER BY l.created_at DESC
  `).bind(userId).all()
  return c.json({ ledgers: results.results })
})

// POST /api/ledgers — 创建账本
ledgers.post('/', async (c) => {
  const userId = c.get('userId')
  const { name, dailyLimit, startDate } = await c.req.json<{ name: string; dailyLimit?: number; startDate: string }>()

  if (!name || !startDate) {
    return c.json({ error: '名称和起始日期不能为空' }, 400)
  }

  const ledgerId = crypto.randomUUID()
  const now = Date.now()
  const inviteCode = generateInviteCode()

  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO ledgers (id, name, owner_id, daily_limit, start_date, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(ledgerId, name, userId, dailyLimit ?? 0, startDate, now, now),
    c.env.DB.prepare('INSERT INTO ledger_members (ledger_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)')
      .bind(ledgerId, userId, 'owner', now),
    c.env.DB.prepare('INSERT INTO ledger_invites (id, ledger_id, code, created_by, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(crypto.randomUUID(), ledgerId, inviteCode, userId, now + 24 * 60 * 60 * 1000, now),
  ])

  return c.json({ ledger: { id: ledgerId, name, ownerId: userId, dailyLimit: dailyLimit ?? 0, startDate, createdAt: now, updatedAt: now, deletedAt: null } }, 201)
})

// GET /api/ledgers/:id — 账本详情
ledgers.get('/:id', async (c) => {
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

  const ledger = await c.env.DB.prepare('SELECT * FROM ledgers WHERE id = ?').bind(ledgerId).first()
  return c.json({ ledger })
})

// PUT /api/ledgers/:id — 更新账本（仅 owner）
ledgers.put('/:id', async (c) => {
  const userId = c.get('userId')
  const ledgerId = c.req.param('id')!
  const { name, dailyLimit, startDate } = await c.req.json<{ name?: string; dailyLimit?: number; startDate?: string }>()

  try {
    await requireLedgerNotDeleted(c.env.DB, ledgerId)
    await requireOwner(c.env.DB, ledgerId, userId)
  } catch (e) {
    if ((e as Error).message === 'LEDGER_NOT_FOUND') return c.json({ error: '账本不存在' }, 404)
    if ((e as Error).message === 'NOT_MEMBER') return c.json({ error: '无权访问' }, 403)
    if ((e as Error).message === 'NOT_OWNER') return c.json({ error: '仅 owner 可修改' }, 403)
    throw e
  }

  const now = Date.now()
  await c.env.DB.prepare(`
    UPDATE ledgers SET name = COALESCE(?, name), daily_limit = COALESCE(?, daily_limit), start_date = COALESCE(?, start_date), updated_at = ? WHERE id = ?
  `).bind(name ?? null, dailyLimit !== undefined ? dailyLimit : null, startDate ?? null, now, ledgerId).run()

  const ledger = await c.env.DB.prepare('SELECT * FROM ledgers WHERE id = ?').bind(ledgerId).first()
  return c.json({ ledger })
})

// DELETE /api/ledgers/:id — 软删除账本（仅 owner）
ledgers.delete('/:id', async (c) => {
  const userId = c.get('userId')
  const ledgerId = c.req.param('id')!

  try {
    await requireLedgerNotDeleted(c.env.DB, ledgerId)
    await requireOwner(c.env.DB, ledgerId, userId)
  } catch (e) {
    if ((e as Error).message === 'LEDGER_NOT_FOUND') return c.json({ error: '账本不存在' }, 404)
    if ((e as Error).message === 'NOT_MEMBER') return c.json({ error: '无权访问' }, 403)
    if ((e as Error).message === 'NOT_OWNER') return c.json({ error: '仅 owner 可删除' }, 403)
    throw e
  }

  const now = Date.now()
  await c.env.DB.prepare('UPDATE ledgers SET deleted_at = ?, updated_at = ? WHERE id = ?').bind(now, now, ledgerId).run()

  return c.json({ ok: true })
})

// POST /api/ledgers/:id/transfer — 转让 ownership
ledgers.post('/:id/transfer', async (c) => {
  const userId = c.get('userId')
  const ledgerId = c.req.param('id')!
  const { targetUserId } = await c.req.json<{ targetUserId: string }>()

  if (!targetUserId) {
    return c.json({ error: '目标用户不能为空' }, 400)
  }

  try {
    await requireLedgerNotDeleted(c.env.DB, ledgerId)
    await requireOwner(c.env.DB, ledgerId, userId)
  } catch (e) {
    if ((e as Error).message === 'LEDGER_NOT_FOUND') return c.json({ error: '账本不存在' }, 404)
    if ((e as Error).message === 'NOT_OWNER') return c.json({ error: '仅 owner 可转让' }, 403)
    throw e
  }

  const target = await c.env.DB.prepare('SELECT role FROM ledger_members WHERE ledger_id = ? AND user_id = ? AND removed_at IS NULL').bind(ledgerId, targetUserId).first()
  if (!target) {
    return c.json({ error: '目标用户不是账本成员' }, 400)
  }

  const now = Date.now()
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE ledgers SET owner_id = ?, updated_at = ? WHERE id = ?').bind(targetUserId, now, ledgerId),
    c.env.DB.prepare('UPDATE ledger_members SET role = ? WHERE ledger_id = ? AND user_id = ?').bind('member', ledgerId, userId),
    c.env.DB.prepare('UPDATE ledger_members SET role = ? WHERE ledger_id = ? AND user_id = ?').bind('owner', ledgerId, targetUserId),
  ])

  return c.json({ ok: true })
})

export default ledgers

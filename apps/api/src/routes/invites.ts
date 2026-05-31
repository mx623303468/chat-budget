import { Hono } from 'hono'
import type { Env } from '../env'
import { authMiddleware } from '../middleware/auth'
import { generateInviteCode } from '../lib/invite'
import { requireOwner, requireLedgerNotDeleted } from '../lib/queries'

const invites = new Hono<{ Bindings: Env; Variables: { userId: string } }>()

// GET /api/ledgers/:id/invite — 获取当前邀请码（仅 owner）
invites.get('/ledgers/:id/invite', authMiddleware, async (c) => {
  const userId = c.get('userId')
  const ledgerId = c.req.param('id')!

  try {
    await requireLedgerNotDeleted(c.env.DB, ledgerId)
    await requireOwner(c.env.DB, ledgerId, userId)
  } catch (e) {
    if ((e as Error).message === 'LEDGER_NOT_FOUND') return c.json({ error: '账本不存在' }, 404)
    if ((e as Error).message === 'NOT_OWNER') return c.json({ error: '仅 owner 可查看邀请码' }, 403)
    throw e
  }

  const invite = await c.env.DB.prepare(
    'SELECT * FROM ledger_invites WHERE ledger_id = ? AND revoked_at IS NULL AND expires_at > ? ORDER BY created_at DESC LIMIT 1'
  ).bind(ledgerId, Date.now()).first()

  return c.json({ invite })
})

// POST /api/ledgers/:id/invite/rotate — 重新生成邀请码（仅 owner）
invites.post('/ledgers/:id/invite/rotate', authMiddleware, async (c) => {
  const userId = c.get('userId')
  const ledgerId = c.req.param('id')!

  try {
    await requireLedgerNotDeleted(c.env.DB, ledgerId)
    await requireOwner(c.env.DB, ledgerId, userId)
  } catch (e) {
    if ((e as Error).message === 'LEDGER_NOT_FOUND') return c.json({ error: '账本不存在' }, 404)
    if ((e as Error).message === 'NOT_OWNER') return c.json({ error: '仅 owner 可重新生成邀请码' }, 403)
    throw e
  }

  const now = Date.now()
  const newCode = generateInviteCode()

  await c.env.DB.prepare('UPDATE ledger_invites SET revoked_at = ? WHERE ledger_id = ? AND revoked_at IS NULL')
    .bind(now, ledgerId).run()

  const inviteId = crypto.randomUUID()
  await c.env.DB.prepare('INSERT INTO ledger_invites (id, ledger_id, code, created_by, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(inviteId, ledgerId, newCode, userId, now + 24 * 60 * 60 * 1000, now).run()

  return c.json({ invite: { id: inviteId, code: newCode, expiresAt: now + 24 * 60 * 60 * 1000 } })
})

// GET /api/invites/:code — 预览邀请信息
invites.get('/invites/:code', async (c) => {
  const code = c.req.param('code')!
  const now = Date.now()

  const invite = await c.env.DB.prepare(
    'SELECT li.*, l.name as ledger_name FROM ledger_invites li JOIN ledgers l ON li.ledger_id = l.id WHERE li.code = ? AND li.revoked_at IS NULL AND li.expires_at > ? AND l.deleted_at IS NULL'
  ).bind(code, now).first<{ ledger_id: string; ledger_name: string }>()

  if (!invite) {
    return c.json({ error: '邀请码无效或已过期' }, 404)
  }

  const memberCount = await c.env.DB.prepare(
    'SELECT COUNT(*) as count FROM ledger_members WHERE ledger_id = ? AND removed_at IS NULL'
  ).bind(invite.ledger_id).first<{ count: number }>()

  return c.json({
    invite: {
      ledgerId: invite.ledger_id,
      ledgerName: invite.ledger_name,
      memberCount: memberCount?.count ?? 0,
    }
  })
})

// POST /api/invites/join — 通过邀请码加入
invites.post('/invites/join', authMiddleware, async (c) => {
  const userId = c.get('userId')
  const { code } = await c.req.json<{ code: string }>()

  if (!code) {
    return c.json({ error: '邀请码不能为空' }, 400)
  }

  const now = Date.now()
  const invite = await c.env.DB.prepare(
    'SELECT * FROM ledger_invites WHERE code = ? AND revoked_at IS NULL AND expires_at > ?'
  ).bind(code, now).first<{ ledger_id: string }>()

  if (!invite) {
    return c.json({ error: '邀请码无效或已过期' }, 404)
  }

  const ledger = await c.env.DB.prepare('SELECT * FROM ledgers WHERE id = ? AND deleted_at IS NULL').bind(invite.ledger_id).first()
  if (!ledger) {
    return c.json({ error: '账本不存在' }, 404)
  }

  const existing = await c.env.DB.prepare('SELECT removed_at FROM ledger_members WHERE ledger_id = ? AND user_id = ?')
    .bind(invite.ledger_id, userId).first<{ removed_at: number | null }>()

  if (existing && !existing.removed_at) {
    return c.json({ error: '已是该账本成员' }, 409)
  }

  if (existing) {
    await c.env.DB.prepare('UPDATE ledger_members SET role = ?, joined_at = ?, removed_at = NULL WHERE ledger_id = ? AND user_id = ?')
      .bind('member', now, invite.ledger_id, userId).run()
  } else {
    await c.env.DB.prepare('INSERT INTO ledger_members (ledger_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)')
      .bind(invite.ledger_id, userId, 'member', now).run()
  }

  return c.json({ ledgerId: invite.ledger_id })
})

export default invites

import { Hono } from 'hono'
import type { Env } from '../env'
import { authMiddleware } from '../middleware/auth'
import { requireMember, requireLedgerNotDeleted } from '../lib/queries'

type AppEnv = { Bindings: Env; Variables: { userId: string } }

type TxRow = Record<string, unknown>

function mapTx(row: TxRow) {
  return {
    id: row.id,
    ledgerId: row.ledger_id,
    userId: row.user_id,
    amount: row.amount,
    note: row.note,
    date: row.date,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    deletedBy: row.deleted_by,
    version: row.version,
  }
}

async function broadcast(c: { env: Env }, ledgerId: string, event: Record<string, unknown>) {
  const id = c.env.SYNC_DO.idFromName(ledgerId)
  const stub = c.env.SYNC_DO.get(id)
  await stub.fetch(new Request('https://do/broadcast', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event, excludeUserId: event.actorUserId }),
  }))
}

const transactions = new Hono<AppEnv>()

transactions.use('*', authMiddleware)

function parseCursor(cursor: string | undefined): { date: string; createdAt: number; id: string } | null {
  if (!cursor) return null
  try {
    return JSON.parse(atob(cursor))
  } catch {
    return null
  }
}

function encodeCursor(date: string, createdAt: number, id: string): string {
  return btoa(JSON.stringify({ date, createdAt, id }))
}

function buildTransactionPayloadFromFields(
  id: string, ledgerId: string, userId: string, amount: number, note: string, date: string,
  createdAt: number, updatedAt: number, deletedAt: number | null,
  createdBy: string, updatedBy: string | null, deletedBy: string | null, version: number
) {
  return JSON.stringify({ id, ledgerId, userId, amount, note, date, createdAt, updatedAt, deletedAt, createdBy, updatedBy, deletedBy, version })
}

transactions.get('/', async (c) => {
  const userId = c.get('userId')
  const ledgerId = c.req.param('id')!
  const cursor = c.req.query('cursor')
  const limit = Math.min(Math.max(Number(c.req.query('limit') ?? '30'), 1), 100)

  try {
    await requireLedgerNotDeleted(c.env.DB, ledgerId)
    await requireMember(c.env.DB, ledgerId, userId)
  } catch (e) {
    const msg = (e as Error).message
    if (msg === 'LEDGER_NOT_FOUND') return c.json({ error: '账本不存在' }, 404)
    if (msg === 'NOT_MEMBER') return c.json({ error: '无权访问' }, 403)
    throw e
  }

  const cData = parseCursor(cursor)
  let rows: Record<string, unknown>[]

  if (cData) {
    rows = (await c.env.DB.prepare(`
      SELECT * FROM transactions
      WHERE ledger_id = ? AND deleted_at IS NULL
        AND (date < ? OR (date = ? AND created_at < ?) OR (date = ? AND created_at = ? AND id < ?))
      ORDER BY date DESC, created_at DESC, id DESC
      LIMIT ?
    `).bind(ledgerId, cData.date, cData.date, cData.createdAt, cData.date, cData.createdAt, cData.id, limit).all()).results as Record<string, unknown>[]
  } else {
    rows = (await c.env.DB.prepare(`
      SELECT * FROM transactions
      WHERE ledger_id = ? AND deleted_at IS NULL
      ORDER BY date DESC, created_at DESC, id DESC
      LIMIT ?
    `).bind(ledgerId, limit).all()).results as Record<string, unknown>[]
  }

  const nextCursor = rows.length === limit && rows.length > 0
    ? encodeCursor(rows[rows.length - 1]!.date as string, rows[rows.length - 1]!.created_at as number, rows[rows.length - 1]!.id as string)
    : null

  return c.json({ transactions: rows.map(mapTx), nextCursor })
})

transactions.post('/', async (c) => {
  const userId = c.get('userId')
  const ledgerId = c.req.param('id')!
  const body = await c.req.json<{
    id: string
    clientMutationId: string
    amount: number
    note: string
    date: string
    userId?: string
  }>()

  try {
    await requireLedgerNotDeleted(c.env.DB, ledgerId)
    await requireMember(c.env.DB, ledgerId, userId)
  } catch (e) {
    const msg = (e as Error).message
    if (msg === 'LEDGER_NOT_FOUND') return c.json({ error: '账本不存在' }, 404)
    if (msg === 'NOT_MEMBER') return c.json({ error: '无权访问' }, 403)
    throw e
  }

  if (!body.id || !body.clientMutationId || body.amount === undefined || !body.note || !body.date) {
    return c.json({ error: '缺少必填字段' }, 400)
  }
  if (body.amount === 0) {
    return c.json({ error: '金额不能为零' }, 400)
  }

  const existing = await c.env.DB.prepare(
    'SELECT status, response_payload FROM client_mutations WHERE ledger_id = ? AND user_id = ? AND id = ?'
  ).bind(ledgerId, userId, body.clientMutationId).first<{ status: string; response_payload: string | null }>()

  if (existing && existing.status === 'completed') {
    return c.json(JSON.parse(existing.response_payload ?? '{}'))
  }

  const transactionUserId = body.userId ?? userId
  const now = Date.now()
  const responsePayload = { id: body.id, version: 1 }

  await c.env.DB.batch([
    c.env.DB.prepare(
      'INSERT INTO transactions (id, ledger_id, user_id, amount, note, date, created_at, updated_at, created_by, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)'
    ).bind(body.id, ledgerId, transactionUserId, body.amount, body.note, body.date, now, now, userId),
    c.env.DB.prepare(
      'INSERT INTO ledger_events (ledger_id, type, entity_type, entity_id, actor_user_id, client_mutation_id, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(ledgerId, 'transaction_added', 'transaction', body.id, userId, body.clientMutationId, buildTransactionPayloadFromFields(body.id, ledgerId, transactionUserId, body.amount, body.note, body.date, now, now, null, userId, null, null, 1), now),
    c.env.DB.prepare(
      'INSERT INTO client_mutations (id, ledger_id, user_id, operation_type, entity_type, entity_id, status, response_payload, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(body.clientMutationId, ledgerId, userId, 'create_transaction', 'transaction', body.id, 'completed', JSON.stringify(responsePayload), now + 30 * 24 * 60 * 60 * 1000, now),
  ])

  c.executionCtx.waitUntil(
    broadcast(c, ledgerId, {
      type: 'transaction_added',
      ledgerId,
      eventId: 0,
      entityId: body.id,
      actorUserId: userId,
      clientMutationId: body.clientMutationId,
      occurredAt: now,
      payload: { transaction: { id: body.id, ledgerId, userId: transactionUserId, amount: body.amount, note: body.note, date: body.date, createdAt: now, updatedAt: now, deletedAt: null, createdBy: userId, updatedBy: null, deletedBy: null, version: 1 } },
    })
  )

  return c.json(responsePayload, 201)
})

transactions.put('/:tid', async (c) => {
  const userId = c.get('userId')
  const ledgerId = c.req.param('id')!
  const transactionId = c.req.param('tid')!
  const body = await c.req.json<{
    clientMutationId: string
    version: number
    amount?: number
    note?: string
    date?: string
    createdAt?: number
  }>()

  try {
    await requireLedgerNotDeleted(c.env.DB, ledgerId)
    await requireMember(c.env.DB, ledgerId, userId)
  } catch (e) {
    const msg = (e as Error).message
    if (msg === 'LEDGER_NOT_FOUND') return c.json({ error: '账本不存在' }, 404)
    if (msg === 'NOT_MEMBER') return c.json({ error: '无权访问' }, 403)
    throw e
  }

  if (!body.clientMutationId || body.version === undefined) {
    return c.json({ error: '缺少 clientMutationId 或 version' }, 400)
  }

  const existing = await c.env.DB.prepare(
    'SELECT status, response_payload FROM client_mutations WHERE ledger_id = ? AND user_id = ? AND id = ?'
  ).bind(ledgerId, userId, body.clientMutationId).first<{ status: string; response_payload: string | null }>()
  if (existing && existing.status === 'completed') {
    return c.json(JSON.parse(existing.response_payload ?? '{}'))
  }

  const tx = await c.env.DB.prepare('SELECT * FROM transactions WHERE id = ? AND ledger_id = ?').bind(transactionId, ledgerId).first<Record<string, unknown>>()
  if (!tx) return c.json({ error: '交易不存在' }, 404)
  if (tx.deleted_at) return c.json({ error: '交易已删除', code: 'VERSION_CONFLICT', latest: tx }, 409)

  if (tx.created_by !== userId) {
    const membership = await c.env.DB.prepare('SELECT role FROM ledger_members WHERE ledger_id = ? AND user_id = ? AND removed_at IS NULL').bind(ledgerId, userId).first<{ role: string }>()
    if (!membership || membership.role !== 'owner') {
      return c.json({ error: '只能编辑自己的交易' }, 403)
    }
  }

  if (tx.version !== body.version) {
    return c.json({ error: '该交易已被其他成员修改', code: 'VERSION_CONFLICT', latest: tx }, 409)
  }

  const now = Date.now()
  const newVersion = (tx.version as number) + 1
  const newAmount = body.amount ?? tx.amount
  const newNote = body.note ?? tx.note
  const newCreatedAt = body.createdAt ?? tx.created_at
  const newDate = body.date ?? (body.createdAt ? `${new Date(body.createdAt).getFullYear()}-${String(new Date(body.createdAt).getMonth() + 1).padStart(2, '0')}-${String(new Date(body.createdAt).getDate()).padStart(2, '0')}` : tx.date)

  const responsePayload = { id: transactionId, version: newVersion }

  await c.env.DB.batch([
    c.env.DB.prepare(
      'UPDATE transactions SET amount = ?, note = ?, date = ?, created_at = ?, updated_at = ?, updated_by = ?, version = ? WHERE id = ?'
    ).bind(newAmount, newNote, newDate, newCreatedAt, now, userId, newVersion, transactionId),
    c.env.DB.prepare(
      'INSERT INTO ledger_events (ledger_id, type, entity_type, entity_id, actor_user_id, client_mutation_id, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(ledgerId, 'transaction_updated', 'transaction', transactionId, userId, body.clientMutationId, buildTransactionPayloadFromFields(transactionId, ledgerId, tx.user_id as string, newAmount as number, newNote as string, newDate as string, newCreatedAt as number, now, null, tx.created_by as string, userId, null, newVersion), now),
    c.env.DB.prepare(
      'INSERT INTO client_mutations (id, ledger_id, user_id, operation_type, entity_type, entity_id, status, response_payload, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(body.clientMutationId, ledgerId, userId, 'update_transaction', 'transaction', transactionId, 'completed', JSON.stringify(responsePayload), now + 30 * 24 * 60 * 60 * 1000, now),
  ])

  c.executionCtx.waitUntil(
    broadcast(c, ledgerId, {
      type: 'transaction_updated',
      ledgerId,
      eventId: 0,
      entityId: transactionId,
      actorUserId: userId,
      clientMutationId: body.clientMutationId,
      occurredAt: now,
      payload: { transaction: { id: transactionId, ledgerId, userId: tx.user_id as string, amount: newAmount as number, note: newNote as string, date: newDate as string, createdAt: newCreatedAt as number, updatedAt: now, deletedAt: null, createdBy: tx.created_by as string, updatedBy: userId, deletedBy: null, version: newVersion } },
    })
  )

  return c.json(responsePayload)
})

transactions.delete('/:tid', async (c) => {
  const userId = c.get('userId')
  const ledgerId = c.req.param('id')!
  const transactionId = c.req.param('tid')!
  const clientMutationId = c.req.query('clientMutationId')

  try {
    await requireLedgerNotDeleted(c.env.DB, ledgerId)
    await requireMember(c.env.DB, ledgerId, userId)
  } catch (e) {
    const msg = (e as Error).message
    if (msg === 'LEDGER_NOT_FOUND') return c.json({ error: '账本不存在' }, 404)
    if (msg === 'NOT_MEMBER') return c.json({ error: '无权访问' }, 403)
    throw e
  }

  const tx = await c.env.DB.prepare('SELECT * FROM transactions WHERE id = ? AND ledger_id = ? AND deleted_at IS NULL').bind(transactionId, ledgerId).first<Record<string, unknown>>()
  if (!tx) {
    return c.json({ ok: true })
  }

  if (tx.created_by !== userId) {
    const membership = await c.env.DB.prepare('SELECT role FROM ledger_members WHERE ledger_id = ? AND user_id = ? AND removed_at IS NULL').bind(ledgerId, userId).first<{ role: string }>()
    if (!membership || membership.role !== 'owner') {
      return c.json({ error: '只能删除自己的交易' }, 403)
    }
  }

  if (clientMutationId) {
    const existing = await c.env.DB.prepare(
      'SELECT status FROM client_mutations WHERE ledger_id = ? AND user_id = ? AND id = ?'
    ).bind(ledgerId, userId, clientMutationId).first<{ status: string }>()
    if (existing && existing.status === 'completed') {
      return c.json({ ok: true })
    }
  }

  const now = Date.now()
  const newVersion = (tx.version as number) + 1
  const mutationId = clientMutationId ?? crypto.randomUUID()

  const batchStmts = [
    c.env.DB.prepare('UPDATE transactions SET deleted_at = ?, deleted_by = ?, updated_at = ?, version = ? WHERE id = ?')
      .bind(now, userId, now, newVersion, transactionId),
    c.env.DB.prepare(
      'INSERT INTO ledger_events (ledger_id, type, entity_type, entity_id, actor_user_id, client_mutation_id, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(ledgerId, 'transaction_deleted', 'transaction', transactionId, userId, mutationId, JSON.stringify({ transactionId, deletedAt: now, version: newVersion }), now),
  ]

  if (clientMutationId) {
    batchStmts.push(
      c.env.DB.prepare(
        'INSERT INTO client_mutations (id, ledger_id, user_id, operation_type, entity_type, entity_id, status, response_payload, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(clientMutationId, ledgerId, userId, 'delete_transaction', 'transaction', transactionId, 'completed', JSON.stringify({ ok: true }), now + 30 * 24 * 60 * 60 * 1000, now)
    )
  }

  await c.env.DB.batch(batchStmts)

  c.executionCtx.waitUntil(
    broadcast(c, ledgerId, {
      type: 'transaction_deleted',
      ledgerId,
      eventId: 0,
      entityId: transactionId,
      actorUserId: userId,
      clientMutationId: mutationId,
      occurredAt: now,
      payload: { transactionId, deletedAt: now, version: newVersion },
    })
  )

  return c.json({ ok: true })
})

export default transactions

import type { D1Database } from '@cloudflare/workers-types'

export async function getLedgerMembership(db: D1Database, ledgerId: string, userId: string) {
  return db.prepare(
    'SELECT role, removed_at FROM ledger_members WHERE ledger_id = ? AND user_id = ?'
  ).bind(ledgerId, userId).first<{ role: string; removed_at: number | null }>()
}

export async function requireMember(db: D1Database, ledgerId: string, userId: string) {
  const membership = await getLedgerMembership(db, ledgerId, userId)
  if (!membership || membership.removed_at) {
    throw new Error('NOT_MEMBER')
  }
  return membership
}

export async function requireOwner(db: D1Database, ledgerId: string, userId: string) {
  const membership = await requireMember(db, ledgerId, userId)
  if (membership.role !== 'owner') {
    throw new Error('NOT_OWNER')
  }
  return membership
}

export async function requireLedgerNotDeleted(db: D1Database, ledgerId: string) {
  const ledger = await db.prepare('SELECT deleted_at FROM ledgers WHERE id = ?').bind(ledgerId).first<{ deleted_at: number | null }>()
  if (!ledger || ledger.deleted_at) {
    throw new Error('LEDGER_NOT_FOUND')
  }
  return ledger
}

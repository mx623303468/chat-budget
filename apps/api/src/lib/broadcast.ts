import type { DurableObjectNamespace } from '@cloudflare/workers-types'

type LedgerEventMessage = {
  type: string
  ledgerId: string
  eventId: number
  entityId: string
  actorUserId: string
  clientMutationId?: string
  occurredAt: number
  payload: unknown
}

export async function broadcastToLedger(
  syncDO: DurableObjectNamespace,
  ledgerId: string,
  event: LedgerEventMessage,
  excludeUserId?: string
) {
  try {
    const id = syncDO.idFromName(ledgerId)
    const stub = syncDO.get(id)

    await stub.fetch(new Request('http://internal/broadcast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event, excludeUserId }),
    }))
  } catch {
    // broadcast failure does not affect data consistency; clients can recover via GET /events
  }
}

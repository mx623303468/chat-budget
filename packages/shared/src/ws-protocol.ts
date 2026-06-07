// 客户端 → 服务器
export type ClientMessage =
  | { type: 'ping' }
  | { type: 'subscribe'; ledgerId: string }
  | { type: 'unsubscribe' }

// 服务器 → 客户端
export type ServerMessage = ControlMessage | LedgerEventMessage

export type ControlMessage =
  | {
      type: 'connected'
      ledgerId: string
      lastEventId: number
      onlineMembers: Array<{ userId: string; nickname: string }>
    }
  | { type: 'pong'; ts: number }
  | { type: 'error'; code: string; message: string }

export type LedgerEventMessage = {
  type:
    | 'transaction_added'
    | 'transaction_updated'
    | 'transaction_deleted'
    | 'settings_updated'
    | 'member_joined'
    | 'member_left'
    | 'ledger_deleted'
  ledgerId: string
  eventId: number
  entityId: string
  actorUserId: string
  clientMutationId?: string
  occurredAt: number
  payload: LedgerEventPayload
}

export type LedgerEventPayload =
  | { transaction: TransactionDTO }
  | { transactionId: string; deletedAt: number; version: number }
  | { settings: LedgerSettingsDTO }
  | { member: LedgerMemberDTO }
  | { ledgerId: string; deletedAt: number }

// 用于事件 payload 的 DTO（不含内部字段）
export type TransactionDTO = {
  id: string
  ledgerId: string
  userId: string
  amount: number
  note: string
  date: string
  createdAt: number
  updatedAt: number
  deletedAt: number | null
  createdBy: string
  updatedBy: string | null
  deletedBy: string | null
  version: number
}

export type LedgerSettingsDTO = {
  name: string
  dailyLimit: number
  startDate: string
}

export type LedgerMemberDTO = {
  userId: string
  nickname: string
  role: 'owner' | 'member'
  joinedAt: number
}

import type { DurableObject, DurableObjectState } from '@cloudflare/workers-types'

type Env = {
  DB: D1Database
  JWT_SECRET: string
  REFRESH_SECRET: string
  ENVIRONMENT: string
}

type ClientInfo = {
  userId: string
  nickname: string
  websocket: WebSocket
  subscribed: boolean
}

export class SyncDO implements DurableObject {
  private state: DurableObjectState
  private env: Env
  private clients: Map<string, ClientInfo> = new Map()

  constructor(state: DurableObjectState, env: Env) {
    this.state = state
    this.env = env
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/broadcast' && request.method === 'POST') {
      try {
        const body = await request.json() as { event: any; excludeUserId?: string }
        this.broadcastEvent(body.event, body.excludeUserId)
        return Response.json({ ok: true })
      } catch {
        return new Response('Invalid broadcast request', { status: 400 })
      }
    }

    const userId = url.searchParams.get('userId') || ''
    const nickname = url.searchParams.get('nickname') || ''

    if (!userId) {
      return new Response('Missing userId', { status: 400 })
    }

    const upgradeHeader = request.headers.get('Upgrade')
    if (upgradeHeader !== 'websocket') {
      return new Response('Expected WebSocket', { status: 400 })
    }

    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair)

    this.clients.set(userId, {
      userId,
      nickname,
      websocket: server,
      subscribed: false,
    })

    server.accept()

    server.addEventListener('message', (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data as string)
        this.handleMessage(userId, msg)
      } catch {
        // ignore invalid messages
      }
    })

    server.addEventListener('close', () => {
      this.clients.delete(userId)
    })

    server.addEventListener('error', () => {
      this.clients.delete(userId)
    })

    return new Response(null, {
      status: 101,
      webSocket: client,
    })
  }

  private handleMessage(userId: string, msg: any) {
    const client = this.clients.get(userId)
    if (!client) return

    switch (msg.type) {
      case 'ping':
        client.websocket.send(JSON.stringify({ type: 'pong', ts: Date.now() }))
        break

      case 'subscribe': {
        client.subscribed = true
        const onlineMembers = this.getOnlineMembers()
        client.websocket.send(JSON.stringify({
          type: 'connected',
          ledgerId: msg.ledgerId,
          lastEventId: 0,
          onlineMembers,
        }))
        break
      }

      case 'unsubscribe':
        client.subscribed = false
        break
    }
  }

  private getOnlineMembers(): Array<{ userId: string; nickname: string }> {
    return Array.from(this.clients.values())
      .filter(c => c.subscribed)
      .map(c => ({ userId: c.userId, nickname: c.nickname }))
  }

  broadcastEvent(event: {
    type: string
    ledgerId: string
    eventId: number
    entityId: string
    actorUserId: string
    clientMutationId?: string
    occurredAt: number
    payload: unknown
  }, excludeUserId?: string) {
    const message = JSON.stringify(event)

    for (const client of this.clients.values()) {
      if (!client.subscribed) continue
      if (client.userId === excludeUserId) continue

      try {
        client.websocket.send(message)
      } catch {
        this.clients.delete(client.userId)
      }
    }
  }
}

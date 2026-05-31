import { Hono } from 'hono'
import type { Env } from './env'

const app = new Hono<{ Bindings: Env }>()

app.get('/api/health', (c) => {
  return c.json({ status: 'ok', timestamp: Date.now() })
})

export default app

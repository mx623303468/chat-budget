import { Hono } from 'hono'
import type { Env } from './env'
import auth from './routes/auth'

const app = new Hono<{ Bindings: Env; Variables: { userId: string } }>()

app.get('/api/health', (c) => {
  return c.json({ status: 'ok', timestamp: Date.now() })
})

app.route('/api/auth', auth)

export default app

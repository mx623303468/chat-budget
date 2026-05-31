import { Hono } from 'hono'
import type { Env } from './env'
import auth from './routes/auth'
import ledgers from './routes/ledgers'
import members from './routes/members'
import invites from './routes/invites'

const app = new Hono<{ Bindings: Env; Variables: { userId: string } }>()

app.get('/api/health', (c) => {
  return c.json({ status: 'ok', timestamp: Date.now() })
})

app.route('/api/auth', auth)
app.route('/api/ledgers', ledgers)
app.route('/api/ledgers/:id/members', members)
app.route('/api', invites)

export default app

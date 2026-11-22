import { Hono } from 'hono'

import { aiConfigured } from './ai'
import { authMode, getAuth, requireUser } from './auth'
import { requireDb } from './db'
import type { AppContext, Env } from './env'
import { handoff } from './handoff'
import { account } from './routes/account'
import { chat } from './routes/chat'
import { conversations } from './routes/conversations'

const app = new Hono<AppContext>()

app.get('/api/auth/status', (c) => {
  c.header('Cache-Control', 'private, no-store')
  return c.json({ mode: authMode(c.env, c.req.raw), database: Boolean(c.env.DB), ai: aiConfigured(c.env) })
})
app.get('/api/health', (c) => c.json({ ok: true }))

// Signing in always finishes on this origin. These routes start it, hand the
// finished session to a frontend on another host, and end it again.
app.route('/', handoff)

const api = new Hono<AppContext>()
api.use('*', requireUser, requireDb)
api.route('/', account)
api.route('/conversations', conversations)
api.route('/chat', chat)
app.route('/api', api)

app.onError((error, c) => {
  console.error(error)
  return c.json({ error: 'Something went wrong.' }, 500)
})
app.notFound((c) => (c.req.path.startsWith('/api/') ? c.json({ error: 'Not found.' }, 404) : c.env.ASSETS.fetch(c.req.raw)))

/** The one browser path every API call uses; see `src/app/lib/api.ts`. */
const GATEWAY = '/api/gateway'

/**
 * `/api/gateway?p=/api/...` lets one frontend call the API whether this Worker
 * serves it or a proxy in front of it does. Here the gateway is an internal
 * rewrite; the proxy (api/gateway.ts) forwards the same path to this Worker.
 * Only paths on this origin under `/api/` are accepted, never another host.
 */
function gateway(request: Request): Request | Response {
  const url = new URL(request.url)
  if (url.pathname !== GATEWAY) return request
  const target = url.searchParams.get('p')
  let inner: URL | null = null
  try {
    inner = target ? new URL(target, url.origin) : null
  } catch {
    inner = null
  }
  if (!inner || inner.origin !== url.origin || !inner.pathname.startsWith('/api/') || inner.pathname === GATEWAY) {
    return new Response(JSON.stringify({ error: 'Bad gateway request.' }), {
      status: 400,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store' },
    })
  }
  return new Request(inner, request)
}

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const routed = gateway(request)
    if (routed instanceof Response) return Promise.resolve(routed)
    // Sign in with Freebuff owns /auth/freebuff/* and keeps sessions fresh.
    // Without a client ID the app falls back to the loopback development user.
    const auth = getAuth(env)
    const handler = (req: Request) => Promise.resolve(app.fetch(req, env, ctx))
    return auth ? auth.wrap(handler)(routed) : handler(routed)
  },
}

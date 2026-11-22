import { AUTH_ROUTE_PREFIX, isSameOriginRequest } from '@freebuff/auth'
import { Hono } from 'hono'

import { appOrigin, clientOrigins, getAuth } from './auth'
import { ensureSchema, now } from './db'
import type { AppContext, Env } from './env'

/**
 * The app can be served by the Worker itself or by a frontend host (Vercel)
 * that keeps its own first-party session. Sign in with Freebuff must always
 * finish on the canonical origin: the OIDC callback is registered there and
 * the transaction cookie is host-only. So the finished session is handed to
 * the app host as a single-use code, and redeemed there for a cookie.
 */

/** How long a handoff code stays redeemable, and how it looks. */
const CODE_TTL_MS = 120_000
const CODE_PATTERN = /^[A-Za-z0-9_-]{43}$/
/** The SDK's session cookie: `v1~access~refresh`. Never any other shape. */
const SESSION_PATTERN = /^v1~[A-Za-z0-9._-]+~fbrt_[A-Za-z0-9_-]+$/
const SESSION_NAMES = ['__Host-freebuff_session', 'freebuff_session']

/** The browser-facing app origin, when it is not this Worker. */
export function appHost(env: Env): string | null {
  const value = (env.HANDOFF_ORIGIN ?? '').trim().replace(/\/+$/, '')
  return /^https:\/\/[^/]+$/.test(value) ? value : null
}

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function codeHash(code: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** The session cookie this request carries, if it is one this app set. */
function carriedSession(request: Request): string | null {
  const header = request.headers.get('cookie')
  if (!header) return null
  const found = header
    .split(';')
    .map((part) => part.trim())
    .filter((part) => SESSION_NAMES.some((name) => part.startsWith(`${name}=`)))
  if (found.length !== 1) return null
  const pair = found[0] as string
  const value = pair.slice(pair.indexOf('=') + 1)
  return SESSION_PATTERN.test(value) ? value : null
}

/** The session value the SDK just issued, when it rotated the tokens. */
function issuedSession(cookies: readonly string[]): string | null {
  for (const cookie of cookies) {
    const pair = cookie.split(';')[0] ?? ''
    const name = pair.slice(0, pair.indexOf('='))
    const value = pair.slice(pair.indexOf('=') + 1)
    if (SESSION_NAMES.includes(name) && SESSION_PATTERN.test(value)) return value
  }
  return null
}

export const handoff = new Hono<AppContext>()

/** Start sign-in on the canonical origin, whatever host the app is on. */
handoff.get('/auth/handoff/begin', (c) => {
  if (!getAuth(c.env)) return c.redirect('/', 303)
  return c.redirect(`${AUTH_ROUTE_PREFIX}/signin?returnTo=${encodeURIComponent('/auth/handoff/mint')}`, 303)
})

/**
 * Reached right after the OIDC callback has set this origin's session cookie.
 * Mints a one-time code and sends the browser back to the app host.
 */
handoff.get('/auth/handoff/mint', async (c) => {
  const host = appHost(c.env)
  // No separate frontend host: the app runs here, so there is nothing to hand off.
  if (!host) return c.redirect('/', 303)
  const failed = c.redirect(`${host}/signin?error=signin_incomplete`, 303)
  const auth = getAuth(c.env)
  const db = c.env.DB
  if (!auth || !db) return failed
  const { user, cookies } = await auth.authenticate(c.req.raw)
  const session = issuedSession(cookies) ?? carriedSession(c.req.raw)
  if (!user || !session) return failed
  await ensureSchema(db)
  const at = now()
  const code = base64url(crypto.getRandomValues(new Uint8Array(32)))
  await db.batch([
    // Nothing expired may be redeemed, and nothing accumulates.
    db.prepare('DELETE FROM handoff_codes WHERE expires_at <= ?').bind(at),
    db.prepare('INSERT INTO handoff_codes (code_hash, session, expires_at, created_at) VALUES (?, ?, ?, ?)').bind(await codeHash(code), session, at + CODE_TTL_MS, at),
  ])
  c.header('Cache-Control', 'private, no-store')
  return c.redirect(`${host}/api/handoff?code=${code}`, 303)
})

/**
 * Server-to-server, from the app host's function: redeem a code for the session
 * value. Only the code's hash is stored, and redeeming deletes the row.
 */
handoff.post('/auth/handoff/exchange', async (c) => {
  c.header('Cache-Control', 'no-store')
  const db = c.env.DB
  if (!db) return c.json({ error: 'database_missing' }, 503)
  // These routes are not under /api, so the schema is not guaranteed yet.
  await ensureSchema(db)
  const body = (await c.req.json().catch(() => null)) as { code?: unknown } | null
  const code = typeof body?.code === 'string' ? body.code : ''
  if (!CODE_PATTERN.test(code)) return c.json({ error: 'invalid_code' }, 400)
  const row = await db
    .prepare('DELETE FROM handoff_codes WHERE code_hash = ? AND expires_at > ? RETURNING session')
    .bind(await codeHash(code), now())
    .first<{ session: string }>()
  if (!row?.session) return c.json({ error: 'invalid_code' }, 400)
  return c.json({ session: row.session })
})

/**
 * Sign out, from this origin or from a trusted app host. Only a trusted origin
 * may submit it, and the refresh token is revoked, not just forgotten.
 */
handoff.post('/api/signout', async (c) => {
  const origins = clientOrigins(c.env, c.req.raw)
  if (!origins.some((origin) => isSameOriginRequest(c.req.raw, origin))) {
    return c.json({ error: 'Cross-origin request refused.' }, 403)
  }
  const auth = getAuth(c.env)
  const origin = appOrigin(c.env, c.req.raw)
  if (auth && origin) {
    // The SDK only signs out on its own origin. This request has already passed
    // the same check just above, so it may stand in for that origin.
    const delegated = await auth.handle(
      new Request(`${origin}${AUTH_ROUTE_PREFIX}/signout`, {
        method: 'POST',
        headers: {
          origin,
          cookie: c.req.raw.headers.get('cookie') ?? '',
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: 'returnTo=/',
      }),
    )
    if (delegated) return delegated
  }
  return c.redirect('/', 303)
})

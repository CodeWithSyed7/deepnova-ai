import { AUTH_ORIGIN } from './_shared'

/**
 * The app's API behind https://deepnova-web.vercel.app.
 *
 * The session is a host-only cookie, so the browser sends it to this host and
 * nowhere else. This function relays the call — cookie included — to the
 * Worker, which owns auth, D1 and the model call, and streams the answer back
 * untouched so replies still arrive token by token.
 *
 * It is a forwarder, nothing more: no session state, no secrets, and no change
 * to who the caller is. Only paths on the Worker under `/api/` are proxied, so
 * it cannot be pointed at another host.
 */
export const maxDuration = 60

const GATEWAY = '/api/gateway'

/** Headers that belong to one connection and must not be relayed. */
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
])

function target(request: Request): URL | null {
  const url = new URL(request.url)
  const p = url.searchParams.get('p') ?? ''
  let inner: URL
  try {
    inner = new URL(p, AUTH_ORIGIN)
  } catch {
    return null
  }
  if (inner.origin !== AUTH_ORIGIN || !inner.pathname.startsWith('/api/') || inner.pathname === GATEWAY) return null
  return inner
}

function requestHeaders(request: Request): Headers {
  const headers = new Headers()
  for (const [name, value] of request.headers) {
    const key = name.toLowerCase()
    // The proxy's own addressing headers are not the Worker's business.
    if (HOP_BY_HOP.has(key) || key === 'host' || key === 'content-length' || key.startsWith('x-forwarded-') || key.startsWith('x-vercel-') || key === 'x-real-ip') continue
    headers.set(key, value)
  }
  // Asking for no compression is what keeps an event stream unbuffered.
  headers.set('accept-encoding', 'identity')
  return headers
}

async function forward(request: Request): Promise<Response> {
  const url = target(request)
  if (!url) {
    return new Response(JSON.stringify({ error: 'Bad gateway request.' }), {
      status: 400,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store' },
    })
  }
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD'
  let upstream: Response
  try {
    upstream = await fetch(url, {
      method: request.method,
      headers: requestHeaders(request),
      body: hasBody ? request.body : undefined,
      // Node needs this to stream a request body upstream.
      ...(hasBody ? { duplex: 'half' } : {}),
      redirect: 'manual',
      // A visitor who stops a reply or closes the tab ends the Worker's work too.
      signal: request.signal,
    } as RequestInit)
  } catch {
    return new Response(JSON.stringify({ error: 'The backend did not answer.' }), {
      status: 502,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store' },
    })
  }
  const headers = new Headers()
  for (const [name, value] of upstream.headers) {
    const key = name.toLowerCase()
    // The body is relayed as a stream, so a length or encoding from upstream no
    // longer describes it.
    if (HOP_BY_HOP.has(key) || key === 'content-length' || key === 'content-encoding') continue
    if (key === 'set-cookie') continue
    headers.set(key, value)
  }
  // A refreshed session cookie must reach the browser as its own header.
  const setCookies = upstream.headers.getSetCookie?.() ?? []
  for (const cookie of setCookies) headers.append('set-cookie', cookie)
  return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers })
}

export const GET = forward
export const HEAD = forward
export const POST = forward
export const PUT = forward
export const PATCH = forward
export const DELETE = forward

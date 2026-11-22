/**
 * Landing point after the canonical origin has signed the visitor in.
 *
 * The code is single use, expires after two minutes and is redeemed
 * server-to-server, so the browser only ever receives this host's own session
 * cookie — never a token in a URL or in page script.
 *
 * Self-contained: Vercel runs `api/*.ts` as ES modules, where a relative import
 * without a file extension does not resolve.
 */

/** The canonical Worker origin. Set AUTH_ORIGIN in Vercel if it ever moves. */
const AUTH_ORIGIN = (process.env.AUTH_ORIGIN ?? 'https://ai-chat-6gfzjw-preview.freebuff.site').replace(/\/+$/, '')

/** The SDK's session cookie: `v1~access~refresh`, and nothing else. */
const SESSION_COOKIE = '__Host-freebuff_session'
const SESSION_PATTERN = /^v1~[A-Za-z0-9._-]+~fbrt_[A-Za-z0-9_-]+$/

function redirect(location: string, cookies: string[] = []): Response {
  const headers = new Headers({ location, 'cache-control': 'private, no-store' })
  for (const cookie of cookies) headers.append('set-cookie', cookie)
  return new Response(null, { status: 303, headers })
}

/** This deployment's own origin, from the proxy's host header. */
function ownOrigin(request: Request): string {
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? ''
  return /^[A-Za-z0-9.:-]+$/.test(host) ? `https://${host}` : ''
}

export async function GET(request: Request): Promise<Response> {
  const code = new URL(request.url).searchParams.get('code') ?? ''
  const failed = () => redirect(`${ownOrigin(request)}/signin?error=handoff_failed`)
  if (!/^[A-Za-z0-9_-]{43}$/.test(code)) return failed()
  let session = ''
  try {
    const response = await fetch(`${AUTH_ORIGIN}/auth/handoff/exchange`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ code }),
      signal: AbortSignal.timeout(8000),
    })
    const body = (await response.json().catch(() => null)) as { session?: unknown } | null
    if (response.ok && typeof body?.session === 'string') session = body.session
  } catch {
    // Treated as a failed handoff below; the visitor can sign in again.
  }
  if (!SESSION_PATTERN.test(session)) return failed()
  // HttpOnly, so page script never sees a token.
  return redirect('/', [`${SESSION_COOKIE}=${session}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=${30 * 86_400}`])
}

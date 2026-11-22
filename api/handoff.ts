import { AUTH_ORIGIN, ownOrigin, redirect, sessionCookie, SESSION_PATTERN } from './_shared'

/**
 * Landing point after the canonical origin has signed the visitor in.
 *
 * The code is single use, expires after two minutes and is redeemed
 * server-to-server, so the browser only ever receives this host's own session
 * cookie — never a token in a URL or in page script.
 */
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
  return redirect('/', [sessionCookie(session)])
}

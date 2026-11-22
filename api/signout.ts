import { AUTH_ORIGIN, closedSessionCookie, ownOrigin, redirect } from './_shared'

/**
 * Sign out. Only this site may submit it (the form is same-origin here, and
 * cookies ride along on cross-site form posts). The Worker revokes the refresh
 * token, then this host's cookie is closed.
 */
export async function POST(request: Request): Promise<Response> {
  const origin = request.headers.get('origin')
  if (!origin || origin !== ownOrigin(request)) {
    return new Response('Sign-out must be submitted from this site.', {
      status: 403,
      headers: { 'cache-control': 'private, no-store' },
    })
  }
  try {
    await fetch(`${AUTH_ORIGIN}/api/signout`, {
      method: 'POST',
      headers: {
        // The Worker only signs out its own origin; this request is the trusted
        // proxy for it, and the browser's origin was checked just above.
        origin: AUTH_ORIGIN,
        cookie: request.headers.get('cookie') ?? '',
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: 'returnTo=/',
      redirect: 'manual',
      signal: AbortSignal.timeout(8000),
    })
  } catch {
    // The local session still ends; the revoked token expires on its own.
  }
  return redirect('/', [closedSessionCookie])
}

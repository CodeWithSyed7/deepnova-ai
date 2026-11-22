/**
 * Sign out. Only this site may submit it (the form is same-origin here, and
 * cookies ride along on cross-site form posts). The Worker revokes the refresh
 * token, then this host's cookie is closed.
 *
 * Self-contained: Vercel runs `api/*.ts` as ES modules, where a relative import
 * without a file extension does not resolve.
 */

/** The canonical Worker origin. Set AUTH_ORIGIN in Vercel if it ever moves. */
const AUTH_ORIGIN = (process.env.AUTH_ORIGIN ?? 'https://ai-chat-6gfzjw-preview.freebuff.site').replace(/\/+$/, '')

const SESSION_COOKIE = '__Host-freebuff_session'

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
  return redirect('/', [`${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0`])
}

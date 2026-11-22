// Shared by the Vercel functions that put the Worker's API and sign-in behind
// https://deepnova-web.vercel.app. Nothing secret lives here: they only relay
// one browser's own request to the canonical Worker, which owns auth and D1.

/** The canonical Worker origin. Override with AUTH_ORIGIN if it ever moves. */
export const AUTH_ORIGIN = (process.env.AUTH_ORIGIN ?? 'https://ai-chat-6gfzjw-preview.freebuff.site').replace(/\/+$/, '')

/** The SDK's session cookie, set on this host by api/handoff.ts. */
export const SESSION_COOKIE = '__Host-freebuff_session'
/** `v1~access~refresh`, exactly as the SDK issues it. Never anything else. */
export const SESSION_PATTERN = /^v1~[A-Za-z0-9._-]+~fbrt_[A-Za-z0-9_-]+$/
const SESSION_MAX_AGE = 30 * 86_400

export const sessionCookie = (value: string) =>
  `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=${SESSION_MAX_AGE}`

export const closedSessionCookie = `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0`

export function redirect(location: string, cookies: string[] = []): Response {
  const headers = new Headers({ location, 'cache-control': 'private, no-store' })
  for (const cookie of cookies) headers.append('set-cookie', cookie)
  return new Response(null, { status: 303, headers })
}

/** This deployment's own origin, from the proxy's host header. */
export function ownOrigin(request: Request): string {
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? ''
  return /^[A-Za-z0-9.:-]+$/.test(host) ? `https://${host}` : ''
}

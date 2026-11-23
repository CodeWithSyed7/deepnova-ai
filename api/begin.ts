/**
 * Start sign-in on the canonical origin, whatever host this frontend is on.
 *
 * A rewrite points `/auth/handoff/begin` here (see vercel.json) instead of a
 * static redirect entry, so the Worker's origin comes from AUTH_ORIGIN alone
 * and is not also copied into deploy config that would quietly go stale.
 *
 * Self-contained like the other api/ files: Vercel runs them as ES modules,
 * where a relative import without a file extension does not resolve.
 */

/** The canonical Worker origin. Set AUTH_ORIGIN in Vercel if it ever moves. */
const AUTH_ORIGIN = (process.env.AUTH_ORIGIN ?? 'https://ai-chat-6gfzjw-preview.freebuff.site').replace(/\/+$/, '')

export function GET(): Response {
  return new Response(null, {
    status: 303,
    headers: { location: `${AUTH_ORIGIN}/auth/handoff/begin`, 'cache-control': 'private, no-store' },
  })
}

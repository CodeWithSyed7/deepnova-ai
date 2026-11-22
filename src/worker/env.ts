import type { FreebuffUser } from '@freebuff/auth'

export interface Env {
  ASSETS: Fetcher
  // Attached by Freebuff Sites once provisioned (sites_add_storage). Optional so
  // the app can explain what is missing instead of crashing.
  DB?: D1Database
  // The Freebuff API key. Locally from `.env`; on Sites from Sites → Secrets.
  // It is read here and nowhere else, and never leaves the Worker.
  OPENAI_API_KEY?: string
  // Optional override of the API origin; defaults to the Freebuff API.
  OPENAI_BASE_URL?: string
  // Injected on deploy once Sign in with Freebuff is enabled (sites_enable_auth).
  FREEBUFF_CLIENT_ID?: string
  FREEBUFF_ISSUER?: string
  APP_ORIGIN?: string
  // The browser-facing app origin when the frontend is not served by this
  // Worker (for example https://deepnova-web.vercel.app). Sign-in hands the
  // finished session over to it with a one-time code. Unset means the app is
  // served here and no handoff happens.
  HANDOFF_ORIGIN?: string
  // Optional comma-separated list of extra browser origins that may call the
  // API with a session cookie. Unset means only APP_ORIGIN (and
  // HANDOFF_ORIGIN) is accepted.
  CLIENT_ORIGINS?: string
}

export type Variables = {
  user: FreebuffUser
  db: D1Database
}

export type AppContext = { Bindings: Env; Variables: Variables }

# DeepNova AI

A lightweight AI assistant built on Cloudflare Workers, D1 and Sign in with
Freebuff. DeepNova AI keeps the surface calm: a landing composer, streamed
Markdown replies, a model picker, conversation search with keyset paging, and a
daily reply/token budget that keeps a shared deployment from draining the
owner's API credits.

Everything runs on Workers: `hono` serves `/api/*`, the React app is served as
static assets from the same Worker, and chat is streamed to the browser as
server-sent events. The API key stays on the server and never reaches the
browser.

## Features

Working today:

- **Sign in with Freebuff** (OIDC). No passwords, no fake reset flows. The
  provider's own errors are shown with a retry path.
- **Streamed replies** rendered as Markdown (GFM tables and lists, code blocks
  with copy), with a caret while streaming and partial text kept when stopped.
- **Model choice** from a server-side allowlist; the server refuses anything else.
- **Conversations**: create, rename, delete, delete-all, search across titles
  and message bodies, newest-first keyset pagination ("Show older chats").
- **Stop, regenerate, copy.** A reply that was stopped is stored and marked.
- **Usage**: per-user daily replies, per-reply token accounting in
  `reply_usage`, and app-wide daily reply and token ceilings. When the
  app-wide ceiling is reached the composer explains which budget ran out and
  when it resets, and sending is disabled until then.
- **Ambient backdrop**: two CSS-only layers (soft gradients and a faint star
  field). It pauses when the tab is hidden and stops for reduced-motion users.
- **Mobile**: sidebar becomes a drawer; composer and thread are touch sized.

Not implemented yet (planned, not present in this codebase — nothing below is
faked in the UI):

- Multiple third-party providers with per-user API keys and a free-model
  directory.
- Attachments, document extraction, image understanding and image generation.
- Voice input and read-aloud.
- Web research with citations.
- Skills marketplace, OAuth connections, projects and memory.
- Share links for conversations or single replies.

## Stack

| Layer | Choice |
| --- | --- |
| Runtime | Cloudflare Workers (`compatibility_date` 2026-09-29) |
| API | Hono, server-sent events via `hono/streaming` |
| Data | Cloudflare D1 (SQLite), schema created on first request |
| Auth | `@freebuff/auth` (OIDC), loopback-only development user |
| UI | React 19, React Router 8, TanStack Query 5, Tailwind 4, `motion`, `lucide-react` |
| Build | Vite 8 + `@cloudflare/vite-plugin`, Bun as package manager |

## Run it

```sh
bun install
bun run dev        # http://localhost:5173, local D1 via Miniflare
bun run typecheck
bun test
bun run build      # dist/client (assets) + dist/ai_chat/index.js (Worker)
```

On localhost without `FREEBUFF_CLIENT_ID` the app signs you in as a local
development user and seeds one sample conversation. Until an API key is
configured the app shows a setup card; it unlocks by itself when the key
appears.

## Configuration

`src/shared/config.ts` is the single place for product settings: `BRAND`,
`TAGLINE`, `SYSTEM_PROMPT`, `MODELS` (also the server-side spending allowlist),
`DEFAULT_MODEL`, `SUGGESTIONS`, `DAILY_MESSAGE_LIMIT`,
`GLOBAL_DAILY_REPLY_LIMIT`, `GLOBAL_DAILY_TOKEN_LIMIT`, context and length caps.

### The API key

The Worker calls the Freebuff API (OpenAI-compatible) with `OPENAI_API_KEY`
from its environment. It is a live credential that spends the owner's prepaid
credits:

- Never ask for it in chat, print it, log it, commit it, or put it in browser
  code. The app only ever tells the browser whether a key is set.
- Locally it lives in `.env` (see `.env.example`), which Git ignores and
  Wrangler reads. Do not add `.dev.vars`: its presence stops Wrangler reading
  `.env`.
- Create and fund one at <https://freebuff.com/account/api>.
- On Freebuff Sites, set `OPENAI_API_KEY` in Sites → Secrets after the first
  deploy (or upload it with `sites_set_secret` from a file, without reading it).
- Give the key a monthly spend limit named after this app. The key's limits are
  the hard ceiling; the app's limits are the soft one.

`OPENAI_BASE_URL` is optional and defaults to the Freebuff API.

## The Freebuff API

OpenAI-compatible: `POST {base}/chat/completions` with `model`, `messages`,
`max_tokens` and optionally `stream`, authenticated with
`Authorization: Bearer fb_live_…`. `GET {base}/models` lists models with
`capabilities.streaming`; only some stream, and `stream: true` on one that does
not is a 400, so `src/worker/ai.ts` checks first and yields the whole reply at
once when streaming is off. Unknown request fields are rejected; images, audio
and embeddings are not supported.

Errors arrive as `{ "error": { "code", "message" } }`: `401 invalid_api_key`,
`402 insufficient_funds`, `403 key_disabled` / `model_not_allowed`,
`404 model_not_found`, `429 rate_limit` / `spend_limit`, `503` when a model is
unavailable. `ai.ts` maps each to one safe sentence.

## Database

D1 has no migration tool on Freebuff Sites, so `src/worker/db.ts` creates its
tables on the first request of each isolate, and new statements are appended —
existing ones are never edited in place once deployed.

- `users` — one row per signed-in owner.
- `conversations` — id, owner, title, model, timestamps.
- `messages` — owner-scoped, ordered by `created_at`; the assistant row is
  created empty when generation starts (so it counts against the limit while
  streaming) and filled in when the turn ends.
- `reply_usage` — one row per reply: prompt and completion tokens, as the API
  reported them or estimated when it reported none.
- `handoff_codes` — hashed one-time codes (120 s) that hand a finished sign-in
  to a frontend on another host; a row is deleted when it is redeemed.

Every query is scoped by `owner_sub`. There is no cross-user read path.

## Deploying to Freebuff Sites

1. `sites_create`, then `sites_add_storage` for D1 named `DB`.
2. `sites_enable_auth` (pass `http://localhost:5173` as the local origin while
   developing and put the returned development variables in `.env`).
3. `bun run build`, then `sites_deploy` with `deploy.json`.
4. Set `OPENAI_API_KEY` in Sites → Secrets.

Sign in with Freebuff is required on a deployed origin: without it nobody can
chat, because every reply spends the owner's credits. The loopback development
user can never activate off localhost.

## Vercel frontend (`https://deepnova-web.vercel.app`)

The app can be served from the Vercel domain while the Worker keeps the
backend: Hono, D1, the model calls and Sign in with Freebuff all stay on
Cloudflare. The Vercel project builds the same frontend (`npx vite build`) and
runs three small functions under `api/`. No API key or `VITE_*` variable
belongs on Vercel; `AUTH_ORIGIN` is optional (it defaults to the Worker origin).

The one hard constraint is the session. Sign in with Freebuff sets a `__Host-`
cookie and registers its OIDC callback for exactly one origin, so signing in
can only finish on the Worker's origin — a cookie set there is never sent to
`*.vercel.app`, and the provider returns the code to the registered callback.
The app stays signed in on Vercel through a **session handoff**:

1. `GET /auth/handoff/begin` (a redirect in `vercel.json`) opens the Worker's
   `/auth/freebuff/signin` with `returnTo=/auth/handoff/mint`.
2. Sign in with Freebuff completes on the Worker origin, which sets its session
   cookie there.
3. `/auth/handoff/mint` turns that session into a 256-bit single-use code
   (only its SHA-256 is stored, in `handoff_codes`, for 120 seconds) and sends
   the browser to `/api/handoff?code=…` on the Vercel domain.
4. `api/handoff.ts` redeems the code server-to-server at
   `POST /auth/handoff/exchange` and answers with the same session as a
   `__Host-freebuff_session` cookie on the Vercel host — HttpOnly, so page
   script never sees a token.

After that the session is first-party on Vercel and every call goes through
`api/gateway.ts`: the frontend calls one path, `/api/gateway?p=/api/…`, which
the Worker handles as an internal rewrite when it serves the app, and the
Vercel function forwards to the Worker when it does not. The gateway relays the
cookie, streams the reply back untouched (SSE keeps working) and copies a
refreshed session cookie back to the browser. Its target is always the Worker's
origin under `/api/`, so it cannot be pointed elsewhere. The Worker accepts
`HANDOFF_ORIGIN` (set in Sites → Secrets) as an origin for mutations, so
`POST /api/chat`, rename and delete are not refused with
`403 Cross-origin request refused.`.

Signing out posts to `/api/signout`: the Vercel function revokes the refresh
token at the Worker and closes the cookie on the Vercel host.

To deploy: set `HANDOFF_ORIGIN=https://deepnova-web.vercel.app` on the Sites
deployment, keep `vercel.json` and `api/` in the repository, and let Vercel
build. Serving the app on a domain of your own still needs the Worker itself on
that domain (`wrangler deploy` with `APP_ORIGIN` plus a registered
`/auth/freebuff/callback`), which Freebuff Sites' injected `APP_ORIGIN` cannot
do.

`vercel.json` is only read by Vercel. The Cloudflare deploy still uses
`deploy.json` and `dist/`.

## Testing

`bun test` covers the auth boundary (only an unconfigured loopback origin gets
the development user, configured auth uses the canonical origin, private routes
refuse anonymous and foreign-origin requests with `Cache-Control: private,
no-store`), the handoff (single-use codes, expiry, trusted origins) and the
gateway rewrite (only `/api/` paths on this origin). `bun run typecheck` and
`bun run build` must pass before a deploy.

## Security notes

Every `/api/*` route requires a signed-in user and scopes queries by
`owner_sub`; mutations must be same-origin. The Worker refuses models outside
`MODELS`, caps messages at `MAX_MESSAGE_CHARS`, sends at most
`MAX_CONTEXT_MESSAGES` of history and `MAX_OUTPUT_TOKENS` per reply, and allows
`DAILY_MESSAGE_LIMIT` replies per user per UTC day — counting stopped and
regenerated ones, while refused requests are free. All new replies stop once
the app reaches `GLOBAL_DAILY_REPLY_LIMIT` replies or
`GLOBAL_DAILY_TOKEN_LIMIT` tokens that day. Assistant Markdown is rendered
without raw HTML, and links open with `noopener noreferrer nofollow`.
Personalised responses are `Cache-Control: private, no-store`.

## Where things are

- `src/worker/index.ts` — routes, the internal gateway rewrite, error and asset
  fallbacks.
- `src/worker/auth.ts` — Freebuff integration, same-origin guard, dev user.
- `src/worker/handoff.ts` — starts sign-in, mints and redeems the one-time
  handoff code, and signs out.
- `api/` — the three Vercel functions: `gateway.ts` (API proxy), `handoff.ts`
  (redeem a code), `signout.ts`.
- `src/worker/ai.ts` — model capabilities, streaming, error mapping, token
  estimates.
- `src/worker/routes/chat.ts` — one turn: limits, storage, SSE, usage.
- `src/worker/routes/conversations.ts` — search, paging, rename, delete.
- `src/worker/routes/account.ts` — `/me` (capabilities + usage) and `/models`.
- `src/worker/db.ts` — schema, mapping, day usage, reply usage.
- `src/app/pages/Chat.tsx` — landing screen, thread, composer, notices.
- `src/app/lib/turn.ts` — the reply in flight, held outside React so it
  survives the move from `/` to `/c/:id`.
- `src/app/components/` — composer, messages, Markdown, model picker, sidebar,
  ambient backdrop, UI primitives.
- `src/styles.css` — design tokens, ambient animation, reply typography.

## Troubleshooting

- **Setup card instead of chat** — `OPENAI_API_KEY` is not set for the Worker.
- **"Almost there" screen** — the D1 binding named `DB` is missing.
- **401 on every `/api/*` call** — no session; sign in again.
- **403 on a mutation** — the request's `Origin` does not match the app origin.
- **`/signin?error=handoff_failed`** — the one-time code expired (120 s) or was
  already used; sign in again.
- **"This app is resting for today"** — a `GLOBAL_DAILY_*` ceiling was reached;
  the notice says which and when it resets (midnight UTC).
- **Stopped replies show "Stopped"** — expected: partial text is kept.

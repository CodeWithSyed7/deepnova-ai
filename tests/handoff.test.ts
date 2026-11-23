import { expect, test } from 'bun:test'

import worker from '../src/worker/index'
import type { Env } from '../src/worker/env'
import { appHost, handoff } from '../src/worker/handoff'

const ctx = {} as ExecutionContext

test('the handoff target is an https origin or nothing', () => {
  expect(appHost({})).toBeNull()
  expect(appHost({ HANDOFF_ORIGIN: '' })).toBeNull()
  expect(appHost({ HANDOFF_ORIGIN: 'http://app.example.test' })).toBeNull()
  expect(appHost({ HANDOFF_ORIGIN: 'https://app.example.test/path' })).toBeNull()
  expect(appHost({ HANDOFF_ORIGIN: 'https://app.example.test/' })).toBe('https://app.example.test')
})

test('sign-in start goes to the canonical origin and stops without a handoff target', async () => {
  const env = { FREEBUFF_CLIENT_ID: 'test-client', APP_ORIGIN: 'https://app.example.test' } as Env
  const begin = await worker.fetch(new Request('https://app.example.test/auth/handoff/begin'), env, ctx)
  expect(begin.status).toBe(303)
  expect(begin.headers.get('Location')).toBe('/auth/freebuff/signin?returnTo=%2Fauth%2Fhandoff%2Fmint')

  // No frontend host: the app is served here, so minting has nothing to hand off.
  const mint = await worker.fetch(new Request('https://app.example.test/auth/handoff/mint'), env, ctx)
  expect(mint.status).toBe(303)
  expect(mint.headers.get('Location')).toBe('/')

  // A handoff target but no session: back to the app's sign-in, never a code.
  const failed = await worker.fetch(
    new Request('https://app.example.test/auth/handoff/mint'),
    { ...env, HANDOFF_ORIGIN: 'https://web.example.test' } as Env,
    ctx,
  )
  expect(failed.headers.get('Location')).toBe('https://web.example.test/signin?error=signin_incomplete')
})

test('the exchange refuses anything that is not a well-formed code', async () => {
  // The route bootstraps the schema first; a malformed code never reaches a query.
  const db = { prepare: () => ({}), batch: async () => [] } as unknown as D1Database
  const env = { DB: db } as Env
  for (const body of ['{}', '{"code":"short"}', '{"code":42}', 'not json']) {
    const response = await handoff.request('https://app.example.test/auth/handoff/exchange', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    }, env)
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'invalid_code' })
  }
})

test('sign-out is refused from a foreign origin and allowed from a trusted one', async () => {
  const env = { FREEBUFF_CLIENT_ID: 'test-client', APP_ORIGIN: 'https://app.example.test' } as Env
  const foreign = await handoff.request('https://app.example.test/api/signout', {
    method: 'POST',
    headers: { origin: 'https://evil.example' },
  }, env)
  expect(foreign.status).toBe(403)

  const trusted = await handoff.request('https://app.example.test/api/signout', {
    method: 'POST',
    headers: { origin: 'https://web.example.test' },
  }, { ...env, HANDOFF_ORIGIN: 'https://web.example.test' } as Env)
  expect(trusted.status).toBe(303)
})

test('the gateway only rewrites paths on this origin under /api/', async () => {
  const ok = await worker.fetch(new Request('http://localhost:5173/api/gateway?p=%2Fapi%2Fhealth'), {} as Env, ctx)
  expect(ok.status).toBe(200)
  expect(await ok.json()).toEqual({ ok: true })

  for (const target of ['/api/gateway', 'https://evil.example/api/me', '/me', '/api/../auth/freebuff/signin']) {
    const response = await worker.fetch(
      new Request(`http://localhost:5173/api/gateway?p=${encodeURIComponent(target)}`),
      {} as Env,
      ctx,
    )
    expect(response.status).toBe(400)
  }
})

test('the gateway carries a POST body through to the API route', async () => {
  // Chat sends its turn through the gateway, so a POST must reach the route
  // with its body — never fall through to the static handler as a 404.
  const response = await worker.fetch(
    new Request('http://localhost:5173/api/gateway?p=%2Fapi%2Fchat', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:5173' },
      body: JSON.stringify({ content: 'hello' }),
    }),
    {} as Env,
    ctx,
  )
  // No database is attached in this test, so the route explains that itself.
  expect(response.status).toBe(503)
  expect(await response.json()).toEqual({
    error: 'database_missing',
    message: 'No database is attached yet. Add D1 storage named DB and redeploy.',
  })
})

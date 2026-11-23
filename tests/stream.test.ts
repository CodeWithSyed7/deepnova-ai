import { expect, test } from 'bun:test'

import { ApiError, apiUrl } from '../src/app/lib/api'
import { streamChat } from '../src/app/lib/stream'
import type { ChatEvent } from '../src/shared/types'

const realFetch = globalThis.fetch

/** Replaces fetch for one test; call restore() when it is done. */
function stubFetch(handler: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  globalThis.fetch = handler as unknown as typeof fetch
  return () => {
    globalThis.fetch = realFetch
  }
}

test('chat takes the same gateway path as every other call', () => {
  // Posting to `/api/chat` directly only works where the Worker serves the app;
  // on a frontend host that proxies the API it has no route.
  expect(apiUrl('/chat')).toBe('/api/gateway?p=%2Fapi%2Fchat')
})

test('a reply is read from events split across chunks', async () => {
  let request: Request | undefined
  const restore = stubFetch(async (input, init) => {
    request = new Request(new URL(String(input), 'https://app.example.test'), init)
    const encoder = new TextEncoder()
    // Deliberately cut mid-event and mid-JSON, as a network read may.
    const pieces = ['data: {"type":"del', 'ta","text":"Hi"}\n\n', 'data: {"type":"delta","text":" there"}\n\n']
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const piece of pieces) controller.enqueue(encoder.encode(piece))
        controller.close()
      },
    })
    return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
  })

  const events: ChatEvent[] = []
  try {
    await streamChat(
      { conversationId: 'c1', content: 'hello', model: 'deepseek-v4.1-flash' },
      { signal: new AbortController().signal, onEvent: (event) => events.push(event) },
    )
  } finally {
    restore()
  }

  expect(new URL(request!.url).pathname).toBe('/api/gateway')
  expect(new URL(request!.url).searchParams.get('p')).toBe('/api/chat')
  expect(request!.method).toBe('POST')
  expect(await request!.json()).toEqual({ conversationId: 'c1', content: 'hello', model: 'deepseek-v4.1-flash' })
  expect(events).toEqual([
    { type: 'delta', text: 'Hi' },
    { type: 'delta', text: ' there' },
  ])
})

test('a refused turn rejects with the server status, code and message', async () => {
  const restore = stubFetch(async () =>
    new Response(JSON.stringify({ error: 'limit', message: 'You have reached today’s limit of 50 replies.' }), {
      status: 429,
      headers: { 'content-type': 'application/json' },
    }),
  )
  let error: unknown
  try {
    await streamChat({ content: 'hello' }, { signal: new AbortController().signal, onEvent: () => {} })
  } catch (caught) {
    error = caught
  } finally {
    restore()
  }
  expect(error).toBeInstanceOf(ApiError)
  expect((error as ApiError).status).toBe(429)
  expect((error as ApiError).code).toBe('limit')
  expect((error as ApiError).message).toContain('50 replies')
})

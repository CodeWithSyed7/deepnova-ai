// POST /api/chat: one user turn in, one streamed reply out. The reply is a
// server-sent event stream of ChatEvent JSON (shared/types.ts). The browser
// never talks to the Freebuff API; this route does, with the Worker's key.

import { Hono } from 'hono'
import { streamSSE, type SSEStreamingApi } from 'hono/streaming'

import {
  DAILY_MESSAGE_LIMIT,
  DEFAULT_MODEL,
  GLOBAL_DAILY_REPLY_LIMIT,
  GLOBAL_DAILY_TOKEN_LIMIT,
  MAX_CONTEXT_MESSAGES,
  MAX_MESSAGE_CHARS,
  SYSTEM_PROMPT,
  type ModelId,
} from '../../shared/config'
import type { ChatEvent, Me, Message } from '../../shared/types'
import { AiError, aiConfigured, complete, estimatePromptTokens, estimateTokens, isModelId, type ChatMessage, type ReportedUsage } from '../ai'
import { dayUsage, id, mapConversation, mapMessage, now, recordReplyUsage, titleFrom, utcDay } from '../db'
import type { AppContext } from '../env'

export const chat = new Hono<AppContext>()

type Input = { conversationId?: unknown; content?: unknown; model?: unknown; regenerate?: unknown }

// Replies in flight per user in this isolate (start times, so a slot that was
// never released still expires). A cheap brake on a tab that fires requests
// in parallel; the daily limit and the key's own spend limits are the real
// ceilings.
const inflight = new Map<string, number[]>()
const MAX_INFLIGHT = 2
const INFLIGHT_TTL = 5 * 60_000
const inflightCount = (owner: string) => {
  const live = (inflight.get(owner) ?? []).filter((at) => Date.now() - at < INFLIGHT_TTL)
  if (live.length) inflight.set(owner, live)
  else inflight.delete(owner)
  return live.length
}

// A write that does not complete in this long means the reader is gone:
// runtimes do not all report a closed connection, and a blocked write would
// otherwise hold the upstream request (and the credits it spends) open.
const WRITE_TIMEOUT = 10_000

chat.post('/', async (c) => {
  const db = c.get('db')
  const owner = c.get('user').sub
  if (!aiConfigured(c.env)) return c.json({ error: 'not_configured', message: 'No API key is configured yet.' }, 503)

  const input = await c.req.json<Input>().catch(() => ({}) as Input)
  const regenerate = input.regenerate === true
  const content = typeof input.content === 'string' ? input.content.replace(/\r\n?/g, '\n').trim() : ''
  if (!regenerate && !content) return c.json({ error: 'empty', message: 'Write a message first.' }, 400)
  if (content.length > MAX_MESSAGE_CHARS) return c.json({ error: 'too_long', message: `Messages can be up to ${MAX_MESSAGE_CHARS.toLocaleString()} characters.` }, 400)
  if (input.model !== undefined && !isModelId(input.model)) return c.json({ error: 'model', message: 'Unknown model.' }, 400)
  if (input.conversationId !== undefined && typeof input.conversationId !== 'string') return c.json({ error: 'conversation', message: 'Invalid conversation.' }, 400)

  if (inflightCount(owner) >= MAX_INFLIGHT) return c.json({ error: 'busy', message: 'Wait for the current reply to finish.' }, 429)

  // Two ceilings: this person's fair use, and the app's whole-day budget. The
  // app-wide one is what a public preview cannot get past, however many people
  // sign in. Both are checked before any row is written, so a refusal is free.
  const [mine, everyone] = await Promise.all([dayUsage(db, owner), dayUsage(db)])
  if (mine.replies >= DAILY_MESSAGE_LIMIT) {
    return c.json({ error: 'limit', message: `You have reached today's limit of ${DAILY_MESSAGE_LIMIT} replies.`, resetsAt: utcDay().end }, 429)
  }
  if (everyone.replies >= GLOBAL_DAILY_REPLY_LIMIT) {
    return c.json({ error: 'app_limit', message: `This app has reached its daily ceiling of ${GLOBAL_DAILY_REPLY_LIMIT} replies. Try again tomorrow.`, resetsAt: utcDay().end }, 429)
  }
  if (everyone.tokens >= GLOBAL_DAILY_TOKEN_LIMIT) {
    return c.json({ error: 'app_limit', message: 'This app has used its daily token budget. Try again tomorrow.', resetsAt: utcDay().end }, 429)
  }

  // The conversation: existing, or created from this first message.
  const t = now()
  let conversationRow = input.conversationId
    ? await db.prepare(`SELECT * FROM conversations WHERE owner_sub = ? AND id = ?`).bind(owner, input.conversationId).first<Record<string, unknown>>()
    : null
  if (input.conversationId && !conversationRow) return c.json({ error: 'not_found', message: 'This chat no longer exists.' }, 404)
  if (regenerate && !conversationRow) return c.json({ error: 'conversation', message: 'Nothing to regenerate.' }, 400)
  const existingModel = conversationRow?.model
  const model: ModelId = isModelId(input.model) ? input.model : isModelId(existingModel) ? existingModel : DEFAULT_MODEL
  const statements: D1PreparedStatement[] = []
  if (!conversationRow) {
    conversationRow = { id: id(), owner_sub: owner, title: titleFrom(content), model, created_at: t, updated_at: t }
    statements.push(
      db.prepare(`INSERT INTO conversations (id, owner_sub, title, model, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`).bind(conversationRow.id, owner, conversationRow.title, model, t, t),
    )
  } else {
    conversationRow.model = model
    conversationRow.updated_at = t
    statements.push(db.prepare(`UPDATE conversations SET model = ?, updated_at = ? WHERE owner_sub = ? AND id = ?`).bind(model, t, owner, conversationRow.id))
  }
  const conversation = mapConversation(conversationRow)

  // History the model sees, oldest first, bounded.
  const history = (
    await db
      .prepare(`SELECT * FROM messages WHERE owner_sub = ? AND conversation_id = ? ORDER BY created_at DESC LIMIT ?`)
      .bind(owner, conversation.id, MAX_CONTEXT_MESSAGES)
      .all()
  ).results.map((r) => mapMessage(r as Record<string, unknown>)).reverse()

  let userMessage: Message
  if (regenerate) {
    // Drop everything after the last user message and answer it again.
    const lastUser = [...history].reverse().find((m) => m.role === 'user')
    if (!lastUser) return c.json({ error: 'conversation', message: 'Nothing to regenerate.' }, 400)
    userMessage = lastUser
    statements.push(db.prepare(`DELETE FROM messages WHERE owner_sub = ? AND conversation_id = ? AND created_at > ?`).bind(owner, conversation.id, lastUser.createdAt))
    history.splice(history.indexOf(lastUser) + 1)
  } else {
    userMessage = { id: id(), conversationId: conversation.id, role: 'user', content, model: null, interrupted: false, createdAt: t }
    statements.push(
      db.prepare(`INSERT INTO messages (id, owner_sub, conversation_id, role, content, model, created_at) VALUES (?, ?, ?, 'user', ?, NULL, ?)`).bind(userMessage.id, owner, conversation.id, content, t),
    )
    history.push(userMessage)
  }
  // The reply's row exists from the start (empty), so it counts toward today's
  // limit while streaming and the app knows its id before the first token.
  const assistantMessageId = id()
  const replyAt = t + 1
  statements.push(
    db.prepare(`INSERT INTO messages (id, owner_sub, conversation_id, role, content, model, created_at) VALUES (?, ?, ?, 'assistant', '', ?, ?)`).bind(assistantMessageId, owner, conversation.id, model, replyAt),
  )
  await db.batch(statements)

  const prompt: ChatMessage[] = [{ role: 'system', content: SYSTEM_PROMPT }, ...history.slice(-MAX_CONTEXT_MESSAGES).map((m) => ({ role: m.role, content: m.content }))]

  const startedAt = Date.now()
  inflight.set(owner, [...(inflight.get(owner) ?? []), startedAt])
  const release = () => {
    const rest = (inflight.get(owner) ?? []).filter((at) => at !== startedAt)
    if (rest.length) inflight.set(owner, rest)
    else inflight.delete(owner)
  }

  c.header('Cache-Control', 'private, no-store')
  return streamSSE(c, async (stream) => {
    // The whole reply runs under waitUntil: when the reader goes away the
    // runtime drops the request's other work, and this is what stops the
    // upstream request and records what arrived. It is registered before
    // the first byte is sent.
    const work = generate(stream)
    c.executionCtx.waitUntil(work)
    await work
  })

  async function generate(stream: SSEStreamingApi) {
    const controller = new AbortController()
    let text = ''
    let gone = false
    // What the API billed, when it said; everything else is estimated.
    const reported: ReportedUsage = {}
    // Resolves false once the reader has stopped taking data: the runtime
    // cancelled the stream, or a write sat unanswered for WRITE_TIMEOUT.
    const send = (event: ChatEvent) => {
      let timer: ReturnType<typeof setTimeout> | undefined
      return Promise.race([
        stream.writeSSE({ data: JSON.stringify(event) }).then(() => !stream.aborted),
        new Promise<boolean>((resolve) => {
          timer = setTimeout(() => resolve(false), WRITE_TIMEOUT)
        }),
      ]).finally(() => clearTimeout(timer))
    }
    const save = (interrupted: boolean) =>
      db.prepare(`UPDATE messages SET content = ?, interrupted = ? WHERE owner_sub = ? AND id = ?`).bind(text, interrupted ? 1 : 0, owner, assistantMessageId).run()
    const discard = () => db.prepare(`DELETE FROM messages WHERE owner_sub = ? AND id = ?`).bind(owner, assistantMessageId).run()
    // Written once per reply, whatever ended it, so the token ceiling sees it.
    const recordUsage = () =>
      recordReplyUsage(db, {
        messageId: assistantMessageId,
        owner,
        model,
        promptTokens: reported.promptTokens ?? estimatePromptTokens(prompt),
        completionTokens: reported.completionTokens ?? estimateTokens(text),
        at: replyAt,
      })
    // The user stopped or left: stop upstream, keep what arrived (or nothing).
    const abandon = async () => {
      if (gone) return
      gone = true
      controller.abort()
      await (text ? save(true) : discard())
      if (text || reported.completionTokens) await recordUsage()
    }
    stream.onAbort(() => void abandon())

    try {
      if (!(await send({ type: 'start', conversation, userMessage, assistantMessageId }))) return await abandon()
      for await (const piece of complete(c.env, { model, messages: prompt, signal: controller.signal, onUsage: (usage) => Object.assign(reported, usage) })) {
        if (gone) return
        text += piece
        if (!(await send({ type: 'delta', text: piece }))) return await abandon()
      }
      if (gone) return
      await save(false)
      await recordUsage()
      const after = await dayUsage(db, owner)
      const message: Message = { id: assistantMessageId, conversationId: conversation.id, role: 'assistant', content: text, model, interrupted: false, createdAt: replyAt }
      const usage: Me['usage'] = { used: after.replies, limit: DAILY_MESSAGE_LIMIT, tokens: after.tokens, resetsAt: utcDay().end }
      await send({ type: 'done', message, usage })
    } catch (error) {
      if (gone) return
      const failure = error instanceof AiError ? error : new AiError('unavailable', 'Something went wrong. Try again.', 502)
      if (!(error instanceof AiError)) console.error(error)
      await (text ? save(true) : discard())
      // A refused request costs nothing and reports nothing; only billed work
      // (text that arrived, or usage the API sent) is recorded.
      if (text || reported.completionTokens || reported.promptTokens !== undefined) await recordUsage()
      await send({ type: 'error', code: failure.code, message: failure.message })
    } finally {
      release()
    }
  }
})

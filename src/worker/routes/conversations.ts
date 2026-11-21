import { Hono } from 'hono'

import { isModelId } from '../ai'
import { privateJson } from '../auth'
import { mapConversation, mapMessage, now } from '../db'
import type { AppContext } from '../env'

export const conversations = new Hono<AppContext>()

// The sidebar: newest first, one page at a time. `q` matches a chat's title or
// any of its messages, so a chat can be found by what was said in it too.
const DEFAULT_PAGE = 30
const MAX_PAGE = 100

type Cursor = { at: number; id: string }

/** "<updatedAt>.<id>": newest-first keyset paging that stays stable as chats move. */
const cursorOf = (at: number, id: string) => `${at}.${id}`

function readCursor(value: string | undefined): Cursor | null | 'invalid' {
  if (!value) return null
  const dot = value.indexOf('.')
  const at = Number(value.slice(0, dot))
  const id = value.slice(dot + 1)
  return dot > 0 && Number.isSafeInteger(at) && at >= 0 && id.length > 0 && id.length <= 64 ? { at, id } : 'invalid'
}

/** A safe LIKE pattern: the search text with its own wildcards escaped. */
const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, (char) => `\\${char}`)}%`

conversations.get('/', async (c) => {
  const db = c.get('db')
  const owner = c.get('user').sub
  const q = (c.req.query('q') ?? '').replace(/\s+/g, ' ').trim().slice(0, 120)
  const page = Number(c.req.query('limit') ?? DEFAULT_PAGE)
  const limit = Number.isFinite(page) ? Math.min(MAX_PAGE, Math.max(1, Math.floor(page))) : DEFAULT_PAGE
  const cursor = readCursor(c.req.query('cursor'))
  if (cursor === 'invalid') return c.json({ error: 'invalid_cursor', message: 'That page has expired. Reload the list.' }, 400)
  const pattern = likePattern(q)
  // One row past the page tells us whether there is another page.
  const rows = await db
    .prepare(
      `SELECT * FROM conversations
        WHERE owner_sub = ?
          AND (? = '' OR title LIKE ? ESCAPE '\\' OR EXISTS (
            SELECT 1 FROM messages m WHERE m.conversation_id = conversations.id AND m.owner_sub = ? AND m.content LIKE ? ESCAPE '\\'
          ))
          AND (? = 0 OR updated_at < ? OR (updated_at = ? AND id < ?))
        ORDER BY updated_at DESC, id DESC
        LIMIT ?`,
    )
    .bind(owner, q, pattern, owner, pattern, cursor ? 1 : 0, cursor?.at ?? 0, cursor?.at ?? 0, cursor?.id ?? '', limit + 1)
    .all()
  const found = (rows.results as Record<string, unknown>[]).map(mapConversation)
  const items = found.slice(0, limit)
  const last = items[items.length - 1]
  return privateJson(c, { items, nextCursor: found.length > limit && last ? cursorOf(last.updatedAt, last.id) : null })
})

// A reply row is created empty when generation starts (routes/chat.ts) and
// filled in at the end. One still empty this long after has been orphaned by
// a lost connection; it is removed when the conversation is next read.
const ORPHAN_AFTER = 10 * 60_000

conversations.get('/:id', async (c) => {
  const db = c.get('db')
  const owner = c.get('user').sub
  const conversationId = c.req.param('id')
  const [, conversation, messages] = await db.batch([
    db
      .prepare(`DELETE FROM messages WHERE owner_sub = ? AND conversation_id = ? AND role = 'assistant' AND content = '' AND created_at < ?`)
      .bind(owner, conversationId, now() - ORPHAN_AFTER),
    db.prepare(`SELECT * FROM conversations WHERE owner_sub = ? AND id = ?`).bind(owner, conversationId),
    db.prepare(`SELECT * FROM messages WHERE owner_sub = ? AND conversation_id = ? AND NOT (role = 'assistant' AND content = '') ORDER BY created_at ASC`).bind(owner, conversationId),
  ])
  if (!conversation.results[0]) return c.json({ error: 'Not found.' }, 404)
  return privateJson(c, {
    conversation: mapConversation(conversation.results[0] as Record<string, unknown>),
    messages: (messages.results as Record<string, unknown>[]).map(mapMessage),
  })
})

conversations.patch('/:id', async (c) => {
  const db = c.get('db')
  const owner = c.get('user').sub
  const conversationId = c.req.param('id')
  const input = await c.req.json<{ title?: unknown; model?: unknown }>().catch(() => ({}) as { title?: unknown; model?: unknown })
  const existing = await db.prepare(`SELECT * FROM conversations WHERE owner_sub = ? AND id = ?`).bind(owner, conversationId).first<Record<string, unknown>>()
  if (!existing) return c.json({ error: 'Not found.' }, 404)
  let title = existing.title as string
  if (input.title !== undefined) {
    if (typeof input.title !== 'string') return c.json({ error: 'Invalid title.' }, 400)
    title = input.title.replace(/\s+/g, ' ').trim().slice(0, 80)
    if (!title) return c.json({ error: 'Give the chat a title.' }, 400)
  }
  let model = existing.model as string
  if (input.model !== undefined) {
    if (!isModelId(input.model)) return c.json({ error: 'Unknown model.' }, 400)
    model = input.model
  }
  await db.prepare(`UPDATE conversations SET title = ?, model = ? WHERE owner_sub = ? AND id = ?`).bind(title, model, owner, conversationId).run()
  const row = await db.prepare(`SELECT * FROM conversations WHERE owner_sub = ? AND id = ?`).bind(owner, conversationId).first<Record<string, unknown>>()
  return privateJson(c, { conversation: mapConversation(row!) })
})

conversations.delete('/:id', async (c) => {
  const db = c.get('db')
  const owner = c.get('user').sub
  const conversationId = c.req.param('id')
  await db.batch([
    db.prepare(`DELETE FROM messages WHERE owner_sub = ? AND conversation_id = ?`).bind(owner, conversationId),
    db.prepare(`DELETE FROM conversations WHERE owner_sub = ? AND id = ?`).bind(owner, conversationId),
  ])
  return privateJson(c, { ok: true, at: now() })
})

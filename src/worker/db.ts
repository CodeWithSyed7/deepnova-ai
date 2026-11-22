import type { MiddlewareHandler } from 'hono'

import type { Conversation, Message } from '../shared/types'
import type { AppContext } from './env'

// Schema lives with the Worker: D1 has no migration tool on Freebuff Sites, so
// tables are created on the first request of each isolate. Add new statements
// at the end; never edit existing ones in place once deployed.
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
    owner_sub TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    owner_sub TEXT NOT NULL,
    title TEXT NOT NULL,
    model TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS conversations_owner ON conversations(owner_sub, updated_at DESC)`,
  `CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    owner_sub TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    model TEXT,
    interrupted INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS messages_conversation ON messages(owner_sub, conversation_id, created_at)`,
  // The daily usage count: replies generated per owner per day.
  `CREATE INDEX IF NOT EXISTS messages_owner_role_created ON messages(owner_sub, role, created_at)`,
  // What each reply cost: the tokens the API reported, or an estimate when it
  // reported none. Written once per reply, at the end of the turn.
  `CREATE TABLE IF NOT EXISTS reply_usage (
    message_id TEXT PRIMARY KEY,
    owner_sub TEXT NOT NULL,
    model TEXT NOT NULL,
    prompt_tokens INTEGER NOT NULL DEFAULT 0,
    completion_tokens INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS reply_usage_created ON reply_usage(created_at)`,
  `CREATE INDEX IF NOT EXISTS reply_usage_owner_created ON reply_usage(owner_sub, created_at)`,
  // One-time codes that hand a finished sign-in to a frontend on another host.
  // Only the code's hash is stored, and a row is deleted when it is redeemed.
  `CREATE TABLE IF NOT EXISTS handoff_codes (
    code_hash TEXT PRIMARY KEY,
    session TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS handoff_codes_expires ON handoff_codes(expires_at)`,
]

const ready = new WeakMap<D1Database, Promise<void>>()

export function ensureSchema(db: D1Database): Promise<void> {
  let pending = ready.get(db)
  if (!pending) {
    pending = db.batch(SCHEMA.map((sql) => db.prepare(sql))).then(() => undefined).catch((error) => {
      ready.delete(db)
      throw error
    })
    ready.set(db, pending)
  }
  return pending
}

export const requireDb: MiddlewareHandler<AppContext> = async (c, next) => {
  const db = c.env.DB
  if (!db) {
    return c.json({ error: 'database_missing', message: 'No database is attached yet. Add D1 storage named DB and redeploy.' }, 503)
  }
  await ensureSchema(db)
  c.set('db', db)
  await next()
}

export const id = () => crypto.randomUUID()
export const now = () => Date.now()

type Row = Record<string, unknown>

export function mapConversation(r: Row): Conversation {
  return {
    id: r.id as string,
    title: r.title as string,
    model: r.model as string,
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  }
}

export function mapMessage(r: Row): Message {
  return {
    id: r.id as string,
    conversationId: r.conversation_id as string,
    role: r.role as Message['role'],
    content: r.content as string,
    model: (r.model as string | null) ?? null,
    interrupted: Boolean(r.interrupted),
    createdAt: Number(r.created_at),
  }
}

/** Midnight UTC that started the current day, and the next one. */
export function utcDay(at = now()): { start: number; end: number } {
  const start = new Date(at)
  start.setUTCHours(0, 0, 0, 0)
  return { start: start.getTime(), end: start.getTime() + 86_400_000 }
}

export type DayUsage = { replies: number; tokens: number }

/**
 * What today has cost, for one owner or (with no owner) for everyone.
 * Replies are counted from the message rows, so a reply still streaming counts
 * against the ceiling from the moment it starts, and stopping or regenerating
 * still counts. Tokens come from reply_usage, which is written when a reply
 * ends. A request the API refused costs nothing and is never recorded.
 */
export async function dayUsage(db: D1Database, owner?: string): Promise<DayUsage> {
  const { start } = utcDay()
  const scope = owner ? 'owner_sub = ? AND ' : ''
  const binds = owner ? [owner, start] : [start]
  const [replies, tokens] = await db.batch([
    db.prepare(`SELECT COUNT(*) AS n FROM messages WHERE ${scope}role = 'assistant' AND created_at >= ?`).bind(...binds),
    db.prepare(`SELECT COALESCE(SUM(prompt_tokens + completion_tokens), 0) AS n FROM reply_usage WHERE ${scope}created_at >= ?`).bind(...binds),
  ])
  const count = (result: D1Result<unknown> | undefined) => Number((result?.results?.[0] as { n?: number } | undefined)?.n ?? 0)
  return { replies: count(replies), tokens: count(tokens) }
}

/** One reply's cost. Called once the reply ends, including when it was stopped. */
export function recordReplyUsage(
  db: D1Database,
  input: { messageId: string; owner: string; model: string; promptTokens: number; completionTokens: number; at: number },
) {
  return db
    .prepare(`INSERT OR REPLACE INTO reply_usage (message_id, owner_sub, model, prompt_tokens, completion_tokens, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(
      input.messageId,
      input.owner,
      input.model,
      Math.max(0, Math.round(input.promptTokens)),
      Math.max(0, Math.round(input.completionTokens)),
      input.at,
    )
    .run()
}

/** A conversation title from its first message: the first line, cut at a word. */
export function titleFrom(content: string): string {
  const line = content.trim().split(/\r?\n/)[0]?.replace(/\s+/g, ' ').trim() ?? ''
  if (line.length <= 48) return line || 'New chat'
  const cut = line.slice(0, 48)
  const space = cut.lastIndexOf(' ')
  return `${(space > 24 ? cut.slice(0, space) : cut).replace(/[\s,.;:!?-]+$/, '')}…`
}

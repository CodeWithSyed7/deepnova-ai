import { expect, test } from 'bun:test'

import { ensureSchema, resetSchemaCacheForTests, titleFrom, utcDay } from '../src/worker/db'

test('a title is the first line of the message, cut at a word', () => {
  expect(titleFrom('Hello there')).toBe('Hello there')
  expect(titleFrom('  Line one  \nand line two')).toBe('Line one')
  expect(titleFrom(' \n\n ')).toBe('New chat')
  expect(titleFrom('word '.repeat(20))).toBe(`${'word '.repeat(9).trim()}…`)
})

test('the day runs from one UTC midnight to the next', () => {
  const day = utcDay(Date.UTC(2026, 10, 23, 18, 30))
  expect(day.start).toBe(Date.UTC(2026, 10, 23))
  expect(day.end - day.start).toBe(86_400_000)
  // Same day, either side of midnight UTC.
  expect(utcDay(Date.UTC(2026, 10, 23, 0, 0)).start).toBe(day.start)
  expect(utcDay(Date.UTC(2026, 10, 23, 23, 59, 59, 999)).start).toBe(day.start)
})

test('the schema is created once per isolate, not on every request', async () => {
  resetSchemaCacheForTests()
  let batches = 0
  const db = {
    prepare: () => ({}),
    batch: async () => {
      batches += 1
      return []
    },
  } as unknown as D1Database

  await ensureSchema(db)
  await ensureSchema(db)
  expect(batches).toBe(1)

  // A new isolate starts over; the statements are idempotent.
  resetSchemaCacheForTests()
  await ensureSchema(db)
  expect(batches).toBe(2)
})

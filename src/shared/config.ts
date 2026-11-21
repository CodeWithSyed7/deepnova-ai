// The product's configuration, shared by the Worker and the app. Most
// customisation happens here: the name, the assistant's instructions, which
// models people may pick, and the usage limits that protect the API credits.

export const BRAND = 'DeepNova AI'
export const TAGLINE = 'One calm workspace for questions, code, writing and research.'
export const DESCRIPTION =
  'DeepNova AI is a lightweight AI assistant: streamed answers, markdown, model choice and a daily budget that keeps it fast and free to use.'

/** What the assistant is told before every conversation. */
export const SYSTEM_PROMPT = `You are ${BRAND}, a thoughtful, capable assistant. Be clear and direct. Match the length of your answer to the question: short for simple ones, structured for complex ones. Use Markdown when it helps (lists, headings, code blocks with a language), never for decoration. Show your reasoning only when it clarifies the answer. If you are unsure, say so plainly rather than guessing.`

/**
 * Models people may choose, in picker order. Ids are Freebuff API model ids
 * (GET https://freebuff.com/api/v1/paid/models lists them). The Worker refuses
 * any model not in this list, so this is also the spending allowlist.
 */
export const MODELS = [
  { id: 'deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash', description: 'Fast, for everyday questions' },
  { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5', description: 'Careful writing and analysis' },
  { id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol', description: 'Broad knowledge' },
  { id: 'gemini-4-argon', name: 'Gemini 4 Argon', description: 'Long documents' },
] as const
export type ModelId = (typeof MODELS)[number]['id']
export const DEFAULT_MODEL: ModelId = 'deepseek-v4.1-flash'

/** Per-user limits. Messages are counted per UTC day. */
export const DAILY_MESSAGE_LIMIT = 50
/**
 * App-wide ceilings for the current UTC day, across every signed-in user.
 * They are the hard stop that keeps a shared or public app from draining the
 * owner's API credits; DAILY_MESSAGE_LIMIT is the per-person fair-use limit.
 * A reply's tokens are what the API reported, or an estimate when it did not.
 */
export const GLOBAL_DAILY_REPLY_LIMIT = 300
export const GLOBAL_DAILY_TOKEN_LIMIT = 1_500_000
/** How much history goes to the model with each message. */
export const MAX_CONTEXT_MESSAGES = 24
export const MAX_MESSAGE_CHARS = 8_000
export const MAX_OUTPUT_TOKENS = 2_048

/** Shown on an empty chat, as starting points rather than commands. */
export const SUGGESTIONS = [
  { title: 'Build something', text: 'Help me plan and build a professional one-page website for a small business.' },
  { title: 'Explain a concept', text: 'Explain how vector databases work, in plain language, with one small example.' },
  { title: 'Write and refine', text: 'Draft a short, friendly email asking a client for feedback on a project we just delivered.' },
  { title: 'Review my code', text: 'Review this TypeScript function for bugs and readability, and suggest a cleaner version.' },
]

/** The Freebuff API, unless OPENAI_BASE_URL says otherwise. */
export const FREEBUFF_API_URL = 'https://freebuff.com/api/v1/paid'
/** Where the app's owner creates and funds an API key. */
export const FREEBUFF_API_KEYS_URL = 'https://freebuff.com/account/api'

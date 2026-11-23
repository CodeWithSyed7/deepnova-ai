import { useQueryClient } from '@tanstack/react-query'
import { motion, useReducedMotion } from 'motion/react'
import { ArrowUpRight, KeyRound } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router'

import { BRAND, DEFAULT_MODEL, FREEBUFF_API_KEYS_URL, MODELS, SUGGESTIONS } from '../../shared/config'
import type { Message } from '../../shared/types'
import { Composer } from '../components/Composer'
import { AssistantMessage, UserMessage } from '../components/Message'
import { ModelPicker } from '../components/ModelPicker'
import { Mark } from '../components/Shell'
import { Spinner, useToast } from '../components/ui'
import { ApiError, useConversation, useMe, useSetConversationModel } from '../lib/api'
import { untilLabel } from '../lib/format'
import { dismissTurn, startTurn, useTurn } from '../lib/turn'

const MODEL_KEY = 'model'

export function Chat() {
  const { id } = useParams()
  const navigate = useNavigate()
  const client = useQueryClient()
  const toast = useToast()
  const { data: me } = useMe()
  const page = useConversation(id)
  const turn = useTurn()
  const setConversationModel = useSetConversationModel()

  const [draft, setDraft] = useState('')
  // Bumped when a suggestion is inserted, so the composer takes focus.
  const [focusKey, setFocusKey] = useState(0)
  const [newModel, setNewModel] = useState(() => {
    const saved = localStorage.getItem(MODEL_KEY)
    return saved && MODELS.some((m) => m.id === saved) ? saved : DEFAULT_MODEL
  })
  // The conversation this page created from "/", so it keeps showing the
  // reply during the moment between the server naming it and the URL changing.
  const owned = useRef<string | null>(null)
  useEffect(() => {
    setDraft('')
  }, [id])

  const conversation = page.data?.conversation
  const saved = page.data?.messages ?? []
  const model = conversation?.model ?? newModel
  const mine = turn !== null && (turn.conversationId === (id ?? null) || (id === undefined && turn.conversationId === owned.current))
  const busy = mine && turn.status !== 'error'
  const ai = me?.capabilities.ai ?? true
  const limitReached = me ? me.usage.used >= me.usage.limit && !busy : false
  // The app-wide ceiling covers everyone for the day. When it is hit nobody can
  // send, so the composer says so instead of failing on every attempt.
  const appRepliesCapped = me?.appUsage ? me.appUsage.replies >= me.appUsage.replyLimit : false
  const appTokensCapped = me?.appUsage ? me.appUsage.tokens >= me.appUsage.tokenLimit : false
  const appCapped = !busy && (appRepliesCapped || appTokensCapped)

  const send = useCallback(
    async (content: string) => {
      content = content.trim()
      if (!content) return
      setDraft('')
      try {
        await startTurn(
          client,
          { conversationId: id, content, model },
          {
            onConversation: (created) => {
              owned.current = created.id
              navigate(`/c/${created.id}`, { replace: true })
            },
          },
        )
      } catch (error) {
        setDraft(content)
        if (error instanceof ApiError && (error.code === 'limit' || error.code === 'app_limit')) void client.invalidateQueries({ queryKey: ['me'] })
        toast(error instanceof Error ? error.message : 'Could not send this message', 'danger')
      }
    },
    [client, id, model, navigate, toast],
  )

  const regenerate = useCallback(async () => {
    if (!id) return
    try {
      await startTurn(client, { conversationId: id, regenerate: true, model })
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not regenerate', 'danger')
    }
  }, [client, id, model, toast])

  const changeModel = (next: string) => {
    if (conversation) setConversationModel.mutate({ id: conversation.id, model: next })
    else {
      setNewModel(next)
      localStorage.setItem(MODEL_KEY, next)
    }
  }

  // What the thread shows: the saved messages, plus the turn in flight. While
  // regenerating, saved replies after the last question are hidden.
  let messages: Message[] = saved
  if (mine && turn && !turn.userMessage) {
    const lastUser = [...saved].reverse().find((m) => m.role === 'user')
    if (lastUser) messages = saved.filter((m) => m.createdAt <= lastUser.createdAt)
  }
  const pendingUser = mine && turn?.userMessage && !messages.some((m) => m.id === turn.userMessage!.id) ? turn.userMessage : null
  const lastSavedAssistant = [...messages].reverse().find((m) => m.role === 'assistant')
  const empty = !id && messages.length === 0 && !mine

  // Follow the reply as it streams, unless the reader has scrolled up.
  const scroller = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const onScroll = () => {
    const el = scroller.current
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }
  useEffect(() => {
    const el = scroller.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [messages.length, pendingUser, turn?.text, id])
  useEffect(() => {
    stick.current = true
  }, [id])

  if (id && page.isLoading) {
    return (
      <div className="grid flex-1 place-items-center">
        <Spinner />
      </div>
    )
  }
  if (id && page.error) {
    // A missing chat is final; anything else (a dropped connection, a 500) is
    // worth another try, and saying the chat vanished would be a lie.
    const missing = page.error instanceof ApiError && page.error.status === 404
    return (
      <div className="grid flex-1 place-items-center p-6 text-center">
        <div>
          <p className="text-[15px] font-medium">{missing ? 'This chat is not here any more.' : 'Could not load this chat.'}</p>
          <button
            type="button"
            onClick={() => (missing ? navigate('/') : void page.refetch())}
            className="mt-2 text-[13.5px] text-muted underline underline-offset-2 hover:text-fg"
          >
            {missing ? 'Start a new one' : 'Try again'}
          </button>
        </div>
      </div>
    )
  }

  const blocked = !ai || appCapped || limitReached
  const placeholder = !ai ? 'Add an API key to start chatting' : appCapped ? 'Daily limit reached' : limitReached ? 'Daily limit reached' : `Message ${BRAND}`
  const composer = (hero: boolean) => (
    <Composer
      value={draft}
      onChange={setDraft}
      onSend={() => void send(draft)}
      onStop={() => turn?.stop()}
      busy={busy}
      disabled={blocked}
      placeholder={placeholder}
      autoFocus={hero}
      large={hero}
      focusKey={focusKey}
    />
  )
  const notice = appCapped && me ? (
    <Notice>
      <span className="font-medium text-fg">{BRAND} is resting for today.</span>{' '}
      {appRepliesCapped
        ? `It has reached its daily ceiling of ${me.appUsage.replyLimit.toLocaleString()} replies for everyone.`
        : `It has used its daily budget of ${me.appUsage.tokenLimit.toLocaleString()} tokens for everyone.`}{' '}
      More {untilLabel(me.appUsage.resetsAt)}.
    </Notice>
  ) : limitReached && me ? (
    <Notice>
      You have used today&apos;s {me.usage.limit} replies. More {untilLabel(me.usage.resetsAt)}.
    </Notice>
  ) : !ai && !empty ? (
    <Notice>
      Add an API key to continue.{' '}
      <a href={FREEBUFF_API_KEYS_URL} target="_blank" rel="noreferrer" className="font-medium text-fg underline underline-offset-2">
        Get one
      </a>
    </Notice>
  ) : null

  if (empty) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex h-12 shrink-0 items-center justify-end px-3 md:h-14 md:px-5">
          <ModelPicker value={model} onChange={changeModel} disabled={busy} />
        </div>
        <div ref={scroller} className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex min-h-full w-full max-w-[720px] flex-col justify-center px-4 pb-10 pt-2 md:px-6">
            {ai ? (
              <Landing
                draft={draft}
                onPick={(text) => {
                  setDraft(text)
                  setFocusKey((key) => key + 1)
                }}
                blocked={blocked}
                notice={notice}
                composer={composer(true)}
              />
            ) : (
              <SetupCard />
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-12 shrink-0 items-center px-3 md:h-14 md:px-5">
        <ModelPicker value={model} onChange={changeModel} disabled={busy} />
      </div>

      <div ref={scroller} onScroll={onScroll} className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[760px] px-4 pb-6 pt-2 md:px-6">
          <div className="space-y-7">
            {messages.map((message) =>
              message.role === 'user' ? (
                <UserMessage key={message.id} content={message.content} />
              ) : (
                <AssistantMessage
                  key={message.id}
                  content={message.content}
                  interrupted={message.interrupted}
                  onRegenerate={message.id === lastSavedAssistant?.id && !mine && ai ? regenerate : undefined}
                />
              ),
            )}
            {pendingUser && <UserMessage key={pendingUser.id} content={pendingUser.content} />}
            {mine && turn && (
              <AssistantMessage
                key={turn.assistantMessageId ?? 'pending'}
                content={turn.text}
                streaming={turn.status !== 'error'}
                error={turn.status === 'error' ? turn.error : null}
                onRetry={() => {
                  dismissTurn()
                  void regenerate()
                }}
              />
            )}
          </div>
        </div>
      </div>

      <div className="mx-auto w-full max-w-[760px] px-4 pb-4 md:px-6 md:pb-6">
        {notice && <div className="mb-2">{notice}</div>}
        {composer(false)}
      </div>
    </div>
  )
}

/** The first screen: a large composer, and a few ways in. */
function Landing({
  draft,
  onPick,
  blocked,
  notice,
  composer,
}: {
  draft: string
  onPick: (text: string) => void
  blocked: boolean
  notice: React.ReactNode
  composer: React.ReactNode
}) {
  const reduce = useReducedMotion()
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      className="pt-2"
    >
      <div className="flex flex-col items-center text-center">
        <Mark size={44} className="shadow-[0_10px_30px_-12px_rgb(100_135_232/0.7)]" />
        <h1 className="mt-5 text-balance text-[30px] font-semibold tracking-[-0.025em] md:text-[34px]">What can I help you with?</h1>
        <p className="mt-2.5 max-w-[430px] text-[14.5px] leading-relaxed text-muted">
          Ask a question, draft something, or paste code to review. Pick a model above whenever you want a different one.
        </p>
      </div>

      <div className="mt-7">
        {notice && <div className="mb-2.5">{notice}</div>}
        {composer}
      </div>

      <ul className="mt-5 grid gap-2 sm:grid-cols-2" aria-label="Suggested prompts">
        {SUGGESTIONS.map((suggestion, index) => (
          <motion.li
            key={suggestion.title}
            initial={reduce ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: 0.12 + index * 0.05, ease: [0.22, 1, 0.36, 1] }}
          >
            <button
              type="button"
              disabled={blocked}
              // A suggestion fills the composer so it can be edited; nothing is sent.
              onClick={() => onPick(suggestion.text)}
              className="group h-full w-full rounded-card border border-line bg-surface/80 px-4 py-3 text-left shadow-card backdrop-blur-[2px] transition-[border-color,background-color,transform] hover:-translate-y-0.5 hover:border-line-strong hover:bg-surface disabled:pointer-events-none disabled:opacity-50"
            >
              <span className="block text-[11px] font-medium uppercase tracking-[0.06em] text-faint">{suggestion.title}</span>
              <span className="mt-1 block text-[13px] leading-snug text-muted transition-colors group-hover:text-fg">{suggestion.text}</span>
            </button>
          </motion.li>
        ))}
      </ul>

      <p className="mt-4 text-center text-[12px] text-faint">
        {draft.trim() ? 'Enter to send · Shift + Enter for a new line' : 'Click a suggestion to edit it before sending'}
      </p>
    </motion.div>
  )
}

function Notice({ children }: { children: React.ReactNode }) {
  return <p className="rounded-control bg-surface-2 px-4 py-3 text-center text-[13.5px] text-muted">{children}</p>
}

/** Shown to everyone until the server has an API key. The key itself never comes here. */
function SetupCard() {
  return (
    <div className="flex flex-col items-center py-6 text-center">
      <div className="grid size-12 place-items-center rounded-card bg-surface shadow-card">
        <KeyRound className="size-5 text-muted" />
      </div>
      <h1 className="mt-5 text-[22px] font-semibold tracking-[-0.02em]">Connect the Freebuff API</h1>
      <p className="mt-2 max-w-sm text-[14px] leading-relaxed text-muted">
        Add your API key as <code className="rounded-[6px] bg-surface-2 px-1.5 py-0.5 font-mono text-[12.5px] text-fg">OPENAI_API_KEY</code> and {BRAND} starts answering.
      </p>
      <a
        href={FREEBUFF_API_KEYS_URL}
        target="_blank"
        rel="noreferrer"
        className="mt-6 inline-flex h-10 items-center gap-1.5 rounded-control bg-fg px-4 text-[14px] font-medium text-white transition-colors hover:bg-[#34373c]"
      >
        Get an API key
        <ArrowUpRight className="size-4" />
      </a>
      <p className="mt-4 text-[12.5px] text-faint">Locally in .env. On Freebuff Sites, in Secrets.</p>
    </div>
  )
}

import { ArrowUp, Square } from 'lucide-react'
import { useEffect, useRef, type KeyboardEvent } from 'react'

import { MAX_MESSAGE_CHARS } from '../../shared/config'
import { cx } from '../lib/cx'

export function Composer({
  value,
  onChange,
  onSend,
  onStop,
  busy,
  disabled,
  placeholder,
  autoFocus,
  large,
  focusKey,
}: {
  value: string
  onChange: (value: string) => void
  onSend: () => void
  onStop: () => void
  /** A reply is being generated. */
  busy: boolean
  disabled?: boolean
  placeholder?: string
  autoFocus?: boolean
  /** The landing composer: roomier, with a slightly taller input. */
  large?: boolean
  /** Changes when something outside (a suggestion) should focus the input. */
  focusKey?: number
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = `${Math.min(el.scrollHeight, large ? 260 : 220)}px`
  }, [value, large])
  useEffect(() => {
    if (autoFocus && !disabled) ref.current?.focus()
  }, [autoFocus, disabled])
  useEffect(() => {
    if (focusKey && !disabled) {
      const el = ref.current
      if (!el) return
      el.focus()
      el.setSelectionRange(el.value.length, el.value.length)
    }
  }, [focusKey, disabled])
  const canSend = !disabled && !busy && value.trim().length > 0 && value.length <= MAX_MESSAGE_CHARS
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      if (canSend) onSend()
    }
  }
  const over = value.length > MAX_MESSAGE_CHARS
  return (
    <div className={cx('composer', large && 'composer-lg', disabled && 'opacity-70')}>
      <textarea
        ref={ref}
        rows={1}
        value={value}
        disabled={disabled}
        placeholder={placeholder ?? 'Message'}
        aria-label="Message"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        className={cx(
          'scrollbar-thin block w-full resize-none bg-transparent text-[15px] leading-[1.55] text-fg placeholder:text-faint focus:outline-none',
          large ? 'px-5 pb-1 pt-4.5' : 'px-4 pb-1 pt-3.5',
        )}
      />
      <div className={cx('flex items-center justify-between', large ? 'px-2.5 pb-2.5' : 'px-2 pb-2')}>
        <span className={cx('pl-2 text-[12px] tabular-nums', over ? 'text-danger' : 'text-transparent')} aria-live="polite">
          {over ? `${value.length.toLocaleString()} / ${MAX_MESSAGE_CHARS.toLocaleString()}` : ''}
        </span>
        {busy ? (
          <button
            type="button"
            onClick={onStop}
            aria-label="Stop"
            className="grid size-8 place-items-center rounded-full bg-fg text-white transition-transform active:scale-95"
          >
            <Square className="size-3.5 fill-current" />
          </button>
        ) : (
          <button
            type="button"
            onClick={onSend}
            disabled={!canSend}
            aria-label="Send"
            className="grid size-8 place-items-center rounded-full bg-fg text-white transition-[opacity,transform,background-color] hover:bg-[#34373c] active:scale-95 disabled:opacity-25"
          >
            <ArrowUp className="size-4" />
          </button>
        )}
      </div>
    </div>
  )
}

import { motion } from 'motion/react'
import { ArrowRight, ShieldCheck, Sparkles, TriangleAlert } from 'lucide-react'

import { BRAND, TAGLINE } from '../../shared/config'
import { Logo, Mark } from '../components/Shell'

/**
 * Sign in. The only supported flow is Sign in with Freebuff (OIDC): there is
 * no password, no reset link and no email verification to invent. If the
 * provider sent us back with an error, it is shown with a way to try again.
 */
export function SignIn() {
  const params = new URLSearchParams(window.location.search)
  const error = params.get('error')
  const detail = params.get('error_description')
  // Sign-in always finishes on the canonical origin, which then hands the
  // session back to this host (see src/worker/handoff.ts).
  const href = '/auth/handoff/begin'
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="mx-auto flex h-16 w-full max-w-[1080px] items-center px-5 sm:px-8">
        <Logo />
      </header>
      <main className="mx-auto grid w-full max-w-[1080px] flex-1 items-center gap-12 px-5 pb-16 pt-6 sm:px-8 lg:grid-cols-[0.95fr_1fr]">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }} className="max-w-md">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1 text-[12px] font-medium text-muted shadow-card">
            <Sparkles className="size-3.5 text-accent" />
            A calmer way to work with AI
          </span>
          <h1 className="mt-5 text-balance text-[38px] font-semibold leading-[1.06] tracking-[-0.03em] sm:text-[46px]">
            Welcome to {BRAND}
          </h1>
          <p className="mt-4 text-[15.5px] leading-relaxed text-muted">{TAGLINE} Sign in and your chats are waiting next time.</p>

          {error && (
            <div role="alert" className="mt-6 flex gap-3 rounded-card border border-danger/25 bg-danger-soft px-4 py-3 text-left">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-danger" />
              <div className="min-w-0">
                <p className="text-[13.5px] font-medium text-fg">Sign-in did not finish</p>
                <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">
                  {friendly(error, detail)} You can start again below — nothing was changed on your account.
                </p>
              </div>
            </div>
          )}

          <a
            href={href}
            className="mt-7 inline-flex h-12 w-full items-center justify-center gap-2.5 rounded-control bg-fg px-5 text-[15px] font-medium text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.14)] transition-[background-color,transform] hover:bg-[#34373c] active:scale-[0.99] sm:w-auto"
          >
            <span className="grid size-5 place-items-center rounded-[6px] bg-white text-[11px] font-bold text-fg">F</span>
            Sign in with Freebuff
            <ArrowRight className="size-4" />
          </a>
          <p className="mt-3 flex items-center gap-1.5 text-[12.5px] text-faint">
            <ShieldCheck className="size-3.5" />
            Uses your Freebuff account. No new password to remember.
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.12, ease: [0.22, 1, 0.36, 1] }}
          className="hidden lg:block"
        >
          <div className="rounded-[26px] border border-white/70 bg-surface/80 p-6 shadow-[0_30px_80px_-40px_rgb(72_92_160/0.45),0_0_0_1px_rgb(32_33_36/0.04)] backdrop-blur-sm">
            <div className="flex justify-end">
              <p className="max-w-[82%] rounded-bubble rounded-br-[8px] bg-surface-2 px-4 py-2.5 text-[14.5px]">
                What&apos;s a good way to start learning the piano as an adult?
              </p>
            </div>
            <div className="mt-5 flex gap-3.5">
              <Mark size={26} className="mt-0.5" />
              <div className="prose-chat text-[14.5px]">
                <p>Start with ten focused minutes a day rather than an hour on Sundays. Three things to do in week one:</p>
                <ol>
                  <li>Learn the C major scale with correct fingering, hands separately.</li>
                  <li>Pick one song you love and learn its first four bars.</li>
                  <li>Record yourself once a week so you can hear progress.</li>
                </ol>
              </div>
            </div>
            <div className="mt-6 flex items-center gap-2 border-t border-line pt-4 text-[12px] text-faint">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-2 py-1 font-medium text-accent">
                <span className="size-1.5 rounded-full bg-accent" />
                DeepSeek V4.1 Flash
              </span>
              <span>Streamed, with model choice</span>
            </div>
          </div>
        </motion.div>
      </main>
    </div>
  )
}

/** The provider's error, said plainly, without exposing internals. */
function friendly(error: string, detail: string | null): string {
  const text = `${error} ${detail ?? ''}`.toLowerCase()
  if (text.includes('access_denied') || text.includes('cancel')) return 'The sign-in was cancelled before it completed.'
  if (text.includes('handoff') || text.includes('incomplete')) return 'The sign-in could not be carried over to this site. Please try again.'
  if (text.includes('expired') || text.includes('state')) return 'That sign-in link expired.'
  if (text.includes('invalid') || text.includes('token')) return 'The sign-in link was not valid.'
  if (detail && detail.length <= 160) return detail
  return 'The provider could not confirm the sign-in.'
}

export function SetupNeeded({ message }: { message: string }) {
  return (
    <div className="grid min-h-dvh place-items-center p-6">
      <div className="max-w-md text-center">
        <div className="mx-auto grid size-12 place-items-center rounded-card bg-surface shadow-card">
          <Mark size={36} />
        </div>
        <h1 className="mt-4 text-[20px] font-semibold tracking-tight">Almost there</h1>
        <p className="mt-2 text-[14px] leading-relaxed text-muted">{message}</p>
        <p className="mt-4 text-[13px] text-faint">In Freebuff, ask the agent to add D1 storage named DB, then deploy again.</p>
      </div>
    </div>
  )
}

import { AnimatePresence, motion } from 'motion/react'
import { Menu as MenuIcon, MoreHorizontal, Pencil, Plus, Search, Settings as SettingsIcon, Trash2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate, useParams } from 'react-router'

import { BRAND } from '../../shared/config'
import type { Conversation } from '../../shared/types'
import { useConversations, useDeleteConversation, useMe, useRenameConversation } from '../lib/api'
import { cx } from '../lib/cx'
import { DAY_GROUPS, dayGroup } from '../lib/format'
import { useTurn } from '../lib/turn'
import { Avatar, Button, ConfirmDialog, Dialog, Input, Menu, useToast } from './ui'

export function Logo({ className, size = 28 }: { className?: string; size?: number }) {
  return (
    <Link to="/" className={cx('inline-flex items-center gap-2.5 text-[15px] font-semibold tracking-tight', className)}>
      <Mark size={size} />
      <span className="tracking-[-0.02em]">{BRAND}</span>
    </Link>
  )
}

/**
 * The brand mark: a nova — a four-point burst of light with a small companion
 * star, on the blue-to-violet tile. Geometric, and still legible at 16px.
 */
export function Mark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <span
      className={cx('grid shrink-0 place-items-center bg-[linear-gradient(135deg,#7d9af0_0%,#6487e8_52%,#8b5cf6_100%)] text-white', className)}
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.32) }}
      aria-hidden
    >
      <svg viewBox="0 0 32 32" width={size * 0.66} height={size * 0.66} fill="currentColor">
        <path d="M16 3.4c1 5.1 3.2 7.3 8.3 8.3-5.1 1-7.3 3.2-8.3 8.3-1-5.1-3.2-7.3-8.3-8.3 5.1-1 7.3-3.2 8.3-8.3z" />
        <circle cx="16" cy="25.4" r="1.7" fillOpacity="0.92" />
      </svg>
    </span>
  )
}

export function Shell() {
  const [drawer, setDrawer] = useState(false)
  const location = useLocation()
  useEffect(() => setDrawer(false), [location.pathname])
  // The drawer covers the page on a phone, so Escape has to close it.
  useEffect(() => {
    if (!drawer) return
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setDrawer(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [drawer])
  return (
    <div className="flex h-dvh overflow-hidden">
      <aside className="hidden w-[264px] shrink-0 flex-col border-r border-line bg-bg md:flex">
        <Sidebar />
      </aside>
      <AnimatePresence>
        {drawer && (
          <motion.div key="drawer" className="fixed inset-0 z-40 bg-fg/30 md:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }} onMouseDown={() => setDrawer(false)}>
            <motion.aside
              role="dialog"
              aria-modal="true"
              aria-label="Chats"
              className="absolute inset-y-0 left-0 flex w-[284px] flex-col bg-bg shadow-dialog"
              initial={{ x: -40, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: -40, opacity: 0 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <Sidebar onClose={() => setDrawer(false)} />
            </motion.aside>
          </motion.div>
        )}
      </AnimatePresence>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-2 px-3 md:hidden">
          <Button variant="ghost" size="icon" aria-label="Open menu" onClick={() => setDrawer(true)}>
            <MenuIcon />
          </Button>
          <Logo size={24} />
        </header>
        <Outlet />
      </div>
    </div>
  )
}

function Sidebar({ onClose }: { onClose?: () => void }) {
  const { data: me } = useMe()
  const turn = useTurn()
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState('')
  // Typing does not fire a request per keystroke.
  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(query.trim()), 250)
    return () => window.clearTimeout(timer)
  }, [query])
  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } = useConversations(search)
  // Pages are newest-first already; a chat moved between them is kept once.
  const items: Conversation[] = []
  const seen = new Set<string>()
  for (const page of data?.pages ?? []) {
    for (const conversation of page.items) {
      if (seen.has(conversation.id)) continue
      seen.add(conversation.id)
      items.push(conversation)
    }
  }
  const groups = DAY_GROUPS.map((group) => ({ group, items: items.filter((c) => dayGroup(c.updatedAt) === group) })).filter((g) => g.items.length)
  return (
    <>
      <div className="flex h-14 items-center justify-between px-4">
        <Logo />
        {onClose && (
          <Button variant="ghost" size="icon-sm" aria-label="Close menu" onClick={onClose}>
            <X />
          </Button>
        )}
      </div>
      <div className="px-3">
        <NavLink
          to="/"
          end
          className={({ isActive }) =>
            cx('flex h-9 items-center gap-2 rounded-control px-3 text-[13.5px] font-medium transition-colors', isActive && !turn ? 'bg-surface text-fg shadow-card' : 'text-muted hover:bg-surface hover:text-fg')
          }
        >
          <Plus className="size-4" />
          New chat
        </NavLink>
      </div>
      <div className="px-3 pb-1 pt-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-faint" aria-hidden />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search chats"
            aria-label="Search chats"
            className="h-9 pl-8 pr-8 text-[13px]"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-[6px] text-faint transition-colors hover:bg-surface-2 hover:text-fg"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      </div>
      <nav className="scrollbar-thin mt-1 flex-1 overflow-y-auto px-3 pb-3" aria-label="Chats">
        {groups.map(({ group, items }) => (
          <section key={group} className="mb-4">
            <h2 className="px-3 pb-1.5 pt-1 text-[11.5px] font-medium text-faint">{group}</h2>
            <ul className="space-y-0.5">
              {items.map((conversation) => (
                <ConversationRow key={conversation.id} conversation={conversation} streaming={turn?.conversationId === conversation.id} />
              ))}
            </ul>
          </section>
        ))}
        {data && items.length === 0 && (
          <p className="px-3 pt-6 text-center text-[13px] text-faint">{search ? 'No chats match that search.' : 'Your chats will appear here.'}</p>
        )}
        {isLoading && <p className="px-3 pt-6 text-center text-[13px] text-faint">Loading chats…</p>}
        {hasNextPage && (
          <div className="px-1 pt-1">
            <button
              type="button"
              onClick={() => void fetchNextPage()}
              disabled={isFetchingNextPage}
              className="h-8 w-full rounded-control text-[12.5px] font-medium text-muted transition-colors hover:bg-surface hover:text-fg disabled:opacity-60"
            >
              {isFetchingNextPage ? 'Loading…' : 'Show older chats'}
            </button>
          </div>
        )}
      </nav>
      <div className="border-t border-line p-3">
        <NavLink to="/settings" className={({ isActive }) => cx('flex h-11 items-center gap-3 rounded-control px-2 transition-colors', isActive ? 'bg-surface shadow-card' : 'hover:bg-surface')}>
          {me && <Avatar name={me.user.name ?? me.user.email ?? 'You'} src={me.user.picture} size={28} />}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13.5px] font-medium">{me?.user.name ?? 'Account'}</span>
            <span className="block truncate text-[12px] text-faint">
              {me ? `${me.usage.used} of ${me.usage.limit} replies today` : ''}
            </span>
          </span>
          <SettingsIcon className="size-4 text-faint" />
        </NavLink>
      </div>
    </>
  )
}

function ConversationRow({ conversation, streaming }: { conversation: Conversation; streaming: boolean }) {
  const { id } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const active = id === conversation.id
  const [renaming, setRenaming] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [title, setTitle] = useState(conversation.title)
  const rename = useRenameConversation()
  const remove = useDeleteConversation()
  return (
    <li className="group relative">
      <NavLink
        to={`/c/${conversation.id}`}
        className={cx('flex h-9 items-center gap-2 rounded-control pl-3 pr-9 text-[13.5px] transition-colors', active ? 'bg-surface text-fg shadow-card' : 'text-muted hover:bg-surface hover:text-fg')}
      >
        <span className="min-w-0 flex-1 truncate">{conversation.title}</span>
        {streaming && <span className="round size-1.5 shrink-0 animate-pulse rounded-full bg-accent" />}
      </NavLink>
      {/* Always visible where there is no hover, so a tap can reach it. */}
      <span className={cx('absolute right-1 top-1/2 -translate-y-1/2 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100', active && 'opacity-100')}>
        <Menu
          trigger={
            <Button variant="ghost" size="icon-sm" aria-label={`Options for ${conversation.title}`} className="size-7">
              <MoreHorizontal />
            </Button>
          }
          items={[
            {
              label: 'Rename',
              icon: <Pencil />,
              onSelect: () => {
                setTitle(conversation.title)
                setRenaming(true)
              },
            },
            { label: 'Delete', icon: <Trash2 />, danger: true, onSelect: () => setConfirm(true) },
          ]}
        />
      </span>
      <Dialog
        open={renaming}
        onClose={() => setRenaming(false)}
        title="Rename chat"
        footer={
          <>
            <Button onClick={() => setRenaming(false)}>Cancel</Button>
            <Button
              variant="primary"
              loading={rename.isPending}
              disabled={!title.trim()}
              onClick={() => rename.mutate({ id: conversation.id, title: title.trim() }, { onSuccess: () => setRenaming(false), onError: () => toast('Could not rename this chat', 'danger') })}
            >
              Save
            </Button>
          </>
        }
      >
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (title.trim()) rename.mutate({ id: conversation.id, title: title.trim() }, { onSuccess: () => setRenaming(false) })
          }}
        >
          <Input value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} aria-label="Title" />
        </form>
      </Dialog>
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Delete this chat?"
        description="Its messages are removed for good."
        loading={remove.isPending}
        onConfirm={() =>
          remove.mutate(conversation.id, {
            onSuccess: () => {
              setConfirm(false)
              if (active) navigate('/', { replace: true })
            },
            onError: () => toast('Could not delete this chat', 'danger'),
          })
        }
      />
    </li>
  )
}

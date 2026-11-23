import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData, type QueryClient } from '@tanstack/react-query'

import type { Conversation, Me, Message, ModelInfo } from '../../shared/types'

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public resetsAt?: number,
  ) {
    super(message)
  }
}

export async function readError(response: Response): Promise<ApiError> {
  let message = response.statusText || 'Request failed.'
  let code: string | undefined
  let resetsAt: number | undefined
  try {
    const body = (await response.json()) as { error?: string; message?: string; resetsAt?: number }
    message = body.message ?? body.error ?? message
    code = body.error
    resetsAt = body.resetsAt
  } catch {
    /* no body */
  }
  return new ApiError(response.status, message, code, resetsAt)
}

/**
 * Every API call goes through one browser path, so the same frontend works when
 * this Worker serves it (an internal rewrite) and when a frontend host proxies
 * it (api/gateway.ts on Vercel). `path` starts with `/`, e.g. `/me`.
 */
export function apiUrl(path: string): string {
  return `/api/gateway?p=${encodeURIComponent(`/api${path}`)}`
}

export async function api<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {}
  const response = await fetch(apiUrl(path), {
    credentials: 'same-origin',
    ...rest,
    headers: { accept: 'application/json', ...(json !== undefined ? { 'content-type': 'application/json' } : {}), ...(rest.headers ?? {}) },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  })
  if (!response.ok) throw await readError(response)
  return (await response.json()) as T
}

export type ConversationPage = { conversation: Conversation; messages: Message[] }
export type ConversationListPage = { items: Conversation[]; nextCursor: string | null }

export const useMe = () =>
  useQuery({
    queryKey: ['me'],
    queryFn: () => api<Me>('/me'),
    retry: false,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    // Until an API key is configured, keep checking so the app unlocks on its
    // own once the owner adds one.
    refetchInterval: (query) => (query.state.data && !query.state.data.capabilities.ai ? 4_000 : false),
  })

export const useModels = () => useQuery({ queryKey: ['models'], queryFn: () => api<{ items: ModelInfo[] }>('/models'), staleTime: 60_000 })

// Pages of chats, newest first. The search text is part of the key, so each
// query is cached separately and paging never mixes two searches together.
export const useConversations = (q = '') =>
  useInfiniteQuery({
    queryKey: ['conversations', q],
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams()
      if (q) params.set('q', q)
      if (pageParam) params.set('cursor', pageParam)
      const search = params.toString()
      return api<ConversationListPage>(`/conversations${search ? `?${search}` : ''}`)
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  })

/**
 * Keeps every cached conversation list in step after a rename or new chat.
 * A chat that is not in a list yet is only added to the unfiltered one: adding
 * it to an active search would show a chat the search did not match.
 */
export function upsertConversation(client: QueryClient, conversation: Conversation) {
  for (const query of client.getQueryCache().findAll({ queryKey: ['conversations'] })) {
    const search = query.queryKey[1]
    const filtered = typeof search === 'string' && search.length > 0
    client.setQueryData<InfiniteData<ConversationListPage>>(query.queryKey, (old) => {
      if (!old) return old
      let found = false
      const pages = old.pages.map((page) => {
        if (!page.items.some((c) => c.id === conversation.id)) return page
        found = true
        return { ...page, items: page.items.map((c) => (c.id === conversation.id ? conversation : c)) }
      })
      if (found) return { ...old, pages }
      if (filtered) return old
      const [first, ...rest] = pages
      return first ? { ...old, pages: [{ ...first, items: [conversation, ...first.items] }, ...rest] } : old
    })
  }
}

export function removeConversationFromLists(client: QueryClient, id: string) {
  client.setQueriesData<InfiniteData<ConversationListPage>>({ queryKey: ['conversations'] }, (old) => old && {
    ...old,
    pages: old.pages.map((page) => ({ ...page, items: page.items.filter((c) => c.id !== id) })),
  })
}

export const useConversation = (id: string | undefined) =>
  useQuery({
    queryKey: ['conversation', id],
    queryFn: () => api<ConversationPage>(`/conversations/${id}`),
    enabled: Boolean(id),
    staleTime: 60_000,
    // A missing chat is an answer, not a hiccup.
    retry: (count, error) => count < 1 && !(error instanceof ApiError && error.status < 500),
  })

export function useRenameConversation() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) => api<{ conversation: Conversation }>(`/conversations/${id}`, { method: 'PATCH', json: { title } }),
    onSuccess: ({ conversation }) => {
      upsertConversation(client, conversation)
      client.setQueryData<ConversationPage>(['conversation', conversation.id], (old) => old && { ...old, conversation })
    },
  })
}

export function useSetConversationModel() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ id, model }: { id: string; model: string }) => api<{ conversation: Conversation }>(`/conversations/${id}`, { method: 'PATCH', json: { model } }),
    // The picker changes at once. A refused save puts the previous model back,
    // instead of leaving the picker naming a model the chat does not have.
    onMutate: async ({ id, model }) => {
      await client.cancelQueries({ queryKey: ['conversation', id] })
      const previous = client.getQueryData<ConversationPage>(['conversation', id])
      client.setQueryData<ConversationPage>(['conversation', id], (old) => old && { ...old, conversation: { ...old.conversation, model } })
      return { previous }
    },
    onError: (_error, { id }, context) => {
      if (context?.previous) client.setQueryData(['conversation', id], context.previous)
      else void client.invalidateQueries({ queryKey: ['conversation', id] })
    },
    onSuccess: ({ conversation }, { id }) => {
      client.setQueryData<ConversationPage>(['conversation', id], (old) => old && { ...old, conversation })
    },
  })
}

export function useDeleteConversation() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api(`/conversations/${id}`, { method: 'DELETE' }),
    onSuccess: (_, id) => {
      removeConversationFromLists(client, id)
      client.removeQueries({ queryKey: ['conversation', id] })
    },
  })
}

export function useDeleteAllConversations() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: () => api('/account/conversations', { method: 'DELETE' }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['conversations'] })
      client.removeQueries({ queryKey: ['conversation'] })
    },
  })
}

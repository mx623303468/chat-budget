/**
 * API 客户端
 * - 基于 fetch，credentials: 'include' 自动携带 HttpOnly Cookie
 * - 401 时自动调用 /api/auth/refresh 刷新 Access Token
 * - 并发 401 只触发一次 refresh
 */

import type { User, Ledger, Transaction, LedgerInvite } from '@chat-budget/shared'

// ─── 响应类型 ───────────────────────────────────────────────

export type ApiError = {
  error: string
  code?: string
  latest?: unknown
}

export type AuthResponse = {
  user: User
}

export type LedgersResponse = {
  ledgers: Ledger[]
}

export type LedgerResponse = {
  ledger: Ledger
}

export type TransactionsResponse = {
  transactions: Transaction[]
  nextCursor: string | null
}

export type TransactionCreateResponse = {
  id: string
  version: number
}

export type TransactionUpdateResponse = {
  id: string
  version: number
}

export type InvitePreviewResponse = {
  ledgerName: string
  memberCount: number
}

export type JoinLedgerResponse = {
  ledgerId: string
}

export type InviteResponse = {
  id: string
  code: string
  expiresAt: number | null
}

export type RotateInviteResponse = {
  id: string
  code: string
  expiresAt: number
}

export type MembersResponse = {
  members: Array<{
    userId: string
    nickname: string
    role: string
    joinedAt: number
    removedAt: number | null
  }>
}

// ─── Token 刷新锁 ───────────────────────────────────────────

let refreshPromise: Promise<boolean> | null = null

/**
 * 尝试刷新 Access Token，并发时只发一次请求
 */
async function tryRefresh(): Promise<boolean> {
  if (refreshPromise) return refreshPromise

  refreshPromise = (async () => {
    try {
      const res = await fetch('/api/auth/refresh', {
        method: 'POST',
        credentials: 'include',
      })
      return res.ok
    } catch {
      return false
    } finally {
      refreshPromise = null
    }
  })()

  return refreshPromise
}

// ─── 核心请求方法 ────────────────────────────────────────────

async function request<T>(
  url: string,
  options: RequestInit = {},
): Promise<T> {
  const res = await fetch(url, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  })

  if (res.status === 401) {
    // 尝试刷新 Token
    const refreshed = await tryRefresh()
    if (refreshed) {
      // 重试原始请求
      const retryRes = await fetch(url, {
        ...options,
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...options.headers,
        },
      })
      if (retryRes.ok) {
        return retryRes.json() as Promise<T>
      }
      // 刷新成功但请求仍失败，抛出错误
      const err: ApiError = await retryRes.json().catch(() => ({ error: '请求失败' }))
      throw new ApiClientError(err.error, retryRes.status, err.code, err.latest)
    }
    // 刷新失败，需要重新登录
    throw new ApiClientError('登录已过期，请重新登录', 401)
  }

  if (!res.ok) {
    const err: ApiError = await res.json().catch(() => ({ error: '请求失败' }))
    throw new ApiClientError(err.error, res.status, err.code, err.latest)
  }

  // 处理 204 No Content
  if (res.status === 204) {
    return undefined as T
  }

  return res.json() as Promise<T>
}

// ─── 自定义错误类 ───────────────────────────────────────────

export class ApiClientError extends Error {
  status: number
  code?: string
  latest?: unknown

  constructor(message: string, status: number, code?: string, latest?: unknown) {
    super(message)
    this.name = 'ApiClientError'
    this.status = status
    this.code = code
    this.latest = latest
  }
}

// ─── Auth API ───────────────────────────────────────────────

export const authApi = {
  register(data: { email: string; password: string; nickname: string }): Promise<AuthResponse> {
    return request('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  },

  login(data: { email: string; password: string }): Promise<AuthResponse> {
    return request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  },

  logout(): Promise<{ ok: boolean }> {
    return request('/api/auth/logout', {
      method: 'POST',
    })
  },

  me(): Promise<AuthResponse> {
    return request('/api/auth/me')
  },

  refresh(): Promise<AuthResponse> {
    return request('/api/auth/refresh', {
      method: 'POST',
    })
  },
}

// ─── Ledgers API ────────────────────────────────────────────

export const ledgersApi = {
  list(): Promise<LedgersResponse> {
    return request('/api/ledgers')
  },

  get(id: string): Promise<LedgerResponse> {
    return request(`/api/ledgers/${id}`)
  },

  create(data: { name: string; dailyLimit?: number; startDate: string }): Promise<LedgerResponse> {
    return request('/api/ledgers', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  },

  update(id: string, data: { name?: string; dailyLimit?: number; startDate?: string }): Promise<LedgerResponse> {
    return request(`/api/ledgers/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  },

  delete(id: string): Promise<{ ok: boolean }> {
    return request(`/api/ledgers/${id}`, {
      method: 'DELETE',
    })
  },
}

// ─── Transactions API ───────────────────────────────────────

export const transactionsApi = {
  list(
    ledgerId: string,
    params?: { cursor?: string; limit?: number },
  ): Promise<TransactionsResponse> {
    const searchParams = new URLSearchParams()
    if (params?.cursor) searchParams.set('cursor', params.cursor)
    if (params?.limit) searchParams.set('limit', String(params.limit))
    const qs = searchParams.toString()
    return request(`/api/ledgers/${ledgerId}/transactions${qs ? `?${qs}` : ''}`)
  },

  create(
    ledgerId: string,
    data: {
      id: string
      clientMutationId: string
      amount: number
      note: string
      date: string
    },
  ): Promise<TransactionCreateResponse> {
    return request(`/api/ledgers/${ledgerId}/transactions`, {
      method: 'POST',
      body: JSON.stringify(data),
    })
  },

  update(
    ledgerId: string,
    transactionId: string,
    data: {
      clientMutationId: string
      version: number
      amount?: number
      note?: string
      date?: string
    },
  ): Promise<TransactionUpdateResponse> {
    return request(`/api/ledgers/${ledgerId}/transactions/${transactionId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  },

  delete(
    ledgerId: string,
    transactionId: string,
    clientMutationId?: string,
  ): Promise<{ ok: boolean }> {
    const qs = clientMutationId ? `?clientMutationId=${clientMutationId}` : ''
    return request(`/api/ledgers/${ledgerId}/transactions/${transactionId}${qs}`, {
      method: 'DELETE',
    })
  },
}

// ─── Invites API ─────────────────────────────────────────────

export const invitesApi = {
  get(ledgerId: string): Promise<InviteResponse> {
    return request(`/api/ledgers/${ledgerId}/invite`)
  },

  rotate(ledgerId: string): Promise<RotateInviteResponse> {
    return request(`/api/ledgers/${ledgerId}/invite/rotate`, {
      method: 'POST',
    })
  },

  preview(code: string): Promise<InvitePreviewResponse> {
    return request(`/api/invites/${code}`)
  },

  join(code: string): Promise<JoinLedgerResponse> {
    return request('/api/invites/join', {
      method: 'POST',
      body: JSON.stringify({ code }),
    })
  },
}

// ─── Members API ────────────────────────────────────────────

export const membersApi = {
  list(ledgerId: string): Promise<MembersResponse> {
    return request(`/api/ledgers/${ledgerId}/members`)
  },

  remove(ledgerId: string, userId: string): Promise<{ ok: boolean }> {
    return request(`/api/ledgers/${ledgerId}/members/${userId}`, { method: 'DELETE' })
  },

  leave(ledgerId: string): Promise<{ ok: boolean }> {
    return request(`/api/ledgers/${ledgerId}/members/me`, { method: 'DELETE' })
  },
}

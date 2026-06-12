/**
 * Thin fetch wrapper for the tonedeck daemon REST API.
 *
 * All network errors and HTTP failures map to CliError with an exit code:
 *   1 — daemon unreachable / network error
 *   2 — user error: 404 unknown slug | bad args | invalid preset (422-user)
 *   3 — daemon refused: 409 not_engaged | 422-refused | 502 upstream
 */

export class CliError extends Error {
  constructor(
    message: string,
    public readonly exitCode: number,
    public readonly data?: unknown,
  ) {
    super(message)
    this.name = 'CliError'
  }
}

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>

export interface ApiCtx {
  baseUrl: string
  fetchFn: FetchFn
}

export function makeCtx(baseUrl: string, fetchFn: FetchFn = globalThis.fetch as FetchFn): ApiCtx {
  return { baseUrl, fetchFn }
}

async function request<T>(
  ctx: ApiCtx,
  method: string,
  path: string,
  body?: unknown,
  errorMode: 'user' | 'refused' = 'user',
): Promise<T> {
  const url = `${ctx.baseUrl}${path}`
  let res: Response
  try {
    res = await ctx.fetchFn(url, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch (err) {
    throw new CliError(`Daemon unreachable: ${(err as Error).message}`, 1)
  }

  if (res.ok) {
    if (res.status === 204) return undefined as T
    // Non-JSON responses (artwork) return null — callers handle this
    const ct = res.headers.get('content-type') ?? ''
    if (!ct.includes('application/json')) return null as T
    return res.json() as Promise<T>
  }

  let errBody: { error?: string } = {}
  try {
    errBody = (await res.json()) as { error?: string }
  } catch {
    /* ignore */
  }
  const msg = errBody.error ?? `HTTP ${res.status}`

  if (res.status === 404) throw new CliError(msg, 2)
  if (res.status === 409) throw new CliError(msg, 3)
  if (res.status === 422) throw new CliError(msg, errorMode === 'refused' ? 3 : 2)
  if (res.status === 502) throw new CliError(msg, 3)
  if (res.status >= 400 && res.status < 500) throw new CliError(msg, 2)
  throw new CliError(msg, 1)
}

export function apiGet<T>(ctx: ApiCtx, path: string): Promise<T> {
  return request<T>(ctx, 'GET', path)
}

export function apiPost<T>(
  ctx: ApiCtx,
  path: string,
  body?: unknown,
  errorMode: 'user' | 'refused' = 'user',
): Promise<T> {
  return request<T>(ctx, 'POST', path, body, errorMode)
}

export function apiPut<T>(ctx: ApiCtx, path: string, body: unknown): Promise<T> {
  return request<T>(ctx, 'PUT', path, body)
}

export function apiDelete(ctx: ApiCtx, path: string): Promise<void> {
  return request<void>(ctx, 'DELETE', path)
}

/** Probe an endpoint for status without attempting to parse the body as JSON. */
export async function apiProbe(
  ctx: ApiCtx,
  path: string,
): Promise<{ status: number; ok: boolean; contentType: string | null }> {
  const url = `${ctx.baseUrl}${path}`
  try {
    const res = await ctx.fetchFn(url, { method: 'GET' })
    // Drain body to avoid connection leak
    try {
      await res.arrayBuffer()
    } catch {
      /* ignore */
    }
    return {
      status: res.status,
      ok: res.ok,
      contentType: res.headers.get('content-type'),
    }
  } catch (err) {
    throw new CliError(`Daemon unreachable: ${(err as Error).message}`, 1)
  }
}

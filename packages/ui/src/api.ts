/**
 * api.ts — typed fetch helpers with one normalized error shape.
 *
 * Every helper throws `ApiError` on non-2xx (carrying the daemon's `error`
 * message + any `warnings`) or on network failure. Same-origin paths — the
 * daemon serves the built UI, and `vite dev` proxies /api + /ws to the daemon.
 */
import type {
  ApplyResponse,
  ArtworkResult,
  MutationResponse,
  Preset,
  PresetSummary,
  Profile,
  Status,
} from './types.js'

export class ApiError extends Error {
  status: number
  warnings: string[]
  constructor(message: string, status: number, warnings: string[] = []) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.warnings = warnings
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, {
      ...init,
      headers: init?.body ? { 'content-type': 'application/json', ...init?.headers } : init?.headers,
    })
  } catch (e) {
    throw new ApiError(e instanceof Error ? e.message : 'network error', 0)
  }
  const text = await res.text()
  const body = text ? safeJson(text) : null
  if (!res.ok) {
    let msg = `HTTP ${res.status}`
    let warnings: string[] = []
    if (body && typeof body === 'object') {
      const b = body as { error?: unknown; warnings?: unknown }
      if (typeof b.error === 'string') msg = b.error
      if (Array.isArray(b.warnings)) warnings = b.warnings as string[]
    }
    throw new ApiError(msg, res.status, warnings)
  }
  return body as T
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

const json = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) })

export const api = {
  status: () => req<Status>('/api/status'),
  presets: () => req<{ presets: PresetSummary[] }>('/api/presets').then((r) => r.presets),
  preset: (slug: string) => req<Preset>(`/api/presets/${slug}`),
  profile: (id: string) => req<Profile>(`/api/profiles/${id}`),

  apply: (slug: string, engage = true) =>
    req<ApplyResponse>(`/api/presets/${slug}/apply`, json({ engage })),
  engage: (preset?: string) => req<Status>('/api/engage', json(preset ? { preset } : {})),
  disengage: () => req<Status>('/api/disengage', json({})),
  panic: () => req<unknown>('/api/panic', json({})),
  bypass: (on: boolean) => req<Status>('/api/bypass', json({ on })),
  preview: (preset: Preset) => req<{ ok: true }>('/api/preview', json({ preset })),

  create: (preset: Preset) => req<MutationResponse>('/api/presets', json({ preset })),
  revertOriginal: (slug: string) =>
    req<MutationResponse & { revertedTo: string }>(
      `/api/presets/${slug}/revert`,
      json({ original: true, reason: 'reset from UI' }),
    ),
  update: (slug: string, preset: Preset, change: string, reason: string) =>
    req<MutationResponse>(`/api/presets/${slug}`, {
      method: 'PUT',
      body: JSON.stringify({ preset, change, reason }),
    }),

  searchArtwork: (term: string, entity: 'album' | 'song' = 'album') =>
    req<{ results: ArtworkResult[] }>(
      `/api/artwork/search?term=${encodeURIComponent(term)}&entity=${entity}`,
    ).then((r) => r.results),

  /** URL for an album's cached artwork (404 → caller shows a fallback tile). */
  artworkUrl: (slug: string) => `/api/artwork/${slug}`,
}

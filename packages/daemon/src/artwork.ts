/**
 * Artwork module — iTunes search + local JPEG cache.
 *
 * fetchImpl is injectable for tests; default = globalThis.fetch (Node ≥22).
 * No rate-limiting inside this module — callers space requests.
 */
import { existsSync } from 'node:fs'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'

// ── Error type ────────────────────────────────────────────────────────────────

export class ArtworkError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ArtworkError'
  }
}

// ── Public shapes ─────────────────────────────────────────────────────────────

export interface ArtworkResult {
  collectionId: number
  artistName: string
  collectionName: string
  artworkUrl100: string
  artworkUrl600: string
  /** Present for entity=song results. */
  trackId?: number
  trackName?: string
}

export type SearchEntity = 'album' | 'song'

// Loose fetch shape so tests inject simple fakes without needing exact global types.
export type FetchLike = (
  url: string,
  init?: { signal?: AbortSignal; [k: string]: unknown },
) => Promise<{
  ok: boolean
  status: number
  json(): Promise<unknown>
  arrayBuffer(): Promise<ArrayBuffer>
}>

export interface ArtworkModuleOpts {
  cacheDir: string
  fetchImpl?: FetchLike
}

// ── Artwork class ─────────────────────────────────────────────────────────────

export class Artwork {
  private readonly cacheDir: string
  private readonly fetchImpl: FetchLike

  constructor(opts: ArtworkModuleOpts) {
    this.cacheDir = opts.cacheDir
    this.fetchImpl = opts.fetchImpl ?? (globalThis.fetch as unknown as FetchLike)
  }

  /** Search iTunes for albums or songs matching `term`. Returns up to 8 results. */
  async search(term: string, entity: SearchEntity = 'album'): Promise<ArtworkResult[]> {
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=${entity}&limit=8&media=music`
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 5000)
    let res: { ok: boolean; status: number; json(): Promise<unknown> }
    try {
      res = await this.fetchImpl(url, { signal: controller.signal })
    } catch (e) {
      throw new ArtworkError(`iTunes search failed: ${(e as Error).message}`)
    } finally {
      clearTimeout(timer)
    }

    if (!res.ok) throw new ArtworkError(`iTunes search returned HTTP ${res.status}`)

    const json = (await res.json()) as { results?: Array<Record<string, unknown>> }
    return (json.results ?? []).map((r) => ({
      collectionId: r.collectionId as number,
      artistName: r.artistName as string,
      collectionName: r.collectionName as string,
      artworkUrl100: r.artworkUrl100 as string,
      // iTunes artworkUrl100 ends like "/100x100bb.jpg"; swap to 600.
      artworkUrl600: (r.artworkUrl100 as string).replace('100x100', '600x600'),
      trackId: r.trackId as number | undefined,
      trackName: r.trackName as string | undefined,
    }))
  }

  /**
   * Return the cache path for `slug`, downloading from `artworkUrl` if not yet
   * cached. The download is atomic (tmp + rename).
   */
  async ensureCached(slug: string, artworkUrl: string): Promise<string> {
    const path = this._cachePath(slug)
    if (existsSync(path)) return path

    await fs.mkdir(this.cacheDir, { recursive: true })

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 5000)
    let res: { ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer> }
    try {
      res = await this.fetchImpl(artworkUrl, { signal: controller.signal })
    } catch (e) {
      throw new ArtworkError(`Artwork download failed: ${(e as Error).message}`)
    } finally {
      clearTimeout(timer)
    }

    if (!res.ok) throw new ArtworkError(`Artwork download returned HTTP ${res.status}`)

    const buf = Buffer.from(await res.arrayBuffer())
    const tmp = `${path}.tmp`
    await fs.writeFile(tmp, buf)
    await fs.rename(tmp, path)
    return path
  }

  /** Synchronous existence check — returns the path or undefined. */
  cachedPath(slug: string): string | undefined {
    const path = this._cachePath(slug)
    return existsSync(path) ? path : undefined
  }

  private _cachePath(slug: string): string {
    return join(this.cacheDir, `${slug}.jpg`)
  }
}

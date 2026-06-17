/**
 * Song catalog — the work-list for bulk EQ generation. Cheap + repeatable to
 * build (ingest); separate from presets, which are slow + resumable to create.
 * Entries are deduped by a normalized (artist, title) key.
 */
import { z } from 'zod'
import { slugify } from './slug.js'

export const CatalogSourceSchema = z.enum(['itunes', 'apple-liked', 'ytmusic-liked'])
export type CatalogSource = z.infer<typeof CatalogSourceSchema>

export const CatalogEntrySchema = z.object({
  title: z.string().min(1),
  artist: z.string().min(1),
  album: z.string().optional(),
  source: CatalogSourceSchema,
  externalId: z.string().optional(),
})
export type CatalogEntry = z.infer<typeof CatalogEntrySchema>

/** Stable identity key for dedup: normalized (artist, title). Reuses slugify so
 *  "Kanye West / Black Skinhead" and "kanye west / black skinhead" collapse. */
export function catalogKey(artist: string, title: string): string {
  return slugify(artist, title)
}

/** Merge incoming into existing, deduping by catalogKey. First-seen wins, so the
 *  ordering of ingest passes determines which source's metadata is kept. */
export function mergeCatalog(existing: CatalogEntry[], incoming: CatalogEntry[]): CatalogEntry[] {
  const byKey = new Map<string, CatalogEntry>()
  for (const e of existing) byKey.set(catalogKey(e.artist, e.title), e)
  for (const e of incoming) {
    const k = catalogKey(e.artist, e.title)
    if (!byKey.has(k)) byKey.set(k, e)
  }
  return Array.from(byKey.values())
}

/** iTunes lookup `results` → song entries, filtered to a primary artistId so
 *  guest features ("… (feat. Kanye West)") are dropped. */
export function parseItunesSongs(results: unknown, artistId: number): CatalogEntry[] {
  if (!Array.isArray(results)) return []
  const out: CatalogEntry[] = []
  for (const r of results as Array<Record<string, unknown>>) {
    if (r.wrapperType !== 'track' || r.kind !== 'song') continue
    if (Number(r.artistId) !== artistId) continue
    const title = String(r.trackName ?? '').trim()
    const artist = String(r.artistName ?? '').trim()
    if (!title || !artist) continue
    out.push({
      title,
      artist,
      album: r.collectionName ? String(r.collectionName) : undefined,
      source: 'itunes',
      externalId: r.trackId != null ? String(r.trackId) : undefined,
    })
  }
  return out
}

/** osascript output — one `title<TAB>artist<TAB>album` line per loved track. */
export function parseAppleLoved(raw: string): CatalogEntry[] {
  const out: CatalogEntry[] = []
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue
    const [title, artist, album] = line.split('\t')
    if (!title?.trim() || !artist?.trim()) continue
    out.push({
      title: title.trim(),
      artist: artist.trim(),
      album: album?.trim() || undefined,
      source: 'apple-liked',
    })
  }
  return out
}

/** Scraped YouTube Music rows → entries. */
export function parseYtMusicRows(
  rows: Array<{ title?: string; artist?: string; album?: string }>,
): CatalogEntry[] {
  const out: CatalogEntry[] = []
  for (const r of rows) {
    const title = (r.title ?? '').trim()
    const artist = (r.artist ?? '').trim()
    if (!title || !artist) continue
    out.push({ title, artist, album: r.album?.trim() || undefined, source: 'ytmusic-liked' })
  }
  return out
}

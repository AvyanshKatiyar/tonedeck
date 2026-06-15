/**
 * Fastify plugin — iTunes artwork search + cached-file serving.
 *
 * Routes:
 *   GET /api/artwork/search?term=  → { results: ArtworkResult[] } | 400 | 502
 *   GET /api/artwork/:slug         → image/jpeg (cached) | 404 | 502
 */
import { createReadStream } from 'node:fs'
import type { FastifyPluginAsync } from 'fastify'
import { ArtworkError, type Artwork, type ArtworkResult } from '../artwork.js'
import type { PresetStore } from '../presets.js'

export interface ArtworkPluginOpts {
  store: PresetStore
  artwork: Artwork
}

/** Minimal preset shape the artwork resolver reads. */
interface ArtPreset {
  kind?: string
  title: string
  artist?: string
  artwork?: { url?: string }
}

// In-flight artwork resolutions keyed by slug, so a burst of concurrent
// requests for the same uncached cover triggers only one iTunes lookup.
const inflight = new Map<string, Promise<string | null>>()

/** Strip combining diacritics so "Måneskin" matches "Maneskin", "Beyoncé" "Beyonce". */
const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
const norm = (s?: string) => fold((s ?? '').toLowerCase()).trim()
/** Drop "(feat …)" and " - EP/Single/Remix…" tails so titles compare cleanly. */
const clean = (s?: string) =>
  norm(s)
    .replace(/\s*[([]?feat\.?[^)\]]*[)\]]?.*$/, '')
    .replace(/\s*-\s*(ep|single|remix|mixed|version|edit)\b.*$/, '')
    .trim()

/**
 * Find an iTunes artwork URL for a preset from its metadata. Searches songs for
 * track presets and albums otherwise. Album matches are conservative (exact or
 * album-name-contains-title) so iTunes-absent records don't borrow the wrong
 * cover; track matches also accept a same-artist track containing every title
 * word. Returns undefined when nothing credible matches.
 */
async function lookupItunesMatch(artwork: Artwork, preset: ArtPreset): Promise<ArtworkResult | undefined> {
  const entity: 'song' | 'album' = preset.kind === 'track' ? 'song' : 'album'
  const term = [preset.artist, preset.title].filter(Boolean).join(' ')
  if (!term.trim()) return undefined
  let results: ArtworkResult[]
  try {
    results = await artwork.search(term, entity)
  } catch {
    return undefined
  }
  const title = clean(preset.title)
  const artist = norm(preset.artist)
  const artistOk = (r: ArtworkResult) =>
    !artist || norm(r.artistName).includes(artist) || artist.includes(norm(r.artistName))

  if (entity === 'album') {
    const name = (r: ArtworkResult) => clean(r.collectionName)
    return (
      results.find((r) => artistOk(r) && name(r) === title) ??
      results.find((r) => artistOk(r) && name(r).includes(title))
    )
  }
  const name = (r: ArtworkResult) => clean(r.trackName ?? r.collectionName)
  const words = title.split(/\s+/).filter((w) => w.length > 3)
  return (
    results.find((r) => artistOk(r) && name(r) === title) ??
    results.find((r) => artistOk(r) && (name(r).includes(title) || title.includes(name(r)))) ??
    (words.length ? results.find((r) => artistOk(r) && words.every((w) => name(r).includes(w))) : undefined)
  )
}

/**
 * Resolve a cached artwork path for a slug with no cached file yet: use the
 * preset's configured url, else a live iTunes lookup. A self-healed cover is
 * persisted back to the preset so it becomes permanent (survives cache clears,
 * shows in /api/presets). Concurrent calls for the same slug share one
 * resolution. Returns the cached path, or null if none.
 */
async function resolveArtwork(
  artwork: Artwork,
  store: PresetStore,
  slug: string,
  preset: ArtPreset,
): Promise<string | null> {
  const existing = inflight.get(slug)
  if (existing) return existing
  const job = (async (): Promise<string | null> => {
    let url = preset.artwork?.url
    let match: ArtworkResult | undefined
    if (!url) {
      match = await lookupItunesMatch(artwork, preset)
      url = match?.artworkUrl600
    }
    if (!url) return null
    let path: string
    try {
      path = await artwork.ensureCached(slug, url)
    } catch {
      return null
    }
    if (match) {
      try {
        await store.attachArtwork(slug, { itunesCollectionId: match.collectionId, url: match.artworkUrl600 })
      } catch {
        /* persistence is best-effort — the cached file already serves the cover */
      }
    }
    return path
  })().finally(() => inflight.delete(slug))
  inflight.set(slug, job)
  return job
}

const artworkPlugin: FastifyPluginAsync<ArtworkPluginOpts> = async (
  fastify,
  { store, artwork },
) => {
  fastify.get('/api/artwork/search', async (req, reply) => {
    const { term, entity } = req.query as { term?: string; entity?: string }
    if (!term?.trim()) {
      return reply.status(400).send({ error: 'Query param "term" is required' })
    }
    try {
      const results = await artwork.search(term, entity === 'song' ? 'song' : 'album')
      return { results }
    } catch (e) {
      if (e instanceof ArtworkError) {
        return reply.status(502).send({ error: e.message })
      }
      throw e
    }
  })

  fastify.get('/api/artwork/:slug', async (req, reply) => {
    const { slug } = req.params as { slug: string }

    // 1. Already cached — serve immediately.
    const cached = artwork.cachedPath(slug)
    if (cached) {
      return reply.type('image/jpeg').send(createReadStream(cached))
    }

    // 2. Resolve from the preset: its configured url, else a live iTunes lookup
    //    from artist/title (so presets created without artwork — e.g. auto-EQ —
    //    still get a cover, cached for next time).
    const preset = store.getPreset(slug)
    if (!preset) {
      return reply.status(404).send({ error: `No preset "${slug}"` })
    }

    try {
      const path = await resolveArtwork(artwork, store, slug, preset)
      if (!path) {
        return reply.status(404).send({ error: `No artwork found for "${slug}"` })
      }
      return reply.type('image/jpeg').send(createReadStream(path))
    } catch (e) {
      if (e instanceof ArtworkError) {
        return reply.status(502).send({ error: e.message })
      }
      throw e
    }
  })
}

export default artworkPlugin

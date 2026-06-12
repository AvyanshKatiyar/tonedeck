/**
 * Fastify plugin — iTunes artwork search + cached-file serving.
 *
 * Routes:
 *   GET /api/artwork/search?term=  → { results: ArtworkResult[] } | 400 | 502
 *   GET /api/artwork/:slug         → image/jpeg (cached) | 404 | 502
 */
import { createReadStream } from 'node:fs'
import type { FastifyPluginAsync } from 'fastify'
import { ArtworkError, type Artwork } from '../artwork.js'
import type { PresetStore } from '../presets.js'

export interface ArtworkPluginOpts {
  store: PresetStore
  artwork: Artwork
}

const artworkPlugin: FastifyPluginAsync<ArtworkPluginOpts> = async (
  fastify,
  { store, artwork },
) => {
  fastify.get('/api/artwork/search', async (req, reply) => {
    const { term } = req.query as { term?: string }
    if (!term?.trim()) {
      return reply.status(400).send({ error: 'Query param "term" is required' })
    }
    try {
      const results = await artwork.search(term)
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

    // 2. Preset has an artwork URL — download then serve.
    const preset = store.getPreset(slug)
    if (!preset?.artwork?.url) {
      return reply.status(404).send({ error: `No artwork cached or configured for "${slug}"` })
    }

    try {
      const path = await artwork.ensureCached(slug, preset.artwork.url)
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

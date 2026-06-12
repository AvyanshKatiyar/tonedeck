/**
 * Fastify plugin — preset CRUD + profile read routes.
 *
 * Routes:
 *   GET  /api/presets          → { presets: PresetSummary[] }
 *   GET  /api/presets/:slug    → Preset | 404
 *   POST /api/presets          → 201 { preset, warnings, verdict } | 409 | 422
 *   PUT  /api/presets/:slug    → 200 { preset, warnings, verdict } | 404 | 422
 *   DELETE /api/presets/:slug  → 204 | 404
 *   GET  /api/presets/:slug/versions → { versions } | 404
 *   POST /api/presets/:slug/revert   → 200 { preset, warnings, verdict, revertedTo } | 404 | 422
 *   GET  /api/profiles         → { profiles: Profile[] }
 *   GET  /api/profiles/:id     → Profile | 404
 */
import type { FastifyPluginAsync, FastifyReply } from 'fastify'
import { StoreError, type PresetStore } from '../presets.js'

export interface PresetsPluginOpts {
  store: PresetStore
}

const presetsPlugin: FastifyPluginAsync<PresetsPluginOpts> = async (fastify, { store }) => {
  // ── Presets ───────────────────────────────────────────────────────────────

  fastify.get('/api/presets', async () => {
    return { presets: store.listPresets() }
  })

  fastify.get('/api/presets/:slug', async (req, reply) => {
    const { slug } = req.params as { slug: string }
    const preset = store.getPreset(slug)
    if (!preset) return reply.status(404).send({ error: `Preset "${slug}" not found` })
    return preset
  })

  fastify.post('/api/presets', async (req, reply) => {
    const body = req.body as {
      preset: unknown
      clamp?: boolean
      autoTrim?: boolean
    }
    try {
      const result = await store.createPreset(body?.preset, {
        clamp: body?.clamp,
        autoTrim: body?.autoTrim,
      })
      return reply.status(201).send(result)
    } catch (e) {
      return mapStoreError(e, reply)
    }
  })

  fastify.put('/api/presets/:slug', async (req, reply) => {
    const { slug } = req.params as { slug: string }
    const body = req.body as {
      preset: unknown
      change: string
      reason: string
      clamp?: boolean
      autoTrim?: boolean
    }
    try {
      const result = await store.updatePreset(
        slug,
        body?.preset,
        { change: body?.change ?? '', reason: body?.reason ?? '' },
        { clamp: body?.clamp, autoTrim: body?.autoTrim },
      )
      return result
    } catch (e) {
      return mapStoreError(e, reply)
    }
  })

  fastify.delete('/api/presets/:slug', async (req, reply) => {
    const { slug } = req.params as { slug: string }
    try {
      await store.deletePreset(slug)
      return reply.status(204).send()
    } catch (e) {
      return mapStoreError(e, reply)
    }
  })

  fastify.get('/api/presets/:slug/versions', async (req, reply) => {
    const { slug } = req.params as { slug: string }
    try {
      return { versions: await store.listVersions(slug) }
    } catch (e) {
      return mapStoreError(e, reply)
    }
  })

  fastify.post('/api/presets/:slug/revert', async (req, reply) => {
    const { slug } = req.params as { slug: string }
    const body = (req.body ?? {}) as { toVersion?: number; original?: boolean; reason?: string }
    try {
      return await store.revertPreset(slug, body)
    } catch (e) {
      return mapStoreError(e, reply)
    }
  })

  // ── Profiles ──────────────────────────────────────────────────────────────

  fastify.get('/api/profiles', async () => {
    return { profiles: store.listProfiles() }
  })

  fastify.get('/api/profiles/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    const profile = store.getProfile(id)
    if (!profile) return reply.status(404).send({ error: `Profile "${id}" not found` })
    return profile
  })
}

/** Map StoreError codes to HTTP status codes. Re-throws for unexpected errors. */
function mapStoreError(e: unknown, reply: FastifyReply): ReturnType<FastifyReply['send']> {
  if (e instanceof StoreError) {
    if (e.code === 'exists') {
      return reply.status(409).send({ error: e.message })
    }
    if (e.code === 'not_found') {
      return reply.status(404).send({ error: e.message })
    }
    if (e.code === 'invalid' || e.code === 'rejected') {
      return reply.status(422).send({ error: e.message, warnings: e.warnings })
    }
  }
  throw e
}

export default presetsPlugin

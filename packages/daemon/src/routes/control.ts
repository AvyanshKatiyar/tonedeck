/**
 * Fastify plugin — daemon control plane (engage / disengage / panic / apply /
 * preview / bypass / status). Handlers are thin: all the real work + the typed
 * error codes live in Lifecycle; here we only translate codes to HTTP statuses.
 *
 * Routes:
 *   POST /api/engage              { preset? }            → 200 status | 422
 *   POST /api/disengage                                  → 200 status
 *   POST /api/panic                                      → 200 (always)
 *   POST /api/presets/:slug/apply { engage?=true }       → 200 {status,warnings,verdict} | 404 | 409 | 422
 *   POST /api/preview             { preset }             → 200 {ok:true} | 409 | 422
 *   POST /api/bypass              { on }                 → 200 status | 409 | 422
 *   GET  /api/status                                     → 200 status
 */
import type { FastifyPluginAsync, FastifyReply } from 'fastify'
import { LifecycleError, type ApplyResult, type LifecycleStatus } from '../lifecycle.js'
import { CdspError } from '../cdsp.js'

/** The control surface a Lifecycle (or a test fake) must expose. */
export interface ControlLifecycle {
  readonly engaged: boolean
  engage(slug?: string): Promise<LifecycleStatus>
  disengage(): Promise<LifecycleStatus>
  panic(): Promise<LifecycleStatus>
  applyPreset(slug: string): Promise<ApplyResult>
  preview(presetLike: unknown): Promise<void>
  bypass(on: boolean): Promise<LifecycleStatus>
  status(): Promise<LifecycleStatus>
}

export interface ControlPluginOpts {
  lifecycle: ControlLifecycle
}

const controlPlugin: FastifyPluginAsync<ControlPluginOpts> = async (fastify, { lifecycle }) => {
  // ── engage ─────────────────────────────────────────────────────────────────
  fastify.post('/api/engage', async (req, reply) => {
    const body = (req.body ?? {}) as { preset?: string }
    try {
      return await lifecycle.engage(body.preset)
    } catch (e) {
      // Any engage failure (device resolution, --check, ws) is a 422.
      return reply.status(422).send({ error: errMessage(e) })
    }
  })

  // ── disengage ────────────────────────────────────────────────────────────--
  fastify.post('/api/disengage', async () => {
    return lifecycle.disengage()
  })

  // ── panic (always 200) ───────────────────────────────────────────────────--
  fastify.post('/api/panic', async (_req, reply) => {
    try {
      return await lifecycle.panic()
    } catch (e) {
      // panic is contractually best-effort; never surface a failure status.
      return reply.status(200).send({ ok: true, error: errMessage(e) })
    }
  })

  // ── apply a preset ───────────────────────────────────────────────────────--
  fastify.post('/api/presets/:slug/apply', async (req, reply) => {
    const { slug } = req.params as { slug: string }
    const body = (req.body ?? {}) as { engage?: boolean }
    const wantEngage = body.engage !== false // default true
    try {
      if (!lifecycle.engaged && wantEngage) {
        const status = await lifecycle.engage(slug)
        return { status, warnings: [], verdict: 'ok' }
      }
      const result = await lifecycle.applyPreset(slug)
      const status = await lifecycle.status()
      return { status, warnings: result.warnings, verdict: result.verdict }
    } catch (e) {
      return mapLifecycleError(e, reply)
    }
  })

  // ── preview (ephemeral) ────────────────────────────────────────────────────
  fastify.post('/api/preview', async (req, reply) => {
    const body = (req.body ?? {}) as { preset?: unknown }
    try {
      await lifecycle.preview(body.preset)
      return { ok: true }
    } catch (e) {
      if (e instanceof LifecycleError && e.code === 'not_engaged') {
        return reply.status(409).send({ error: e.message })
      }
      return reply.status(422).send({ error: errMessage(e) })
    }
  })

  // ── bypass ───────────────────────────────────────────────────────────────--
  fastify.post('/api/bypass', async (req, reply) => {
    const body = (req.body ?? {}) as { on?: unknown }
    if (typeof body.on !== 'boolean') {
      return reply.status(422).send({ error: 'body.on must be a boolean' })
    }
    try {
      return await lifecycle.bypass(body.on)
    } catch (e) {
      if (e instanceof LifecycleError && e.code === 'not_engaged') {
        return reply.status(409).send({ error: e.message })
      }
      return reply.status(422).send({ error: errMessage(e) })
    }
  })

  // ── status ───────────────────────────────────────────────────────────────--
  fastify.get('/api/status', async () => {
    return lifecycle.status()
  })
}

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/** Map LifecycleError codes (and cdsp failures) to HTTP statuses. */
function mapLifecycleError(e: unknown, reply: FastifyReply): ReturnType<FastifyReply['send']> {
  if (e instanceof LifecycleError) {
    if (e.code === 'not_found') return reply.status(404).send({ error: e.message })
    if (e.code === 'not_engaged') return reply.status(409).send({ error: e.message })
    // invalid | no_device | device_check | engage_failed
    return reply.status(422).send({ error: e.message })
  }
  // A cdsp protocol failure during apply/engage is a 422, not a 500.
  if (e instanceof CdspError) return reply.status(422).send({ error: e.message })
  return reply.status(422).send({ error: errMessage(e) })
}

export default controlPlugin

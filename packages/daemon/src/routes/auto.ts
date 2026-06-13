import type { FastifyPluginAsync } from 'fastify'
import type { AutoDJ } from '../autodj.js'

export interface AutoPluginOpts {
  autodj: Pick<AutoDJ, 'mode' | 'arm' | 'disarm' | 'tick'>
  persist: (enabled: boolean) => Promise<void>
}

const autoPlugin: FastifyPluginAsync<AutoPluginOpts> = async (fastify, { autodj, persist }) => {
  const status = () => ({ mode: autodj.mode, following: autodj.mode === 'armed' })

  fastify.get('/api/auto', async () => status())

  fastify.post('/api/auto', async (req, reply) => {
    const body = (req.body ?? {}) as { on?: unknown }
    if (typeof body.on !== 'boolean') {
      return reply.status(422).send({ error: 'body.on must be a boolean' })
    }
    if (body.on) autodj.arm()
    else autodj.disarm()
    await persist(body.on)
    return status()
  })

  // Force-resolve the current track now: a far-future `now` clears the debounce.
  fastify.post('/api/auto/now', async () => {
    await autodj.tick(Number.MAX_SAFE_INTEGER)
    return status()
  })
}

export default autoPlugin

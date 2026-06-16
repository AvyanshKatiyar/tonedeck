/**
 * Fastify plugin — tone-only EQ clustering over all presets.
 *
 * Routes:
 *   GET /api/clusters?threshold=<db>  → ClusterResult
 */
import type { FastifyPluginAsync } from 'fastify'
import { clusterPresets } from '@tonedeck/shared'
import type { PresetStore } from '../presets.js'

export interface ClustersPluginOpts {
  store: PresetStore
}

const clustersPlugin: FastifyPluginAsync<ClustersPluginOpts> = async (fastify, { store }) => {
  fastify.get('/api/clusters', async (req) => {
    const q = req.query as { threshold?: string }
    const t = q.threshold != null ? Number(q.threshold) : undefined
    return clusterPresets(store.allPresets(), {
      threshold: t != null && Number.isFinite(t) ? t : undefined,
    })
  })
}

export default clustersPlugin

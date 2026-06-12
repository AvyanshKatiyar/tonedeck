// NOTE: This placeholder daemon binds port 5056 deliberately.
// Port 5055 belongs to the legacy CamillaDSP switcher until cutover;
// tonedeck will take over 5055 as part of the production migration (task K).

import { VERSION } from '@tonedeck/shared'
import Fastify from 'fastify'
import { fileURLToPath } from 'node:url'
import { resolve, join } from 'node:path'
import { homedir } from 'node:os'
import { PresetStore } from './presets.js'
import { Artwork } from './artwork.js'
import presetsPlugin from './routes/presets.js'
import artworkPlugin from './routes/artwork.js'

/**
 * Repo root resolved relative to this file so the path works from both
 * `src/` (tsx dev) and `dist/` (compiled):
 *   packages/daemon/src/index.ts  → ../../.. → repo root
 *   packages/daemon/dist/index.js → ../../.. → repo root  (same depth)
 */
const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url))

export interface BuildServerOpts {
  /** Defaults to ~/.tonedeck */
  dataDir?: string
  /** Override individual paths (useful in tests pointing at temp dirs). */
  paths?: {
    presetsDir?: string
    profilesDir?: string
    builtinPresetsDir?: string
    artworkCacheDir?: string
  }
  /** Inject a pre-initialised store (tests only — skips store.init()). */
  _store?: PresetStore
  /** Inject a pre-constructed Artwork module (tests only). */
  _artwork?: Artwork
}

export async function buildServer(opts: BuildServerOpts = {}) {
  const { dataDir = join(homedir(), '.tonedeck'), paths = {}, _store, _artwork } = opts

  const presetsDir = paths.presetsDir ?? join(dataDir, 'presets')
  const artworkCacheDir = paths.artworkCacheDir ?? join(dataDir, 'artwork')
  const profilesDir = paths.profilesDir ?? join(REPO_ROOT, 'profiles')
  const builtinPresetsDir = paths.builtinPresetsDir ?? join(REPO_ROOT, 'presets', 'builtin')

  const store = _store ?? new PresetStore({ presetsDir, profilesDir, builtinPresetsDir })
  const artwork = _artwork ?? new Artwork({ cacheDir: artworkCacheDir })

  if (!_store) await store.init()

  const server = Fastify({ logger: false })

  server.get('/api/health', async () => {
    return { ok: true, version: VERSION, presets: store.count }
  })

  await server.register(presetsPlugin, { store })
  await server.register(artworkPlugin, { store, artwork })

  return server
}

// Only bind when executed directly — not when imported by tests or other packages.
const isMain =
  resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1] ?? '')

if (isMain) {
  const port = Number(process.env.TONEDECK_PORT ?? 5056)
  const server = await buildServer()
  await server.listen({ host: '127.0.0.1', port })
  console.log(`tonedeck daemon listening on http://127.0.0.1:${port}`)
}

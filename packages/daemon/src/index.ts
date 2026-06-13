// ToneDeck daemon — product port 5055, taken over from the retired legacy
// album-switcher at install time. install.sh boots out
// any previous occupant of port 5055 before starting this daemon.
// Override at runtime with TONEDECK_PORT.

import { VERSION } from '@tonedeck/shared'
import Fastify from 'fastify'
import fastifyWebsocket from '@fastify/websocket'
import fastifyStatic from '@fastify/static'
import { fileURLToPath } from 'node:url'
import { resolve, join } from 'node:path'
import { existsSync } from 'node:fs'
import { promises as fsp } from 'node:fs'
import { homedir } from 'node:os'
import { PresetStore } from './presets.js'
import { Artwork } from './artwork.js'
import { Lifecycle } from './lifecycle.js'
import { MeterBroadcaster } from './meters.js'
import { AutoDJ } from './autodj.js'
import { readNowPlaying } from './nowplaying.js'
import { generateTrackEq } from './eqgen.js'
import presetsPlugin from './routes/presets.js'
import artworkPlugin from './routes/artwork.js'
import controlPlugin from './routes/control.js'
import autoPlugin from './routes/auto.js'

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
  /** Mount the audio control plane + meters (default true). */
  lifecycle?: boolean
  /** CamillaDSP websocket port the lifecycle drives (default 1234). */
  cdspPort?: number
  /** Allow real `SwitchAudioSource -s` device switching (default true). */
  deviceSwitching?: boolean
  /** Inject a pre-constructed Lifecycle (tests only — skips reconcile()). */
  _lifecycle?: Lifecycle
  /** Inject a pre-constructed MeterBroadcaster (tests only). */
  _meters?: MeterBroadcaster
}

export interface ToneDeckServer {
  lifecycle: Lifecycle | null
  meters: MeterBroadcaster | null
  autodj: AutoDJ | null
  autoTimer: ReturnType<typeof setInterval> | null
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

  // ── Static UI (packages/ui/dist) ────────────────────────────────────────────
  // Serve the built album-art UI from the repo root when it exists. The API
  // routes above take precedence (explicit routes match first); a single-page
  // notFound fallback returns index.html for non-API GETs so a refresh on `/`
  // keeps working. Skipped entirely in dev (vite serves the UI + proxies /api).
  const uiDist = join(REPO_ROOT, 'packages', 'ui', 'dist')
  const uiIndex = join(uiDist, 'index.html')
  const uiAvailable = existsSync(uiIndex)
  if (uiAvailable) {
    await server.register(fastifyStatic, { root: uiDist, prefix: '/', wildcard: false })
    server.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api') && !req.url.startsWith('/ws')) {
        return reply.type('text/html').sendFile('index.html')
      }
      return reply.status(404).send({ error: `Route ${req.method} ${req.url} not found` })
    })
  }

  // ── Audio control plane (lifecycle + live meters + ws) ──────────────────────
  const lifecycleEnabled = opts.lifecycle ?? true
  const handle: ToneDeckServer = { lifecycle: null, meters: null, autodj: null, autoTimer: null }

  if (lifecycleEnabled) {
    const lifecycle =
      opts._lifecycle ??
      new Lifecycle({
        store,
        dataDir,
        cdspPort: opts.cdspPort,
        deviceSwitching: opts.deviceSwitching,
      })

    // ── AutoDJ: construct before meters so we can pass autoSource ───────────
    const autoStatePath = join(dataDir, 'auto.json')
    let autoEnabled = false
    try { autoEnabled = JSON.parse(await fsp.readFile(autoStatePath, 'utf8')).enabled === true } catch { /* default off */ }

    const autodj = new AutoDJ({
      lifecycle,
      store,
      nowPlaying: () => readNowPlaying(),
      generate: (track, profile, o) => generateTrackEq(track, profile, { slug: o.slug }),
    })
    const persistAuto = async (enabled: boolean): Promise<void> => {
      const tmp = `${autoStatePath}.tmp`
      await fsp.writeFile(tmp, JSON.stringify({ enabled }))
      await fsp.rename(tmp, autoStatePath)
    }
    if (autoEnabled) autodj.arm()
    const pollMs = Number(process.env.TONEDECK_AUTO_POLL_MS ?? 2000)
    const autoTimer = setInterval(() => { void autodj.tick() }, pollMs)
    autoTimer.unref?.()

    const meters = opts._meters ?? new MeterBroadcaster({ lifecycle, autoSource: autodj })

    // Re-adopt or clear whatever audio state a prior daemon left behind. Never
    // auto-spawns; never grabs audio on boot.
    if (!opts._lifecycle) await lifecycle.reconcile()

    await server.register(fastifyWebsocket)
    await server.register(controlPlugin, { lifecycle })
    await server.register(autoPlugin, { autodj, persist: persistAuto })
    server.get('/ws', { websocket: true }, (socket) => {
      meters.addSocket(socket)
    })

    handle.lifecycle = lifecycle
    handle.meters = meters
    handle.autodj = autodj
    handle.autoTimer = autoTimer
  }

  // Expose the audio handles for direct-run shutdown (and tests).
  ;(server as typeof server & { tonedeck: ToneDeckServer }).tonedeck = handle

  return server
}

// Only bind when executed directly — not when imported by tests or other packages.
const isMain = resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1] ?? '')

if (isMain) {
  const port = Number(process.env.TONEDECK_PORT ?? 5055)
  const dataDir = process.env.TONEDECK_DATA_DIR || undefined
  const server = await buildServer({ dataDir })
  await server.listen({ host: '127.0.0.1', port })
  console.log(`tonedeck daemon listening on http://127.0.0.1:${port}`)

  // SIGTERM/SIGINT: tear down the control plane only. We deliberately do NOT
  // disengage — the control plane going down does not mean audio should stop;
  // CamillaDSP keeps playing and reconcile() re-adopts it on the next boot.
  const shutdown = async (signal: string): Promise<void> => {
    console.log(`tonedeck daemon received ${signal} — closing control plane (audio left running)`)
    const handle = (server as typeof server & { tonedeck?: ToneDeckServer }).tonedeck
    if (handle?.autoTimer != null) clearInterval(handle.autoTimer)
    handle?.meters?.close()
    try {
      await server.close()
    } catch {
      /* ignore */
    }
    process.exit(0)
  }
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT', () => void shutdown('SIGINT'))
}

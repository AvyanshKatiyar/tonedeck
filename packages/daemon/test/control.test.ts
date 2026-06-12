/**
 * HTTP control-route tests — Fastify .inject() against buildServer with an
 * injected fake Lifecycle. Covers every status-code path in routes/control.ts.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { buildServer } from '../src/index.js'
import { LifecycleError, type ApplyResult, type LifecycleStatus, type Lifecycle } from '../src/lifecycle.js'
import type { PresetStore } from '../src/presets.js'

const PROFILES_DIR = fileURLToPath(new URL('../../../profiles', import.meta.url))
const BUILTIN_PRESETS_DIR = fileURLToPath(new URL('../../../presets/builtin', import.meta.url))

function baseStatus(over: Partial<LifecycleStatus> = {}): LifecycleStatus {
  return {
    engaged: false,
    bypass: false,
    activePreset: null,
    dspState: null,
    clippedSamples: null,
    devices: { current: null, saved: null, outputs: [] },
    dspVersion: null,
    lastEvent: null,
    ...over,
  }
}

class FakeLifecycle extends EventEmitter {
  engaged = false
  cdsp = null
  activePreset: string | null = null
  engageError?: Error
  applyError?: Error
  previewError?: Error
  bypassError?: Error
  panicThrows = false
  applyResult: ApplyResult = { warnings: ['headroom warning'], verdict: 'warn', maxBoostDb: 4.2 }

  async engage(slug?: string): Promise<LifecycleStatus> {
    if (this.engageError) throw this.engageError
    this.engaged = true
    this.activePreset = slug ?? 'mbdtf'
    return this.status()
  }
  async disengage(): Promise<LifecycleStatus> {
    this.engaged = false
    return this.status()
  }
  async panic(): Promise<LifecycleStatus> {
    if (this.panicThrows) throw new Error('panic boom')
    this.engaged = false
    return this.status()
  }
  async applyPreset(slug: string): Promise<ApplyResult> {
    if (this.applyError) throw this.applyError
    this.activePreset = slug
    return this.applyResult
  }
  async preview(): Promise<void> {
    if (this.previewError) throw this.previewError
  }
  async bypass(on: boolean): Promise<LifecycleStatus> {
    if (this.bypassError) throw this.bypassError
    return this.status({ bypass: on })
  }
  async status(over: Partial<LifecycleStatus> = {}): Promise<LifecycleStatus> {
    return baseStatus({ engaged: this.engaged, activePreset: this.activePreset, ...over })
  }
}

const fakeStore = {
  count: 16,
  listPresets: () => [],
  getPreset: () => undefined,
  getProfile: () => undefined,
  listProfiles: () => [],
} as unknown as PresetStore

let tmpDir: string
let fake: FakeLifecycle
let server: Awaited<ReturnType<typeof buildServer>>

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'td-control-'))
  fake = new FakeLifecycle()
  server = await buildServer({
    dataDir: tmpDir,
    paths: { profilesDir: PROFILES_DIR, builtinPresetsDir: BUILTIN_PRESETS_DIR },
    _store: fakeStore,
    _lifecycle: fake as unknown as Lifecycle,
  })
})

afterEach(async () => {
  await server.close()
  await rm(tmpDir, { recursive: true, force: true })
})

describe('POST /api/engage', () => {
  it('200 with status on success', async () => {
    const res = await server.inject({ method: 'POST', url: '/api/engage', payload: { preset: 'mbdtf' } })
    expect(res.statusCode).toBe(200)
    expect(res.json().engaged).toBe(true)
    expect(res.json().activePreset).toBe('mbdtf')
  })

  it('422 on device/check failure', async () => {
    fake.engageError = new LifecycleError('no_device', 'no safe playback device present')
    const res = await server.inject({ method: 'POST', url: '/api/engage', payload: {} })
    expect(res.statusCode).toBe(422)
    expect(typeof res.json().error).toBe('string')
  })
})

describe('POST /api/disengage', () => {
  it('200 with status', async () => {
    const res = await server.inject({ method: 'POST', url: '/api/disengage' })
    expect(res.statusCode).toBe(200)
    expect(res.json().engaged).toBe(false)
  })
})

describe('POST /api/panic', () => {
  it('200 always', async () => {
    const res = await server.inject({ method: 'POST', url: '/api/panic' })
    expect(res.statusCode).toBe(200)
  })
  it('200 even when panic throws', async () => {
    fake.panicThrows = true
    const res = await server.inject({ method: 'POST', url: '/api/panic' })
    expect(res.statusCode).toBe(200)
    expect(res.json().ok).toBe(true)
  })
})

describe('POST /api/presets/:slug/apply', () => {
  it('engages when not engaged and engage!=false → 200 verdict ok', async () => {
    const res = await server.inject({ method: 'POST', url: '/api/presets/mbdtf/apply', payload: {} })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.status.engaged).toBe(true)
    expect(body.verdict).toBe('ok')
  })

  it('applies when already engaged → 200 with warnings + verdict', async () => {
    fake.engaged = true
    const res = await server.inject({ method: 'POST', url: '/api/presets/yeezus/apply', payload: {} })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.verdict).toBe('warn')
    expect(body.warnings).toEqual(['headroom warning'])
  })

  it('409 not_engaged when engage:false and not engaged', async () => {
    fake.applyError = new LifecycleError('not_engaged', 'not engaged')
    const res = await server.inject({
      method: 'POST',
      url: '/api/presets/mbdtf/apply',
      payload: { engage: false },
    })
    expect(res.statusCode).toBe(409)
  })

  it('404 on unknown preset', async () => {
    fake.engaged = true
    fake.applyError = new LifecycleError('not_found', 'preset "ghost" not found')
    const res = await server.inject({ method: 'POST', url: '/api/presets/ghost/apply', payload: {} })
    expect(res.statusCode).toBe(404)
  })

  it('422 on invalid/headroom-reject', async () => {
    fake.engaged = true
    fake.applyError = new LifecycleError('invalid', 'profile not found')
    const res = await server.inject({ method: 'POST', url: '/api/presets/mbdtf/apply', payload: {} })
    expect(res.statusCode).toBe(422)
  })
})

describe('POST /api/preview', () => {
  it('200 {ok:true} on success', async () => {
    const res = await server.inject({ method: 'POST', url: '/api/preview', payload: { preset: {} } })
    expect(res.statusCode).toBe(200)
    expect(res.json().ok).toBe(true)
  })
  it('409 when not engaged', async () => {
    fake.previewError = new LifecycleError('not_engaged', 'not engaged')
    const res = await server.inject({ method: 'POST', url: '/api/preview', payload: { preset: {} } })
    expect(res.statusCode).toBe(409)
  })
  it('422 on invalid preset', async () => {
    fake.previewError = new LifecycleError('invalid', 'invalid preset')
    const res = await server.inject({ method: 'POST', url: '/api/preview', payload: { preset: {} } })
    expect(res.statusCode).toBe(422)
  })
})

describe('POST /api/bypass', () => {
  it('200 status with on:true', async () => {
    const res = await server.inject({ method: 'POST', url: '/api/bypass', payload: { on: true } })
    expect(res.statusCode).toBe(200)
    expect(res.json().bypass).toBe(true)
  })
  it('409 when not engaged', async () => {
    fake.bypassError = new LifecycleError('not_engaged', 'not engaged')
    const res = await server.inject({ method: 'POST', url: '/api/bypass', payload: { on: false } })
    expect(res.statusCode).toBe(409)
  })
  it('422 when on is not a boolean', async () => {
    const res = await server.inject({ method: 'POST', url: '/api/bypass', payload: { on: 'yes' } })
    expect(res.statusCode).toBe(422)
  })
})

describe('GET /api/status', () => {
  it('200 with lifecycle status', async () => {
    fake.engaged = true
    const res = await server.inject({ method: 'GET', url: '/api/status' })
    expect(res.statusCode).toBe(200)
    expect(res.json().engaged).toBe(true)
  })
})

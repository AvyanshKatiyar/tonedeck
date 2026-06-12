/**
 * Unit tests for Lifecycle with fully injected fakes — no real audio, no real
 * CamillaDSP, no real SwitchAudioSource. A shared monotonic `tick()` lets us
 * assert ORDER between device switches (fake exec) and ws/exit (fake client).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { readFileSync, existsSync } from 'node:fs'
import { writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import YAML from 'yaml'
import { emitCamillaYaml, type Preset, type Profile } from '@tonedeck/shared'
import {
  Lifecycle,
  LifecycleError,
  type CdspLike,
  type ChildLike,
  type ExecFn,
  type SpawnFn,
  type CdspClientFactory,
} from '../src/lifecycle.js'
import type { PresetStore } from '../src/presets.js'

// ── shared step counter for ordering assertions ─────────────────────────────────
let STEP = 0
const tick = (): number => ++STEP

// ── fixtures ────────────────────────────────────────────────────────────────────
const profile: Profile = {
  id: 'ft1pro',
  name: 'FiiO FT1 Pro',
  playbackDeviceName: 'External Headphones',
  captureDeviceName: 'BlackHole 2ch',
  bandTemplate: [],
  limits: {
    bandGainDb: [-8, 6],
    preampDb: [-6, 4],
    q: [0.3, 5],
    freqHz: [20, 20000],
    clipHeadroomDb: 3,
  },
  houseNotes: 'test profile',
}

function makePreset(overrides: Partial<Preset> = {}): Preset {
  return {
    schemaVersion: 1,
    slug: 'mbdtf',
    kind: 'album',
    title: 'My Beautiful Dark Twisted Fantasy',
    artist: 'Kanye West',
    profile: 'ft1pro',
    preamp: 2,
    bands: [{ id: 'Bass', type: 'lowshelf', freq: 60, q: 0.7, gain: 2 }],
    intent: 'loud',
    provenance: { createdBy: 'builtin', history: [] },
    version: 1,
    createdAt: '2026-06-12T00:00:00.000Z',
    updatedAt: '2026-06-12T00:00:00.000Z',
    ...overrides,
  }
}

function makeStore(presets: Record<string, Preset>): PresetStore {
  return {
    getPreset: (slug: string) => presets[slug],
    getProfile: (id: string) => (id === 'ft1pro' ? profile : undefined),
  } as unknown as PresetStore
}

// ── fake exec (SwitchAudioSource / camilladsp --check / pkill) ──────────────────
interface ExecState {
  current: string
  outputs: string[]
  switches: { name: string; at: number }[]
  checkFails: boolean
  pkillCalled: number
  failEverything: boolean
}

function makeExec(state: ExecState): ExecFn {
  return async (file, args) => {
    if (state.failEverything) throw new Error('exec exploded')
    if (file.includes('SwitchAudioSource')) {
      if (args[0] === '-c') return { stdout: state.current + '\n', stderr: '' }
      if (args[0] === '-a') return { stdout: state.outputs.join('\n') + '\n', stderr: '' }
      if (args[0] === '-s') {
        const name = args[1]
        state.switches.push({ name, at: tick() })
        state.current = name
        return { stdout: '', stderr: '' }
      }
    }
    if (file.includes('camilladsp') && args[0] === '--check') {
      if (state.checkFails) {
        const e = new Error('Config is not valid') as Error & { stderr?: string }
        e.stderr = 'devices.samplerate: invalid'
        throw e
      }
      return { stdout: 'Config is valid', stderr: '' }
    }
    if (file.includes('pkill')) {
      state.pkillCalled++
      return { stdout: '', stderr: '' }
    }
    return { stdout: '', stderr: '' }
  }
}

// ── fake spawned child ──────────────────────────────────────────────────────────
interface FakeChild extends EventEmitter, ChildLike {
  killed: (NodeJS.Signals | number | undefined)[]
  exitCode: number | null
}

function makeChild(): FakeChild {
  const ee = new EventEmitter() as unknown as FakeChild
  ;(ee as { pid: number }).pid = 4242
  ee.exitCode = null
  ee.killed = []
  ee.kill = (sig?: NodeJS.Signals | number) => {
    ee.killed.push(sig)
    if (ee.exitCode === null) {
      ee.exitCode = 0
      queueMicrotask(() => ee.emit('exit', 0, sig ?? null))
    }
    return true
  }
  return ee
}

// ── fake cdsp client ────────────────────────────────────────────────────────────
interface FakeClientOpts {
  failConnect?: boolean
  activeYmlPath: string
}
class FakeClient implements CdspLike {
  isConnected = false
  connectAt = -1
  exitAt = -1
  exited = false
  closed = false
  resetCalls = 0
  setConfigs: { yaml: string; activeOnDisk: string | null; at: number }[] = []
  constructor(private opts: FakeClientOpts) {}
  async connect(): Promise<void> {
    if (this.opts.failConnect) throw new Error('connection refused')
    this.isConnected = true
    this.connectAt = tick()
  }
  async getState(): Promise<string> {
    return 'Running'
  }
  async getVersion(): Promise<string> {
    return '4.1.3'
  }
  async getConfig(): Promise<string> {
    return 'title: x'
  }
  async setConfig(yaml: string): Promise<void> {
    let activeOnDisk: string | null = null
    try {
      activeOnDisk = readFileSync(this.opts.activeYmlPath, 'utf-8')
    } catch {
      activeOnDisk = null
    }
    this.setConfigs.push({ yaml, activeOnDisk, at: tick() })
  }
  async resetClippedSamples(): Promise<void> {
    this.resetCalls++
  }
  async getClippedSamples(): Promise<number> {
    return 0
  }
  async getPlaybackSignalRms(): Promise<number[]> {
    return [-20, -20]
  }
  async getPlaybackSignalPeak(): Promise<number[]> {
    return [-10, -10]
  }
  async exit(): Promise<void> {
    this.exited = true
    this.exitAt = tick()
    this.isConnected = false
  }
  async close(): Promise<void> {
    this.closed = true
    this.isConnected = false
  }
}

// ── harness ───────────────────────────────────────────────────────────────────--
interface Harness {
  lc: Lifecycle
  exec: ExecState
  children: FakeChild[]
  clients: FakeClient[]
  dataDir: string
  activeYml: string
}

let tmpDirs: string[] = []

async function makeHarness(
  opts: {
    presets?: Record<string, Preset>
    deviceSwitching?: boolean
    failConnect?: boolean
    current?: string
    outputs?: string[]
    checkFails?: boolean
    seedState?: object
  } = {},
): Promise<Harness> {
  const dataDir = await mkdtemp(join(tmpdir(), 'td-lc-'))
  tmpDirs.push(dataDir)
  const activeYml = join(dataDir, 'generated', 'active.yml')

  if (opts.seedState) {
    await writeFile(join(dataDir, 'state.json'), JSON.stringify(opts.seedState), 'utf-8')
  }

  const exec: ExecState = {
    current: opts.current ?? 'MacBook Air Speakers',
    outputs: opts.outputs ?? ['BlackHole 2ch', 'MacBook Air Speakers'],
    switches: [],
    checkFails: opts.checkFails ?? false,
    pkillCalled: 0,
    failEverything: false,
  }
  const children: FakeChild[] = []
  const clients: FakeClient[] = []

  const spawnImpl: SpawnFn = () => {
    const c = makeChild()
    children.push(c)
    return c as unknown as ChildLike
  }
  const clientFactory: CdspClientFactory = () => {
    const c = new FakeClient({ failConnect: opts.failConnect, activeYmlPath: activeYml })
    clients.push(c)
    return c
  }

  const lc = new Lifecycle({
    store: makeStore(opts.presets ?? { mbdtf: makePreset() }),
    dataDir,
    deviceSwitching: opts.deviceSwitching ?? true,
    exec: makeExec(exec),
    spawnImpl,
    _clientFactory: clientFactory,
    _timing: {
      engageConnectMs: 120,
      connectRetryMs: 15,
      killTermMs: 10,
      killKillMs: 25,
      deviceCheckMs: 100000, // effectively off unless invoked directly
    },
  })
  return { lc, exec, children, clients, dataDir, activeYml }
}

async function readState(dataDir: string): Promise<Record<string, unknown>> {
  const raw = await readFile(join(dataDir, 'state.json'), 'utf-8')
  return JSON.parse(raw)
}

beforeEach(() => {
  STEP = 0
  tmpDirs = []
})

afterEach(async () => {
  for (const d of tmpDirs) await rm(d, { recursive: true, force: true })
})

// ── device resolution matrix ────────────────────────────────────────────────────
describe('resolvePlaybackDevice', () => {
  it('current real output → saved + used', async () => {
    const { lc, dataDir } = await makeHarness({ current: 'MacBook Air Speakers' })
    const dev = await lc.resolvePlaybackDevice(profile)
    expect(dev).toBe('MacBook Air Speakers')
    expect((await readState(dataDir)).lastRealOutput).toBe('MacBook Air Speakers')
  })

  it('current is BlackHole → falls back to saved', async () => {
    const { lc } = await makeHarness({
      current: 'BlackHole 2ch',
      outputs: ['BlackHole 2ch', 'Studio Display'],
      seedState: { engaged: false, activePreset: null, lastRealOutput: 'Studio Display', bypass: false },
    })
    const dev = await lc.resolvePlaybackDevice(profile)
    expect(dev).toBe('Studio Display')
  })

  it('saved gone → falls back to profile playbackDeviceName', async () => {
    const { lc } = await makeHarness({
      current: 'BlackHole 2ch',
      outputs: ['BlackHole 2ch', 'External Headphones'],
      seedState: { engaged: false, activePreset: null, lastRealOutput: 'Vanished Device', bypass: false },
    })
    const dev = await lc.resolvePlaybackDevice(profile)
    expect(dev).toBe('External Headphones')
  })

  it('nothing safe present → throws no_device', async () => {
    const { lc } = await makeHarness({ current: 'BlackHole 2ch', outputs: ['BlackHole 2ch'] })
    await expect(lc.resolvePlaybackDevice(profile)).rejects.toMatchObject({
      code: 'no_device',
    })
  })

  it('never returns a BlackHole device even when BlackHole is current', async () => {
    // Current output is the loopback; resolution must fall through to a real
    // device (here the profile device, which is present) — never BlackHole.
    const { lc } = await makeHarness({
      current: 'BlackHole 2ch',
      outputs: ['BlackHole 2ch', 'External Headphones'],
    })
    const dev = await lc.resolvePlaybackDevice(profile)
    expect(dev).toBe('External Headphones')
    expect(dev.toLowerCase()).not.toContain('blackhole')
  })
})

// ── engage ────────────────────────────────────────────────────────────────────--
describe('engage', () => {
  it('happy path: --check ran, active.yml written, switch AFTER ws, state persisted', async () => {
    const { lc, exec, children, clients, dataDir, activeYml } = await makeHarness()
    const status = await lc.engage('mbdtf')

    expect(status.engaged).toBe(true)
    expect(children).toHaveLength(1)
    expect(existsSync(activeYml)).toBe(true)

    // The system output was switched to the capture device (BlackHole)…
    const bh = exec.switches.find((s) => s.name === 'BlackHole 2ch')
    expect(bh).toBeDefined()
    // …and only AFTER the ws connected.
    expect(clients[0].connectAt).toBeGreaterThan(0)
    expect(bh!.at).toBeGreaterThan(clients[0].connectAt)

    const persisted = await readState(dataDir)
    expect(persisted.engaged).toBe(true)
    expect(persisted.activePreset).toBe('mbdtf')
    expect(persisted.bypass).toBe(false)
  })

  it('runs camilladsp --check before spawning', async () => {
    const { lc, children } = await makeHarness({ checkFails: true })
    await expect(lc.engage('mbdtf')).rejects.toMatchObject({ code: 'device_check' })
    // --check failed → never spawned.
    expect(children).toHaveLength(0)
  })

  it('failure mid-engage (ws never accepts) kills child, leaves output off BlackHole, not engaged', async () => {
    const { lc, exec, children, dataDir } = await makeHarness({ failConnect: true })
    await expect(lc.engage('mbdtf')).rejects.toBeInstanceOf(LifecycleError)

    expect(children).toHaveLength(1)
    expect(children[0].killed.length).toBeGreaterThan(0) // child was killed
    // We never switched the system output to BlackHole (switch happens post-ws).
    expect(exec.switches.find((s) => s.name === 'BlackHole 2ch')).toBeUndefined()
    expect(exec.current.toLowerCase()).not.toContain('blackhole')

    const persisted = await readState(dataDir)
    expect(persisted.engaged).toBe(false)
  })

  it('unknown preset → not_found', async () => {
    const { lc } = await makeHarness()
    await expect(lc.engage('ghost')).rejects.toMatchObject({ code: 'not_found' })
  })

  it('deviceSwitching=false logs intent instead of switching', async () => {
    const { lc, exec, dataDir } = await makeHarness({ deviceSwitching: false })
    const status = await lc.engage('mbdtf')
    expect(status.engaged).toBe(true)
    expect(exec.switches).toHaveLength(0) // no -s calls at all
    expect((await readState(dataDir)).engaged).toBe(true)
  })
})

// ── applyPreset ─────────────────────────────────────────────────────────────────
describe('applyPreset', () => {
  it('writes active.yml BEFORE setConfig (order-sensitive)', async () => {
    const presets = { mbdtf: makePreset(), yeezus: makePreset({ slug: 'yeezus', title: 'Yeezus' }) }
    const { lc, clients } = await makeHarness({ presets })
    await lc.engage('mbdtf')
    await lc.applyPreset('yeezus')

    const client = clients[0]
    const last = client.setConfigs[client.setConfigs.length - 1]
    // active.yml on disk at the moment setConfig fired equals the yaml passed.
    expect(last.activeOnDisk).toBe(last.yaml)
    expect(last.yaml).toContain('Yeezus')
    expect(client.resetCalls).toBeGreaterThan(0)
  })

  it('not engaged → not_engaged', async () => {
    const { lc } = await makeHarness()
    await expect(lc.applyPreset('mbdtf')).rejects.toMatchObject({ code: 'not_engaged' })
  })

  it('unknown preset → not_found', async () => {
    const { lc } = await makeHarness()
    await lc.engage('mbdtf')
    await expect(lc.applyPreset('ghost')).rejects.toMatchObject({ code: 'not_found' })
  })

  it('returns headroom warnings + verdict', async () => {
    // preamp 4 + bass +6 → well over the 3 dB clip headroom → warn.
    const hot = makePreset({ slug: 'hot', preamp: 4, bands: [{ id: 'Bass', type: 'lowshelf', freq: 60, q: 0.7, gain: 6 }] })
    const { lc } = await makeHarness({ presets: { mbdtf: makePreset(), hot } })
    await lc.engage('mbdtf')
    const r = await lc.applyPreset('hot')
    expect(r.verdict).toBe('warn')
    expect(r.warnings.length).toBeGreaterThan(0)
    expect(r.maxBoostDb).toBeGreaterThan(3)
  })
})

// ── bypass ──────────────────────────────────────────────────────────────────────
describe('bypass', () => {
  it('on → flat config (only Preamp), devices identical to applied', async () => {
    const { lc, clients } = await makeHarness()
    await lc.engage('mbdtf')

    await lc.bypass(true)
    const flat = clients[0].setConfigs[clients[0].setConfigs.length - 1]
    const parsed = YAML.parse(flat.yaml) as { filters: Record<string, unknown>; devices: unknown }
    expect(Object.keys(parsed.filters)).toEqual(['Preamp'])

    // devices block byte-identical to a real applied config on the same device.
    const appliedYaml = emitCamillaYaml(makePreset(), profile, 'MacBook Air Speakers')
    const appliedDevices = (YAML.parse(appliedYaml) as { devices: unknown }).devices
    expect(parsed.devices).toEqual(appliedDevices)
  })

  it('off → re-applies active preset, bypass=false', async () => {
    const { lc, clients, dataDir } = await makeHarness()
    await lc.engage('mbdtf')
    await lc.bypass(true)
    expect((await readState(dataDir)).bypass).toBe(true)

    await lc.bypass(false)
    expect((await readState(dataDir)).bypass).toBe(false)
    const last = clients[0].setConfigs[clients[0].setConfigs.length - 1]
    expect(last.yaml).toContain('My Beautiful Dark Twisted Fantasy')
  })

  it('not engaged → not_engaged', async () => {
    const { lc } = await makeHarness()
    await expect(lc.bypass(true)).rejects.toMatchObject({ code: 'not_engaged' })
  })
})

// ── preview ─────────────────────────────────────────────────────────────────────
describe('preview', () => {
  it('sets config but does NOT write active.yml or change state', async () => {
    const { lc, clients, activeYml, dataDir } = await makeHarness()
    await lc.engage('mbdtf')
    const activeBefore = readFileSync(activeYml, 'utf-8')
    const stateBefore = await readState(dataDir)

    const setCountBefore = clients[0].setConfigs.length
    await lc.preview(makePreset({ bands: [{ id: 'Bass', type: 'lowshelf', freq: 60, q: 0.7, gain: 5 }] }))
    expect(clients[0].setConfigs.length).toBe(setCountBefore + 1)

    expect(readFileSync(activeYml, 'utf-8')).toBe(activeBefore) // unchanged
    expect(await readState(dataDir)).toEqual(stateBefore) // unchanged
  })

  it('not engaged → not_engaged', async () => {
    const { lc } = await makeHarness()
    await expect(lc.preview(makePreset())).rejects.toMatchObject({ code: 'not_engaged' })
  })

  it('invalid preset → invalid', async () => {
    const { lc } = await makeHarness()
    await lc.engage('mbdtf')
    await expect(lc.preview({ nonsense: true })).rejects.toMatchObject({ code: 'invalid' })
  })
})

// ── disengage ─────────────────────────────────────────────────────────────────--
describe('disengage', () => {
  it('restores system output BEFORE client.exit()', async () => {
    const { lc, exec, clients, dataDir } = await makeHarness()
    await lc.engage('mbdtf')
    await lc.disengage()

    // The restore switch (to the real device) precedes the ws exit.
    const restore = exec.switches[exec.switches.length - 1]
    expect(restore.name).toBe('MacBook Air Speakers')
    expect(clients[0].exited).toBe(true)
    expect(restore.at).toBeLessThan(clients[0].exitAt)

    expect((await readState(dataDir)).engaged).toBe(false)
  })
})

// ── panic ───────────────────────────────────────────────────────────────────────
describe('panic', () => {
  it('pkills camilladsp and clears state', async () => {
    const { lc, exec, dataDir } = await makeHarness()
    await lc.engage('mbdtf')
    await lc.panic()
    expect(exec.pkillCalled).toBeGreaterThan(0)
    const persisted = await readState(dataDir)
    expect(persisted.engaged).toBe(false)
    expect(persisted.bypass).toBe(false)
  })

  it('never throws even when every external call explodes', async () => {
    const { lc, exec } = await makeHarness()
    await lc.engage('mbdtf')
    exec.failEverything = true // SwitchAudioSource, pkill, reads all throw
    await expect(lc.panic()).resolves.toBeDefined()
  })
})

// ── watchdog ──────────────────────────────────────────────────────────────────--
describe('watchdog', () => {
  it('unexpected child exit → safe disengage (output restored, not engaged)', async () => {
    const { lc, exec, children, dataDir } = await makeHarness()
    await lc.engage('mbdtf')
    expect((await readState(dataDir)).engaged).toBe(true)

    // Simulate camilladsp dying on its own.
    children[0].exitCode = 137
    children[0].emit('exit', 137, 'SIGKILL')

    await vi.waitFor(async () => {
      expect((await readState(dataDir)).engaged).toBe(false)
    })
    // Output was restored to a present non-BlackHole device.
    const restore = exec.switches[exec.switches.length - 1]
    expect(restore.name).toBe('MacBook Air Speakers')
  })

  it('device-vanish check → graceful disengage', async () => {
    const { lc, exec, dataDir } = await makeHarness()
    await lc.engage('mbdtf')
    // The device camilladsp plays to disappears.
    exec.outputs = ['BlackHole 2ch', 'MacBook Air Speakers'].filter((d) => d !== 'MacBook Air Speakers')
    exec.current = 'BlackHole 2ch'
    // But lastRealOutput was MacBook Air Speakers → it is gone.
    await lc._checkDeviceStillPresent()
    expect((await readState(dataDir)).engaged).toBe(false)
  })
})

// ── reconcile ────────────────────────────────────────────────────────────────--
describe('reconcile', () => {
  it('stale engaged state with no running camilladsp → cleared', async () => {
    const { lc, dataDir } = await makeHarness({
      failConnect: true,
      seedState: { engaged: true, activePreset: 'mbdtf', lastRealOutput: 'MacBook Air Speakers', bypass: false },
    })
    await lc.reconcile()
    expect((await readState(dataDir)).engaged).toBe(false)
    expect((await lc.status()).lastEvent).toContain('stale')
  })

  it('running camilladsp → adopted, stays engaged', async () => {
    const { lc } = await makeHarness({
      failConnect: false,
      seedState: { engaged: true, activePreset: 'mbdtf', lastRealOutput: 'MacBook Air Speakers', bypass: false },
    })
    await lc.reconcile()
    const status = await lc.status()
    expect(status.engaged).toBe(true)
    expect(lc.cdsp).not.toBeNull()
    expect(status.lastEvent).toContain('adopted')
  })

  it('not engaged → no-op', async () => {
    const { lc, children } = await makeHarness()
    await lc.reconcile()
    expect(children).toHaveLength(0)
    expect((await lc.status()).engaged).toBe(false)
  })
})

// ── mutex ────────────────────────────────────────────────────────────────────--
describe('mutex', () => {
  it('two concurrent engages serialize to a single spawn', async () => {
    const { lc, children } = await makeHarness()
    await Promise.all([lc.engage('mbdtf'), lc.engage('mbdtf')])
    expect(children).toHaveLength(1)
  })
})

// ── status ──────────────────────────────────────────────────────────────────────
describe('status', () => {
  it('never throws with everything down', async () => {
    const { lc, exec } = await makeHarness()
    exec.failEverything = true
    const status = await lc.status()
    expect(status.engaged).toBe(false)
    expect(status.dspState).toBeNull()
    expect(status.devices.outputs).toEqual([])
  })
})

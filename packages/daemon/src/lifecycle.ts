/**
 * Lifecycle — the daemon's audio-state owner.
 *
 * This is the one module that holds REAL audio state on the machine: it spawns
 * and supervises a CamillaDSP process, it switches the macOS system output
 * device, and it persists a small state file so a crashed/restarted daemon can
 * reconcile what it left running.
 *
 * INVARIANTS that everything below defends:
 *  - We NEVER route output into the BlackHole loopback (the "silence trap"):
 *    `resolvePlaybackDevice` never returns a BlackHole device, and the shared
 *    YAML emitter throws if asked to.
 *  - All mutating methods (engage/applyPreset/preview/bypass/disengage) are
 *    serialized through a promise-chain mutex so concurrent HTTP calls can't
 *    interleave (e.g. two engages → one spawn, never two). `panic()` and
 *    `status()` deliberately bypass the lock — panic must fire even while a
 *    long engage holds it, and status is read-only and tolerant.
 *  - A fresh CdspClient is created per engage/spawn cycle: after exit()/stop()
 *    a client permanently disables reconnect (see cdsp.ts), so reuse is unsafe.
 *  - The devices block of every generated config is byte-identical across
 *    presets on the same profile+device, which is what makes SetConfig swaps
 *    glitch-free (the camilladsp PID stays stable across applies).
 *
 * The two device hooks (`exec`, `spawnImpl`) and the cdsp client factory are
 * injectable so the whole engine can be unit-tested with zero real audio.
 */
import { EventEmitter } from 'node:events'
import { execFile } from 'node:child_process'
import { spawn } from 'node:child_process'
import { promises as fs, readFileSync } from 'node:fs'
import { join } from 'node:path'
import YAML from 'yaml'
import {
  emitCamillaYaml,
  emitDevicesBlock,
  headroomVerdict,
  clampPreset,
  parsePreset,
  type Preset,
  type Profile,
} from '@tonedeck/shared'
import { CdspClient } from './cdsp.js'
import type { PresetStore } from './presets.js'

// ── External binaries (env-overridable for unusual installs) ──────────────────

const CAMILLADSP = process.env.TONEDECK_CAMILLADSP_BIN ?? '/opt/homebrew/bin/camilladsp'
const SWITCHAUDIO = process.env.TONEDECK_SWITCHAUDIO_BIN ?? '/opt/homebrew/bin/SwitchAudioSource'
const PKILL = '/usr/bin/pkill'

// ── Errors ────────────────────────────────────────────────────────────────────

export type LifecycleErrorCode =
  | 'not_found'
  | 'not_engaged'
  | 'invalid'
  | 'no_device'
  | 'device_check'
  | 'engage_failed'

/** Typed failure surface for the control routes to map to HTTP statuses. */
export class LifecycleError extends Error {
  constructor(
    readonly code: LifecycleErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'LifecycleError'
  }
}

// ── Injectable shapes ─────────────────────────────────────────────────────────

/** execFile-style runner for SwitchAudioSource / camilladsp --check / pkill. */
export type ExecFn = (file: string, args: string[]) => Promise<{ stdout: string; stderr: string }>

/** The subset of a spawned child process the lifecycle relies on. */
export interface ChildLike {
  readonly pid?: number
  readonly exitCode: number | null
  kill(signal?: NodeJS.Signals | number): boolean
  on(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown
  on(event: 'error', listener: (err: Error) => void): unknown
  once(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown
  unref?(): void
}

export type SpawnFn = (command: string, args: string[], options: Record<string, unknown>) => ChildLike

/** The subset of CdspClient the lifecycle + meters rely on. */
export interface CdspLike {
  readonly isConnected: boolean
  connect(): Promise<void>
  getState(): Promise<string>
  getVersion(): Promise<string>
  getConfig(): Promise<string>
  setConfig(yaml: string): Promise<void>
  resetClippedSamples(): Promise<void>
  getClippedSamples(): Promise<number>
  getPlaybackSignalRms(): Promise<number[]>
  getPlaybackSignalPeak(): Promise<number[]>
  exit(): Promise<void>
  close(): Promise<void>
}

export type CdspClientFactory = (opts: {
  port: number
  host?: string
  connectTimeoutMs?: number
  reconnect?: boolean
}) => CdspLike

interface LifecycleTiming {
  /** Total budget for the post-spawn ws to accept a connection. */
  engageConnectMs: number
  /** Sleep between connect retries during engage. */
  connectRetryMs: number
  /** SIGTERM the child this long after exit() if still alive. */
  killTermMs: number
  /** SIGKILL the child this long after exit() if still alive. */
  killKillMs: number
  /** Interval for the "did the playback device vanish?" watchdog. */
  deviceCheckMs: number
  /** Min gap between automatic re-routes after output theft; a second theft
   *  inside this window means something else is managing audio — disengage. */
  rerouteCooldownMs: number
}

export interface LifecycleOpts {
  store: PresetStore
  dataDir: string
  cdspPort?: number
  exec?: ExecFn
  spawnImpl?: SpawnFn
  deviceSwitching?: boolean
  /** Test hook: inject a fake cdsp client factory. */
  _clientFactory?: CdspClientFactory
  /** Test hook: shrink the engage/kill/watchdog timers. */
  _timing?: Partial<LifecycleTiming>
}

// ── Public state + status shapes ──────────────────────────────────────────────

export interface LifecycleState {
  engaged: boolean
  activePreset: string | null
  lastRealOutput: string | null
  bypass: boolean
}

export interface LifecycleStatus {
  engaged: boolean
  bypass: boolean
  activePreset: string | null
  dspState: string | null
  clippedSamples: number | null
  devices: { current: string | null; saved: string | null; outputs: string[] }
  dspVersion: string | null
  lastEvent: string | null
}

export interface ApplyResult {
  warnings: string[]
  verdict: string
  maxBoostDb: number
}

const DEFAULT_STATE: LifecycleState = {
  engaged: false,
  activePreset: null,
  lastRealOutput: null,
  bypass: false,
}

const defaultExec: ExecFn = (file, args) =>
  new Promise((resolve, reject) => {
    execFile(file, args, { encoding: 'utf8' }, (err, stdout, stderr) => {
      if (err) {
        ;(err as { stdout?: string }).stdout = String(stdout ?? '')
        ;(err as { stderr?: string }).stderr = String(stderr ?? '')
        reject(err)
        return
      }
      resolve({ stdout: String(stdout ?? ''), stderr: String(stderr ?? '') })
    })
  })

const defaultSpawn: SpawnFn = (command, args, options) =>
  spawn(command, args, options) as unknown as ChildLike

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

// ── Lifecycle ─────────────────────────────────────────────────────────────────

export class Lifecycle extends EventEmitter {
  private readonly store: PresetStore
  private readonly dataDir: string
  private readonly cdspPort: number
  private readonly exec: ExecFn
  private readonly spawnImpl: SpawnFn
  private readonly deviceSwitching: boolean
  private readonly clientFactory: CdspClientFactory
  private readonly timing: LifecycleTiming

  private readonly stateFile: string
  private readonly generatedDir: string
  private readonly activeYml: string
  private readonly logsDir: string
  private readonly logFile: string

  private state: LifecycleState
  private client: CdspLike | null = null
  private child: ChildLike | null = null
  private lastEvent: string | null = null

  /** True while we are deliberately tearing audio down — suppresses watchdog. */
  private stopping = false
  private deviceInterval: ReturnType<typeof setInterval> | null = null
  private deviceCheckRunning = false
  /** Wall-clock of the last automatic re-route after output theft. */
  private lastRerouteAt = 0

  /** Mutex: a promise chain that serializes mutating operations. */
  private chain: Promise<unknown> = Promise.resolve()

  constructor(opts: LifecycleOpts) {
    super()
    this.store = opts.store
    this.dataDir = opts.dataDir
    this.cdspPort = opts.cdspPort ?? 1234
    this.exec = opts.exec ?? defaultExec
    this.spawnImpl = opts.spawnImpl ?? defaultSpawn
    this.deviceSwitching = opts.deviceSwitching ?? true
    this.clientFactory = opts._clientFactory ?? ((o) => new CdspClient(o))
    this.timing = {
      engageConnectMs: opts._timing?.engageConnectMs ?? 5000,
      connectRetryMs: opts._timing?.connectRetryMs ?? 200,
      killTermMs: opts._timing?.killTermMs ?? 2000,
      killKillMs: opts._timing?.killKillMs ?? 4000,
      deviceCheckMs: opts._timing?.deviceCheckMs ?? 3000,
      rerouteCooldownMs: opts._timing?.rerouteCooldownMs ?? 15000,
    }

    this.stateFile = join(this.dataDir, 'state.json')
    this.generatedDir = join(this.dataDir, 'generated')
    this.activeYml = join(this.generatedDir, 'active.yml')
    this.logsDir = join(this.dataDir, 'logs')
    this.logFile = join(this.logsDir, 'camilladsp.log')

    this.state = this._loadStateSync()
  }

  // ── Public getters (consumed by meters) ────────────────────────────────────

  get engaged(): boolean {
    return this.state.engaged
  }

  /** The live cdsp client (null when down). Used by MeterBroadcaster. */
  get cdsp(): CdspLike | null {
    return this.client
  }

  /** Where the generated CamillaDSP config is written (for inspection/smoke). */
  get activeConfigPath(): string {
    return this.activeYml
  }

  // ── Device helpers ──────────────────────────────────────────────────────────

  async currentOutput(): Promise<string> {
    const { stdout } = await this.exec(SWITCHAUDIO, ['-c', '-t', 'output'])
    return stdout.trim()
  }

  async listOutputs(): Promise<string[]> {
    const { stdout } = await this.exec(SWITCHAUDIO, ['-a', '-t', 'output'])
    return stdout
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
  }

  /**
   * Choose the REAL device CamillaDSP should play to — never a BlackHole. The
   * resolved device is persisted to `state.lastRealOutput` so a crash mid-engage
   * still leaves us a known-good device to restore the system output to.
   */
  async resolvePlaybackDevice(profile: Profile): Promise<string> {
    const capture = profile.captureDeviceName
    const isBlackhole = (d: string | null | undefined): boolean =>
      !d || d.toLowerCase().includes('blackhole') || d.toLowerCase() === capture.toLowerCase()

    let cur: string | null = null
    try {
      cur = await this.currentOutput()
    } catch {
      cur = null
    }
    if (cur && !isBlackhole(cur)) {
      await this._setState({ lastRealOutput: cur })
      return cur
    }

    let outs: string[] = []
    try {
      outs = await this.listOutputs()
    } catch {
      outs = []
    }

    const saved = this.state.lastRealOutput
    if (saved && outs.includes(saved) && !isBlackhole(saved)) return saved

    const pdn = profile.playbackDeviceName
    if (pdn && outs.includes(pdn) && !isBlackhole(pdn)) return pdn

    throw new LifecycleError(
      'no_device',
      `no safe playback device present (current="${cur ?? 'none'}", saved="${saved ?? 'none'}", profile="${pdn}", available=[${outs.join(', ')}])`,
    )
  }

  // ── Core operations (public = locked wrappers) ──────────────────────────────

  engage(slug?: string): Promise<LifecycleStatus> {
    return this._withLock(() => this._engage(slug))
  }

  applyPreset(slug: string): Promise<ApplyResult> {
    return this._withLock(() => this._applyPreset(slug))
  }

  preview(presetLike: unknown): Promise<void> {
    return this._withLock(() => this._preview(presetLike))
  }

  bypass(on: boolean): Promise<LifecycleStatus> {
    return this._withLock(() => this._bypass(on))
  }

  disengage(): Promise<LifecycleStatus> {
    return this._withLock(() => this._disengage())
  }

  // ── engage ──────────────────────────────────────────────────────────────────

  private async _engage(slug?: string): Promise<LifecycleStatus> {
    // Idempotent: already live → behave like an apply — UNLESS the system
    // output has been switched away from the capture loopback (macOS does this
    // automatically when a new device is plugged in), in which case the chain
    // is silently bypassed and the thief device is where the user is actually
    // listening. Tear down and fall through to a full re-engage so
    // resolvePlaybackDevice re-targets it.
    if (this.state.engaged && this.client && this.client.isConnected) {
      const thief = await this._outputStolen()
      if (!thief) {
        const target = slug ?? this.state.activePreset ?? 'mbdtf'
        await this._applyPreset(target)
        return this.status()
      }
      this.lastEvent = `system output is "${thief}" — re-routing EQ chain`
      await this._teardownDsp({ restoreOutput: false })
    }

    const target = slug ?? this.state.activePreset ?? 'mbdtf'
    const preset = this.store.getPreset(target)
    if (!preset) throw new LifecycleError('not_found', `preset "${target}" not found`)
    const profile = this.store.getProfile(preset.profile)
    if (!profile)
      throw new LifecycleError('invalid', `profile "${preset.profile}" not found for preset "${target}"`)

    const device = await this.resolvePlaybackDevice(profile)
    const yaml = emitCamillaYaml(preset, profile, device)

    let child: ChildLike | null = null
    let client: CdspLike | null = null
    let switched = false
    try {
      await fs.mkdir(this.generatedDir, { recursive: true })
      await fs.mkdir(this.logsDir, { recursive: true })

      // emit → check (on a temp file) → commit active.yml (atomic rename).
      const tmp = `${this.activeYml}.tmp`
      await fs.writeFile(tmp, yaml, 'utf-8')
      await this._checkConfig(tmp)
      await fs.rename(tmp, this.activeYml)

      child = this.spawnImpl(
        CAMILLADSP,
        [
          this.activeYml,
          '--address',
          '127.0.0.1',
          '--port',
          String(this.cdspPort),
          '--logfile',
          this.logFile,
          '--loglevel',
          'info',
        ],
        // detached + unref: camilladsp must SURVIVE a daemon restart (control
        // plane down ≠ audio down). Without this, launchd tears the child down
        // with the daemon's process group and reconcile() finds nothing to
        // adopt. Pairs with AbandonProcessGroup=true in the LaunchAgent plist.
        { stdio: ['ignore', 'ignore', 'ignore'], detached: true },
      )
      child.unref?.()
      this.child = child
      child.on('error', () => {
        // Spawn/runtime error surfaces as a failed connect below or as an exit;
        // swallow here so it never becomes an uncaught process error.
      })
      child.once('exit', (code) => this._onChildExit(code))

      client = this.clientFactory({ port: this.cdspPort, host: '127.0.0.1', reconnect: true })
      await this._connectWithRetry(client, this.timing.engageConnectMs)
      const st = await client.getState()
      if (typeof st !== 'string' || st.length === 0) {
        throw new LifecycleError('engage_failed', `camilladsp returned an invalid state: ${String(st)}`)
      }
      this.client = client

      // Only AFTER the ws is confirmed do we touch the system output: route it
      // into the capture loopback so apps feed audio through CamillaDSP.
      await this._switchOutput(profile.captureDeviceName)
      switched = this.deviceSwitching

      await this._setState({ engaged: true, activePreset: target, bypass: false })
      this._startDeviceInterval()
      this.lastEvent = `engaged "${target}"`
      this.emit('applied', { slug: target })
      return this.status()
    } catch (e) {
      // Roll back everything we touched, in reverse order.
      try {
        await client?.close()
      } catch {
        /* tolerant */
      }
      if (child && child.exitCode === null) {
        try {
          child.kill('SIGKILL')
        } catch {
          /* already gone */
        }
      }
      this.child = null
      this.client = null
      if (switched) {
        try {
          await this._restoreOutput()
        } catch {
          /* tolerant */
        }
      }
      throw e
    }
  }

  // ── applyPreset ───────────────────────────────────────────────────────────--

  private async _applyPreset(slug: string): Promise<ApplyResult> {
    const preset = this.store.getPreset(slug)
    if (!preset) throw new LifecycleError('not_found', `preset "${slug}" not found`)
    if (!this.state.engaged || !this.client) {
      throw new LifecycleError('not_engaged', 'not engaged — call engage first')
    }
    const profile = this.store.getProfile(preset.profile)
    if (!profile) throw new LifecycleError('invalid', `profile "${preset.profile}" not found`)

    // Same device as the running config — that byte-identity is the glitch-free
    // contract for SetConfig.
    const device = this.state.lastRealOutput
    if (!device) {
      throw new LifecycleError('engage_failed', 'no saved playback device while engaged (inconsistent state)')
    }

    const yaml = emitCamillaYaml(preset, profile, device)
    await fs.mkdir(this.generatedDir, { recursive: true })
    // active.yml is written FIRST so it is always the source of truth for what
    // is loaded; only then do we ask CamillaDSP to load it.
    await this._writeFileAtomic(this.activeYml, yaml)
    await this.client.setConfig(yaml)
    try {
      await this.client.resetClippedSamples()
    } catch {
      /* non-fatal */
    }

    await this._setState({ activePreset: slug, bypass: false })
    this.lastEvent = `applied "${slug}"`
    this.emit('applied', { slug })

    const v = headroomVerdict(preset, profile)
    return { warnings: v.warnings, verdict: v.verdict, maxBoostDb: v.maxBoostDb }
  }

  // ── preview (ephemeral A/B; never persisted) ────────────────────────────────

  private async _preview(presetLike: unknown): Promise<void> {
    if (!this.state.engaged || !this.client) {
      throw new LifecycleError('not_engaged', 'not engaged — call engage first')
    }
    let preset: Preset
    try {
      preset = parsePreset(presetLike)
    } catch (e) {
      throw new LifecycleError('invalid', `invalid preset: ${(e as Error).message}`)
    }
    const profile = this.store.getProfile(preset.profile)
    if (!profile) throw new LifecycleError('invalid', `profile "${preset.profile}" not found`)

    const { preset: clamped } = clampPreset(preset, profile)
    const device = this.state.lastRealOutput
    if (!device) throw new LifecycleError('engage_failed', 'no saved playback device while engaged')

    const yaml = emitCamillaYaml(clamped, profile, device)
    // Deliberately NO active.yml write and NO state change: a crash during a
    // preview reverts to the last applied preset on the next restart.
    await this.client.setConfig(yaml)
  }

  // ── bypass ───────────────────────────────────────────────────────────────-─-

  private async _bypass(on: boolean): Promise<LifecycleStatus> {
    if (!this.state.engaged || !this.client) {
      throw new LifecycleError('not_engaged', 'not engaged — call engage first')
    }
    if (on) {
      const profile = this._activeProfileOrThrow()
      const device = this.state.lastRealOutput
      if (!device) throw new LifecycleError('engage_failed', 'no saved playback device while engaged')
      const yaml = this._flatYaml(profile, device)
      await this.client.setConfig(yaml)
      await this._setState({ bypass: true })
      this.lastEvent = 'bypass on (flat passthrough)'
    } else {
      const slug = this.state.activePreset
      if (!slug) throw new LifecycleError('engage_failed', 'no active preset to restore on bypass off')
      await this._applyPreset(slug) // re-applies + persists bypass:false
      this.lastEvent = 'bypass off'
    }
    return this.status()
  }

  /** Minimal flat config: same devices block (byte-identical), Preamp 0 dB only. */
  private _flatYaml(profile: Profile, device: string): string {
    const devices = emitDevicesBlock(profile, device)
    const config = {
      title: `${profile.name} - Bypass (flat)`,
      description: 'ToneDeck bypass — flat passthrough (Preamp 0 dB only)',
      devices,
      filters: {
        Preamp: {
          type: 'Gain',
          parameters: { gain: 0, inverted: false, mute: false, scale: 'dB' },
        },
      },
      pipeline: [{ type: 'Filter', channels: [0, 1], names: ['Preamp'] }],
    }
    return YAML.stringify(config)
  }

  private _activeProfileOrThrow(): Profile {
    const slug = this.state.activePreset
    const preset = slug ? this.store.getPreset(slug) : undefined
    if (!preset) throw new LifecycleError('engage_failed', 'no active preset to derive a profile from')
    const profile = this.store.getProfile(preset.profile)
    if (!profile) throw new LifecycleError('invalid', `profile "${preset.profile}" not found`)
    return profile
  }

  // ── disengage ───────────────────────────────────────────────────────────────

  private async _disengage(): Promise<LifecycleStatus> {
    await this._teardownDsp({ restoreOutput: true })
    try {
      await this._setState({ engaged: false })
    } catch {
      /* tolerant */
    }
    this.lastEvent = 'disengaged'
    return this.status()
  }

  /**
   * Tear down the DSP child + client. With `restoreOutput` the system output is
   * restored FIRST so audio has somewhere to go the instant CamillaDSP dies;
   * without it (re-route paths) the output is already where the user listens.
   */
  private async _teardownDsp(opts: { restoreOutput: boolean }): Promise<void> {
    this.stopping = true
    this._clearDeviceInterval()
    if (opts.restoreOutput) {
      try {
        await this._restoreOutput()
      } catch {
        /* tolerant */
      }
    }
    if (this.client) {
      try {
        await this.client.exit()
      } catch {
        /* exit/disconnect is the success case */
      }
    }
    try {
      await this._killChild(this.child)
    } catch {
      /* tolerant */
    }
    this.client = null
    this.child = null
    this.stopping = false
  }

  // ── panic (best-effort, never throws, NOT mutex-gated) ───────────────────────

  async panic(): Promise<LifecycleStatus> {
    this.stopping = true
    this._clearDeviceInterval()
    try {
      await this._restoreOutput()
    } catch {
      /* tolerant */
    }
    try {
      // Nuke every camilladsp, whether or not we spawned it.
      await this.exec(PKILL, ['-x', 'camilladsp'])
    } catch {
      /* pkill exits non-zero when nothing matched — fine */
    }
    try {
      await this.client?.close()
    } catch {
      /* tolerant */
    }
    this.client = null
    if (this.child && this.child.exitCode === null) {
      try {
        this.child.kill('SIGKILL')
      } catch {
        /* already gone */
      }
    }
    this.child = null
    try {
      await this._setState({ engaged: false, bypass: false })
    } catch {
      /* tolerant */
    }
    this.lastEvent = 'panic'
    this.stopping = false
    return this.status()
  }

  // ── status (never throws) ────────────────────────────────────────────────────

  async status(): Promise<LifecycleStatus> {
    const s = this.state
    let dspState: string | null = null
    let clippedSamples: number | null = null
    let dspVersion: string | null = null

    if (this.client && this.client.isConnected) {
      dspState = await this._budget(this.client.getState(), 500).catch(() => null)
      clippedSamples = await this._budget(this.client.getClippedSamples(), 500).catch(() => null)
      dspVersion = await this._budget(this.client.getVersion(), 500).catch(() => null)
    }

    let current: string | null = null
    let outputs: string[] = []
    try {
      current = await this.currentOutput()
    } catch {
      current = null
    }
    try {
      outputs = await this.listOutputs()
    } catch {
      outputs = []
    }

    return {
      engaged: s.engaged,
      bypass: s.bypass,
      activePreset: s.activePreset,
      dspState,
      clippedSamples,
      devices: { current, saved: s.lastRealOutput, outputs },
      dspVersion,
      lastEvent: this.lastEvent,
    }
  }

  // ── boot reconciliation ──────────────────────────────────────────────────────

  /**
   * Called once on daemon boot. If we left audio engaged, try to re-adopt a
   * still-running CamillaDSP; otherwise clear the stale flag. We NEVER auto-spawn
   * or auto-grab audio on boot — adoption only.
   */
  async reconcile(): Promise<void> {
    if (!this.state.engaged) return
    const probe = this.clientFactory({
      port: this.cdspPort,
      host: '127.0.0.1',
      connectTimeoutMs: 1000,
      reconnect: true,
    })
    try {
      await probe.connect()
      await probe.getState() // confirm it actually answers
      this.client = probe
      this._startDeviceInterval()
      this.lastEvent = 'adopted running camilladsp on boot'
      this.emit('state', this._statusLite())
    } catch {
      try {
        await probe.close()
      } catch {
        /* tolerant */
      }
      this.lastEvent = 'stale engaged state cleared on boot'
      await this._setState({ engaged: false }).catch(() => {})
    }
  }

  // ── watchdog ──────────────────────────────────────────────────────────────--

  /** Child 'exit' handler. Fires safe-disengage on an unexpected death. */
  private _onChildExit(code: number | null): void {
    if (this.stopping) return // deliberate teardown
    if (!this.state.engaged) return // mid-engage failure — engage() handles cleanup
    this.lastEvent = `camilladsp exited unexpectedly (code ${code})`
    void this._withLock(async () => {
      if (!this.state.engaged) return // re-check under lock
      await this._safeDisengageAfterCrash()
    })
  }

  private async _safeDisengageAfterCrash(): Promise<void> {
    this.stopping = true
    this._clearDeviceInterval()
    try {
      await this._restoreOutput()
    } catch {
      /* tolerant — the device may have vanished */
    }
    try {
      await this.client?.close()
    } catch {
      /* tolerant */
    }
    this.client = null
    this.child = null
    try {
      await this._setState({ engaged: false })
    } catch {
      /* tolerant */
    }
    this.stopping = false
  }

  private _startDeviceInterval(): void {
    if (this.deviceInterval) return
    this.deviceInterval = setInterval(() => {
      void this._checkDeviceStillPresent()
    }, this.timing.deviceCheckMs)
    this.deviceInterval.unref?.()
  }

  private _clearDeviceInterval(): void {
    if (this.deviceInterval) {
      clearInterval(this.deviceInterval)
      this.deviceInterval = null
    }
  }

  /**
   * The 3s watchdog, two hazards:
   *  1. The device CamillaDSP plays to VANISHED (headphones unplugged) →
   *     disengage gracefully before audio glitches.
   *  2. The system output was STOLEN from the capture loopback (macOS
   *     auto-switches the default output when a device is plugged in) → the EQ
   *     chain is silently bypassed. Re-route to the thief device, since that
   *     is where the user is now listening. A second theft inside the cooldown
   *     means something else is managing audio — stop fighting and disengage.
   * Exposed (not private) so a test can drive it deterministically.
   */
  async _checkDeviceStillPresent(): Promise<void> {
    if (!this.state.engaged || this.stopping || this.deviceCheckRunning) return
    this.deviceCheckRunning = true
    try {
      const dev = this.state.lastRealOutput
      if (!dev) return
      let outs: string[]
      try {
        outs = await this.listOutputs()
      } catch {
        return // can't tell — leave it alone
      }
      if (!outs.includes(dev)) {
        // Set the reason AFTER disengage — it overwrites lastEvent internally.
        await this.disengage()
        this.lastEvent = `playback device "${dev}" disappeared — disengaged`
        this.emit('state', this._statusLite())
        return
      }

      const thief = await this._outputStolen()
      if (!thief) return
      const now = Date.now()
      if (now - this.lastRerouteAt < this.timing.rerouteCooldownMs) {
        await this.disengage()
        this.lastEvent = `system output keeps being switched away ("${thief}") — disengaged`
        this.emit('state', this._statusLite())
        return
      }
      this.lastRerouteAt = now
      try {
        await this._withLock(async () => {
          // Re-verify under the lock: an engage/disengage may have raced us.
          if (!this.state.engaged || this.stopping) return
          const again = await this._outputStolen()
          if (!again) return
          await this._teardownDsp({ restoreOutput: false })
          await this._engage(this.state.activePreset ?? undefined)
          this.lastEvent = `re-routed EQ to "${again}" after system output was switched`
          this.emit('state', this._statusLite())
        })
      } catch (e) {
        // A failed re-engage is self-healed by the child-exit handler; just
        // make the failure visible instead of letting it escape the interval.
        this.lastEvent = `re-route after output switch failed: ${(e as Error).message}`
        this.emit('state', this._statusLite())
      }
    } finally {
      this.deviceCheckRunning = false
    }
  }

  /**
   * While engaged, the system output should be the capture loopback. Returns
   * the device it was switched to instead ("the thief"), or null when all is
   * well, undeterminable, or device switching is disabled.
   */
  private async _outputStolen(): Promise<string | null> {
    if (!this.deviceSwitching) return null
    let cur: string
    try {
      cur = await this.currentOutput()
    } catch {
      return null // can't tell — leave it alone
    }
    if (!cur || cur.toLowerCase().includes('blackhole')) return null
    let capture = 'blackhole 2ch'
    try {
      capture = this._activeProfileOrThrow().captureDeviceName.toLowerCase()
    } catch {
      /* profile unavailable — the blackhole substring check above still guards */
    }
    if (cur.toLowerCase() === capture) return null
    return cur
  }

  // ── low-level helpers ─────────────────────────────────────────────────────--

  private async _switchOutput(name: string): Promise<void> {
    if (!this.deviceSwitching) {
      this.lastEvent = `[deviceSwitching off] would set system output to "${name}"`
      return
    }
    await this.exec(SWITCHAUDIO, ['-s', name, '-t', 'output'])
  }

  /** Restore the system output to a present, non-BlackHole device. */
  private async _restoreOutput(): Promise<void> {
    const target = await this._pickRestoreTarget()
    if (!target) {
      this.lastEvent = 'no present non-BlackHole device to restore system output to'
      return
    }
    await this._switchOutput(target)
  }

  private async _pickRestoreTarget(): Promise<string | null> {
    let outs: string[] = []
    try {
      outs = await this.listOutputs()
    } catch {
      outs = []
    }
    const isBlackhole = (d: string): boolean => d.toLowerCase().includes('blackhole')
    const saved = this.state.lastRealOutput
    if (saved && outs.includes(saved) && !isBlackhole(saved)) return saved
    return outs.find((d) => !isBlackhole(d)) ?? null
  }

  private async _checkConfig(path: string): Promise<void> {
    try {
      await this.exec(CAMILLADSP, ['--check', path])
    } catch (e) {
      const err = e as { stderr?: string; message?: string }
      const detail = (err.stderr && err.stderr.trim()) || err.message || 'unknown error'
      throw new LifecycleError('device_check', `camilladsp --check rejected the config: ${detail}`)
    }
  }

  private async _connectWithRetry(client: CdspLike, budgetMs: number): Promise<void> {
    const deadline = Date.now() + budgetMs
    let lastErr: unknown
    // Always make at least one attempt even if the budget is tiny.
    do {
      try {
        await client.connect()
        return
      } catch (e) {
        lastErr = e
        if (Date.now() >= deadline) break
        await sleep(this.timing.connectRetryMs)
      }
    } while (Date.now() < deadline)
    throw new LifecycleError(
      'engage_failed',
      `camilladsp websocket did not accept a connection within ${budgetMs}ms: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
    )
  }

  private async _killChild(child: ChildLike | null): Promise<void> {
    if (!child || child.exitCode !== null) return
    await new Promise<void>((resolve) => {
      let done = false
      const finish = (): void => {
        if (done) return
        done = true
        clearTimeout(t1)
        clearTimeout(t2)
        resolve()
      }
      child.once('exit', () => finish())
      const t1 = setTimeout(() => {
        if (!done && child.exitCode === null) {
          try {
            child.kill('SIGTERM')
          } catch {
            /* already gone */
          }
        }
      }, this.timing.killTermMs)
      const t2 = setTimeout(() => {
        if (!done) {
          if (child.exitCode === null) {
            try {
              child.kill('SIGKILL')
            } catch {
              /* already gone */
            }
          }
          finish()
        }
      }, this.timing.killKillMs)
      t1.unref?.()
      t2.unref?.()
      if (child.exitCode !== null) finish()
    })
  }

  private _budget<T>(p: Promise<T>, ms: number): Promise<T> {
    return Promise.race([
      p,
      new Promise<T>((_, reject) => {
        const t = setTimeout(() => reject(new Error(`budget ${ms}ms exceeded`)), ms)
        t.unref?.()
      }),
    ])
  }

  private _withLock<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.chain.then(
      () => fn(),
      () => fn(),
    )
    // Keep the chain alive but never let a rejection poison the next op.
    this.chain = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  // ── state file ────────────────────────────────────────────────────────────--

  private _loadStateSync(): LifecycleState {
    try {
      const raw = readFileSync(this.stateFile, 'utf-8')
      const parsed = JSON.parse(raw) as Partial<LifecycleState>
      return {
        engaged: typeof parsed.engaged === 'boolean' ? parsed.engaged : false,
        activePreset: typeof parsed.activePreset === 'string' ? parsed.activePreset : null,
        lastRealOutput: typeof parsed.lastRealOutput === 'string' ? parsed.lastRealOutput : null,
        bypass: typeof parsed.bypass === 'boolean' ? parsed.bypass : false,
      }
    } catch {
      return { ...DEFAULT_STATE }
    }
  }

  private async _setState(patch: Partial<LifecycleState>): Promise<void> {
    this.state = { ...this.state, ...patch }
    await this._writeStateFile()
    this.emit('state', this._statusLite())
  }

  private async _writeStateFile(): Promise<void> {
    await fs.mkdir(this.dataDir, { recursive: true })
    await this._writeFileAtomic(this.stateFile, JSON.stringify(this.state, null, 2) + '\n')
  }

  private async _writeFileAtomic(path: string, contents: string): Promise<void> {
    const tmp = `${path}.tmp`
    await fs.writeFile(tmp, contents, 'utf-8')
    await fs.rename(tmp, path)
  }

  private _statusLite(): {
    engaged: boolean
    bypass: boolean
    activePreset: string | null
    lastEvent: string | null
  } {
    return {
      engaged: this.state.engaged,
      bypass: this.state.bypass,
      activePreset: this.state.activePreset,
      lastEvent: this.lastEvent,
    }
  }
}

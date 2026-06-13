import { EventEmitter } from 'node:events'
import { slugify, type Preset, type Profile } from '@tonedeck/shared'
import type { NowPlaying } from './nowplaying.js'

export type AutoMode = 'off' | 'armed' | 'yielded'

export interface AutoDJLifecycle extends EventEmitter {
  readonly engaged: boolean
  readonly activePreset: string | null
  readonly activeProfile: Profile | null
  applyPreset(slug: string): Promise<{ warnings: string[]; verdict: string }>
}
export interface AutoDJStore {
  getPreset(slug: string): { slug: string } | undefined
  createPreset(input: unknown, opts?: { clamp?: boolean }): Promise<{ preset: Preset }>
}
export interface AutoDJOpts {
  lifecycle: AutoDJLifecycle
  store: AutoDJStore
  nowPlaying: () => Promise<NowPlaying>
  generate: (track: NowPlaying, profile: Profile, opts: { slug: string }) => Promise<Preset>
  debounceMs?: number
  maxGenPerHour?: number
  /** After a failed/timed-out generation, don't re-attempt that track for this long. */
  genCooldownMs?: number
  onAuto?: (e: { mode: AutoMode; generating?: boolean; track?: NowPlaying }) => void
}

export class AutoDJ extends EventEmitter {
  mode: AutoMode = 'off'
  private last: NowPlaying | null = null
  private lastAppliedTrackId: number | null = null
  private pendingTrackId: number | null = null
  private pendingSince = 0
  private initiatedSlug: string | null = null
  private inFlight = new Set<number>()
  private ticking = false
  private genTimestamps: number[] = []
  /** trackId -> earliest timestamp at which generation may be re-attempted (post-failure backoff). */
  private genCooldownUntil = new Map<number, number>()
  private readonly o: AutoDJOpts & { debounceMs: number; maxGenPerHour: number; genCooldownMs: number }

  constructor(opts: AutoDJOpts) {
    super()
    this.o = { debounceMs: 4000, maxGenPerHour: 30, genCooldownMs: 60_000, ...opts }
    opts.lifecycle.on('applied', ({ slug }: { slug: string }) => {
      if (this.mode === 'armed' && slug !== this.initiatedSlug) this.setMode('yielded')
    })
  }

  arm() { if (this.mode === 'off') this.setMode('armed') }
  disarm() {
    this.lastAppliedTrackId = null
    this.pendingTrackId = null
    this.initiatedSlug = null
    this.pendingSince = 0
    // in-flight generate self-cleans via its finally block; don't touch inFlight here
    this.setMode('off')
  }

  private setMode(m: AutoMode) {
    if (this.mode === m) return
    this.mode = m
    const e = { mode: m, track: this.last ?? undefined }
    this.o.onAuto?.(e); this.emit('auto', e)
  }

  private emitGenerating(generating: boolean) {
    const e = { mode: this.mode, generating, track: this.last ?? undefined }
    this.o.onAuto?.(e); this.emit('auto', e)
  }

  /** One poll cycle. Call on an interval (and from tests). Never throws. */
  async tick(now = Date.now()): Promise<void> {
    if (this.mode === 'off') return
    if (this.ticking) return
    this.ticking = true
    try {
      let np: NowPlaying
      try { np = await this.o.nowPlaying() } catch { return }
      this.last = np
      if (np.state !== 'playing' || np.trackId == null) return
      if (np.trackId === this.lastAppliedTrackId) return
      if (np.trackId !== this.pendingTrackId) { this.pendingTrackId = np.trackId; this.pendingSince = now; return }
      if (now - this.pendingSince < this.o.debounceMs) return
      if (this.mode === 'yielded') this.setMode('armed')
      await this.resolveAndApply(np, now)
    } finally {
      this.ticking = false
    }
  }

  private async resolveAndApply(np: NowPlaying, now: number): Promise<void> {
    if (!this.o.lifecycle.engaged) return // never grabs audio
    const profile = this.o.lifecycle.activeProfile
    if (!profile) return

    const trackSlug = slugify(np.artist ?? '', np.title ?? '')
    const albumSlug = slugify(np.artist ?? '', np.album ?? '')

    let slug: string | null = null
    if (this.o.store.getPreset(trackSlug)) slug = trackSlug
    else if (np.album && this.o.store.getPreset(albumSlug)) slug = albumSlug
    else if (np.trackId != null && (this.genCooldownUntil.get(np.trackId) ?? 0) > now) {
      // generation recently failed for this track — back off so we don't respawn claude every tick
      slug = this.albumFallback(np)
    } else slug = await this.generateAndStore(np, profile, trackSlug, now)

    if (!slug) return
    this.initiatedSlug = slug
    try {
      await this.o.lifecycle.applyPreset(slug)
      this.lastAppliedTrackId = np.trackId
    } catch {
      // apply failed — leave lastAppliedTrackId unset so the next tick retries this track
    }
  }

  private async generateAndStore(np: NowPlaying, profile: Profile, slug: string, now: number): Promise<string | null> {
    if (np.trackId != null && this.inFlight.has(np.trackId)) return null
    this.genTimestamps = this.genTimestamps.filter((t) => now - t < 3_600_000)
    if (this.genTimestamps.length >= this.o.maxGenPerHour) return this.albumFallback(np)
    if (np.trackId != null) this.inFlight.add(np.trackId)
    this.emitGenerating(true)
    try {
      const preset = await this.o.generate(np, profile, { slug })
      await this.o.store.createPreset(preset, { clamp: true })
      // only count successful generates against the hourly budget
      this.genTimestamps.push(now)
      return slug
    } catch {
      // back off this track so a slow/failing generation can't respawn every poll tick
      if (np.trackId != null) this.genCooldownUntil.set(np.trackId, now + this.o.genCooldownMs)
      return this.albumFallback(np) // album preset, otherwise null (keep current EQ)
    } finally {
      if (np.trackId != null) this.inFlight.delete(np.trackId)
      this.emitGenerating(false)
    }
  }

  private albumFallback(np: NowPlaying): string | null {
    const albumSlug = slugify(np.artist ?? '', np.album ?? '')
    return np.album && this.o.store.getPreset(albumSlug) ? albumSlug : null
  }
}

import { describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { AutoDJ } from '../src/autodj.js'

function fakeLifecycle(initial = { engaged: true, activePreset: 'mbdtf' as string | null }) {
  const ee = new EventEmitter()
  const applied: string[] = []
  return Object.assign(ee, {
    engaged: initial.engaged,
    get activePreset() { return initial.activePreset },
    activeProfile: { id: 'ft1-pro', name: 'FT1', playbackDeviceName: 'x', captureDeviceName: 'BlackHole 2ch', bandTemplate: [], limits: { bandGainDb: [-12, 12], preampDb: [-12, 0], q: [0.3, 5], freqHz: [20, 20000], clipHeadroomDb: 1 }, houseNotes: '' },
    applied,
    async applyPreset(slug: string) { applied.push(slug); initial.activePreset = slug; ee.emit('applied', { slug }); return { warnings: [], verdict: 'ok' } },
  })
}
const tracks = {
  ny: { state: 'playing' as const, trackId: 1, title: 'NY State', artist: 'Nas', album: 'Illmatic' },
  life: { state: 'playing' as const, trackId: 2, title: "Life's a Bitch", artist: 'Nas', album: 'Illmatic' },
}
const store = (slugs: string[]) => ({
  getPreset: (s: string) => (slugs.includes(s) ? { slug: s } : undefined),
  createPreset: vi.fn(async (p: any) => ({ preset: p, warnings: [], verdict: 'ok' })),
})

describe('AutoDJ', () => {
  it('does nothing while off', async () => {
    const lc = fakeLifecycle()
    const dj = new AutoDJ({ lifecycle: lc as any, store: store([]) as any, nowPlaying: async () => tracks.ny, generate: vi.fn(), debounceMs: 0 })
    await dj.tick(); await dj.tick()
    expect(lc.applied).toEqual([])
  })

  it('applies an existing track preset (no generation)', async () => {
    const lc = fakeLifecycle()
    const gen = vi.fn()
    const dj = new AutoDJ({ lifecycle: lc as any, store: store(['nas-ny-state']) as any, nowPlaying: async () => tracks.ny, generate: gen, debounceMs: 0 })
    dj.arm()
    await dj.tick() // pending
    await dj.tick() // confirmed -> apply
    expect(lc.applied).toContain('nas-ny-state')
    expect(gen).not.toHaveBeenCalled()
  })

  it('falls back to album preset when no track preset', async () => {
    const lc = fakeLifecycle()
    const dj = new AutoDJ({ lifecycle: lc as any, store: store(['nas-illmatic']) as any, nowPlaying: async () => tracks.ny, generate: vi.fn(), debounceMs: 0 })
    dj.arm(); await dj.tick(); await dj.tick()
    expect(lc.applied).toContain('nas-illmatic')
  })

  it('generates + caches + applies when nothing exists', async () => {
    const lc = fakeLifecycle()
    const st = store([])
    const gen = vi.fn(async () => ({ slug: 'nas-ny-state', kind: 'track' }))
    const dj = new AutoDJ({ lifecycle: lc as any, store: st as any, nowPlaying: async () => tracks.ny, generate: gen as any, debounceMs: 0 })
    dj.arm(); await dj.tick(); await dj.tick()
    expect(gen).toHaveBeenCalledOnce()
    expect(st.createPreset).toHaveBeenCalledOnce()
    expect(st.createPreset).toHaveBeenCalledWith(expect.anything(), { clamp: true })
    expect(lc.applied).toContain('nas-ny-state')
  })

  it('yields on a manual apply, resumes on next track', async () => {
    const lc = fakeLifecycle()
    let current = tracks.ny
    const dj = new AutoDJ({ lifecycle: lc as any, store: store(['nas-ny-state', 'nas-lifes-a-bitch']) as any, nowPlaying: async () => current, generate: vi.fn(), debounceMs: 0 })
    dj.arm(); await dj.tick(); await dj.tick()        // applies nas-ny-state
    lc.applyPreset('user-pick')                        // manual override (foreign)
    expect(dj.mode).toBe('yielded')
    await dj.tick()                                    // same track, still yielded -> no auto apply
    expect(lc.applied.filter((s) => s === 'nas-ny-state')).toHaveLength(1)
    current = tracks.life                              // track changes
    await dj.tick(); await dj.tick()
    expect(dj.mode).toBe('armed')
    expect(lc.applied).toContain('nas-lifes-a-bitch')
  })

  it('backs off generation after a failure (no retry storm)', async () => {
    const lc = fakeLifecycle()
    const gen = vi.fn().mockRejectedValue(new Error('timeout'))
    const dj = new AutoDJ({ lifecycle: lc as any, store: store([]) as any, nowPlaying: async () => tracks.ny, generate: gen as any, debounceMs: 0, genCooldownMs: 60_000 })
    dj.arm()
    await dj.tick(1000); await dj.tick(1000)   // first new track -> generate attempted -> fails -> cooldown
    expect(gen).toHaveBeenCalledTimes(1)
    await dj.tick(1000); await dj.tick(1000)   // within cooldown -> must NOT respawn generation
    expect(gen).toHaveBeenCalledTimes(1)
    await dj.tick(70_000)                       // past cooldown -> one retry allowed
    expect(gen).toHaveBeenCalledTimes(2)
  })

  it('does not re-apply the same track repeatedly', async () => {
    const lc = fakeLifecycle()
    const dj = new AutoDJ({ lifecycle: lc as any, store: store(['nas-ny-state']) as any, nowPlaying: async () => tracks.ny, generate: vi.fn(), debounceMs: 0 })
    dj.arm(); await dj.tick(); await dj.tick(); await dj.tick(); await dj.tick()
    expect(lc.applied.filter((s) => s === 'nas-ny-state')).toHaveLength(1)
  })

  it('re-applies the current track after disarm then re-arm', async () => {
    const lc = fakeLifecycle()
    const dj = new AutoDJ({ lifecycle: lc as any, store: store(['nas-ny-state']) as any, nowPlaying: async () => tracks.ny, generate: vi.fn(), debounceMs: 0 })
    dj.arm(); await dj.tick(); await dj.tick()
    expect(lc.applied).toEqual(['nas-ny-state'])
    dj.disarm()
    dj.arm(); await dj.tick(); await dj.tick()
    expect(lc.applied).toEqual(['nas-ny-state', 'nas-ny-state']) // re-applied after re-arm
  })

  it('stops generating past the hourly cap and falls back to album', async () => {
    const lc = fakeLifecycle()
    const st = store(['nas-illmatic']) // album exists as fallback for second track only
    // first track has album 'It Was Written' — no preset for it, so generate fires
    let current = { ...tracks.ny, album: 'It Was Written' }
    const gen = vi.fn(async () => ({ slug: 'nas-ny-state', kind: 'track' }))
    const dj = new AutoDJ({ lifecycle: lc as any, store: st as any, nowPlaying: async () => current, generate: gen as any, debounceMs: 0, maxGenPerHour: 1 })
    dj.arm()
    // first new track -> no track preset, no album preset -> generates (cap: 0->1)
    await dj.tick(1000); await dj.tick(1000)
    // change track id so it's treated as a new track, but no track preset -> would generate, cap=1 already hit -> album fallback
    current = { ...tracks.ny, trackId: 99, title: 'Other', album: 'Illmatic' }
    await dj.tick(2000); await dj.tick(2000)
    expect(gen).toHaveBeenCalledTimes(1)
    expect(lc.applied).toContain('nas-illmatic')
  })
})

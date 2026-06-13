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

  it('does not re-apply the same track repeatedly', async () => {
    const lc = fakeLifecycle()
    const dj = new AutoDJ({ lifecycle: lc as any, store: store(['nas-ny-state']) as any, nowPlaying: async () => tracks.ny, generate: vi.fn(), debounceMs: 0 })
    dj.arm(); await dj.tick(); await dj.tick(); await dj.tick(); await dj.tick()
    expect(lc.applied.filter((s) => s === 'nas-ny-state')).toHaveLength(1)
  })
})

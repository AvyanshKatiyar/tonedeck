import { describe, it, expect } from 'vitest'
import { runCorpusBuild, type CorpusItem } from '../src/corpus.js'
import type { Preset } from '@tonedeck/shared'

const fakePreset = (slug: string): Preset =>
  ({
    schemaVersion: 1, slug, kind: 'track', title: slug, profile: 'ft1pro', preamp: -3,
    bands: [{ id: 'b1', type: 'peaking', freq: 1000, q: 1, gain: 1 }], intent: 'x',
    provenance: { createdBy: 'claude', history: [] }, version: 1,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  }) as Preset

const items = (slugs: string[]): CorpusItem[] =>
  slugs.map((s) => ({ title: s, artist: 'K', slug: s }))

describe('runCorpusBuild', () => {
  it('generates+saves each new item and skips existing slugs', async () => {
    const saved: string[] = []
    const r = await runCorpusBuild({
      items: items(['a', 'b', 'c']),
      existing: new Set(['b']),
      generate: async (it) => fakePreset(it.slug),
      save: async (p) => { saved.push(p.slug) },
      concurrency: 2,
    })
    expect(r.generated).toBe(2)
    expect(r.skipped).toBe(1)
    expect(r.failed).toEqual([])
    expect(saved.sort()).toEqual(['a', 'c'])
  })

  it('records failures and keeps going', async () => {
    const r = await runCorpusBuild({
      items: items(['a', 'boom', 'c']),
      existing: new Set(),
      generate: async (it) => {
        if (it.slug === 'boom') throw new Error('gen failed')
        return fakePreset(it.slug)
      },
      save: async () => {},
      concurrency: 1,
    })
    expect(r.generated).toBe(2)
    expect(r.failed).toEqual([{ slug: 'boom', error: 'gen failed' }])
  })

  it('never exceeds the concurrency limit', async () => {
    let active = 0
    let peak = 0
    await runCorpusBuild({
      items: items(['a', 'b', 'c', 'd', 'e']),
      existing: new Set(),
      generate: async (it) => {
        active++
        peak = Math.max(peak, active)
        await new Promise((res) => setTimeout(res, 5))
        active--
        return fakePreset(it.slug)
      },
      save: async () => {},
      concurrency: 2,
    })
    expect(peak).toBeLessThanOrEqual(2)
  })
})

import { describe, it, expect } from 'vitest'
import {
  presetCurve,
  curveDistance,
  CLUSTER_FREQS,
  clusterPresets,
  describeCurve,
} from '../src/cluster.js'
import type { Preset } from '../src/preset.js'

function preset(over: Partial<Preset>): Preset {
  return {
    schemaVersion: 1,
    slug: over.slug ?? 's',
    kind: 'track',
    title: over.title ?? 'T',
    profile: 'ft1pro',
    preamp: over.preamp ?? 0,
    bands: over.bands ?? [{ id: 'b1', type: 'peaking', freq: 100, q: 1, gain: 3 }],
    intent: 'x',
    provenance: { createdBy: 'user', history: [] },
    version: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  } as Preset
}

describe('presetCurve', () => {
  it('is mean-normalized to ~0 (loudness removed)', () => {
    const c = presetCurve(preset({}))
    const mean = c.reduce((a, b) => a + b, 0) / c.length
    expect(Math.abs(mean)).toBeLessThan(1e-9)
    expect(c).toHaveLength(CLUSTER_FREQS.length)
  })
  it('ignores preamp (tone-only): same bands, different preamp → identical curve', () => {
    const a = presetCurve(preset({ preamp: 0 }))
    const b = presetCurve(preset({ preamp: -6 }))
    expect(curveDistance(a, b)).toBeLessThan(1e-9)
  })
})

describe('curveDistance', () => {
  it('is 0 for identical curves and >0 for different shapes', () => {
    const bass = preset({ bands: [{ id: 'b1', type: 'lowshelf', freq: 80, q: 0.7, gain: 5 }] })
    const treble = preset({ bands: [{ id: 'b1', type: 'highshelf', freq: 8000, q: 0.7, gain: 5 }] })
    expect(curveDistance(presetCurve(bass), presetCurve(bass))).toBe(0)
    expect(curveDistance(presetCurve(bass), presetCurve(treble))).toBeGreaterThan(1)
  })
})

describe('clusterPresets', () => {
  const bassA = preset({ slug: 'bass-a', bands: [{ id: 'b1', type: 'lowshelf', freq: 80, q: 0.7, gain: 5 }] })
  const bassB = preset({ slug: 'bass-b', bands: [{ id: 'b1', type: 'lowshelf', freq: 80, q: 0.7, gain: 5.2 }] })
  const treble = preset({ slug: 'treble', bands: [{ id: 'b1', type: 'highshelf', freq: 8000, q: 0.7, gain: 5 }] })

  it('groups near-identical shapes and separates a different one', () => {
    const r = clusterPresets([bassA, bassB, treble], { threshold: 1.5 })
    expect(r.clusters).toHaveLength(2)
    const big = r.clusters.find((c) => c.members.length === 2)!
    expect(big.members.map((m) => m.slug).sort()).toEqual(['bass-a', 'bass-b'])
  })

  it('reports the dB gap to the nearest other cluster (the splitting variance)', () => {
    const r = clusterPresets([bassA, treble], { threshold: 1.5 })
    expect(r.clusters).toHaveLength(2)
    expect(r.clusters[0].nearestDistanceDb).toBeGreaterThan(1.5)
  })

  it('handles empty input', () => {
    expect(clusterPresets([], {})).toEqual({ threshold: 1.5, clusters: [] })
  })
})

describe('describeCurve', () => {
  it('labels a bass-forward curve', () => {
    const c = presetCurve(preset({ bands: [{ id: 'b1', type: 'lowshelf', freq: 80, q: 0.7, gain: 6 }] }))
    expect(describeCurve(c, CLUSTER_FREQS)).toContain('bass-forward')
  })
})

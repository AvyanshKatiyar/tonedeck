import { describe, it, expect } from 'vitest'
import { VIBES, applyVibes } from '../src/index.js'
import { loadFt1Profile, makeTemplatePreset } from './fixtures.js'

const profile = loadFt1Profile()

function gainOf(bands: { id: string; gain: number }[], id: string) {
  return bands.find((b) => b.id === id)?.gain
}

describe('VIBES table', () => {
  it('exposes the five documented vibes', () => {
    expect(Object.keys(VIBES).sort()).toEqual(
      ['clarity', 'punch', 'smoothness', 'sparkle', 'warmth'].sort(),
    )
  })
})

describe('applyVibes', () => {
  it('warmth +1 produces exactly the documented deltas', () => {
    const { preset } = applyVibes(makeTemplatePreset(), { warmth: 1 }, profile)
    expect(gainOf(preset.bands, 'Bass')).toBeCloseTo(0.6, 10)
    expect(gainOf(preset.bands, 'KickBody')).toBeCloseTo(0.4, 10)
    expect(gainOf(preset.bands, 'LowMidClean')).toBeCloseTo(0.3, 10)
    expect(gainOf(preset.bands, 'Air')).toBeCloseTo(-0.3, 10)
    // untouched bands stay at 0
    expect(gainOf(preset.bands, 'UpperMidTame')).toBeCloseTo(0, 10)
    expect(gainOf(preset.bands, 'PresenceTame')).toBeCloseTo(0, 10)
  })

  it('copies a missing band from the profile template before applying', () => {
    const base = makeTemplatePreset()
    base.bands = base.bands.filter((b) => b.id !== 'Air') // drop Air
    const { preset, changes } = applyVibes(base, { sparkle: 1 }, profile)
    expect(gainOf(preset.bands, 'Air')).toBeCloseTo(0.8, 10)
    expect(changes.some((c) => /Air/.test(c) && /template/i.test(c))).toBe(true)
  })

  it('clamps each vibe step to ±3 per call', () => {
    const { preset, changes } = applyVibes(makeTemplatePreset(), { warmth: 5 }, profile)
    // warmth step clamped 5 -> 3, so Bass = 0.6 * 3 = 1.8
    expect(gainOf(preset.bands, 'Bass')).toBeCloseTo(1.8, 10)
    expect(changes.some((c) => /clamp/i.test(c))).toBe(true)
  })

  it('clamps the resulting band gain to profile limits and warns', () => {
    const base = makeTemplatePreset()
    base.bands = base.bands.map((b) => (b.id === 'Bass' ? { ...b, gain: 5.0 } : b))
    const { preset, warnings } = applyVibes(base, { warmth: 3 }, profile)
    // 5.0 + 0.6*3 = 6.8 -> clamped to profile max 6
    expect(gainOf(preset.bands, 'Bass')).toBe(6)
    expect(warnings.length).toBeGreaterThan(0)
  })

  it('does not bump version or updatedAt', () => {
    const base = makeTemplatePreset()
    const { preset } = applyVibes(base, { warmth: 1 }, profile)
    expect(preset.version).toBe(base.version)
    expect(preset.updatedAt).toBe(base.updatedAt)
  })
})

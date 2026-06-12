import { describe, it, expect } from 'vitest'
import {
  clampPreset,
  predictMaxBoostDb,
  headroomVerdict,
  autoTrim,
} from '../src/index.js'
import { loadFt1Profile, make808Preset, makeTemplatePreset } from './fixtures.js'

const profile = loadFt1Profile()

describe('predictMaxBoostDb', () => {
  it('an 808s-style loud-house preset peaks ~5.0–5.6 dB', () => {
    const peak = predictMaxBoostDb(make808Preset())
    // Spec target: "≈ 5.0–5.6". The exact RBJ-computed peak for these bands is
    // ~4.997 dB (the 60 Hz shelf is just under +3 at 20 Hz), i.e. ~5.0.
    expect(peak).toBeGreaterThanOrEqual(4.95)
    expect(peak).toBeLessThanOrEqual(5.6)
    expect(peak).toBeCloseTo(5.0, 1)
  })
})

describe('headroomVerdict + autoTrim', () => {
  it('808s warns, suggests a trim of ~(peak - headroom), and autoTrim makes it ok', () => {
    const preset = make808Preset()
    const v = headroomVerdict(preset, profile)
    expect(v.verdict).toBe('warn')
    expect(v.suggestedPreampTrimDb).toBeCloseTo(v.maxBoostDb - 3, 5)
    expect(v.warnings.length).toBeGreaterThan(0)

    const { preset: trimmed, trimmedByDb } = autoTrim(preset, profile)
    expect(trimmedByDb).toBeCloseTo(v.suggestedPreampTrimDb, 5)
    expect(headroomVerdict(trimmed, profile).verdict).toBe('ok')
  })

  it('a flat-ish preset within headroom is ok and autoTrim is a no-op', () => {
    const preset = makeTemplatePreset({ preamp: 1.0 })
    const v = headroomVerdict(preset, profile)
    expect(v.verdict).toBe('ok')
    expect(v.suggestedPreampTrimDb).toBe(0)
    expect(autoTrim(preset, profile).trimmedByDb).toBe(0)
  })

  it('two stacked +6 bands warn (rescuable by preamp trim), not reject', () => {
    const preset = makeTemplatePreset({ preamp: 4.0 })
    preset.bands = [
      { id: 's1', type: 'peaking', freq: 1000, q: 2, gain: 6 },
      { id: 's2', type: 'peaking', freq: 1000, q: 2, gain: 6 },
    ]
    expect(headroomVerdict(preset, profile).verdict).toBe('warn')
  })

  it('four stacked +6 bands are absurd and rejected even at minimum preamp', () => {
    const preset = makeTemplatePreset({ preamp: 4.0 })
    preset.bands = [
      { id: 's1', type: 'peaking', freq: 1000, q: 2, gain: 6 },
      { id: 's2', type: 'peaking', freq: 1000, q: 2, gain: 6 },
      { id: 's3', type: 'peaking', freq: 1000, q: 2, gain: 6 },
      { id: 's4', type: 'peaking', freq: 1000, q: 2, gain: 6 },
    ]
    const v = headroomVerdict(preset, profile)
    expect(v.verdict).toBe('reject')
    expect(v.warnings.length).toBeGreaterThan(0)
  })
})

describe('clampPreset', () => {
  it('clamps an over-limit band gain to +6 with a warning', () => {
    const preset = makeTemplatePreset()
    preset.bands[0] = { ...preset.bands[0], gain: 9 }
    const { preset: clamped, warnings } = clampPreset(preset, profile)
    expect(clamped.bands[0].gain).toBe(6)
    expect(warnings.length).toBeGreaterThan(0)
    expect(warnings.some((w) => /gain/i.test(w))).toBe(true)
  })

  it('clamps an over-limit preamp with a warning', () => {
    const preset = makeTemplatePreset({ preamp: 10 })
    const { preset: clamped, warnings } = clampPreset(preset, profile)
    expect(clamped.preamp).toBe(4)
    expect(warnings.some((w) => /preamp/i.test(w))).toBe(true)
  })

  it('does not mutate the input preset', () => {
    const preset = makeTemplatePreset()
    preset.bands[0] = { ...preset.bands[0], gain: 9 }
    clampPreset(preset, profile)
    expect(preset.bands[0].gain).toBe(9)
  })
})

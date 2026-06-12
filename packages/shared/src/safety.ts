/**
 * Safety rails: clamping to per-device limits and clip-headroom prediction.
 *
 * POLICY — warnings inform, they don't block. The 16 shipped builtins run
 * combined boosts of ~+5 dB by design (loud "house" style) and are
 * grandfathered: a preset over its clip-headroom produces a WARN plus a
 * suggested preamp trim, never a hard rejection. The only hard 'reject' is
 * when the band boosts ALONE are absurd — i.e. even after trimming the preamp
 * all the way to its profile minimum, the predicted peak is still more than
 * 6 dB above the clip-headroom. (Schema violations are rejected upstream in
 * preset.ts; this module never sees malformed presets.)
 */
import type { Preset, Profile } from './preset.js'
import { logSpacedFreqs, responseDb } from './biquad.js'

const EPS = 1e-9

export interface ClampResult {
  preset: Preset
  warnings: string[]
}

function clampTo(value: number, [min, max]: [number, number]): number {
  return Math.min(max, Math.max(min, value))
}

/** Clamp every band gain/q/freq and the preamp to profile limits. */
export function clampPreset(preset: Preset, profile: Profile): ClampResult {
  const warnings: string[] = []
  const { bandGainDb, q, freqHz, preampDb } = profile.limits

  const bands = preset.bands.map((band) => {
    const next = { ...band }
    if (next.gain < bandGainDb[0] || next.gain > bandGainDb[1]) {
      const c = clampTo(next.gain, bandGainDb)
      warnings.push(
        `Band "${band.id}" gain ${band.gain} dB clamped to ${c} dB (limit ${bandGainDb[0]}..${bandGainDb[1]} dB)`,
      )
      next.gain = c
    }
    if (next.q < q[0] || next.q > q[1]) {
      const c = clampTo(next.q, q)
      warnings.push(`Band "${band.id}" Q ${band.q} clamped to ${c} (limit ${q[0]}..${q[1]})`)
      next.q = c
    }
    if (next.freq < freqHz[0] || next.freq > freqHz[1]) {
      const c = clampTo(next.freq, freqHz)
      warnings.push(
        `Band "${band.id}" freq ${band.freq} Hz clamped to ${c} Hz (limit ${freqHz[0]}..${freqHz[1]} Hz)`,
      )
      next.freq = c
    }
    return next
  })

  let preamp = preset.preamp
  if (preamp < preampDb[0] || preamp > preampDb[1]) {
    const c = clampTo(preamp, preampDb)
    warnings.push(`Preamp ${preamp} dB clamped to ${c} dB (limit ${preampDb[0]}..${preampDb[1]} dB)`)
    preamp = c
  }

  return { preset: { ...preset, bands, preamp }, warnings }
}

/** Max of the total response over 256 log-spaced points 20–20000 Hz. */
export function predictMaxBoostDb(preset: Preset, sampleRate = 48000): number {
  const freqs = logSpacedFreqs(256, 20, 20000)
  const resp = responseDb(preset.bands, preset.preamp, freqs, sampleRate)
  return Math.max(...resp)
}

export type Verdict = 'ok' | 'warn' | 'reject'

export interface HeadroomVerdict {
  verdict: Verdict
  maxBoostDb: number
  suggestedPreampTrimDb: number
  warnings: string[]
}

export function headroomVerdict(preset: Preset, profile: Profile): HeadroomVerdict {
  const maxBoostDb = predictMaxBoostDb(preset)
  const clip = profile.limits.clipHeadroomDb
  const preampMin = profile.limits.preampDb[0]
  const availableTrim = Math.max(0, preset.preamp - preampMin)
  const warnings: string[] = []

  if (maxBoostDb <= clip + EPS) {
    return { verdict: 'ok', maxBoostDb, suggestedPreampTrimDb: 0, warnings }
  }

  // Trimming the preamp lowers the whole curve 1:1, so the residual peak after
  // trimming all the way to the preamp minimum is maxBoost - availableTrim.
  const residualAfterMaxTrim = maxBoostDb - availableTrim
  if (residualAfterMaxTrim > clip + 6 + EPS) {
    warnings.push(
      `Predicted peak boost ${maxBoostDb.toFixed(1)} dB is beyond rescue: even trimming the preamp to its minimum (${preampMin} dB) leaves ${residualAfterMaxTrim.toFixed(1)} dB, above the ${clip + 6} dB hard ceiling. The band boosts themselves are too large.`,
    )
    return { verdict: 'reject', maxBoostDb, suggestedPreampTrimDb: availableTrim, warnings }
  }

  const neededTrim = maxBoostDb - clip
  const suggestedPreampTrimDb = Math.min(neededTrim, availableTrim)
  warnings.push(
    `Predicted peak boost ${maxBoostDb.toFixed(1)} dB exceeds clip headroom ${clip} dB. Suggest trimming preamp by ${suggestedPreampTrimDb.toFixed(1)} dB (informational — playback is not blocked).`,
  )
  return { verdict: 'warn', maxBoostDb, suggestedPreampTrimDb, warnings }
}

export interface AutoTrimResult {
  preset: Preset
  trimmedByDb: number
}

/** Apply the suggested preamp trim; no-op when the verdict is already 'ok'. */
export function autoTrim(preset: Preset, profile: Profile): AutoTrimResult {
  const v = headroomVerdict(preset, profile)
  if (v.verdict === 'ok' || v.suggestedPreampTrimDb <= 0) {
    return { preset: { ...preset }, trimmedByDb: 0 }
  }
  return {
    preset: { ...preset, preamp: preset.preamp - v.suggestedPreampTrimDb },
    trimmedByDb: v.suggestedPreampTrimDb,
  }
}

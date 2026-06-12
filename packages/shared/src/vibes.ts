/**
 * Layman vocabulary → band-gain deltas. House-tuning v1.
 *
 * Each vibe maps a +1 "step" to a set of per-band gain deltas (dB). Steps are
 * clamped to -3..+3 per vibe per call; the resulting gains are clamped to the
 * profile limits via clampPreset. Referencing a band the preset lacks copies
 * it from the profile template (at gain 0) first. This never bumps version or
 * updatedAt — that bookkeeping is the daemon's job.
 */
import type { Band, Preset, Profile } from './preset.js'
import { clampPreset } from './safety.js'

export interface VibeDelta {
  band: string
  delta: number
}

export const VIBES = {
  warmth: [
    { band: 'Bass', delta: 0.6 },
    { band: 'KickBody', delta: 0.4 },
    { band: 'LowMidClean', delta: 0.3 },
    { band: 'Air', delta: -0.3 },
  ],
  punch: [
    { band: 'KickBody', delta: 0.8 },
    { band: 'Bass', delta: 0.4 },
    { band: 'LowMidClean', delta: -0.3 },
  ],
  clarity: [
    { band: 'UpperMidTame', delta: 0.6 },
    { band: 'PresenceTame', delta: 0.3 },
    { band: 'LowMidClean', delta: -0.4 },
  ],
  smoothness: [
    { band: 'UpperMidTame', delta: -0.6 },
    { band: 'PresenceTame', delta: -0.8 },
    { band: 'Air', delta: -0.2 },
  ],
  sparkle: [
    { band: 'Air', delta: 0.8 },
    { band: 'PresenceTame', delta: 0.3 },
  ],
} as const satisfies Record<string, readonly VibeDelta[]>

export type VibeName = keyof typeof VIBES

export interface ApplyVibesResult {
  preset: Preset
  changes: string[]
  warnings: string[]
}

const STEP_MIN = -3
const STEP_MAX = 3

export function applyVibes(
  preset: Preset,
  adjustments: Partial<Record<VibeName, number>>,
  profile: Profile,
): ApplyVibesResult {
  const changes: string[] = []
  const warnings: string[] = []
  const bands: Band[] = preset.bands.map((b) => ({ ...b }))
  const byId = new Map<string, Band>(bands.map((b) => [b.id, b]))

  for (const key of Object.keys(adjustments) as VibeName[]) {
    const raw = adjustments[key]
    if (raw === undefined) continue

    let step = raw
    if (step < STEP_MIN || step > STEP_MAX) {
      const clamped = Math.min(STEP_MAX, Math.max(STEP_MIN, step))
      changes.push(`Clamped "${key}" step from ${step} to ${clamped} (allowed ${STEP_MIN}..${STEP_MAX} per call)`)
      step = clamped
    }
    if (step === 0) continue

    for (const { band: bandId, delta } of VIBES[key]) {
      let target = byId.get(bandId)
      if (!target) {
        const template = profile.bandTemplate.find((b) => b.id === bandId)
        if (!template) {
          warnings.push(`Vibe "${key}" references band "${bandId}" missing from both preset and profile template — skipped`)
          continue
        }
        target = { ...template, gain: 0 }
        bands.push(target)
        byId.set(bandId, target)
        changes.push(`Added band "${bandId}" from profile template (gain 0) to receive "${key}"`)
      }
      const before = target.gain
      target.gain = before + delta * step
      changes.push(`"${key}" ${step >= 0 ? '+' : ''}${step}: band "${bandId}" gain ${before} → ${target.gain} dB`)
    }
  }

  const clamped = clampPreset({ ...preset, bands }, profile)
  warnings.push(...clamped.warnings)
  return { preset: clamped.preset, changes, warnings }
}

/**
 * vibedraft.ts — PURE client-side vibe → draft-preset math.
 *
 * Mirrors `applyVibes` from @tonedeck/shared band-for-band so the UI can redraw
 * the curve INSTANTLY on every slider input without a round-trip, while staying
 * byte-identical to what the daemon would compute. The parity is asserted in
 * test/vibedraft.test.ts. We reuse the shared VIBES table + clampPreset so the
 * only thing reimplemented here is the (synchronous, allocation-light)
 * accumulation loop.
 */
import { VIBES, clampPreset, type Band, type Preset, type Profile, type VibeName } from '@tonedeck/shared'

const STEP_MIN = -3
const STEP_MAX = 3

const clampStep = (s: number) => Math.min(STEP_MAX, Math.max(STEP_MIN, s))

/**
 * Apply a set of vibe step adjustments to a base preset, returning a fully
 * clamped draft preset. Identical band gains to `applyVibes(...).preset`.
 */
export function applyVibesDraft(
  base: Preset,
  adjustments: Partial<Record<VibeName, number>>,
  profile: Profile,
): Preset {
  const bands: Band[] = base.bands.map((b) => ({ ...b }))
  const byId = new Map<string, Band>(bands.map((b) => [b.id, b]))

  for (const key of Object.keys(adjustments) as VibeName[]) {
    const raw = adjustments[key]
    if (raw === undefined) continue
    const step = clampStep(raw)
    if (step === 0) continue

    for (const { band: bandId, delta } of VIBES[key]) {
      let target = byId.get(bandId)
      if (!target) {
        const template = profile.bandTemplate.find((b) => b.id === bandId)
        if (!template) continue
        target = { ...template, gain: 0 }
        bands.push(target)
        byId.set(bandId, target)
      }
      target.gain = target.gain + delta * step
    }
  }

  return clampPreset({ ...base, bands }, profile).preset
}

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseProfile, type Preset, type Profile } from '../src/index.js'

/** Raw (unparsed) contents of the real repo-root profiles/ft1pro.json. */
export function loadFt1ProfileRaw(): unknown {
  const p = fileURLToPath(new URL('../../../profiles/ft1pro.json', import.meta.url))
  return JSON.parse(readFileSync(p, 'utf8'))
}

/** Parsed, validated FT1 Pro profile. */
export function loadFt1Profile(): Profile {
  return parseProfile(loadFt1ProfileRaw())
}

/** A neutral preset built from the profile band template (all gains 0). */
export function makeTemplatePreset(overrides: Partial<Preset> = {}): Preset {
  const profile = loadFt1Profile()
  return {
    schemaVersion: 1,
    slug: 'test-preset',
    kind: 'album',
    title: 'Test Preset',
    artist: 'Tester',
    profile: profile.id,
    preamp: 2.0,
    bands: profile.bandTemplate.map((b) => ({ ...b })),
    intent: 'A neutral test preset built from the template.',
    provenance: { createdBy: 'user', history: [] },
    version: 1,
    createdAt: '2026-06-12T00:00:00.000Z',
    updatedAt: '2026-06-12T00:00:00.000Z',
    ...overrides,
  }
}

/** "808s & Heartbreak"-style loud-house preset used by the safety tests. */
export function make808Preset(): Preset {
  const preset = makeTemplatePreset({ slug: '808s', title: '808s & Heartbreak', preamp: 2.0 })
  const gains: Record<string, number> = {
    Bass: 3.0,
    KickBody: 1.5,
    LowMidClean: -1.8,
    UpperMidTame: -1.4,
    PresenceTame: -1.6,
    Air: -0.5,
  }
  preset.bands = preset.bands.map((b) => ({ ...b, gain: gains[b.id] ?? b.gain }))
  return preset
}

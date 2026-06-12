#!/usr/bin/env tsx
/**
 * Migrates 16 legacy Kanye album EQ presets from the start-ft1pro-eq zsh script
 * into canonical ToneDeck JSON presets at presets/builtin/<slug>.json.
 *
 * Source of truth: ~/Desktop/mirror-bphs-corpus/camilladsp-setup/start-ft1pro-eq
 * (READ-ONLY — gains are transcribed verbatim; do not "improve" any value).
 *
 * Run: npm run migrate:kanye
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import YAML from 'yaml'
import { parsePreset, parseProfile } from '@tonedeck/shared'
import type { Preset } from '@tonedeck/shared'

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------
const SCRIPT_DIR = fileURLToPath(new URL('.', import.meta.url))
const ROOT = join(SCRIPT_DIR, '..')
const PRESETS_DIR = join(ROOT, 'presets', 'builtin')
const PROFILES_DIR = join(ROOT, 'profiles')
const LEGACY_CONFIGS_DIR = '/Users/avyanshkatiyar/camilladsp/configs'

const CREATED_AT = '2026-06-12T00:00:00.000Z'
const PREAMP = 2.0

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------
const profileRaw = JSON.parse(readFileSync(join(PROFILES_DIR, 'ft1pro.json'), 'utf8'))
const profile = parseProfile(profileRaw)

// ---------------------------------------------------------------------------
// Album table — transcribed verbatim from start-ft1pro-eq case statement
// Order: Bass / KickBody / LowMidClean / UpperMidTame / PresenceTame / Air
// ---------------------------------------------------------------------------
interface AlbumEntry {
  slug: string
  title: string
  artist: string
  intent: string
  bass: number
  kick: number
  lowmid: number
  upper: number
  pres: number
  air: number
}

const ALBUMS: AlbumEntry[] = [
  {
    slug: 'college-dropout',
    title: 'The College Dropout',
    artist: 'Kanye West',
    intent: 'loud warm chipmunk soul, thicker mids, easy vocal clarity',
    bass: 1.5, kick: 1.0, lowmid: 0.6, upper: -0.5, pres: -0.8, air: 0.6,
  },
  {
    slug: 'late-registration',
    title: 'Late Registration',
    artist: 'Kanye West',
    intent: 'loud orchestral warmth with extra string and vocal air',
    bass: 1.0, kick: 0.6, lowmid: 0.4, upper: -0.4, pres: -0.6, air: 1.2,
  },
  {
    slug: 'graduation',
    title: 'Graduation',
    artist: 'Kanye West',
    intent: 'loud synth-pop shine, punchy lows, reduced glare',
    bass: 2.5, kick: 0.6, lowmid: -1.0, upper: -1.0, pres: -2.8, air: 1.8,
  },
  {
    slug: '808s',
    title: '808s & Heartbreak',
    artist: 'Kanye West',
    intent: 'loud 808 weight, hollowed low mids, darker top',
    bass: 3.0, kick: 1.5, lowmid: -1.8, upper: -1.4, pres: -1.6, air: -0.5,
  },
  {
    slug: 'mbdtf',
    title: 'My Beautiful Dark Twisted Fantasy',
    artist: 'Kanye West',
    intent: 'loud dense maximalism, heavy body, controlled upper mids',
    bass: 2.0, kick: 1.0, lowmid: -1.5, upper: -1.6, pres: -2.0, air: 1.0,
  },
  {
    slug: 'watch-the-throne',
    title: 'Watch the Throne',
    artist: 'JAY-Z & Kanye West',
    intent: 'loud stadium drums, polished sparkle, wide-feeling top end',
    bass: 2.8, kick: 1.2, lowmid: -1.0, upper: -1.0, pres: -1.5, air: 1.8,
  },
  {
    slug: 'yeezus',
    title: 'Yeezus',
    artist: 'Kanye West',
    intent: 'loud lean industrial tuning with strong edge control',
    bass: 0.5, kick: -0.8, lowmid: -1.5, upper: -3.5, pres: -4.0, air: -1.0,
  },
  {
    slug: 'tlop',
    title: 'The Life of Pablo',
    artist: 'Kanye West',
    intent: 'loud party low end with smoother crowded mixes',
    bass: 2.8, kick: 1.2, lowmid: -1.4, upper: -2.0, pres: -2.2, air: 1.0,
  },
  {
    slug: 'ye',
    title: 'ye',
    artist: 'Kanye West',
    intent: 'loud intimate vocal focus with restrained bass',
    bass: 1.0, kick: 0.2, lowmid: 0.2, upper: -1.6, pres: -1.5, air: 0.4,
  },
  {
    slug: 'kids-see-ghosts',
    title: 'Kids See Ghosts',
    artist: 'KIDS SEE GHOSTS',
    intent: 'loud psychedelic punch with extra air and softened bite',
    bass: 1.8, kick: 0.8, lowmid: -0.5, upper: -1.8, pres: -1.8, air: 1.8,
  },
  {
    slug: 'jesus-is-king',
    title: 'Jesus Is King',
    artist: 'Kanye West',
    intent: 'loud choirs forward, lean bass, bright gospel air',
    bass: 0.0, kick: -0.2, lowmid: 0.4, upper: -0.8, pres: -0.8, air: 1.8,
  },
  {
    slug: 'donda',
    title: 'Donda',
    artist: 'Kanye West',
    intent: 'loud dark spacious weight, deeper lows, clean presence',
    bass: 3.0, kick: 1.3, lowmid: -1.6, upper: -2.0, pres: -1.8, air: 1.2,
  },
  {
    slug: 'donda-2',
    title: 'Donda 2',
    artist: 'Kanye West',
    intent: 'loud rougher trap/drill weight with stronger smoothing',
    bass: 3.2, kick: 1.5, lowmid: -1.8, upper: -2.2, pres: -2.8, air: 0.2,
  },
  {
    slug: 'vultures-1',
    title: 'Vultures 1',
    artist: 'Kanye West',
    intent: 'loud modern trap slam with aggressive harshness control',
    bass: 3.0, kick: 1.5, lowmid: -1.6, upper: -2.2, pres: -2.8, air: 0.4,
  },
  {
    slug: 'vultures-2',
    title: 'Vultures 2',
    artist: 'Kanye West',
    intent: 'loud thick dark bass and heavier smoothing for uneven mixes',
    bass: 2.8, kick: 1.2, lowmid: -2.0, upper: -2.5, pres: -3.2, air: 0.0,
  },
  {
    slug: 'bully',
    title: 'Bully',
    artist: 'Kanye West',
    intent: 'loud darker experimental tuning with controlled edge',
    bass: 1.8, kick: 0.6, lowmid: -1.2, upper: -3.0, pres: -3.2, air: 0.2,
  },
]

// ---------------------------------------------------------------------------
// Build and write presets
// ---------------------------------------------------------------------------
mkdirSync(PRESETS_DIR, { recursive: true })

const builtPresets: Preset[] = []

for (const album of ALBUMS) {
  const bandGains: Record<string, number> = {
    Bass: album.bass,
    KickBody: album.kick,
    LowMidClean: album.lowmid,
    UpperMidTame: album.upper,
    PresenceTame: album.pres,
    Air: album.air,
  }

  const bands = profile.bandTemplate.map((b) => ({ ...b, gain: bandGains[b.id] }))

  const raw: unknown = {
    schemaVersion: 1,
    slug: album.slug,
    kind: 'album',
    title: album.title,
    artist: album.artist,
    profile: profile.id,
    preamp: PREAMP,
    bands,
    intent: album.intent,
    provenance: { createdBy: 'builtin', history: [] },
    version: 1,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  }

  const preset = parsePreset(raw)
  builtPresets.push(preset)

  const outPath = join(PRESETS_DIR, `${album.slug}.json`)
  writeFileSync(outPath, JSON.stringify(preset, null, 2) + '\n', 'utf8')
}

console.log(`Wrote ${builtPresets.length} presets to ${PRESETS_DIR}`)

// ---------------------------------------------------------------------------
// Verification: compare against legacy CamillaDSP YAML configs
// ---------------------------------------------------------------------------
interface LegacyYaml {
  filters: Record<string, {
    type: string
    parameters: Record<string, number | boolean | string>
  }>
}

const BAND_IDS = ['Bass', 'KickBody', 'LowMidClean', 'UpperMidTame', 'PresenceTame', 'Air'] as const
type BandId = typeof BAND_IDS[number]

type VerifyResult = 'PASS' | 'FAIL' | 'SKIPPED'

interface VerifyRow {
  slug: string
  result: VerifyResult
  detail?: string
}

const rows: VerifyRow[] = []
let anyFail = false

for (const preset of builtPresets) {
  const legacyPath = join(LEGACY_CONFIGS_DIR, `ft1pro-${preset.slug}.yml`)

  if (!existsSync(legacyPath)) {
    rows.push({ slug: preset.slug, result: 'SKIPPED', detail: 'legacy file absent' })
    continue
  }

  const legacyRaw = readFileSync(legacyPath, 'utf8')
  const legacy = YAML.parse(legacyRaw) as LegacyYaml
  const failures: string[] = []

  // Check preamp
  const legacyPreamp = legacy.filters['Preamp']?.parameters['gain'] as number
  if (legacyPreamp !== preset.preamp) {
    failures.push(`Preamp gain: legacy=${legacyPreamp} preset=${preset.preamp}`)
  }

  // Check each band
  for (const bandId of BAND_IDS) {
    const legacyBandParams = legacy.filters[bandId]?.parameters
    const presetBand = preset.bands.find((b) => b.id === bandId)

    if (!legacyBandParams || !presetBand) {
      failures.push(`${bandId}: missing in legacy or preset`)
      continue
    }

    const lGain = legacyBandParams['gain'] as number
    const lFreq = legacyBandParams['freq'] as number
    const lQ = legacyBandParams['q'] as number

    if (lGain !== presetBand.gain) {
      failures.push(`${bandId} gain: legacy=${lGain} preset=${presetBand.gain}`)
    }
    if (lFreq !== presetBand.freq) {
      failures.push(`${bandId} freq: legacy=${lFreq} preset=${presetBand.freq}`)
    }
    if (lQ !== presetBand.q) {
      failures.push(`${bandId} q: legacy=${lQ} preset=${presetBand.q}`)
    }
  }

  if (failures.length === 0) {
    rows.push({ slug: preset.slug, result: 'PASS' })
  } else {
    rows.push({ slug: preset.slug, result: 'FAIL', detail: failures.join(', ') })
    anyFail = true
  }
}

// ---------------------------------------------------------------------------
// Print verification table
// ---------------------------------------------------------------------------
const COL_SLUG = 26
const COL_RESULT = 8
const SEPARATOR = '-'.repeat(COL_SLUG + COL_RESULT + 4)

console.log()
console.log('Migration verification against legacy CamillaDSP configs:')
console.log(SEPARATOR)
console.log(`${'SLUG'.padEnd(COL_SLUG)}  ${'RESULT'.padEnd(COL_RESULT)}  DETAIL`)
console.log(SEPARATOR)

for (const row of rows) {
  const slug = row.slug.padEnd(COL_SLUG)
  const result = row.result.padEnd(COL_RESULT)
  const detail = row.detail ?? ''
  console.log(`${slug}  ${result}  ${detail}`)
}

console.log(SEPARATOR)
const passes = rows.filter((r) => r.result === 'PASS').length
const skips = rows.filter((r) => r.result === 'SKIPPED').length
const fails = rows.filter((r) => r.result === 'FAIL').length
console.log(`${passes} PASS  ${skips} SKIPPED  ${fails} FAIL`)
console.log()

if (anyFail) {
  console.error('Migration FAILED: one or more gain mismatches detected.')
  process.exit(1)
}

console.log('Migration complete.')

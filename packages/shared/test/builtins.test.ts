/**
 * Smoke tests for the 16 builtin Kanye album presets.
 *
 * Each preset in presets/builtin/ must:
 *   1. Parse successfully via parsePreset (schema valid)
 *   2. Have a slug that matches its filename
 *   3. Produce a headroomVerdict of 'ok' or 'warn' against ft1pro (never 'reject')
 *   4. Emit valid CamillaDSP YAML via emitCamillaYaml without throwing
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parsePreset, headroomVerdict, emitCamillaYaml } from '../src/index.js'
import { loadFt1Profile } from './fixtures.js'

const SCRIPT_DIR = fileURLToPath(new URL('.', import.meta.url))
const PRESETS_DIR = join(SCRIPT_DIR, '../../../presets/builtin')

const EXPECTED_SLUGS = [
  'college-dropout',
  'late-registration',
  'graduation',
  '808s',
  'mbdtf',
  'watch-the-throne',
  'yeezus',
  'tlop',
  'ye',
  'kids-see-ghosts',
  'jesus-is-king',
  'donda',
  'donda-2',
  'vultures-1',
  'vultures-2',
  'bully',
]

describe('builtin presets', () => {
  const profile = loadFt1Profile()

  // Load all JSON files from presets/builtin/
  const files = readdirSync(PRESETS_DIR).filter((f) => f.endsWith('.json'))

  it('has exactly 16 builtin preset files', () => {
    expect(files.length).toBe(16)
  })

  it('covers all expected slugs', () => {
    const foundSlugs = files.map((f) => f.replace(/\.json$/, '')).sort()
    expect(foundSlugs).toEqual([...EXPECTED_SLUGS].sort())
  })

  for (const file of files) {
    const slug = file.replace(/\.json$/, '')
    const filePath = join(PRESETS_DIR, file)

    describe(`preset: ${slug}`, () => {
      const raw = JSON.parse(readFileSync(filePath, 'utf8')) as unknown
      const preset = parsePreset(raw)

      it('parses successfully', () => {
        expect(() => parsePreset(raw)).not.toThrow()
      })

      it('slug matches filename', () => {
        expect(preset.slug).toBe(slug)
      })

      it('headroomVerdict is ok or warn (never reject)', () => {
        const verdict = headroomVerdict(preset, profile)
        expect(verdict.verdict).not.toBe('reject')
        expect(['ok', 'warn']).toContain(verdict.verdict)
      })

      it('emitCamillaYaml does not throw', () => {
        expect(() => emitCamillaYaml(preset, profile, 'External Headphones')).not.toThrow()
      })
    })
  }
})

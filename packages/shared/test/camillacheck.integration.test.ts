import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { emitCamillaYaml } from '../src/index.js'
import { loadFt1Profile, make808Preset } from './fixtures.js'

const CAMILLA = '/opt/homebrew/bin/camilladsp'

describe('CamillaDSP --check integration', () => {
  it.skipIf(!existsSync(CAMILLA))(
    'emitted YAML passes `camilladsp --check` (exit 0)',
    () => {
      const profile = loadFt1Profile()
      const yaml = emitCamillaYaml(make808Preset(), profile, profile.playbackDeviceName)
      const dir = mkdtempSync(join(tmpdir(), 'tonedeck-'))
      const file = join(dir, 'config.yml')
      writeFileSync(file, yaml, 'utf8')

      const res = spawnSync(CAMILLA, ['--check', file], { encoding: 'utf8' })
      if (res.status !== 0) {
        // surface camilladsp output for debugging when it fails
        throw new Error(`camilladsp --check failed (status ${res.status}):\n${res.stdout}\n${res.stderr}`)
      }
      expect(res.status).toBe(0)
    },
  )
})

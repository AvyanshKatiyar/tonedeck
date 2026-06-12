import { describe, it, expect } from 'vitest'
import YAML from 'yaml'
import { emitCamillaYaml, emitDevicesBlock } from '../src/index.js'
import { loadFt1Profile, make808Preset, makeTemplatePreset } from './fixtures.js'

const profile = loadFt1Profile()
const DEVICE = 'External Headphones'

function devicesSection(yaml: string): string {
  const start = yaml.indexOf('devices:')
  const end = yaml.indexOf('filters:')
  expect(start).toBeGreaterThanOrEqual(0)
  expect(end).toBeGreaterThan(start)
  return yaml.slice(start, end)
}

describe('emitCamillaYaml', () => {
  it('round-trips through the YAML parser with the expected structure', () => {
    const yaml = emitCamillaYaml(makeTemplatePreset(), profile, DEVICE)
    const cfg = YAML.parse(yaml)
    expect(cfg.devices.samplerate).toBe(48000)
    expect(cfg.devices.chunksize).toBe(1024)
    expect(cfg.devices.target_level).toBe(512)
    expect(cfg.devices.enable_rate_adjust).toBe(true)
    expect(cfg.devices.capture.device).toBe('BlackHole 2ch')
    expect(cfg.devices.capture.format).toBe('F32')
    expect(cfg.devices.playback.device).toBe('External Headphones')
    expect(cfg.devices.playback.exclusive).toBe(false)
    expect(cfg.filters.Preamp.type).toBe('Gain')
    expect(cfg.filters.Preamp.parameters.scale).toBe('dB')
    expect(cfg.title).toBe('FiiO FT1 Pro - Test Preset')
    expect(cfg.pipeline.length).toBe(1)
  })

  it('capitalizes Biquad filter type names for CamillaDSP', () => {
    const cfg = YAML.parse(emitCamillaYaml(makeTemplatePreset(), profile, DEVICE))
    expect(cfg.filters.Bass.type).toBe('Biquad')
    expect(cfg.filters.Bass.parameters.type).toBe('Lowshelf')
    expect(cfg.filters.KickBody.parameters.type).toBe('Peaking')
    expect(cfg.filters.Air.parameters.type).toBe('Highshelf')
  })

  it('pipeline names are [Preamp, ...band ids in preset order]', () => {
    const preset = makeTemplatePreset()
    const cfg = YAML.parse(emitCamillaYaml(preset, profile, DEVICE))
    expect(cfg.pipeline[0].type).toBe('Filter')
    expect(cfg.pipeline[0].channels).toEqual([0, 1])
    expect(cfg.pipeline[0].names).toEqual(['Preamp', ...preset.bands.map((b) => b.id)])
  })

  it('emits a byte-identical devices block across two different presets', () => {
    const yamlA = emitCamillaYaml(makeTemplatePreset(), profile, DEVICE)
    const yamlB = emitCamillaYaml(make808Preset(), profile, DEVICE)
    expect(devicesSection(yamlA)).toBe(devicesSection(yamlB))
    // and the standalone emitter is deterministic
    expect(YAML.stringify(emitDevicesBlock(profile, DEVICE))).toBe(
      YAML.stringify(emitDevicesBlock(profile, DEVICE)),
    )
  })

  it('is deterministic: identical inputs produce byte-identical output', () => {
    const a = emitCamillaYaml(make808Preset(), profile, DEVICE)
    const b = emitCamillaYaml(make808Preset(), profile, DEVICE)
    expect(a).toBe(b)
  })

  it('throws on dangerous / silence-trap playback devices', () => {
    const preset = makeTemplatePreset()
    expect(() => emitCamillaYaml(preset, profile, '')).toThrow()
    expect(() => emitCamillaYaml(preset, profile, 'null')).toThrow()
    expect(() => emitCamillaYaml(preset, profile, 'NULL')).toThrow()
    expect(() => emitCamillaYaml(preset, profile, 'BlackHole 2ch')).toThrow()
    expect(() => emitCamillaYaml(preset, profile, 'blackhole 16ch')).toThrow()
  })
})

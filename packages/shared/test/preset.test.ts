import { describe, it, expect } from 'vitest'
import {
  parsePreset,
  parseProfile,
  presetJsonSchema,
  profileJsonSchema,
} from '../src/index.js'
import { loadFt1ProfileRaw, makeTemplatePreset } from './fixtures.js'

describe('preset schema', () => {
  it('parses a valid preset', () => {
    const preset = makeTemplatePreset()
    const parsed = parsePreset(preset)
    expect(parsed.slug).toBe('test-preset')
    expect(parsed.bands.length).toBe(6)
    expect(parsed.provenance.history).toEqual([])
  })

  it('defaults provenance.history to [] when omitted', () => {
    const preset = makeTemplatePreset()
    const raw = { ...preset, provenance: { createdBy: 'builtin' } } as unknown
    const parsed = parsePreset(raw)
    expect(parsed.provenance.history).toEqual([])
  })

  it('rejects a bad slug', () => {
    const preset = makeTemplatePreset({ slug: 'Bad Slug!' as never })
    expect(() => parsePreset(preset)).toThrow()
  })

  it('rejects duplicate band ids', () => {
    const preset = makeTemplatePreset()
    preset.bands[1] = { ...preset.bands[0] }
    expect(() => parsePreset(preset)).toThrow(/unique/i)
  })

  it('rejects preamp out of bounds', () => {
    const preset = makeTemplatePreset({ preamp: 30 })
    expect(() => parsePreset(preset)).toThrow()
  })

  it('rejects an empty bands array', () => {
    const preset = makeTemplatePreset({ bands: [] })
    expect(() => parsePreset(preset)).toThrow()
  })
})

describe('profile schema', () => {
  it('parses the real profiles/ft1pro.json file', () => {
    const profile = parseProfile(loadFt1ProfileRaw())
    expect(profile.id).toBe('ft1pro')
    expect(profile.playbackDeviceName).toBe('External Headphones')
    expect(profile.captureDeviceName).toBe('BlackHole 2ch')
    expect(profile.bandTemplate.length).toBe(6)
    expect(profile.limits.clipHeadroomDb).toBe(3)
  })

  it('defaults captureDeviceName when omitted', () => {
    const raw = loadFt1ProfileRaw() as Record<string, unknown>
    delete raw.captureDeviceName
    const profile = parseProfile(raw)
    expect(profile.captureDeviceName).toBe('BlackHole 2ch')
  })
})

describe('JSON-Schema export', () => {
  it('presetJsonSchema() returns an object with expected top-level keys', () => {
    const schema = presetJsonSchema() as Record<string, unknown>
    expect(typeof schema).toBe('object')
    expect(schema).toHaveProperty('type', 'object')
    expect(schema).toHaveProperty('properties')
    expect((schema.properties as Record<string, unknown>).slug).toBeDefined()
    expect((schema.properties as Record<string, unknown>).bands).toBeDefined()
  })

  it('profileJsonSchema() returns an object with expected top-level keys', () => {
    const schema = profileJsonSchema() as Record<string, unknown>
    expect(typeof schema).toBe('object')
    expect(schema).toHaveProperty('type', 'object')
    expect(schema).toHaveProperty('properties')
    expect((schema.properties as Record<string, unknown>).bandTemplate).toBeDefined()
  })
})

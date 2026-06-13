import { describe, expect, it, vi } from 'vitest'
import { generateTrackEq, EqGenError } from '../src/eqgen.js'
import type { Profile } from '@tonedeck/shared'

const profile: Profile = {
  id: 'ft1-pro', name: 'FT1 Pro', playbackDeviceName: 'FiiO', captureDeviceName: 'BlackHole 2ch',
  bandTemplate: [], limits: { bandGainDb: [-12, 12], preampDb: [-12, 0], q: [0.3, 5], freqHz: [20, 20000], clipHeadroomDb: 1 },
  houseNotes: 'neutral-warm',
}
const track = { state: 'playing' as const, trackId: 1, title: "Life's a Bitch", artist: 'Nas', album: 'Illmatic' }

const goodJson = JSON.stringify({
  preamp: -3, intent: 'warm low end', notes: 'n',
  bands: [{ type: 'lowshelf', freq: 80, q: 0.7, gain: 3 }, { type: 'peaking', freq: 250, q: 1, gain: -2 }],
})

describe('generateTrackEq', () => {
  it('returns a valid Preset built from model JSON', async () => {
    const exec = vi.fn().mockResolvedValue(goodJson)
    const p = await generateTrackEq(track, profile, { slug: 'nas-lifes-a-bitch', exec })
    expect(p.slug).toBe('nas-lifes-a-bitch')
    expect(p.kind).toBe('track')
    expect(p.album).toBe('Illmatic')
    expect(p.provenance.createdBy).toBe('claude')
    expect(p.bands).toHaveLength(2)
    expect(p.bands[0].id).toBeTruthy() // ids assigned
  })
  it('tolerates ```json code fences', async () => {
    const exec = vi.fn().mockResolvedValue('```json\n' + goodJson + '\n```')
    const p = await generateTrackEq(track, profile, { slug: 's', exec })
    expect(p.bands).toHaveLength(2)
  })
  it('throws EqGenError on non-JSON', async () => {
    const exec = vi.fn().mockResolvedValue('I cannot do that')
    await expect(generateTrackEq(track, profile, { slug: 's', exec })).rejects.toBeInstanceOf(EqGenError)
  })
  it('throws EqGenError when exec rejects (timeout)', async () => {
    const exec = vi.fn().mockRejectedValue(new Error('timeout'))
    await expect(generateTrackEq(track, profile, { slug: 's', exec })).rejects.toBeInstanceOf(EqGenError)
  })
})

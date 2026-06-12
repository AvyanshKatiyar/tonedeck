import { describe, it, expect } from 'vitest'
import { applyVibesDraft } from '../src/vibedraft.js'
import { applyVibes, type Preset, type Profile } from '@tonedeck/shared'

const profile: Profile = {
  id: 'ft1pro',
  name: 'FiiO FT1 Pro',
  playbackDeviceName: 'External Headphones',
  captureDeviceName: 'BlackHole 2ch',
  bandTemplate: [
    { id: 'Bass', type: 'lowshelf', freq: 60, q: 0.7, gain: 0 },
    { id: 'KickBody', type: 'peaking', freq: 120, q: 0.9, gain: 0 },
    { id: 'LowMidClean', type: 'peaking', freq: 250, q: 1, gain: 0 },
    { id: 'UpperMidTame', type: 'peaking', freq: 3200, q: 1.2, gain: 0 },
    { id: 'PresenceTame', type: 'peaking', freq: 5000, q: 2, gain: 0 },
    { id: 'Air', type: 'highshelf', freq: 10000, q: 0.7, gain: 0 },
  ],
  limits: {
    bandGainDb: [-8, 6],
    preampDb: [-6, 4],
    q: [0.3, 5],
    freqHz: [20, 20000],
    clipHeadroomDb: 3,
  },
  houseNotes: 'test',
}

const base: Preset = {
  schemaVersion: 1,
  slug: 'mbdtf',
  kind: 'album',
  title: 'My Beautiful Dark Twisted Fantasy',
  artist: 'Kanye West',
  profile: 'ft1pro',
  preamp: 2,
  bands: [
    { id: 'Bass', type: 'lowshelf', freq: 60, q: 0.7, gain: 2 },
    { id: 'KickBody', type: 'peaking', freq: 120, q: 0.9, gain: 1 },
    { id: 'LowMidClean', type: 'peaking', freq: 250, q: 1, gain: -1.5 },
    { id: 'UpperMidTame', type: 'peaking', freq: 3200, q: 1.2, gain: -1.6 },
    { id: 'PresenceTame', type: 'peaking', freq: 5000, q: 2, gain: -2 },
    { id: 'Air', type: 'highshelf', freq: 10000, q: 0.7, gain: 1 },
  ],
  intent: 'test',
  provenance: { createdBy: 'builtin', history: [] },
  version: 1,
  createdAt: '2026-06-12T00:00:00.000Z',
  updatedAt: '2026-06-12T00:00:00.000Z',
}

function gainMap(p: Preset): Record<string, number> {
  return Object.fromEntries(p.bands.map((b) => [b.id, b.gain]))
}

describe('applyVibesDraft parity with shared applyVibes', () => {
  it('warmth +1 produces identical band gains', () => {
    const draft = applyVibesDraft(base, { warmth: 1 }, profile)
    const shared = applyVibes(base, { warmth: 1 }, profile).preset
    expect(gainMap(draft)).toEqual(gainMap(shared))
  })

  it('multiple vibes + a clamped step stay in parity', () => {
    const adj = { warmth: 2, sparkle: -1.5, clarity: 1, punch: 5 } as const
    const draft = applyVibesDraft(base, adj, profile)
    const shared = applyVibes(base, adj, profile).preset
    expect(gainMap(draft)).toEqual(gainMap(shared))
    expect(draft.preamp).toEqual(shared.preamp)
  })
})

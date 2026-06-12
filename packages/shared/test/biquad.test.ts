import { describe, it, expect } from 'vitest'
import {
  biquadCoeffs,
  magnitudeDb,
  logSpacedFreqs,
  responseDb,
  type Band,
} from '../src/index.js'

const SR = 48000

function magAt(type: Band['type'], freq: number, q: number, gain: number, at: number) {
  return magnitudeDb(biquadCoeffs(type, freq, q, gain, SR), at, SR)
}

describe('biquadCoeffs / magnitudeDb', () => {
  it('peaking 1 kHz Q1 +6 dB: +6 at center, ~0 at the edges', () => {
    expect(magAt('peaking', 1000, 1, 6, 1000)).toBeCloseTo(6, 1)
    expect(magAt('peaking', 1000, 1, 6, 20)).toBeCloseTo(0, 1)
    expect(magAt('peaking', 1000, 1, 6, 20000)).toBeCloseTo(0, 1)
  })

  it('lowshelf 60 Hz +3 dB: +3 in the sub-bass, ~0 in the mids', () => {
    expect(magAt('lowshelf', 60, 0.7, 3, 20)).toBeCloseTo(3, 1)
    expect(magAt('lowshelf', 60, 0.7, 3, 2000)).toBeCloseTo(0, 1)
  })

  it('highshelf 10 kHz +2 dB: +2 in the air, ~0 in the mids', () => {
    expect(magAt('highshelf', 10000, 0.7, 2, 20000)).toBeCloseTo(2, 1)
    expect(magAt('highshelf', 10000, 0.7, 2, 1000)).toBeCloseTo(0, 1)
  })

  it('gain 0 yields 0 dB everywhere for every filter type', () => {
    for (const type of ['lowshelf', 'peaking', 'highshelf'] as const) {
      for (const f of [20, 100, 1000, 5000, 20000]) {
        expect(magAt(type, 1000, 1, 0, f)).toBeCloseTo(0, 6)
      }
    }
  })
})

describe('logSpacedFreqs', () => {
  it('is geometric and spans the endpoints inclusively', () => {
    const fs = logSpacedFreqs(256, 20, 20000)
    expect(fs.length).toBe(256)
    expect(fs[0]).toBeCloseTo(20, 6)
    expect(fs[255]).toBeCloseTo(20000, 6)
    const r0 = fs[1] / fs[0]
    const r1 = fs[2] / fs[1]
    expect(r1).toBeCloseTo(r0, 9)
  })
})

describe('responseDb', () => {
  it('sums preamp and band magnitudes', () => {
    const bands: Band[] = [{ id: 'P', type: 'peaking', freq: 1000, q: 1, gain: 6 }]
    const [atLow, atCenter] = responseDb(bands, 3, [20, 1000], SR)
    expect(atLow).toBeCloseTo(3, 1) // preamp only down low
    expect(atCenter).toBeCloseTo(9, 1) // preamp + 6 dB peak
  })
})

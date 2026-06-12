import { describe, it, expect } from 'vitest'
import { presetToPolyline, xOfFreq, yOfDb } from '../src/curve.js'
import type { Preset } from '@tonedeck/shared'

const W = 600
const H = 240
const FREQ: [number, number] = [20, 20000]
const DB: [number, number] = [-9, 9]

function preset(bands: Preset['bands'], preamp = 0): Pick<Preset, 'bands' | 'preamp'> {
  return { bands, preamp }
}

describe('presetToPolyline', () => {
  it('flat preset → horizontal line at y(0 dB) (±0.5px)', () => {
    const flat = preset([
      { id: 'Bass', type: 'lowshelf', freq: 60, q: 0.7, gain: 0 },
      { id: 'Mid', type: 'peaking', freq: 1000, q: 1, gain: 0 },
      { id: 'Air', type: 'highshelf', freq: 10000, q: 0.7, gain: 0 },
    ])
    const { curve } = presetToPolyline(flat, W, H, FREQ, DB)
    const yZero = yOfDb(0, H, DB)
    for (const [, y] of curve) {
      expect(Math.abs(y - yZero)).toBeLessThanOrEqual(0.5)
    }
  })

  it('peaking boost → curve max at x(freq)±2px and y(gain)±1px', () => {
    const f0 = 1000
    const gain = 6
    const p = preset([{ id: 'P', type: 'peaking', freq: f0, q: 1.5, gain }])
    const { curve } = presetToPolyline(p, W, H, FREQ, DB)

    // Highest point of the curve = smallest y.
    let maxPt = curve[0]
    for (const pt of curve) if (pt[1] < maxPt[1]) maxPt = pt

    expect(Math.abs(maxPt[0] - xOfFreq(f0, W, FREQ))).toBeLessThanOrEqual(2)
    expect(Math.abs(maxPt[1] - yOfDb(gain, H, DB))).toBeLessThanOrEqual(1)
  })

  it('dots count equals band count, positioned at (freq, gain)', () => {
    const bands: Preset['bands'] = [
      { id: 'Bass', type: 'lowshelf', freq: 60, q: 0.7, gain: 3 },
      { id: 'Mid', type: 'peaking', freq: 2000, q: 1, gain: -2 },
    ]
    const { dots } = presetToPolyline(preset(bands), W, H, FREQ, DB)
    expect(dots).toHaveLength(bands.length)
    expect(dots[0][0]).toBeCloseTo(xOfFreq(60, W, FREQ), 5)
    expect(dots[0][1]).toBeCloseTo(yOfDb(3, H, DB), 5)
    expect(dots[1][1]).toBeCloseTo(yOfDb(-2, H, DB), 5)
  })
})

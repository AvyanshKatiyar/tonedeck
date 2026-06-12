/**
 * curve.ts — PURE geometry for the EQ response curve. No canvas, no React.
 *
 * Maps a preset's combined frequency response (preamp + every band, via the
 * shared RBJ biquad math) into pixel-space polylines a canvas can stroke. Log
 * x-axis (frequency), linear y-axis (dB). Unit-testable in isolation.
 */
import { logSpacedFreqs, responseDb, type Preset } from '@tonedeck/shared'

export type Point = [number, number]

export interface Polyline {
  /** Combined-response curve, one point per pixel column (length ≈ w). */
  curve: Point[]
  /** One dot per band at its (centre freq, band gain). */
  dots: Point[]
}

export interface Axes {
  /** Vertical octave gridlines at human-named frequencies. */
  freqLines: { x: number; label: string }[]
  /** Horizontal dB gridlines. */
  dbLines: { y: number; label: string; zero: boolean }[]
}

const GRID_FREQS: { hz: number; label: string }[] = [
  { hz: 20, label: '20' },
  { hz: 50, label: '50' },
  { hz: 100, label: '100' },
  { hz: 200, label: '200' },
  { hz: 500, label: '500' },
  { hz: 1000, label: '1k' },
  { hz: 2000, label: '2k' },
  { hz: 5000, label: '5k' },
  { hz: 10000, label: '10k' },
  { hz: 20000, label: '20k' },
]

const GRID_DBS = [-9, -6, -3, 0, 3, 6, 9]

export function xOfFreq(freq: number, w: number, [fmin, fmax]: [number, number]): number {
  return (Math.log(freq / fmin) / Math.log(fmax / fmin)) * w
}

export function yOfDb(db: number, h: number, [dbMin, dbMax]: [number, number]): number {
  return h - ((db - dbMin) / (dbMax - dbMin)) * h
}

/**
 * Build the response polyline + per-band dots for a preset.
 *
 * @param w,h         logical (CSS) pixel size of the plot area
 * @param freqRange   [fmin, fmax] Hz (default 20–20000)
 * @param dbRange     [dbMin, dbMax] dB (default ±9)
 */
export function presetToPolyline(
  preset: Pick<Preset, 'bands' | 'preamp'>,
  w: number,
  h: number,
  freqRange: [number, number] = [20, 20000],
  dbRange: [number, number] = [-9, 9],
): Polyline {
  const n = Math.max(2, Math.round(w))
  const freqs = logSpacedFreqs(n, freqRange[0], freqRange[1])
  const resp = responseDb(preset.bands, preset.preamp, freqs)

  const curve: Point[] = freqs.map((f, i) => [
    xOfFreq(f, w, freqRange),
    yOfDb(resp[i], h, dbRange),
  ])

  const dots: Point[] = preset.bands.map((b) => [
    xOfFreq(b.freq, w, freqRange),
    yOfDb(b.gain, h, dbRange),
  ])

  return { curve, dots }
}

/** Gridline positions (for the canvas axes layer). */
export function axes(
  w: number,
  h: number,
  freqRange: [number, number] = [20, 20000],
  dbRange: [number, number] = [-9, 9],
): Axes {
  const freqLines = GRID_FREQS.filter(
    (g) => g.hz >= freqRange[0] && g.hz <= freqRange[1],
  ).map((g) => ({ x: xOfFreq(g.hz, w, freqRange), label: g.label }))

  const dbLines = GRID_DBS.filter((d) => d >= dbRange[0] && d <= dbRange[1]).map((d) => ({
    y: yOfDb(d, h, dbRange),
    label: d > 0 ? `+${d}` : `${d}`,
    zero: d === 0,
  }))

  return { freqLines, dbLines }
}

/**
 * RBJ Audio-EQ-Cookbook biquad math — pure functions, no state.
 *
 * Shelves use the Q-based RBJ shelf form (A = 10^(gain/40), alpha = sin/2Q).
 * Coefficients are returned normalized by a0 (so a0 == 1 implicitly).
 */
import type { Band } from './preset.js'

export interface BiquadCoeffs {
  b0: number
  b1: number
  b2: number
  a1: number
  a2: number
}

export function biquadCoeffs(
  type: Band['type'],
  freqHz: number,
  q: number,
  gainDb: number,
  sampleRate: number,
): BiquadCoeffs {
  const A = Math.pow(10, gainDb / 40)
  const w0 = (2 * Math.PI * freqHz) / sampleRate
  const cosw = Math.cos(w0)
  const sinw = Math.sin(w0)
  const alpha = sinw / (2 * q)
  const sqrtA = Math.sqrt(A)

  let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number

  switch (type) {
    case 'peaking':
      b0 = 1 + alpha * A
      b1 = -2 * cosw
      b2 = 1 - alpha * A
      a0 = 1 + alpha / A
      a1 = -2 * cosw
      a2 = 1 - alpha / A
      break
    case 'lowshelf':
      b0 = A * (A + 1 - (A - 1) * cosw + 2 * sqrtA * alpha)
      b1 = 2 * A * (A - 1 - (A + 1) * cosw)
      b2 = A * (A + 1 - (A - 1) * cosw - 2 * sqrtA * alpha)
      a0 = A + 1 + (A - 1) * cosw + 2 * sqrtA * alpha
      a1 = -2 * (A - 1 + (A + 1) * cosw)
      a2 = A + 1 + (A - 1) * cosw - 2 * sqrtA * alpha
      break
    case 'highshelf':
      b0 = A * (A + 1 + (A - 1) * cosw + 2 * sqrtA * alpha)
      b1 = -2 * A * (A - 1 + (A + 1) * cosw)
      b2 = A * (A + 1 + (A - 1) * cosw - 2 * sqrtA * alpha)
      a0 = A + 1 - (A - 1) * cosw + 2 * sqrtA * alpha
      a1 = 2 * (A - 1 - (A + 1) * cosw)
      a2 = A + 1 - (A - 1) * cosw - 2 * sqrtA * alpha
      break
    default: {
      const _exhaustive: never = type
      throw new Error(`Unknown filter type: ${String(_exhaustive)}`)
    }
  }

  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 }
}

/** Exact |H(e^jw)| of a normalized biquad, in dB, at the given frequency. */
export function magnitudeDb(coeffs: BiquadCoeffs, freqHz: number, sampleRate: number): number {
  const w = (2 * Math.PI * freqHz) / sampleRate
  const cosw = Math.cos(w)
  const cos2w = Math.cos(2 * w)
  const sinw = Math.sin(w)
  const sin2w = Math.sin(2 * w)

  const numRe = coeffs.b0 + coeffs.b1 * cosw + coeffs.b2 * cos2w
  const numIm = -(coeffs.b1 * sinw + coeffs.b2 * sin2w)
  const denRe = 1 + coeffs.a1 * cosw + coeffs.a2 * cos2w
  const denIm = -(coeffs.a1 * sinw + coeffs.a2 * sin2w)

  const mag = Math.sqrt(
    (numRe * numRe + numIm * numIm) / (denRe * denRe + denIm * denIm),
  )
  return 20 * Math.log10(mag)
}

/** `n` geometrically-spaced frequencies from fminHz to fmaxHz, inclusive. */
export function logSpacedFreqs(n: number, fminHz: number, fmaxHz: number): number[] {
  if (n <= 1) return [fminHz]
  const ratio = Math.log(fmaxHz / fminHz)
  const out = new Array<number>(n)
  for (let i = 0; i < n; i++) {
    out[i] = fminHz * Math.exp(ratio * (i / (n - 1)))
  }
  return out
}

/** Total response (preamp + every band) in dB at each frequency. */
export function responseDb(
  bands: Band[],
  preampDb: number,
  freqs: number[],
  sampleRate = 48000,
): number[] {
  const coeffs = bands.map((b) => biquadCoeffs(b.type, b.freq, b.q, b.gain, sampleRate))
  return freqs.map((f) => {
    let sum = preampDb
    for (const c of coeffs) sum += magnitudeDb(c, f, sampleRate)
    return sum
  })
}

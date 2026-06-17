/**
 * Tone-only EQ clustering. Each preset is rendered to its magnitude-response
 * curve (bands only — preamp excluded), mean-normalized so we compare SHAPE not
 * loudness. Distance is RMS dB between curves; clustering is agglomerative with a
 * dB threshold, so the merge/split distance is itself interpretable in dB.
 */
import { responseDb, logSpacedFreqs } from './biquad.js'
import type { Preset } from './preset.js'

/** 48 log-spaced probe frequencies, 20 Hz–20 kHz. */
export const CLUSTER_FREQS: number[] = logSpacedFreqs(48, 20, 20000)

/** Tone-only response curve: bands only (preamp=0), mean-normalized to 0 dB. */
export function presetCurve(preset: Preset, freqs: number[] = CLUSTER_FREQS): number[] {
  const raw = responseDb(preset.bands, 0, freqs)
  const mean = raw.reduce((a, b) => a + b, 0) / raw.length
  return raw.map((v) => v - mean)
}

/** RMS dB difference between two equal-length curves. */
export function curveDistance(a: number[], b: number[]): number {
  if (a.length !== b.length) throw new Error('curveDistance: length mismatch')
  let sum = 0
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i]
    sum += d * d
  }
  return Math.sqrt(sum / a.length)
}

export interface ClusterMember {
  slug: string
  title: string
  artist?: string
}

export interface Cluster {
  id: number
  members: ClusterMember[]
  /** Human label from the cluster centroid (e.g. "bass-forward, flat mids, tamed top"). */
  character: string
  /** Id of the nearest other cluster (stable id, not array position). */
  nearestClusterId: number | null
  /** RMS dB gap to that nearest cluster — the variance that keeps them separate. */
  nearestDistanceDb: number | null
}

export interface ClusterResult {
  threshold: number
  clusters: Cluster[]
}

function round1(x: number): number {
  return Math.round(x * 10) / 10
}

function centroid(curves: number[][]): number[] {
  const m = curves[0].length
  const out = new Array<number>(m).fill(0)
  for (const c of curves) for (let i = 0; i < m; i++) out[i] += c[i]
  return out.map((v) => v / curves.length)
}

/** Human label from a normalized curve: average dB in low/mid/high bands. */
export function describeCurve(curve: number[], freqs: number[]): string {
  const band = (lo: number, hi: number): number => {
    const vals = curve.filter((_, i) => freqs[i] >= lo && freqs[i] < hi)
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0
  }
  const low = band(20, 250)
  const mid = band(250, 4000)
  const high = band(4000, 20001)
  return [
    low > 0.5 ? 'bass-forward' : low < -0.5 ? 'lean bass' : 'neutral bass',
    mid > 0.5 ? 'forward mids' : mid < -0.5 ? 'scooped mids' : 'flat mids',
    high > 0.5 ? 'bright top' : high < -0.5 ? 'tamed top' : 'neutral top',
  ].join(', ')
}

/** Average-linkage agglomerative clustering, cut at an RMS-dB threshold. */
export function clusterPresets(
  presets: Preset[],
  opts: { threshold?: number; freqs?: number[] } = {},
): ClusterResult {
  const threshold = opts.threshold ?? 1.5
  const freqs = opts.freqs ?? CLUSTER_FREQS
  if (presets.length === 0) return { threshold, clusters: [] }

  const curves = presets.map((p) => presetCurve(p, freqs))
  const groups: number[][] = presets.map((_, i) => [i])

  const avgDist = (ga: number[], gb: number[]): number => {
    let s = 0
    let n = 0
    for (const i of ga) for (const j of gb) {
      s += curveDistance(curves[i], curves[j])
      n++
    }
    return n ? s / n : Infinity
  }

  // Merge the closest pair until the closest pair exceeds the threshold.
  for (;;) {
    let best = Infinity
    let bi = -1
    let bj = -1
    for (let i = 0; i < groups.length; i++)
      for (let j = i + 1; j < groups.length; j++) {
        const d = avgDist(groups[i], groups[j])
        if (d < best) {
          best = d
          bi = i
          bj = j
        }
      }
    if (bi < 0 || best > threshold) break
    groups[bi] = groups[bi].concat(groups[bj])
    groups.splice(bj, 1)
  }

  // Build clusters with STABLE ids (= final group index), then nearest-neighbor gaps.
  const built: Cluster[] = groups.map((members, id) => ({
    id,
    members: members.map((i) => ({
      slug: presets[i].slug,
      title: presets[i].title,
      artist: presets[i].artist,
    })),
    character: describeCurve(centroid(members.map((i) => curves[i])), freqs),
    nearestClusterId: null,
    nearestDistanceDb: null,
  }))
  for (let i = 0; i < groups.length; i++) {
    let best = Infinity
    let bj = -1
    for (let j = 0; j < groups.length; j++) {
      if (i === j) continue
      const d = avgDist(groups[i], groups[j])
      if (d < best) {
        best = d
        bj = j
      }
    }
    if (bj >= 0) {
      built[i].nearestClusterId = bj
      built[i].nearestDistanceDb = round1(best)
    }
  }

  // Display order: largest clusters first (ids stay stable for nearest refs).
  built.sort((a, b) => b.members.length - a.members.length)
  return { threshold, clusters: built }
}

/**
 * Visualizer — animated level-bar visualizer for the Now-Live hero.
 *
 * Renders N_BARS vertical bars on a canvas. Bar heights are driven by the live
 * meter frame (L+R RMS for body level, peak for transient spikes). Each bar
 * also gets a small centre-weighted silhouette shape plus a slow-advancing
 * per-bar phase so the display looks alive even between 10 Hz meter updates.
 * Heights are eased each rAF frame (60fps) toward their target so the ~10Hz
 * meter ticks look smooth.
 *
 * No per-frame Math.random — motion is fully deterministic/smooth.
 * rAF loop is cleaned up on unmount.
 */
import { useEffect, useRef } from 'react'
import type { Meters as MeterFrame } from '../types.js'

// ── Constants ────────────────────────────────────────────────────────────────

const N_BARS = 24
const FLOOR_DB = -60          // same floor as Meters.tsx
const IDLE_HEIGHT = 0.04      // fraction each bar settles to when disengaged
const EASE = 0.22             // lerp factor per frame (~60fps → smooth at 10Hz feed)
const PHASE_SPEED = 0.012     // radians/frame — slow phase advance
const PHASE_SPREAD = Math.PI * 2 // total phase range across all bars

/** dBFS → 0..1 (mirrors Meters.tsx pct() but returns fraction, not %). */
function dbToFrac(db: number): number {
  if (!Number.isFinite(db)) return 0
  return Math.max(0, Math.min(1, (db - FLOOR_DB) / (0 - FLOOR_DB)))
}

/**
 * Centre-weighted silhouette weight for bar i out of n.
 * Returns a value in [0.5, 1.0] — middle bars are taller, edges shorter.
 */
function shapeWeight(i: number, n: number): number {
  const t = i / (n - 1)           // 0..1 across bar array
  const center = 1 - 2 * Math.abs(t - 0.5)  // 0 at edges, 1 at centre
  return 0.5 + 0.5 * center
}

// ── Component ────────────────────────────────────────────────────────────────

export function Visualizer({
  meters,
  engaged,
}: {
  meters: MeterFrame | null
  engaged: boolean
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // Per-bar current displayed height (fraction 0..1). Persists across renders.
  const barHeightsRef = useRef<Float32Array>(new Float32Array(N_BARS).fill(IDLE_HEIGHT))
  // Slowly-advancing global phase shared by the rAF loop.
  const phaseRef = useRef(0)
  // Keep latest meters + engaged in refs so the rAF closure never needs to
  // rebuild — avoids stale-closure bugs without creating new rAF loops.
  const metersRef = useRef<MeterFrame | null>(null)
  const engagedRef = useRef(false)

  // Keep refs in sync with props each render.
  metersRef.current = meters
  engagedRef.current = engaged

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let rafId = 0
    let running = true

    function frame() {
      if (!running) return
      rafId = requestAnimationFrame(frame)

      const dpr = window.devicePixelRatio || 1
      const w = canvas!.clientWidth
      const h = canvas!.clientHeight

      // Resize backing store if needed (e.g. window resize or first paint).
      if (canvas!.width !== Math.round(w * dpr) || canvas!.height !== Math.round(h * dpr)) {
        canvas!.width = Math.round(w * dpr)
        canvas!.height = Math.round(h * dpr)
        ctx!.scale(dpr, dpr)
      }

      // Advance phase.
      phaseRef.current += PHASE_SPEED

      const frame_meters = metersRef.current
      const isEngaged = engagedRef.current

      // Compute the base signal level from meters (0..1).
      let rmsLevel = 0
      let peakLevel = 0
      if (frame_meters && isEngaged) {
        const rmsL = dbToFrac(frame_meters.rms[0])
        const rmsR = dbToFrac(frame_meters.rms[1])
        rmsLevel = (rmsL + rmsR) * 0.5

        const peakL = dbToFrac(frame_meters.peak[0])
        const peakR = dbToFrac(frame_meters.peak[1])
        peakLevel = Math.max(peakL, peakR)
      }

      // Combine RMS body + peak transient into a single signal level.
      // Peak adds a snap punch on top of the RMS body.
      const signalLevel = Math.min(1, rmsLevel * 0.75 + peakLevel * 0.35)

      const heights = barHeightsRef.current
      const phase = phaseRef.current

      // Update each bar.
      for (let i = 0; i < N_BARS; i++) {
        // Per-bar phase offset — spread evenly across the bar array.
        const barPhase = (i / N_BARS) * PHASE_SPREAD

        // Slow sine modulation adds organic variation between bars.
        const sineVar = 0.5 + 0.5 * Math.sin(phase + barPhase)

        // Centre-weighted shape (makes middle bars taller as a silhouette).
        const shape = shapeWeight(i, N_BARS)

        let target: number
        if (isEngaged && signalLevel > 0.01) {
          // Live: drive bar height from signal, modulated by shape + sine.
          // sineVar gives neighbouring bars different heights; shape gives
          // the whole array a pleasing arch.
          target = signalLevel * shape * (0.6 + 0.4 * sineVar)
          // Floor bars to at least a small idle flicker so they never freeze.
          target = Math.max(target, IDLE_HEIGHT * 0.5 + 0.02 * sineVar)
        } else {
          // Idle / disengaged: decay to a low gently-rippling baseline.
          target = IDLE_HEIGHT * (0.5 + 0.5 * sineVar)
        }

        // Ease toward target.
        heights[i] += (target - heights[i]) * EASE
      }

      // Draw.
      ctx!.clearRect(0, 0, w, h)

      const gap = 2
      const totalGap = gap * (N_BARS - 1)
      const barW = (w - totalGap) / N_BARS
      const radius = Math.min(barW / 2, 3)

      // Amber→terracotta gradient (vertical, top of tallest bar to bottom).
      // We use accent (#d4a259) and accent-warm (#e07a5f) from the CSS tokens.
      const grad = ctx!.createLinearGradient(0, 0, 0, h)
      grad.addColorStop(0, '#e07a5f')   // --accent-warm (top / peak)
      grad.addColorStop(0.45, '#d4a259') // --accent (mid)
      grad.addColorStop(1, 'rgba(212,162,89,0.35)') // dim at base

      ctx!.fillStyle = grad

      for (let i = 0; i < N_BARS; i++) {
        const barH = Math.max(radius * 2, heights[i] * h)
        const x = i * (barW + gap)
        const y = h - barH

        // Rounded-top bar (full rounded rect).
        ctx!.beginPath()
        // top-left, top-right, bottom-right, bottom-left arcs
        ctx!.moveTo(x + radius, y)
        ctx!.lineTo(x + barW - radius, y)
        ctx!.arcTo(x + barW, y, x + barW, y + radius, radius)
        ctx!.lineTo(x + barW, h)
        ctx!.lineTo(x, h)
        ctx!.lineTo(x, y + radius)
        ctx!.arcTo(x, y, x + radius, y, radius)
        ctx!.closePath()
        ctx!.fill()
      }
    }

    rafId = requestAnimationFrame(frame)

    return () => {
      running = false
      cancelAnimationFrame(rafId)
    }
  }, []) // run once on mount; refs carry live data

  return (
    <canvas
      ref={canvasRef}
      className="visualizer-canvas"
      aria-hidden="true"
    />
  )
}

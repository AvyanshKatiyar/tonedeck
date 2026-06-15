/**
 * EqCurveCanvas — the showpiece. Draws a preset's combined frequency response:
 * log-x 20 Hz–20 kHz, linear-y ±9 dB, octave + dB gridlines with tiny labels,
 * a dotted zero line, the 2px amber response curve with a soft 12% fill to zero,
 * and a dot at each band's (freq, gain). devicePixelRatio-aware; redraws on
 * every draft change and on resize.
 */
import { useEffect, useRef } from 'react'
import { axes, presetToPolyline } from '../curve.js'
import type { Preset } from '../types.js'

const FREQ: [number, number] = [20, 20000]
const DB: [number, number] = [-9, 9]
const PAD = { left: 28, right: 10, top: 10, bottom: 18 }

const ACCENT = '#1ed760'
const GRID = 'rgba(255,255,255,0.08)'
const ZERO = 'rgba(255,255,255,0.28)'
const LABEL = 'rgba(255,255,255,0.4)'

export function EqCurveCanvas({ preset }: { preset: Pick<Preset, 'bands' | 'preamp'> }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const sizeRef = useRef({ w: 0, h: 0 })

  const draw = () => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return
    const w = wrap.clientWidth
    const h = wrap.clientHeight
    if (w === 0 || h === 0) return
    sizeRef.current = { w, h }

    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.round(w * dpr)
    canvas.height = Math.round(h * dpr)
    canvas.style.width = `${w}px`
    canvas.style.height = `${h}px`

    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)

    const plotW = w - PAD.left - PAD.right
    const plotH = h - PAD.top - PAD.bottom
    if (plotW <= 0 || plotH <= 0) return
    const ox = PAD.left
    const oy = PAD.top

    const { freqLines, dbLines } = axes(plotW, plotH, FREQ, DB)

    // dB gridlines + labels.
    ctx.font = '9px -apple-system, system-ui, sans-serif'
    ctx.textBaseline = 'middle'
    for (const line of dbLines) {
      ctx.strokeStyle = line.zero ? ZERO : GRID
      ctx.lineWidth = 1
      ctx.setLineDash(line.zero ? [3, 3] : [])
      ctx.beginPath()
      ctx.moveTo(ox, oy + line.y)
      ctx.lineTo(ox + plotW, oy + line.y)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.fillStyle = LABEL
      ctx.textAlign = 'right'
      ctx.fillText(line.label, ox - 4, oy + line.y)
    }

    // Frequency gridlines + labels.
    ctx.textBaseline = 'top'
    ctx.textAlign = 'center'
    for (const line of freqLines) {
      ctx.strokeStyle = GRID
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(ox + line.x, oy)
      ctx.lineTo(ox + line.x, oy + plotH)
      ctx.stroke()
      ctx.fillStyle = LABEL
      ctx.fillText(line.label, ox + line.x, oy + plotH + 4)
    }

    // Response curve + fill.
    const { curve, dots } = presetToPolyline(preset, plotW, plotH, FREQ, DB)
    if (curve.length > 1) {
      const zeroY = oy + dbLines.find((d) => d.zero)!.y

      // Soft fill to the zero line.
      ctx.beginPath()
      ctx.moveTo(ox + curve[0][0], oy + curve[0][1])
      for (const [x, y] of curve) ctx.lineTo(ox + x, oy + y)
      ctx.lineTo(ox + curve[curve.length - 1][0], zeroY)
      ctx.lineTo(ox + curve[0][0], zeroY)
      ctx.closePath()
      ctx.fillStyle = 'rgba(30,215,96,0.14)'
      ctx.fill()

      // Curve stroke.
      ctx.beginPath()
      ctx.moveTo(ox + curve[0][0], oy + curve[0][1])
      for (const [x, y] of curve) ctx.lineTo(ox + x, oy + y)
      ctx.strokeStyle = ACCENT
      ctx.lineWidth = 2
      ctx.lineJoin = 'round'
      ctx.stroke()

      // Band dots.
      for (const [x, y] of dots) {
        ctx.beginPath()
        ctx.arc(ox + x, oy + y, 3, 0, Math.PI * 2)
        ctx.fillStyle = ACCENT
        ctx.fill()
        ctx.strokeStyle = '#121212'
        ctx.lineWidth = 1.5
        ctx.stroke()
      }
    }
  }

  // Redraw on draft change.
  useEffect(draw, [preset])

  // Redraw on resize.
  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    const ro = new ResizeObserver(draw)
    ro.observe(wrap)
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="eq-canvas" ref={wrapRef}>
      <canvas ref={canvasRef} />
    </div>
  )
}

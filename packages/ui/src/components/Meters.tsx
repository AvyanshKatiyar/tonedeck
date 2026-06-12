/**
 * Meters — two horizontal RMS bars (L/R, −60..0 dBFS) with peak tick marks and
 * a clip light. RMS fill transitions over 100ms; peak ticks track the last
 * frame. The clip light glows red when the cumulative clipped-sample count
 * exceeds the last acknowledged value; click it to reset the visual.
 */
import type { Meters as MeterFrame } from '../types.js'

const FLOOR = -60

/** dBFS → 0..100 % of the bar width (−1000 silence floor → 0). */
function pct(db: number): number {
  if (!Number.isFinite(db)) return 0
  return Math.max(0, Math.min(1, (db - FLOOR) / (0 - FLOOR))) * 100
}

function Bar({ label, rms, peak }: { label: string; rms: number; peak: number }) {
  const rmsPct = pct(rms)
  const peakPct = pct(peak)
  return (
    <div className="meter">
      <span className="meter__label">{label}</span>
      <div className="meter__track">
        <div className="meter__fill" style={{ width: `${rmsPct}%` }} />
        {peakPct > 0 && <div className="meter__peak" style={{ left: `${peakPct}%` }} />}
      </div>
    </div>
  )
}

export function Meters({
  meters,
  clipped,
  clipAck,
  onAckClip,
  engaged,
}: {
  meters: MeterFrame | null
  clipped: number | null
  clipAck: number
  onAckClip: () => void
  engaged: boolean
}) {
  const rmsL = meters?.rms[0] ?? -1000
  const rmsR = meters?.rms[1] ?? -1000
  const peakL = meters?.peak[0] ?? -1000
  const peakR = meters?.peak[1] ?? -1000

  const clipping = (clipped ?? 0) > clipAck

  return (
    <div className={`meters ${engaged ? '' : 'meters--idle'}`}>
      <div className="meters__bars">
        <Bar label="L" rms={rmsL} peak={peakL} />
        <Bar label="R" rms={rmsR} peak={peakR} />
      </div>
      <button
        type="button"
        className={`clip-light ${clipping ? 'clip-light--on' : ''}`}
        title={clipping ? 'Clipping detected — click to reset' : 'No clipping'}
        onClick={onAckClip}
        aria-label="Clip indicator"
      >
        CLIP
      </button>
    </div>
  )
}

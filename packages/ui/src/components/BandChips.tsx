import type { Band } from '../types.js'

const fmtFreq = (f: number) => (f >= 1000 ? `${(f / 1000).toFixed(f % 1000 ? 1 : 0)}k` : `${f}`)

export function BandChips({ bands, preamp }: { bands: Band[]; preamp: number }) {
  return (
    <div className="chips">
      {bands.map((b) => (
        <span className="chip" key={b.id}>
          {b.gain >= 0 ? '+' : ''}{b.gain.toFixed(1)} {b.type.replace('shelf', '-shelf')} {fmtFreq(b.freq)}Hz
        </span>
      ))}
      <span className="chip chip-pre">preamp {preamp.toFixed(1)}</span>
    </div>
  )
}

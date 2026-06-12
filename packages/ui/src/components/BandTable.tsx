/**
 * BandTable — the Advanced editor. Read-only id/type/freq/Q columns plus
 * editable per-band gain number inputs and a preamp input. Edits update the
 * draft directly (same pipeline the curve + preview read) with a debounced
 * /api/preview when engaged.
 */
import { useRef } from 'react'
import { useStore } from '../store.js'
import type { Preset } from '../types.js'

export function BandTable() {
  const { state, actions } = useStore()
  const { draft } = state
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  if (!draft) return null

  const push = (next: Preset) => {
    actions.setDraft(next)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => actions.preview(next), 300)
  }

  const setGain = (id: string, gain: number) => {
    push({ ...draft, bands: draft.bands.map((b) => (b.id === id ? { ...b, gain } : b)) })
  }
  const setPreamp = (preamp: number) => push({ ...draft, preamp })

  return (
    <div className="bandtable">
      <table>
        <thead>
          <tr>
            <th>Band</th>
            <th>Type</th>
            <th>Freq</th>
            <th>Q</th>
            <th>Gain dB</th>
          </tr>
        </thead>
        <tbody>
          {draft.bands.map((b) => (
            <tr key={b.id}>
              <td className="bandtable__id">{b.id}</td>
              <td className="bandtable__dim">{b.type}</td>
              <td className="bandtable__dim">{b.freq < 1000 ? `${b.freq}` : `${b.freq / 1000}k`}</td>
              <td className="bandtable__dim">{b.q}</td>
              <td>
                <input
                  type="number"
                  step={0.5}
                  value={b.gain}
                  onChange={(e) => setGain(b.id, Number(e.target.value))}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <label className="bandtable__preamp">
        Preamp dB
        <input
          type="number"
          step={0.5}
          value={draft.preamp}
          onChange={(e) => setPreamp(Number(e.target.value))}
        />
      </label>
    </div>
  )
}

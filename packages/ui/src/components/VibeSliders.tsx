/**
 * VibeSliders — the 5 layman vibes (Warmth/Punch/Clarity/Smoothness/Sparkle),
 * each −3..+3 in 0.5 steps with a tick at 0. On input the draft preset is
 * recomputed locally (instant curve redraw) and, when engaged, a debounced
 * (300ms) /api/preview pushes the same draft to the live chain.
 */
import { useRef } from 'react'
import { useStore } from '../store.js'
import { applyVibesDraft } from '../vibedraft.js'
import type { VibeName } from '../types.js'

const VIBE_LABELS: { key: VibeName; label: string; hint: string }[] = [
  { key: 'warmth', label: 'Warmth', hint: 'fuller low end' },
  { key: 'punch', label: 'Punch', hint: 'tighter kick' },
  { key: 'clarity', label: 'Clarity', hint: 'cuts through' },
  { key: 'smoothness', label: 'Smoothness', hint: 'less harsh' },
  { key: 'sparkle', label: 'Sparkle', hint: 'more air up top' },
]

export function VibeSliders() {
  const { state, actions } = useStore()
  const { vibes, base, profile } = state
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const onChange = (key: VibeName, value: number) => {
    const next = { ...vibes, [key]: value }
    actions.setVibes(next) // instant curve + draft
    if (!base || !profile) return
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      actions.preview(applyVibesDraft(base, next, profile))
    }, 300)
  }

  return (
    <div className="vibes">
      {VIBE_LABELS.map(({ key, label, hint }) => (
        <div className="vibe" key={key}>
          <div className="vibe__head">
            <span className="vibe__label">{label}</span>
            <span className="vibe__val">
              {vibes[key] > 0 ? '+' : ''}
              {vibes[key].toFixed(1)}
            </span>
          </div>
          <input
            className="vibe__slider"
            type="range"
            min={-3}
            max={3}
            step={0.5}
            value={vibes[key]}
            list="vibe-ticks"
            aria-label={label}
            onChange={(e) => onChange(key, Number(e.target.value))}
          />
          <span className="vibe__hint">{hint}</span>
        </div>
      ))}
      <datalist id="vibe-ticks">
        <option value="0" />
      </datalist>
    </div>
  )
}

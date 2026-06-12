/**
 * PresetDrawer — right-side 420px panel for tuning one preset. Header (art,
 * title/artist, version, kind), the EqCurveCanvas showpiece, VibeSliders, a
 * Save (auto-composed change string + one-line reason) / Revert pair, and an
 * Advanced collapsible (BandTable + provenance history).
 */
import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { useStore } from '../store.js'
import type { Preset } from '../types.js'
import { AlbumArt } from './FallbackArt.js'
import { EqCurveCanvas } from './EqCurveCanvas.js'
import { VibeSliders } from './VibeSliders.js'
import { BandTable } from './BandTable.js'

/** Human-readable diff of gains + preamp between the saved base and the draft. */
function composeChange(base: Preset, draft: Preset): string {
  const parts: string[] = []
  const baseById = new Map(base.bands.map((b) => [b.id, b.gain]))
  for (const b of draft.bands) {
    const before = baseById.get(b.id)
    if (before === undefined) {
      if (b.gain !== 0) parts.push(`+${b.id} ${fmt(b.gain)}`)
    } else if (Math.abs(b.gain - before) > 1e-9) {
      parts.push(`${b.id} ${fmt(b.gain - before, true)}`)
    }
  }
  if (Math.abs(draft.preamp - base.preamp) > 1e-9) {
    parts.push(`preamp ${fmt(draft.preamp - base.preamp, true)}`)
  }
  return parts.length ? parts.join(', ') : 'no change'
}
const fmt = (n: number, signed = false) =>
  `${signed && n > 0 ? '+' : ''}${n.toFixed(1)} dB`

export function PresetDrawer() {
  const { state, actions } = useStore()
  const { drawerSlug, base, draft } = state
  const [reason, setReason] = useState('')
  const [advanced, setAdvanced] = useState(false)

  // Reset the reason field whenever a different preset is opened.
  useEffect(() => setReason(''), [drawerSlug])

  if (!drawerSlug || !base || !draft) return null

  const change = composeChange(base, draft)
  const dirty = change !== 'no change'
  const history = base.provenance.history.slice(-5).reverse()

  return (
    <>
      <div className="drawer-backdrop" onClick={actions.closeDrawer} />
      <aside className="drawer" role="dialog" aria-label={`Tune ${base.title}`}>
        <header className="drawer__head">
          <div className="drawer__art">
            <AlbumArt slug={base.slug} title={base.title} src={api.artworkUrl(base.slug)} fontSize={18} />
          </div>
          <div className="drawer__meta">
            <div className="drawer__title">{base.title}</div>
            <div className="drawer__artist">{base.artist ?? '—'}</div>
            <div className="drawer__tags">
              <span className="tag">{base.kind}</span>
              <span className="tag">v{base.version}</span>
            </div>
          </div>
          <button type="button" className="drawer__close" onClick={actions.closeDrawer} aria-label="Close">
            ×
          </button>
        </header>

        <div className="drawer__body">
          <EqCurveCanvas preset={draft} />
          <p className="drawer__intent">{base.intent}</p>

          <VibeSliders />

          <div className="drawer__save">
            <input
              className="drawer__reason"
              type="text"
              value={reason}
              placeholder="why? e.g. 'too harsh on this album'"
              onChange={(e) => setReason(e.target.value)}
            />
            <div className="drawer__actions">
              <button type="button" className="btn" onClick={actions.revert} disabled={!dirty}>
                Revert
              </button>
              <button
                type="button"
                className="btn btn--primary"
                disabled={!dirty}
                onClick={() => actions.save(change, reason.trim() || 'manual tweak')}
              >
                Save
              </button>
            </div>
            {dirty && <div className="drawer__changehint">{change}</div>}
          </div>

          <button
            type="button"
            className="drawer__advtoggle"
            onClick={() => setAdvanced((v) => !v)}
          >
            {advanced ? '▾' : '▸'} Advanced
          </button>
          {advanced && (
            <div className="drawer__advanced">
              <BandTable />
              {history.length > 0 && (
                <div className="provenance">
                  <div className="provenance__head">Recent changes</div>
                  {history.map((h, i) => (
                    <div className="provenance__row" key={i}>
                      <span className="provenance__change">{h.change}</span>
                      <span className="provenance__reason">{h.reason}</span>
                      <span className="provenance__date">{h.at.slice(0, 10)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </aside>
    </>
  )
}

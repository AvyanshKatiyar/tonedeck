/**
 * PresetDrawer — right-side 420px panel for tuning one preset. Header (art,
 * title/artist, version, kind), the EqCurveCanvas showpiece, VibeSliders, a
 * Save (auto-composed change string + one-line reason) / Revert pair, then the
 * full control set inline: BandTable, reset-to-original, delete (two-step
 * confirm, active-preset protected), and provenance history.
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
  const { drawerSlug, base, draft, status, profile, optimizingPreamp } = state
  const [reason, setReason] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)

  // Reset transient state whenever a different preset is opened.
  useEffect(() => {
    setReason('')
    setConfirmDelete(false)
  }, [drawerSlug])

  const isActive = !!status?.engaged && status?.activePreset === drawerSlug

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

          <div className="preamp-section">
            <div className="preamp-section__head">
              <label htmlFor="preamp-slider" className="preamp-section__label">
                Preamp / Loudness
              </label>
              <span className="preamp-section__val">
                {draft.preamp >= 0 ? '+' : ''}{draft.preamp.toFixed(1)} dB
              </span>
            </div>
            <input
              id="preamp-slider"
              type="range"
              className="preamp-slider"
              min={profile?.limits.preampDb[0] ?? -12}
              max={profile?.limits.preampDb[1] ?? 4}
              step={0.5}
              value={draft.preamp}
              onChange={(e) => actions.setDraft({ ...draft, preamp: Number(e.target.value) })}
            />
            <div className="preamp-section__optimize">
              <button
                type="button"
                className="btn btn--optimize"
                disabled={optimizingPreamp}
                onClick={() => void actions.optimizeForPreamp()}
              >
                {optimizingPreamp ? (
                  <>
                    <span className="btn--optimize__spinner" aria-hidden />
                    Optimizing…
                  </>
                ) : (
                  'Optimize for loudness'
                )}
              </button>
              <p className="preamp-section__hint">
                Re-balances the bands for this preamp via Sonnet (~10s).
              </p>
            </div>
          </div>

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

          <div className="drawer__divider" aria-hidden />
          <div className="drawer__advanced">
            <BandTable />
            {base.version > 1 && (
              <button
                type="button"
                className="btn drawer__resetoriginal"
                onClick={actions.resetOriginal}
                title="Restore this preset's original values (your saved changes stay in history)"
              >
                Reset to original
              </button>
            )}
            <button
              type="button"
              className={`btn btn--danger drawer__delete ${confirmDelete ? 'btn--danger-armed' : ''}`}
              disabled={isActive}
              title={
                isActive
                  ? 'This preset is playing — switch to another before deleting'
                  : 'Remove this preset from your library'
              }
              onClick={() => {
                if (!confirmDelete) {
                  setConfirmDelete(true)
                  return
                }
                void actions.deletePreset()
              }}
            >
              {confirmDelete ? 'Click again to delete' : 'Delete preset'}
            </button>
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
        </div>
      </aside>
    </>
  )
}

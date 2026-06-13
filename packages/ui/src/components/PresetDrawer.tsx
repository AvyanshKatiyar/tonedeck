/**
 * PresetDrawer — persistent right-hand console for tuning one preset.
 *
 * Console header: album art, title/artist, version, kind, the EQ On/Off
 * (A/B bypass) toggle, and — when not following live — a "↩ Live" return
 * button.
 *
 * Body: EqCurveCanvas, VibeSliders, preamp/loudness slider + Optimize-for-
 * loudness button, Save / Revert pair, BandTable, reset-to-original, delete
 * (two-step confirm, active-preset protected), and provenance history.
 *
 * Props:
 *   followingLive  — true when the console is auto-tracking the active preset.
 *   onReturnToLive — called when the user wants to return to following.
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

interface PresetDrawerProps {
  followingLive: boolean
  onReturnToLive: () => void
}

export function PresetDrawer({ followingLive, onReturnToLive }: PresetDrawerProps) {
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
  const engaged = !!status?.engaged
  const bypassed = !!status?.bypass

  if (!drawerSlug || !base || !draft) return null

  const change = composeChange(base, draft)
  const dirty = change !== 'no change'
  const history = base.provenance.history.slice(-5).reverse()

  return (
    <aside className="console" role="complementary" aria-label={`EQ Console — ${base.title}`}>
      {/* ── Console header ──────────────────────────────────────────────── */}
      <header className="console__head">
        <div className="console__art">
          <AlbumArt slug={base.slug} title={base.title} src={api.artworkUrl(base.slug)} fontSize={18} />
        </div>
        <div className="console__meta">
          <div className="console__title">{base.title}</div>
          <div className="console__artist">{base.artist ?? '—'}</div>
          <div className="console__tags">
            <span className="tag">{base.kind}</span>
            <span className="tag">v{base.version}</span>
            {isActive && <span className="tag tag--live">Live</span>}
          </div>
        </div>

        {/* EQ On / Off (A/B bypass) toggle */}
        <div className="eq-toggle">
          <button
            type="button"
            className={`eq-toggle__btn${!bypassed && engaged ? ' eq-toggle__btn--on' : ''}`}
            disabled={!engaged}
            title={
              !engaged
                ? 'EQ is not engaged — apply a preset to enable'
                : bypassed
                ? 'EQ is OFF (bypassed) — click to turn ON'
                : 'EQ is ON — click to bypass (flat A/B compare)'
            }
            onClick={() => void actions.bypass(bypassed ? false : true)}
          >
            <span className="eq-toggle__track">
              <span className="eq-toggle__thumb" />
            </span>
            <span className="eq-toggle__label">
              EQ {!bypassed && engaged ? 'ON' : 'OFF'}
            </span>
          </button>
        </div>

        {/* ↩ Live — return to following the active preset */}
        {!followingLive && (
          <button
            type="button"
            className="console__return-live"
            onClick={onReturnToLive}
            title="Return to following the live preset"
          >
            ↩ Live
          </button>
        )}
      </header>

      {/* ── Console body ────────────────────────────────────────────────── */}
      <div className="console__body">
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
  )
}

/**
 * NowPlayingBar — full-width bottom player, modelled on Spotify's playback bar.
 *
 * Left:   active album thumb + title/artist + an EQ-on/off heart.
 * Centre: transport cluster (decorative shuffle/prev/next/repeat around the big
 *         play/pause, which maps to Engage/Disengage) over a progress line whose
 *         fill tracks the live output level.
 * Right:  A/B bypass, a compact level meter, and an always-live PANIC button.
 */
import { api } from '../api.js'
import { useStore } from '../store.js'
import type { Meters as MeterFrame } from '../types.js'
import { AlbumArt, FallbackArt } from './FallbackArt.js'
import { Meters } from './Meters.js'

const FLOOR = -60
/** dBFS → 0..100 % (mirrors Meters.pct). */
function pct(db: number): number {
  if (!Number.isFinite(db)) return 0
  return Math.max(0, Math.min(1, (db - FLOOR) / (0 - FLOOR))) * 100
}

export function NowPlayingBar({ meters }: { meters: MeterFrame | null }) {
  const { state, actions } = useStore()
  const { status, presets, clipAck } = state
  const engaged = status?.engaged ?? false
  const bypass = status?.bypass ?? false
  const active = presets.find((p) => p.slug === status?.activePreset) ?? null

  // Progress fill tracks the louder channel's RMS.
  const level = engaged && meters ? Math.max(pct(meters.rms[0]), pct(meters.rms[1])) : 0

  // Transport: shuffle / prev / next cycle through the preset library, applying
  // each (which goes live). Order mirrors the daemon's title-sorted list.
  const slugs = presets.map((p) => p.slug)
  const activeIdx = status?.activePreset ? slugs.indexOf(status.activePreset) : -1
  const canNav = slugs.length > 0
  const goTo = (delta: number) => {
    if (!slugs.length) return
    const base = activeIdx < 0 ? 0 : activeIdx
    void actions.applyPreset(slugs[(base + delta + slugs.length) % slugs.length])
  }
  const shuffle = () => {
    if (!slugs.length) return
    let n = Math.floor(Math.random() * slugs.length)
    if (n === activeIdx && slugs.length > 1) n = (n + 1) % slugs.length
    void actions.applyPreset(slugs[n])
  }

  return (
    <footer className="npbar">
      {/* ── Left: track ──────────────────────────────────────────────── */}
      <div className="npbar__left">
        <div className="npbar__thumb">
          {active ? (
            <AlbumArt slug={active.slug} title={active.title} src={api.artworkUrl(active.slug)} fontSize={18} />
          ) : (
            <FallbackArt slug="tonedeck" title="ToneDeck" fontSize={15} />
          )}
        </div>
        <div className="npbar__meta">
          <div className="npbar__title">{active ? active.title : 'No album engaged'}</div>
          <div className="npbar__artist">
            {active ? active.artist ?? '—' : 'Pick an album to go live'}
          </div>
        </div>
        <button
          type="button"
          className={`npbar__like${engaged && !bypass ? ' is-on' : ''}`}
          disabled={!engaged}
          onClick={() => actions.bypass(!bypass)}
          title={bypass ? 'EQ bypassed — click to enable' : 'EQ on — click to bypass'}
          aria-label="Toggle EQ"
        >
          {engaged && !bypass ? '♥' : '♡'}
        </button>
      </div>

      {/* ── Centre: transport + progress ─────────────────────────────── */}
      <div className="npbar__center">
        <div className="npbar__controls">
          <button type="button" className="np-ctl" disabled={!canNav} onClick={shuffle} title="Shuffle — random preset" aria-label="Shuffle">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M16 4h5v5h-2V7.4l-4.3 4.3-1.4-1.4L17.6 6H16V4ZM3 6h4.6l3.3 3.3-1.4 1.4L6.6 8H3V6Zm0 10h4.6l11-11H21v5h-2V7.4L9.4 17H3v-1Zm14.6 0L16 14.4 17.4 13l4.3 4.3V15.6h2V21h-5v-2h1.6Z"/></svg>
          </button>
          <button type="button" className="np-ctl" disabled={!canNav} onClick={() => goTo(-1)} title="Previous preset" aria-label="Previous">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M7 5h2v14H7V5Zm10 0v14l-8-7 8-7Z"/></svg>
          </button>
          <button
            type="button"
            className={`np-play${engaged ? '' : ' np-play--off'}`}
            onClick={() => (engaged ? actions.disengage() : actions.engage())}
            title={engaged ? 'Disengage EQ' : 'Engage EQ'}
            aria-label={engaged ? 'Disengage' : 'Engage'}
          >
            {engaged ? (
              <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M7 5h4v14H7V5Zm6 0h4v14h-4V5Z" /></svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M8 5v14l11-7L8 5Z" /></svg>
            )}
          </button>
          <button type="button" className="np-ctl" disabled={!canNav} onClick={() => goTo(1)} title="Next preset" aria-label="Next">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M15 5h2v14h-2V5ZM7 5l8 7-8 7V5Z"/></svg>
          </button>
          <button
            type="button"
            className={`np-ctl${engaged && !bypass ? ' np-ctl--on' : ''}`}
            disabled={!engaged}
            onClick={() => actions.bypass(!bypass)}
            title="A/B bypass — repeat the flat signal"
            aria-label="A/B bypass"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M7 7h10v2.6l3-3-3-3V6H5v6h2V7Zm10 10H7v-2.6l-3 3 3 3V18h12v-6h-2v5Z"/></svg>
          </button>
        </div>
        <div className="npbar__progress">
          <span className="np-time">{engaged ? (bypass ? 'FLAT' : 'EQ') : 'OFF'}</span>
          <div className="np-bar">
            <div className="np-bar__fill" style={{ width: `${level}%` }} />
          </div>
          <span className="np-time">{status?.dspState ?? '—'}</span>
        </div>
      </div>

      {/* ── Right: bypass · level · panic ────────────────────────────── */}
      <div className="npbar__right">
        <button
          type="button"
          className={`btn btn--toggle ${bypass ? 'is-on' : ''}`}
          disabled={!engaged}
          onClick={() => actions.bypass(!bypass)}
          title="A/B bypass — hear the EQ vs. flat"
        >
          {bypass ? 'A · flat' : 'B · EQ'}
        </button>
        <div className="npbar__level">
          <Meters
            meters={meters}
            clipped={status?.clippedSamples ?? null}
            clipAck={clipAck}
            onAckClip={actions.ackClip}
            engaged={engaged}
          />
        </div>
        <button type="button" className="btn btn--danger" onClick={() => actions.panic()}>
          PANIC
        </button>
      </div>
    </footer>
  )
}

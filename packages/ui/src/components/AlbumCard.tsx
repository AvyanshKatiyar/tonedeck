/**
 * AlbumCard — one album tile. Square artwork (cached image → fallback tile),
 * title + artist, hover lift with an intent one-liner overlay, a "Tune" icon
 * button (hover/active), and an amber ring + playing bars when active. Clicking
 * the card applies the preset (auto-engages); a spinner ring shows in flight.
 */
import { api } from '../api.js'
import type { PresetSummary } from '../types.js'
import { AlbumArt } from './FallbackArt.js'

function PlayingBars() {
  return (
    <span className="playing-bars" aria-hidden>
      <i />
      <i />
      <i />
    </span>
  )
}

export function AlbumCard({
  preset,
  active,
  applying,
  onApply,
  onTune,
}: {
  preset: PresetSummary
  active: boolean
  applying: boolean
  onApply: () => void
  onTune: () => void
}) {
  return (
    <div className={`card ${active ? 'card--active' : ''} ${applying ? 'card--applying' : ''}`}>
      <button
        type="button"
        className="card__art"
        onClick={onApply}
        aria-label={`Apply ${preset.title}`}
      >
        <AlbumArt slug={preset.slug} title={preset.title} src={api.artworkUrl(preset.slug)} />
        <span className="card__overlay">{preset.intent}</span>
        {applying && <span className="card__spinner" aria-label="Applying" />}
        {active && !applying && (
          <span className="card__badge">
            <PlayingBars />
          </span>
        )}
      </button>
      <div className="card__foot">
        <div className="card__text">
          <div className="card__title" title={preset.title}>
            {preset.title}
            {preset.kind === 'track' && <span className="card__kind">song</span>}
          </div>
          <div className="card__artist">{preset.artist ?? '—'}</div>
        </div>
        <button type="button" className="card__tune" onClick={onTune} title="Tune this preset">
          <TuneIcon />
        </button>
      </div>
    </div>
  )
}

function TuneIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M2 4h8M2 8h12M2 12h5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="11" cy="4" r="2" fill="currentColor" />
      <circle cx="8" cy="12" r="2" fill="currentColor" />
    </svg>
  )
}

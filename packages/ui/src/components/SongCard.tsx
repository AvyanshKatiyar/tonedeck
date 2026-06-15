/**
 * SongCard — one row in an expanded album's track list (Spotify-style).
 * Columns: index (an animated equalizer when live) · title · state · edit.
 * Lightweight: only PresetSummary fields (no bands), so no per-card API call.
 */
import type { PresetSummary } from '../types.js'

export function SongCard({
  song,
  live,
  index,
  onApply,
  onEdit,
}: {
  song: PresetSummary
  live: boolean
  index: number
  onApply: (slug: string) => void
  onEdit: (slug: string) => void
}) {
  const statusLabel = live ? 'Playing' : song.kind === 'track' ? 'Tuned' : 'Album EQ'

  return (
    <div className={`song${live ? ' song--live' : ''}`}>
      <div className="song__index" aria-hidden>
        {live ? (
          <span className="playing-bars">
            <i />
            <i />
            <i />
          </span>
        ) : (
          index
        )}
      </div>
      <button
        type="button"
        className="song__apply"
        onClick={() => onApply(song.slug)}
        title={`Play ${song.title}`}
      >
        <div className="song__title">{song.title}</div>
      </button>
      <div className={`song__status${live ? ' song__status--live' : ''}`}>{statusLabel}</div>
      <button
        type="button"
        className="song__edit-btn"
        onClick={(e) => {
          e.stopPropagation()
          onEdit(song.slug)
        }}
        title={`Edit EQ for ${song.title}`}
        aria-label={`Edit EQ for ${song.title}`}
      >
        ✎
      </button>
    </div>
  )
}

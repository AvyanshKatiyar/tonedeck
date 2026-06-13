/**
 * SongCard — compact song tile inside an expanded AlbumDeck.
 * Lightweight: only PresetSummary fields (no bands), so no per-card API call.
 * Live card gets an amber highlight ring; otherwise shows a muted kind tag.
 */
import type { PresetSummary } from '../types.js'

export function SongCard({
  song,
  live,
  onApply,
  onEdit,
}: {
  song: PresetSummary
  live: boolean
  onApply: (slug: string) => void
  onEdit: (slug: string) => void
}) {
  const statusLabel = live
    ? '● LIVE'
    : song.kind === 'track'
      ? 'tuned'
      : 'album'

  return (
    <div className={`song${live ? ' song--live' : ''}`}>
      <button
        type="button"
        className="song__apply"
        onClick={() => onApply(song.slug)}
        title={song.title}
      >
        <div className="song__title">{song.title}</div>
        <div className={`song__status${live ? ' song__status--live' : ''}`}>{statusLabel}</div>
      </button>
      <button
        type="button"
        className="song__edit-btn"
        onClick={(e) => { e.stopPropagation(); onEdit(song.slug) }}
        title={`Edit EQ for ${song.title}`}
        aria-label={`Edit EQ for ${song.title}`}
      >
        ✎
      </button>
    </div>
  )
}

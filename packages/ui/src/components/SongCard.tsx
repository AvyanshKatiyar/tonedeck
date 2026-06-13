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
}: {
  song: PresetSummary
  live: boolean
  onApply: (slug: string) => void
}) {
  const statusLabel = live
    ? '● LIVE'
    : song.kind === 'track'
      ? 'tuned'
      : 'album'

  return (
    <button
      type="button"
      className={`song${live ? ' song--live' : ''}`}
      onClick={() => onApply(song.slug)}
      title={song.title}
    >
      <div className="song__title">{song.title}</div>
      <div className={`song__status${live ? ' song__status--live' : ''}`}>{statusLabel}</div>
    </button>
  )
}

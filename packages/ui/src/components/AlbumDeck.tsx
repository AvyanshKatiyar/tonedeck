/**
 * AlbumDeck — a single album rendered as a stacked-card deck.
 *
 * Resting state: a "stack of cards" depth illusion via CSS ::before/::after
 * pseudo-elements on .deck__cover, album name (serif), song count.
 *
 * Expanded state: a horizontal scrolling .songrow of SongCards — one per song,
 * plus an "Album EQ" entry if deck.albumPreset exists.
 *
 * Gracefully handles albumPreset === undefined: shows deck name + artwork +
 * songs without crashing. Uses artwork from deck.artwork when available, keyed
 * via deck.albumSlug ?? deck.songs[0]?.slug.
 */
import { api } from '../api.js'
import type { AlbumDeck as AlbumDeckType } from '../library.js'
import { AlbumArt } from './FallbackArt.js'
import { SongCard } from './SongCard.js'

export function AlbumDeck({
  deck,
  expanded,
  activeSlug,
  onToggle,
  onApply,
}: {
  deck: AlbumDeckType
  expanded: boolean
  activeSlug: string | null
  onToggle: (album: string) => void
  onApply: (slug: string) => void
}) {
  // Prefer the album slug for artwork lookup; fall back to first song slug
  const artSlug = deck.albumSlug ?? deck.songs[0]?.slug ?? deck.album
  const totalCount = deck.songs.length + (deck.albumPreset ? 1 : 0)
  const albumIsLive = deck.albumSlug !== null && deck.albumSlug === activeSlug

  return (
    <div className={`deck${expanded ? ' deck--expanded' : ''}${albumIsLive ? ' deck--live' : ''}`}>
      {/* Stacked cover — clicking toggles expand */}
      <button
        type="button"
        className="deck__cover"
        onClick={() => onToggle(deck.album)}
        aria-label={expanded ? `Collapse ${deck.album}` : `Expand ${deck.album}`}
        aria-expanded={expanded}
      >
        <AlbumArt slug={artSlug} title={deck.album} src={api.artworkUrl(artSlug)} fontSize={22} />
      </button>

      {/* Album name + count */}
      <div className="deck__meta">
        <div className="deck__name">{deck.album}</div>
        <div className="deck__count">
          {totalCount} {totalCount === 1 ? 'song' : 'songs'}
          {deck.albumPreset ? ' · album EQ' : ''}
        </div>
      </div>

      {/* Expanded song row */}
      {expanded && (
        <div className="expand">
          <div className="songrow">
            {/* Album-level EQ entry — only when albumPreset exists */}
            {deck.albumPreset && (
              <SongCard
                song={deck.albumPreset}
                live={albumIsLive}
                onApply={onApply}
              />
            )}
            {deck.songs.map((song) => (
              <SongCard
                key={song.slug}
                song={song}
                live={song.slug === activeSlug}
                onApply={onApply}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

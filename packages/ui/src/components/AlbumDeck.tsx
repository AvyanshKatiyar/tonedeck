/**
 * AlbumDeck — one album rendered as a flat Spotify card: artwork tile with a
 * hover-reveal green play button (applies the album/first-song preset → goes
 * live), a hover edit pencil (top-right), and album name + tune count below.
 *
 * Clicking the cover toggles the album's expanded track list, which is rendered
 * full-width by ArtistSection (so it can span the whole card grid). The card
 * itself is purely the tile; expansion lives one level up.
 */
import { api } from '../api.js'
import type { AlbumDeck as AlbumDeckType } from '../library.js'
import { AlbumArt } from './FallbackArt.js'

/** Best slug to apply for a deck: the album preset, else its first song. */
function primarySlug(deck: AlbumDeckType): string | null {
  return deck.albumSlug ?? deck.songs[0]?.slug ?? null
}

export function AlbumDeck({
  deck,
  expanded,
  activeSlug,
  onToggle,
  onApply,
  onEdit,
}: {
  deck: AlbumDeckType
  expanded: boolean
  activeSlug: string | null
  onToggle: (album: string) => void
  onApply: (slug: string) => void
  onEdit: (slug: string) => void
}) {
  const artSlug = deck.albumSlug ?? deck.songs[0]?.slug ?? deck.album
  const totalCount = deck.songs.length + (deck.albumPreset ? 1 : 0)
  const playSlug = primarySlug(deck)
  const albumIsLive =
    !!activeSlug &&
    (deck.albumSlug === activeSlug || deck.songs.some((s) => s.slug === activeSlug))

  return (
    <div
      className={`deck${expanded ? ' deck--expanded' : ''}${albumIsLive ? ' deck--live' : ''}`}
    >
      <div className="deck__card">
        <div className="deck__cover-wrap">
          <button
            type="button"
            className="deck__cover"
            onClick={() => onToggle(deck.album)}
            aria-label={expanded ? `Collapse ${deck.album}` : `Expand ${deck.album}`}
            aria-expanded={expanded}
          >
            <AlbumArt slug={artSlug} title={deck.album} src={api.artworkUrl(artSlug)} fontSize={40} />
          </button>

          {playSlug && (
            <button
              type="button"
              className={`play-fab${albumIsLive ? ' play-fab--live' : ''}`}
              onClick={(e) => {
                e.stopPropagation()
                onApply(playSlug)
              }}
              title={`Play ${deck.album}`}
              aria-label={`Play ${deck.album}`}
            >
              <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d="M8 5v14l11-7L8 5Z" />
              </svg>
            </button>
          )}

          {deck.albumSlug && (
            <button
              type="button"
              className="deck__edit-btn"
              onClick={(e) => {
                e.stopPropagation()
                onEdit(deck.albumSlug!)
              }}
              title={`Edit album EQ for ${deck.album}`}
              aria-label={`Edit album EQ for ${deck.album}`}
            >
              ✎
            </button>
          )}
        </div>

        <div className="deck__meta">
          <div className="deck__name">{deck.album}</div>
          <div className="deck__count">
            {totalCount} {totalCount === 1 ? 'tune' : 'tunes'}
            {deck.albumPreset ? ' · album EQ' : ''}
          </div>
        </div>
      </div>
    </div>
  )
}

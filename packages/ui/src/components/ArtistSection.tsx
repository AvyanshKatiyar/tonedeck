/**
 * ArtistSection — one artist header, a responsive grid of AlbumDeck cards, and
 * (when one of this artist's albums is expanded) a full-width track list below
 * the grid. The list is a sibling of the grid — not nested inside a card — so
 * it spans the section width like a Spotify album view.
 */
import type { ArtistGroup } from '../library.js'
import { AlbumDeck } from './AlbumDeck.js'
import { SongCard } from './SongCard.js'

export function ArtistSection({
  group,
  expandedAlbum,
  activeSlug,
  onToggle,
  onApply,
  onEdit,
}: {
  group: ArtistGroup
  expandedAlbum: string | null
  activeSlug: string | null
  onToggle: (album: string) => void
  onApply: (slug: string) => void
  onEdit: (slug: string) => void
}) {
  const openDeck = group.albums.find((d) => d.album === expandedAlbum) ?? null

  // Album-EQ entry first (when present), then the songs — numbered sequentially.
  const tracks = openDeck
    ? [...(openDeck.albumPreset ? [openDeck.albumPreset] : []), ...openDeck.songs]
    : []

  return (
    <section className="sec-group">
      <h2 className="sec">{group.artist}</h2>
      <div className="decks">
        {group.albums.map((deck) => (
          <AlbumDeck
            key={deck.album}
            deck={deck}
            expanded={expandedAlbum === deck.album}
            activeSlug={activeSlug}
            onToggle={onToggle}
            onApply={onApply}
            onEdit={onEdit}
          />
        ))}
      </div>

      {openDeck && (
        <div className="expand">
          <div className="expand__head">
            <span>#</span>
            <span>{openDeck.album}</span>
            <span>State</span>
          </div>
          <div className="songrow">
            {tracks.map((song, i) => (
              <SongCard
                key={song.slug}
                song={song}
                index={i + 1}
                live={song.slug === activeSlug}
                onApply={onApply}
                onEdit={onEdit}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

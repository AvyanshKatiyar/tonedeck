/**
 * ArtistSection — one artist header + a flex row of AlbumDeck tiles.
 * Threads expandedAlbum / activeSlug / onToggle / onApply / onEdit through to each deck.
 */
import type { ArtistGroup } from '../library.js'
import { AlbumDeck } from './AlbumDeck.js'

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
    </section>
  )
}

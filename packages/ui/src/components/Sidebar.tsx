/**
 * Sidebar — Spotify-style "Your Library" rail. A Home/Search nav card on top,
 * then a scrollable list of album rows built from the same artist→album groups
 * the main grid uses. Clicking a row applies that album's preset (goes live);
 * the row tied to the active preset is highlighted green. The "+" opens the
 * add-album modal. Filter chips are presentational (All is the resting state).
 */
import { api } from '../api.js'
import type { ArtistGroup, AlbumDeck } from '../library.js'
import { AlbumArt } from './FallbackArt.js'

/** Best slug to apply for a deck: the album preset, else its first song. */
function primarySlug(deck: AlbumDeck): string | null {
  return deck.albumSlug ?? deck.songs[0]?.slug ?? null
}

function deckIsLive(deck: AlbumDeck, activeSlug: string | null): boolean {
  if (!activeSlug) return false
  return (
    deck.albumSlug === activeSlug ||
    deck.songs.some((s) => s.slug === activeSlug)
  )
}

export function Sidebar({
  groups,
  activeSlug,
  onApply,
  onEdit,
  onAdd,
}: {
  groups: ArtistGroup[]
  activeSlug: string | null
  onApply: (slug: string) => void
  onEdit: (slug: string) => void
  onAdd: () => void
}) {
  // Flatten groups to album rows, carrying the artist for the subtitle.
  const rows = groups.flatMap((g) =>
    g.albums.map((deck) => ({ deck, artist: g.artist })),
  )

  return (
    <nav className="sidebar" aria-label="Your library">
      <div className="sb-nav">
        <button type="button" className="sb-nav__item sb-nav__item--active">
          <svg className="sb-nav__ico" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M12 3.3 2 11.2v9.5h6.5v-6h7v6H22v-9.5L12 3.3Z" />
          </svg>
          Home
        </button>
        <button type="button" className="sb-nav__item">
          <svg className="sb-nav__ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" strokeLinecap="round" />
          </svg>
          Search
        </button>
      </div>

      <div className="sb-lib">
        <div className="sb-lib__head">
          <button type="button" className="sb-lib__title">
            <svg className="sb-nav__ico" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M3 22V2h2v20H3Zm4 0V2h2v20H7Zm5.7-.3L17 6.2l1.9.5-4.3 15.5-1.9-.5Z" />
            </svg>
            Your Library
          </button>
          <button type="button" className="sb-lib__add" onClick={onAdd} title="Add music" aria-label="Add music">
            +
          </button>
        </div>

        <div className="sb-lib__chips">
          <button type="button" className="sb-chip sb-chip--on">Albums</button>
          <button type="button" className="sb-chip">Artists</button>
          <button type="button" className="sb-chip">Songs</button>
        </div>

        <div className="sb-lib__scroll">
          {rows.length === 0 && (
            <div className="sb-lib__empty">
              Your tuned library is empty. Tap + to add an album.
            </div>
          )}
          {rows.map(({ deck, artist }) => {
            const slug = primarySlug(deck)
            const live = deckIsLive(deck, activeSlug)
            const artSlug = deck.albumSlug ?? deck.songs[0]?.slug ?? deck.album
            const count = deck.songs.length + (deck.albumPreset ? 1 : 0)
            return (
              <button
                type="button"
                key={`${artist}::${deck.album}`}
                className={`sb-row${live ? ' sb-row--active' : ''}`}
                onClick={() => slug && onApply(slug)}
                onDoubleClick={() => slug && onEdit(slug)}
                title={`${deck.album} — ${artist}`}
              >
                <div className="sb-row__art">
                  <AlbumArt slug={artSlug} title={deck.album} src={api.artworkUrl(artSlug)} fontSize={16} />
                </div>
                <div className="sb-row__meta">
                  <div className="sb-row__title">{deck.album}</div>
                  <div className="sb-row__sub">
                    {live && <span className="sb-row__live">● Playing</span>}
                    {!live && <span>Album · {artist}</span>}
                    {!live && <span aria-hidden>·</span>}
                    {!live && <span>{count} {count === 1 ? 'tune' : 'tunes'}</span>}
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      </div>
    </nav>
  )
}

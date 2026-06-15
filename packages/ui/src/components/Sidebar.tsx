/**
 * Sidebar — Spotify-style "Your Library" rail. A Home/Search nav card on top,
 * then filter chips (Albums / Artists / Songs) that actually re-shape the list,
 * and a scrollable list of rows. Clicking a row applies that preset (goes live);
 * the active one is highlighted. The "+" opens the add-album modal. Every row's
 * cover falls back to a deterministic tile when artwork is missing.
 */
import { useRef, useState, type ReactNode } from 'react'
import { api } from '../api.js'
import type { ArtistGroup, AlbumDeck } from '../library.js'
import type { PresetSummary } from '../types.js'
import { AlbumArt } from './FallbackArt.js'

type Filter = 'albums' | 'artists' | 'songs'

/** Best slug to apply for a deck: the album preset, else its first song. */
function primarySlug(deck: AlbumDeck): string | null {
  return deck.albumSlug ?? deck.songs[0]?.slug ?? null
}
function deckIsLive(deck: AlbumDeck, activeSlug: string | null): boolean {
  if (!activeSlug) return false
  return deck.albumSlug === activeSlug || deck.songs.some((s) => s.slug === activeSlug)
}

export function Sidebar({
  groups,
  activeSlug,
  onApply,
  onEdit,
  onAdd,
  onSearch,
}: {
  groups: ArtistGroup[]
  activeSlug: string | null
  onApply: (slug: string) => void
  onEdit: (slug: string) => void
  onAdd: () => void
  onSearch: () => void
}) {
  const [filter, setFilter] = useState<Filter>('albums')
  const scrollRef = useRef<HTMLDivElement>(null)

  const toTop = () => scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  const goHome = () => {
    setFilter('albums')
    toTop()
  }

  // ── Build the rows for the active filter ──────────────────────────────────
  const albumRows = groups.flatMap((g) => g.albums.map((deck) => ({ deck, artist: g.artist })))
  const songRows: { song: PresetSummary; artist: string }[] = groups.flatMap((g) =>
    g.albums.flatMap((deck) =>
      [...(deck.albumPreset ? [deck.albumPreset] : []), ...deck.songs].map((song) => ({
        song,
        artist: g.artist,
      })),
    ),
  )

  let body: ReactNode
  if (filter === 'songs') {
    body =
      songRows.length === 0 ? (
        <Empty />
      ) : (
        <>
          {songRows.map(({ song, artist }) => (
            <button
              type="button"
              key={song.slug}
              className={`sb-row${song.slug === activeSlug ? ' sb-row--active' : ''}`}
              onClick={() => onApply(song.slug)}
              onDoubleClick={() => onEdit(song.slug)}
              title={`${song.title} — ${artist}`}
            >
              <div className="sb-row__art">
                <AlbumArt slug={song.slug} title={song.title} src={api.artworkUrl(song.slug)} fontSize={14} />
              </div>
              <div className="sb-row__meta">
                <div className="sb-row__title">{song.title}</div>
                <div className="sb-row__sub">
                  {song.slug === activeSlug ? (
                    <span className="sb-row__live">● Playing</span>
                  ) : (
                    <span>{song.kind === 'album' ? 'Album EQ' : 'Song'} · {artist}</span>
                  )}
                </div>
              </div>
            </button>
          ))}
        </>
      )
  } else if (filter === 'artists') {
    body =
      groups.length === 0 ? (
        <Empty />
      ) : (
        <>
          {groups.map((g) => {
            const first = g.albums[0]
            const artSlug = first?.albumSlug ?? first?.songs[0]?.slug ?? g.artist
            const slug = first ? primarySlug(first) : null
            const live = g.albums.some((d) => deckIsLive(d, activeSlug))
            return (
              <button
                type="button"
                key={g.artist}
                className={`sb-row sb-row--artist${live ? ' sb-row--active' : ''}`}
                onClick={() => slug && onApply(slug)}
                title={g.artist}
              >
                <div className="sb-row__art">
                  <AlbumArt slug={artSlug} title={g.artist} src={api.artworkUrl(artSlug)} fontSize={14} />
                </div>
                <div className="sb-row__meta">
                  <div className="sb-row__title">{g.artist}</div>
                  <div className="sb-row__sub">
                    {live ? <span className="sb-row__live">● Playing</span> : (
                      <span>Artist · {g.albums.length} {g.albums.length === 1 ? 'album' : 'albums'}</span>
                    )}
                  </div>
                </div>
              </button>
            )
          })}
        </>
      )
  } else {
    body =
      albumRows.length === 0 ? (
        <Empty />
      ) : (
        <>
          {albumRows.map(({ deck, artist }) => {
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
                    {live ? (
                      <span className="sb-row__live">● Playing</span>
                    ) : (
                      <span>Album · {artist} · {count} {count === 1 ? 'tune' : 'tunes'}</span>
                    )}
                  </div>
                </div>
              </button>
            )
          })}
        </>
      )
  }

  return (
    <nav className="sidebar" aria-label="Your library">
      <div className="sb-nav">
        <button type="button" className="sb-nav__item sb-nav__item--active" onClick={goHome}>
          <svg className="sb-nav__ico" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M12 3.3 2 11.2v9.5h6.5v-6h7v6H22v-9.5L12 3.3Z" />
          </svg>
          Home
        </button>
        <button type="button" className="sb-nav__item" onClick={onSearch}>
          <svg className="sb-nav__ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" strokeLinecap="round" />
          </svg>
          Search
        </button>
      </div>

      <div className="sb-lib">
        <div className="sb-lib__head">
          <button type="button" className="sb-lib__title" onClick={toTop}>
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
          {(['albums', 'artists', 'songs'] as Filter[]).map((f) => (
            <button
              type="button"
              key={f}
              className={`sb-chip${filter === f ? ' sb-chip--on' : ''}`}
              onClick={() => {
                setFilter(f)
                toTop()
              }}
            >
              {f[0].toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>

        <div className="sb-lib__scroll" ref={scrollRef}>
          {body}
        </div>
      </div>
    </nav>
  )
}

function Empty() {
  return <div className="sb-lib__empty">Your tuned library is empty. Tap + to add an album.</div>
}

/**
 * library.ts — pure organization logic for the preset grid: text search,
 * kind filtering, and section grouping. Kept free of React so it unit-tests
 * without a DOM.
 */
import type { PresetSummary } from './types.js'

export type KindFilter = 'all' | 'album' | 'track' | 'other'

export interface LibrarySection {
  /** Header label; null = render without a header (single-section views). */
  title: string | null
  presets: PresetSummary[]
}

const OTHER_KINDS = new Set(['genre', 'mood'])

function matches(p: PresetSummary, q: string): boolean {
  if (!q) return true
  const needle = q.toLowerCase()
  return (
    p.title.toLowerCase().includes(needle) ||
    (p.artist ?? '').toLowerCase().includes(needle)
  )
}

function ofKind(p: PresetSummary, kind: KindFilter): boolean {
  if (kind === 'all') return true
  if (kind === 'other') return OTHER_KINDS.has(p.kind)
  return p.kind === kind
}

/** Counts per filter chip; `other` only counts genre/mood presets. */
export function kindCounts(presets: PresetSummary[]): Record<KindFilter, number> {
  return {
    all: presets.length,
    album: presets.filter((p) => p.kind === 'album').length,
    track: presets.filter((p) => p.kind === 'track').length,
    other: presets.filter((p) => OTHER_KINDS.has(p.kind)).length,
  }
}

export interface AlbumDeck {
  album: string
  albumSlug: string | null
  albumPreset?: PresetSummary
  artwork?: PresetSummary['artwork']
  songs: PresetSummary[]
}

export interface ArtistGroup {
  artist: string
  albums: AlbumDeck[]
}

/** Group presets into artist -> album-deck -> song. Album presets define a
 *  deck; track presets slot in by their `album` field. Genre/mood and
 *  album-less tracks fall back to a deck named by their title. */
export function groupByArtist(presets: PresetSummary[], query: string): ArtistGroup[] {
  const q = query.toLowerCase().trim()
  const hit = (p: PresetSummary) =>
    !q || [p.title, p.artist, p.album].some((v) => (v ?? '').toLowerCase().includes(q))
  const byArtist = new Map<string, Map<string, AlbumDeck>>()
  for (const p of presets) {
    if (!hit(p)) continue
    const artist = p.artist?.trim() || 'Unknown Artist'
    const albumName = (p.kind === 'album' ? p.title : p.album?.trim()) || p.title
    const albums = byArtist.get(artist) ?? new Map<string, AlbumDeck>()
    byArtist.set(artist, albums)
    const deck = albums.get(albumName) ?? { album: albumName, albumSlug: null, songs: [] }
    if (p.kind === 'album') {
      deck.albumPreset = p
      deck.albumSlug = p.slug
      // album art is authoritative when present, but don't erase track-sourced art
      deck.artwork = p.artwork ?? deck.artwork
    } else {
      deck.songs.push(p)
      if (!deck.artwork) deck.artwork = p.artwork
    }
    albums.set(albumName, deck)
  }
  return [...byArtist.entries()]
    .map(([artist, albums]) => ({
      artist,
      albums: [...albums.values()].sort((a, b) => a.album.localeCompare(b.album)),
    }))
    .sort((a, b) => a.artist.localeCompare(b.artist))
}

/**
 * Filter by query + kind, then group. The "all" view groups into
 * Albums / Songs / Genres & moods sections (empty sections omitted; a lone
 * non-empty section drops its header). Filtered views are one headerless
 * section. Order within sections is preserved from the input (title-sorted
 * by the daemon).
 */
export function organizeLibrary(
  presets: PresetSummary[],
  query: string,
  kind: KindFilter,
): LibrarySection[] {
  const visible = presets.filter((p) => matches(p, query) && ofKind(p, kind))

  if (kind !== 'all') return visible.length ? [{ title: null, presets: visible }] : []

  const sections: LibrarySection[] = [
    { title: 'Albums', presets: visible.filter((p) => p.kind === 'album') },
    { title: 'Songs', presets: visible.filter((p) => p.kind === 'track') },
    { title: 'Genres & moods', presets: visible.filter((p) => OTHER_KINDS.has(p.kind)) },
  ].filter((s) => s.presets.length > 0)

  if (sections.length === 1) sections[0] = { ...sections[0], title: null }
  return sections
}

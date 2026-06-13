import { describe, expect, it } from 'vitest'
import { kindCounts, organizeLibrary, groupByArtist } from '../src/library.js'
import type { PresetSummary } from '../src/types.js'

function p(slug: string, kind: string, title: string, artist = 'Kanye West'): PresetSummary {
  return { slug, kind, title, artist, intent: '', version: 1, profile: 'ft1pro', updatedAt: '' } as PresetSummary
}

const LIB = [
  p('donda', 'album', 'Donda'),
  p('mbdtf', 'album', 'My Beautiful Dark Twisted Fantasy'),
  p('track-runaway', 'track', 'Runaway'),
  p('mood-late-night', 'mood', 'Late Night'),
]

describe('organizeLibrary', () => {
  it('groups the all-view into ordered sections, omitting empty ones', () => {
    const sections = organizeLibrary(LIB, '', 'all')
    expect(sections.map((s) => s.title)).toEqual(['Albums', 'Songs', 'Genres & moods'])
    expect(sections[0].presets.map((x) => x.slug)).toEqual(['donda', 'mbdtf'])
    expect(sections[1].presets.map((x) => x.slug)).toEqual(['track-runaway'])
  })

  it('drops the header when only one section survives', () => {
    const albumsOnly = [p('donda', 'album', 'Donda')]
    expect(organizeLibrary(albumsOnly, '', 'all')).toEqual([
      { title: null, presets: albumsOnly },
    ])
  })

  it('kind filters return a single headerless section', () => {
    const sections = organizeLibrary(LIB, '', 'track')
    expect(sections).toHaveLength(1)
    expect(sections[0].title).toBeNull()
    expect(sections[0].presets.map((x) => x.slug)).toEqual(['track-runaway'])
  })

  it('query matches title or artist, case-insensitive', () => {
    expect(organizeLibrary(LIB, 'twisted', 'all')[0].presets[0].slug).toBe('mbdtf')
    expect(organizeLibrary(LIB, 'KANYE', 'album')[0].presets).toHaveLength(2)
    expect(organizeLibrary(LIB, 'no-such-thing', 'all')).toEqual([])
  })

  it('kindCounts counts per chip', () => {
    expect(kindCounts(LIB)).toEqual({ all: 4, album: 2, track: 1, other: 1 })
  })
})

const P = (o: Partial<any>) => ({ slug: o.slug, kind: o.kind ?? 'track', title: o.title, artist: o.artist, album: o.album, intent: '', version: 1, profile: 'ft1', updatedAt: '2026-06-13T00:00:00Z', ...o })

describe('groupByArtist', () => {
  const presets = [
    P({ slug: 'nas-illmatic', kind: 'album', title: 'Illmatic', artist: 'Nas' }),
    P({ slug: 'nas-ny-state', kind: 'track', title: 'NY State', artist: 'Nas', album: 'Illmatic' }),
    P({ slug: 'ye-mbdtf', kind: 'album', title: 'MBDTF', artist: 'Kanye West' }),
  ]
  it('groups artists, then album decks with songs nested', () => {
    const groups = groupByArtist(presets, '')
    expect(groups.map((g) => g.artist)).toEqual(['Kanye West', 'Nas'])
    const nas = groups.find((g) => g.artist === 'Nas')!
    const illmatic = nas.albums.find((a) => a.album === 'Illmatic')!
    expect(illmatic.albumPreset?.slug).toBe('nas-illmatic')
    expect(illmatic.songs.map((s) => s.slug)).toEqual(['nas-ny-state'])
  })
  it('search filters across artist/album/title', () => {
    expect(groupByArtist(presets, 'mbdtf').map((g) => g.artist)).toEqual(['Kanye West'])
  })
  it('buckets missing artist under Unknown Artist', () => {
    expect(groupByArtist([P({ slug: 's', title: 'x' })], '')[0].artist).toBe('Unknown Artist')
  })
})

import { describe, it, expect } from 'vitest'
import {
  CatalogEntrySchema,
  catalogKey,
  mergeCatalog,
  parseItunesSongs,
  parseAppleLoved,
  parseYtMusicRows,
  type CatalogEntry,
} from '../src/catalog.js'

const entry = (o: Partial<CatalogEntry>): CatalogEntry =>
  CatalogEntrySchema.parse({ title: 'X', artist: 'Y', source: 'itunes', ...o })

describe('catalogKey', () => {
  it('is stable across case/punctuation/feature noise in artist+title', () => {
    expect(catalogKey('Kanye West', 'Black Skinhead')).toBe(catalogKey('kanye west', 'black skinhead'))
  })
})

describe('mergeCatalog', () => {
  it('dedupes by (artist,title), first-seen wins', () => {
    const a = [entry({ title: 'Stronger', artist: 'Kanye West', source: 'itunes', album: 'Graduation' })]
    const b = [
      entry({ title: 'stronger', artist: 'kanye west', source: 'apple-liked' }), // dup
      entry({ title: 'Flashing Lights', artist: 'Kanye West', source: 'apple-liked' }), // new
    ]
    const merged = mergeCatalog(a, b)
    expect(merged).toHaveLength(2)
    const stronger = merged.find((e) => catalogKey(e.artist, e.title) === catalogKey('Kanye West', 'Stronger'))!
    expect(stronger.source).toBe('itunes') // first-seen kept
    expect(stronger.album).toBe('Graduation')
  })
})

describe('parseItunesSongs', () => {
  it('keeps primary-artist songs and drops features + non-songs', () => {
    const results = [
      { wrapperType: 'track', kind: 'song', artistId: 2715720, artistName: 'Kanye West', trackName: 'Power', collectionName: 'MBDTF', trackId: 1 },
      { wrapperType: 'track', kind: 'song', artistId: 999, artistName: 'Estelle', trackName: 'American Boy (feat. Kanye West)', trackId: 2 },
      { wrapperType: 'collection', kind: 'album', artistId: 2715720, collectionName: 'MBDTF' },
    ]
    const out = parseItunesSongs(results, 2715720)
    expect(out).toEqual([
      { title: 'Power', artist: 'Kanye West', album: 'MBDTF', source: 'itunes', externalId: '1' },
    ])
  })
  it('returns [] for non-array input', () => {
    expect(parseItunesSongs(null, 2715720)).toEqual([])
  })
})

describe('parseAppleLoved', () => {
  it('parses tab-separated title/artist/album lines, skips blanks', () => {
    const raw = 'Power\tKanye West\tMBDTF\n\nSpace Song\tBeach House\tDepression Cherry\n'
    expect(parseAppleLoved(raw)).toEqual([
      { title: 'Power', artist: 'Kanye West', album: 'MBDTF', source: 'apple-liked' },
      { title: 'Space Song', artist: 'Beach House', album: 'Depression Cherry', source: 'apple-liked' },
    ])
  })
})

describe('parseYtMusicRows', () => {
  it('keeps rows with both title and artist', () => {
    const rows = [
      { title: 'Runaway', artist: 'Kanye West', album: 'MBDTF' },
      { title: 'No Artist', artist: '' },
    ]
    expect(parseYtMusicRows(rows)).toEqual([
      { title: 'Runaway', artist: 'Kanye West', album: 'MBDTF', source: 'ytmusic-liked' },
    ])
  })
})

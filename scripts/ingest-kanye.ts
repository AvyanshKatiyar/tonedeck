#!/usr/bin/env tsx
/**
 * Ingest Kanye West's discography into the catalog via the iTunes API.
 * Walks his albums (entity=album), then each album's songs (entity=song), and
 * keeps only primary-artist songs. No login. Run: npm run ingest:kanye
 */
import { parseItunesSongs, type CatalogEntry } from '@tonedeck/shared'
import { addToCatalog } from './lib/catalog-io.js'

const ARTIST_ID = 2715720 // Kanye West (verified 2026-06-16)

async function lookup(params: string): Promise<{ results: unknown[] }> {
  const res = await fetch(`https://itunes.apple.com/lookup?${params}`)
  if (!res.ok) throw new Error(`iTunes ${res.status} for ${params}`)
  return (await res.json()) as { results: unknown[] }
}

async function main(): Promise<void> {
  // 1) all albums for the artist
  const albumsResp = await lookup(`id=${ARTIST_ID}&entity=album&limit=200`)
  const collectionIds = albumsResp.results
    .filter((r) => (r as Record<string, unknown>).wrapperType === 'collection')
    .map((r) => Number((r as Record<string, unknown>).collectionId))
    .filter((n) => Number.isFinite(n))
  console.log(`found ${collectionIds.length} albums`)

  // 2) songs per album, primary-artist only
  const all: CatalogEntry[] = []
  for (const cid of collectionIds) {
    try {
      const songsResp = await lookup(`id=${cid}&entity=song&limit=200`)
      all.push(...parseItunesSongs(songsResp.results, ARTIST_ID))
    } catch (e) {
      console.warn(`  skip album ${cid}: ${(e as Error).message}`)
    }
    await new Promise((r) => setTimeout(r, 200)) // be polite to the API
  }

  const merged = await addToCatalog(all)
  console.log(`ingested ${all.length} Kanye song rows; catalog now ${merged.length} entries`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

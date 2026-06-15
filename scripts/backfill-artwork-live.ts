#!/usr/bin/env tsx
/**
 * scripts/backfill-artwork-live.ts
 *
 * Backfill iTunes artwork into the LIVE preset store (~/.tonedeck/presets), not
 * the repo builtins. The daemon serves presets from there, and its artwork route
 * serves any cached file at ~/.tonedeck/artwork/<slug>.jpg before checking a
 * preset's url — so caching the image is what actually makes covers load.
 *
 * For each live preset missing `artwork.url`:
 *   1. Search iTunes — entity=song for tracks, entity=album otherwise.
 *   2. Pick a credible match (see pickBest). Albums are conservative (no wrong
 *      album for iTunes-absent records like Yeezus / Vultures 1 / Donda 2);
 *      tracks fall back to the top same-artist single.
 *   3. Write artwork:{ itunesCollectionId, url } into the live JSON.
 *   4. Download + cache to ~/.tonedeck/artwork/<slug>.jpg.
 *
 * Calls are spaced ≥3 s apart for iTunes' ~20/min limit. Re-running is a no-op
 * for presets that already have artwork. Pass --dry to preview without writing.
 */
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { Artwork, type ArtworkResult } from '../packages/daemon/src/artwork.js'

const PRESETS_DIR = join(homedir(), '.tonedeck', 'presets')
const ARTWORK_CACHE_DIR = join(homedir(), '.tonedeck', 'artwork')
const DRY = process.argv.includes('--dry')

const art = new Artwork({ cacheDir: ARTWORK_CACHE_DIR })

interface LivePreset {
  slug: string
  kind?: string
  title: string
  artist?: string
  album?: string
  artwork?: { itunesCollectionId?: number; url?: string }
  [k: string]: unknown
}

/** Strip combining diacritics so "Måneskin" matches "Maneskin", "Beyoncé" "Beyonce". */
const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const norm = (s?: string) => fold((s ?? '').toLowerCase()).trim()
/** Drop "(feat …)", " - EP/Single/Remix…" tails so titles compare cleanly. */
const clean = (s?: string) =>
  norm(s)
    .replace(/\s*[([]?feat\.?[^)\]]*[)\]]?.*$/, '')
    .replace(/\s*-\s*(ep|single|remix|mixed|version|edit)\b.*$/, '')
    .trim()
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Pick a credible iTunes result.
 *   albums → exact name, or an album whose name CONTAINS the full title. No
 *            looser fallback — so iTunes-absent records (Yeezus, Vultures 1,
 *            Donda 2) stay artwork-less rather than borrowing the wrong cover.
 *   songs  → exact trackName, or substring either way, or (last resort) a
 *            same-artist track containing every title word.
 */
function pickBest(
  preset: LivePreset,
  results: ArtworkResult[],
  entity: 'song' | 'album',
): ArtworkResult | undefined {
  if (results.length === 0) return undefined
  const title = clean(preset.title)
  const artist = norm(preset.artist)
  const artistOk = (r: ArtworkResult) =>
    !artist || norm(r.artistName).includes(artist) || artist.includes(norm(r.artistName))

  if (entity === 'album') {
    const name = (r: ArtworkResult) => clean(r.collectionName)
    return (
      results.find((r) => artistOk(r) && name(r) === title) ??
      results.find((r) => artistOk(r) && name(r).includes(title))
    )
  }

  const name = (r: ArtworkResult) => clean(r.trackName ?? r.collectionName)
  const titleWords = title.split(/\s+/).filter((w) => w.length > 3)
  return (
    results.find((r) => artistOk(r) && name(r) === title) ??
    results.find((r) => artistOk(r) && (name(r).includes(title) || title.includes(name(r)))) ??
    (titleWords.length > 0
      ? results.find((r) => artistOk(r) && titleWords.every((w) => name(r).includes(w)))
      : undefined)
  )
}

async function run() {
  const files = (await fs.readdir(PRESETS_DIR)).filter((f) => f.endsWith('.json')).sort()
  const rows: { slug: string; status: string; detail: string }[] = []
  let firstCall = true

  for (const file of files) {
    const path = join(PRESETS_DIR, file)
    const preset = JSON.parse(await fs.readFile(path, 'utf-8')) as LivePreset
    if (preset.artwork?.url) {
      // Ensure it's cached even if the url already exists.
      if (!art.cachedPath(preset.slug)) {
        try {
          await art.ensureCached(preset.slug, preset.artwork.url)
        } catch {
          /* non-fatal */
        }
      }
      rows.push({ slug: preset.slug, status: 'have', detail: 'already had artwork' })
      continue
    }

    if (!firstCall) await sleep(3100)
    firstCall = false

    const entity: 'song' | 'album' = preset.kind === 'track' ? 'song' : 'album'
    const term = [preset.artist, preset.title].filter(Boolean).join(' ')
    process.stdout.write(`  ${entity.padEnd(5)} "${term}" … `)

    let results: ArtworkResult[]
    try {
      results = await art.search(term, entity)
    } catch (e) {
      process.stdout.write('ERROR\n')
      rows.push({ slug: preset.slug, status: 'error', detail: (e as Error).message })
      continue
    }

    const match = pickBest(preset, results, entity)
    if (!match) {
      process.stdout.write('no match\n')
      rows.push({ slug: preset.slug, status: 'no-match', detail: `${results.length} results, none credible` })
      continue
    }
    const label = match.trackName ? `${match.trackName} — ${match.collectionName}` : match.collectionName
    process.stdout.write(`→ ${label}\n`)

    if (!DRY) {
      const updated: LivePreset = {
        ...preset,
        artwork: { itunesCollectionId: match.collectionId, url: match.artworkUrl600 },
      }
      await fs.writeFile(path, JSON.stringify(updated, null, 2) + '\n', 'utf-8')
      try {
        await art.ensureCached(preset.slug, match.artworkUrl600)
      } catch {
        /* url saved; cache can fill later via the route */
      }
    }
    rows.push({ slug: preset.slug, status: DRY ? 'would-match' : 'matched', detail: label })
  }

  const by = (s: string) => rows.filter((r) => r.status === s).length
  console.log('\nSummary:')
  console.log(`  matched:   ${by('matched') + by('would-match')}`)
  console.log(`  had:       ${by('have')}`)
  console.log(`  no-match:  ${by('no-match')}`)
  console.log(`  error:     ${by('error')}`)
  const nm = rows.filter((r) => r.status === 'no-match')
  if (nm.length) console.log(`  unmatched slugs: ${nm.map((r) => r.slug).join(', ')}`)
}

run().catch((e) => {
  console.error('Backfill failed:', e)
  process.exit(1)
})

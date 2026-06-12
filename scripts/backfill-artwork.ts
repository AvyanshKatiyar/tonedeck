#!/usr/bin/env tsx
/**
 * scripts/backfill-artwork.ts
 *
 * For each builtin preset missing an `artwork` field:
 *   1. Search iTunes (term = "<artist> <title>").
 *   2. Pick the best match (exact collectionName first, else first result).
 *   3. Write `artwork: { itunesCollectionId, url }` back into the builtin JSON.
 *   4. Download and cache the artwork to ~/.tonedeck/artwork/<slug>.jpg.
 *
 * Requests are spaced ≥3 s apart to stay within iTunes 20/min rate limit.
 * Re-running is a no-op: presets with artwork are skipped and cache hits are
 * served from disk.
 *
 * If "Bully" is absent from iTunes (2025 release), that preset is left
 * artwork-less and noted in the report.
 */

import { promises as fs } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { Artwork, type ArtworkResult } from '../packages/daemon/src/artwork.js'

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))
const BUILTIN_DIR = join(REPO_ROOT, 'presets', 'builtin')
const ARTWORK_CACHE_DIR = join(homedir(), '.tonedeck', 'artwork')

const art = new Artwork({ cacheDir: ARTWORK_CACHE_DIR })

interface BuiltinPreset {
  slug: string
  title: string
  artist?: string
  artwork?: { itunesCollectionId?: number; url?: string }
  [k: string]: unknown
}

interface RowResult {
  slug: string
  status: 'skipped' | 'matched' | 'no-results' | 'error'
  collectionName?: string
  cachedFile?: string
  cachedBytes?: number
  note?: string
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

/**
 * Pick the best iTunes result for a preset title.
 *
 * Strategy:
 *   1. Exact case-insensitive collectionName match.
 *   2. collectionName contains the title as a substring (e.g. "BULLY - EP" ⊇ "Bully").
 *   3. Otherwise: no match — return undefined rather than silently writing a
 *      wrong album (Yeezus/Vultures 1/Donda 2 are absent from iTunes).
 */
function pickBest(title: string, results: ArtworkResult[]): ArtworkResult | undefined {
  if (results.length === 0) return undefined
  const t = title.toLowerCase()
  const exact = results.find((r) => r.collectionName.toLowerCase() === t)
  if (exact) return exact
  const contains = results.find((r) => r.collectionName.toLowerCase().includes(t))
  return contains ?? undefined
}

/** Parse `--only <slug>` from argv (restrict the run to a single preset). */
function parseOnly(): string | undefined {
  const i = process.argv.indexOf('--only')
  if (i !== -1 && process.argv[i + 1]) return process.argv[i + 1]
  return undefined
}

async function run() {
  const only = parseOnly()
  let files = (await fs.readdir(BUILTIN_DIR)).filter((f) => f.endsWith('.json')).sort()
  if (only) {
    files = files.filter((f) => f === `${only}.json`)
    if (files.length === 0) {
      console.error(`--only "${only}": no builtin preset ${only}.json`)
      process.exit(1)
    }
    console.log(`Restricting to --only ${only}`)
  }

  const rows: RowResult[] = []
  let firstRequest = true

  for (const file of files) {
    const filePath = join(BUILTIN_DIR, file)
    const raw = await fs.readFile(filePath, 'utf-8')
    const preset = JSON.parse(raw) as BuiltinPreset
    const { slug, title, artist } = preset

    // Already has artwork — check cache and skip search.
    if (preset.artwork?.url) {
      let cachedBytes: number | undefined
      const cachedFile = art.cachedPath(slug)
      if (cachedFile) {
        const stat = await fs.stat(cachedFile)
        cachedBytes = stat.size
      } else {
        // Cache miss — download now.
        try {
          const path = await art.ensureCached(slug, preset.artwork.url)
          const stat = await fs.stat(path)
          cachedBytes = stat.size
        } catch {
          cachedBytes = undefined
        }
      }
      rows.push({
        slug,
        status: 'skipped',
        collectionName: preset.artwork.itunesCollectionId
          ? `iTunes #${preset.artwork.itunesCollectionId}`
          : '(existing)',
        cachedFile: art.cachedPath(slug),
        cachedBytes,
        note: 'already has artwork',
      })
      continue
    }

    // Rate-limit: wait 3 s between actual iTunes calls.
    if (!firstRequest) await sleep(3100)
    firstRequest = false

    const term = artist ? `${artist} ${title}` : title
    process.stdout.write(`  Searching: ${term}…`)

    let results: ArtworkResult[]
    try {
      results = await art.search(term)
    } catch (e) {
      process.stdout.write(' ERROR\n')
      rows.push({ slug, status: 'error', note: (e as Error).message })
      continue
    }

    if (results.length === 0) {
      process.stdout.write(' no results\n')
      rows.push({ slug, status: 'no-results', note: 'iTunes returned 0 results' })
      continue
    }

    const match = pickBest(title, results)
    if (!match) {
      // iTunes returned results but none are a credible match for this title.
      // (e.g. Yeezus, Vultures 1, Donda 2 are absent from iTunes.)
      process.stdout.write(' no credible match (skipping)\n')
      rows.push({
        slug,
        status: 'no-results',
        note: `iTunes top result "${results[0].collectionName}" doesn't match "${title}" — leaving artwork-less`,
      })
      continue
    }
    process.stdout.write(` → "${match.collectionName}"\n`)

    // Persist artwork field into the builtin JSON.
    const updated: BuiltinPreset = {
      ...preset,
      artwork: {
        itunesCollectionId: match.collectionId,
        url: match.artworkUrl600,
      },
    }
    await fs.writeFile(filePath, JSON.stringify(updated, null, 2) + '\n', 'utf-8')

    // Cache the image.
    let cachedFile: string | undefined
    let cachedBytes: number | undefined
    try {
      cachedFile = await art.ensureCached(slug, match.artworkUrl600)
      const stat = await fs.stat(cachedFile)
      cachedBytes = stat.size
    } catch {
      // Non-fatal — the URL is saved; cache can be populated later.
    }

    rows.push({
      slug,
      status: 'matched',
      collectionName: match.collectionName,
      cachedFile,
      cachedBytes,
    })
  }

  // ── Print summary table ───────────────────────────────────────────────────

  console.log('\n')
  const COL = [20, 8, 38, 12, 30]
  const pad = (s: string, n: number) => s.slice(0, n).padEnd(n)
  const header = [
    pad('slug', COL[0]),
    pad('status', COL[1]),
    pad('collectionName', COL[2]),
    pad('bytes', COL[3]),
    pad('cachedFile', COL[4]),
  ].join('  ')
  console.log(header)
  console.log('-'.repeat(header.length))

  for (const r of rows) {
    const line = [
      pad(r.slug, COL[0]),
      pad(r.status, COL[1]),
      pad(r.collectionName ?? r.note ?? '—', COL[2]),
      pad(r.cachedBytes != null ? String(r.cachedBytes) : '—', COL[3]),
      pad(r.cachedFile ? r.cachedFile.replace(homedir(), '~') : '—', COL[4]),
    ].join('  ')
    console.log(line)
  }

  const matched = rows.filter((r) => r.status === 'matched').length
  const skipped = rows.filter((r) => r.status === 'skipped').length
  const noResults = rows.filter((r) => r.status === 'no-results')
  const errors = rows.filter((r) => r.status === 'error')

  console.log(`\nSummary: ${matched} matched, ${skipped} skipped (already had artwork), ` +
    `${noResults.length} no-results, ${errors.length} errors`)

  if (noResults.length > 0) {
    console.log(`No-results slugs: ${noResults.map((r) => r.slug).join(', ')}`)
    console.log('  → These presets remain artwork-less.')
  }
  if (errors.length > 0) {
    console.log(`Error slugs: ${errors.map((r) => `${r.slug} (${r.note})`).join(', ')}`)
  }
}

run().catch((e) => {
  console.error('Backfill failed:', e)
  process.exit(1)
})

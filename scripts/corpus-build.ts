#!/usr/bin/env tsx
/**
 * Generate an independent per-song EQ preset for every catalog song that
 * doesn't have one yet, storing via the running daemon. Resumable + bounded.
 * Run (daemon must be running): npm run corpus:build
 * Concurrency override: TONEDECK_CORPUS_CONCURRENCY=4 npm run corpus:build
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseProfile, slugify } from '@tonedeck/shared'
import { generateTrackEq } from '../packages/daemon/src/eqgen.js'
import { runCorpusBuild, type CorpusItem } from '../packages/daemon/src/corpus.js'
import { readCatalog } from './lib/catalog-io.js'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const BASE = process.env.TONEDECK_URL ?? `http://127.0.0.1:${process.env.TONEDECK_PORT ?? 5055}`
const CONCURRENCY = Number(process.env.TONEDECK_CORPUS_CONCURRENCY ?? 3)
// Optional cap for staged runs (e.g. TONEDECK_CORPUS_LIMIT=15 for a sample).
const LIMIT = Number(process.env.TONEDECK_CORPUS_LIMIT ?? 0)

const profile = parseProfile(JSON.parse(readFileSync(join(ROOT, 'profiles', 'ft1pro.json'), 'utf8')))

async function existingSlugs(): Promise<Set<string>> {
  const res = await fetch(`${BASE}/api/presets`)
  if (!res.ok) throw new Error(`daemon GET /api/presets → ${res.status} (is the daemon running?)`)
  const body = (await res.json()) as { presets: Array<{ slug: string }> }
  return new Set(body.presets.map((p) => p.slug))
}

async function savePreset(preset: unknown): Promise<void> {
  const res = await fetch(`${BASE}/api/presets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ preset, clamp: true }),
  })
  if (res.status === 409) return // already exists — treat as done
  if (!res.ok) throw new Error(`POST /api/presets → ${res.status}: ${await res.text()}`)
}

async function main(): Promise<void> {
  const catalog = await readCatalog()
  if (catalog.length === 0) {
    console.log('catalog is empty — run an ingest script first')
    return
  }
  let items: CorpusItem[] = catalog.map((e) => ({
    title: e.title,
    artist: e.artist,
    album: e.album,
    slug: slugify(e.artist, e.title),
  }))
  const existing = await existingSlugs()
  if (LIMIT > 0) {
    // Cap to the first LIMIT songs that still need generating (staged sample run).
    const pending = items.filter((it) => !existing.has(it.slug)).slice(0, LIMIT)
    items = pending
    console.log(`LIMIT=${LIMIT} → sampling ${pending.length} not-yet-generated songs`)
  }

  console.log(`corpus: ${items.length} songs, ${existing.size} presets already exist, concurrency ${CONCURRENCY}`)
  const result = await runCorpusBuild({
    items,
    existing,
    concurrency: CONCURRENCY,
    generate: (it) =>
      generateTrackEq({ title: it.title, artist: it.artist, album: it.album ?? null }, profile, { slug: it.slug }),
    save: (p) => savePreset(p),
    onProgress: (p) => {
      const tag = p.status === 'failed' ? `FAIL (${p.error})` : 'ok'
      console.log(`  [${p.done}/${p.total}] ${p.slug} — ${tag}`)
    },
  })
  console.log(`done: ${result.generated} generated, ${result.skipped} skipped, ${result.failed.length} failed`)
  if (result.failed.length) console.log('re-run to retry failures (resumable).')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

# EQ Corpus + Clustering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ingest a song corpus (Kanye discography + Apple Music & YouTube Music Liked songs), generate an independent per-song EQ preset for each, and cluster the presets by tone-only frequency-response shape — reporting the dB variance that splits each cluster — all driven from the `tonedeck` CLI.

**Architecture:** Pure logic (catalog model, clustering math, batch orchestration) lives in `packages/shared` and `packages/daemon` with full unit tests. Heavy IO (iTunes fetch, osascript, Playwright, the long generation batch) lives in `scripts/` as `tsx` npm-scripts that wire the tested pure functions to the real world — keeping Playwright and multi-hour batches out of the always-on daemon. The cluster *read* is a first-class `tonedeck clusters` CLI verb backed by a new daemon route.

**Tech Stack:** TypeScript (ESM, `"type":"module"`), zod, Fastify, commander, vitest, `playwright-core` (Brave as the chromium driver), the existing RBJ biquad math in `@tonedeck/shared`.

---

## File structure

**Create (pure, unit-tested):**
- `packages/shared/src/catalog.ts` — `CatalogEntry` schema + dedup/merge + source parsers
- `packages/shared/src/cluster.ts` — curve rendering, distance, agglomerative clustering
- `packages/daemon/src/corpus.ts` — `runCorpusBuild` (resumable, bounded-concurrency orchestration)
- `packages/daemon/src/routes/clusters.ts` — `GET /api/clusters`
- `packages/shared/test/catalog.test.ts`, `packages/shared/test/cluster.test.ts`
- `packages/daemon/test/corpus.test.ts`, `packages/daemon/test/routes-clusters.test.ts`
- `packages/cli/test/clusters.test.ts`

**Create (IO glue, verified by running — matches `migrate-kanye.ts` pattern):**
- `scripts/lib/catalog-io.ts` — read/write `~/.tonedeck/catalog.json`
- `scripts/ingest-kanye.ts`, `scripts/ingest-apple-liked.ts`, `scripts/ingest-ytmusic.ts`
- `scripts/corpus-build.ts`

**Modify:**
- `packages/shared/src/index.ts` — re-export `catalog.js` + `cluster.js`
- `packages/daemon/src/presets.ts` — add `allPresets()` accessor
- `packages/daemon/src/index.ts` — register `clustersPlugin`
- `packages/cli/src/commands.ts` — add `actionClusters`
- `packages/cli/src/format.ts` — add `fmtClusters`
- `packages/cli/src/index.ts` — wire `clusters` command
- `package.json` — add `ingest:*` + `corpus:build` npm scripts
- `README.md` — add a "Corpus & clustering" section

---

## Task 1: Catalog model — schema, dedup, merge

**Files:**
- Create: `packages/shared/src/catalog.ts`
- Test: `packages/shared/test/catalog.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/test/catalog.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/shared/test/catalog.test.ts`
Expected: FAIL — cannot resolve `../src/catalog.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/shared/src/catalog.ts
/**
 * Song catalog — the work-list for bulk EQ generation. Cheap + repeatable to
 * build (ingest); separate from presets, which are slow + resumable to create.
 * Entries are deduped by a normalized (artist, title) key.
 */
import { z } from 'zod'
import { slugify } from './slug.js'

export const CatalogSourceSchema = z.enum(['itunes', 'apple-liked', 'ytmusic-liked'])
export type CatalogSource = z.infer<typeof CatalogSourceSchema>

export const CatalogEntrySchema = z.object({
  title: z.string().min(1),
  artist: z.string().min(1),
  album: z.string().optional(),
  source: CatalogSourceSchema,
  externalId: z.string().optional(),
})
export type CatalogEntry = z.infer<typeof CatalogEntrySchema>

/** Stable identity key for dedup: normalized (artist, title). Reuses slugify so
 *  "Kanye West / Black Skinhead" and "kanye west / black skinhead" collapse. */
export function catalogKey(artist: string, title: string): string {
  return slugify(artist, title)
}

/** Merge incoming into existing, deduping by catalogKey. First-seen wins, so the
 *  ordering of ingest passes determines which source's metadata is kept. */
export function mergeCatalog(existing: CatalogEntry[], incoming: CatalogEntry[]): CatalogEntry[] {
  const byKey = new Map<string, CatalogEntry>()
  for (const e of existing) byKey.set(catalogKey(e.artist, e.title), e)
  for (const e of incoming) {
    const k = catalogKey(e.artist, e.title)
    if (!byKey.has(k)) byKey.set(k, e)
  }
  return Array.from(byKey.values())
}

/** iTunes lookup `results` → song entries, filtered to a primary artistId so
 *  guest features ("… (feat. Kanye West)") are dropped. */
export function parseItunesSongs(results: unknown, artistId: number): CatalogEntry[] {
  if (!Array.isArray(results)) return []
  const out: CatalogEntry[] = []
  for (const r of results as Array<Record<string, unknown>>) {
    if (r.wrapperType !== 'track' || r.kind !== 'song') continue
    if (Number(r.artistId) !== artistId) continue
    const title = String(r.trackName ?? '').trim()
    const artist = String(r.artistName ?? '').trim()
    if (!title || !artist) continue
    out.push({
      title,
      artist,
      album: r.collectionName ? String(r.collectionName) : undefined,
      source: 'itunes',
      externalId: r.trackId != null ? String(r.trackId) : undefined,
    })
  }
  return out
}

/** osascript output — one `title<TAB>artist<TAB>album` line per loved track. */
export function parseAppleLoved(raw: string): CatalogEntry[] {
  const out: CatalogEntry[] = []
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue
    const [title, artist, album] = line.split('\t')
    if (!title?.trim() || !artist?.trim()) continue
    out.push({
      title: title.trim(),
      artist: artist.trim(),
      album: album?.trim() || undefined,
      source: 'apple-liked',
    })
  }
  return out
}

/** Scraped YouTube Music rows → entries. */
export function parseYtMusicRows(
  rows: Array<{ title?: string; artist?: string; album?: string }>,
): CatalogEntry[] {
  const out: CatalogEntry[] = []
  for (const r of rows) {
    const title = (r.title ?? '').trim()
    const artist = (r.artist ?? '').trim()
    if (!title || !artist) continue
    out.push({ title, artist, album: r.album?.trim() || undefined, source: 'ytmusic-liked' })
  }
  return out
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/shared/test/catalog.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/catalog.ts packages/shared/test/catalog.test.ts
git commit -m "feat(shared): song catalog model — schema, dedup, merge"
```

---

## Task 2: Catalog source parsers (test the three parsers)

**Files:**
- Modify: `packages/shared/test/catalog.test.ts`

- [ ] **Step 1: Add failing parser tests**

```ts
// append to packages/shared/test/catalog.test.ts
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
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run packages/shared/test/catalog.test.ts`
Expected: PASS (parsers already implemented in Task 1).

- [ ] **Step 3: Commit**

```bash
git add packages/shared/test/catalog.test.ts
git commit -m "test(shared): cover catalog source parsers"
```

---

## Task 3: Cluster curve rendering + distance

**Files:**
- Create: `packages/shared/src/cluster.ts`
- Test: `packages/shared/test/cluster.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/test/cluster.test.ts
import { describe, it, expect } from 'vitest'
import { presetCurve, curveDistance, CLUSTER_FREQS } from '../src/cluster.js'
import type { Preset } from '../src/preset.js'

function preset(over: Partial<Preset>): Preset {
  return {
    schemaVersion: 1, slug: over.slug ?? 's', kind: 'track', title: over.title ?? 'T',
    profile: 'ft1pro', preamp: over.preamp ?? 0, bands: over.bands ?? [
      { id: 'b1', type: 'peaking', freq: 100, q: 1, gain: 3 },
    ],
    intent: 'x', provenance: { createdBy: 'user', history: [] },
    version: 1, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  } as Preset
}

describe('presetCurve', () => {
  it('is mean-normalized to ~0 (loudness removed)', () => {
    const c = presetCurve(preset({}))
    const mean = c.reduce((a, b) => a + b, 0) / c.length
    expect(Math.abs(mean)).toBeLessThan(1e-9)
    expect(c).toHaveLength(CLUSTER_FREQS.length)
  })
  it('ignores preamp (tone-only): same bands, different preamp → identical curve', () => {
    const a = presetCurve(preset({ preamp: 0 }))
    const b = presetCurve(preset({ preamp: -6 }))
    expect(curveDistance(a, b)).toBeLessThan(1e-9)
  })
})

describe('curveDistance', () => {
  it('is 0 for identical curves and >0 for different shapes', () => {
    const bass = preset({ bands: [{ id: 'b1', type: 'lowshelf', freq: 80, q: 0.7, gain: 5 }] })
    const treble = preset({ bands: [{ id: 'b1', type: 'highshelf', freq: 8000, q: 0.7, gain: 5 }] })
    expect(curveDistance(presetCurve(bass), presetCurve(bass))).toBe(0)
    expect(curveDistance(presetCurve(bass), presetCurve(treble))).toBeGreaterThan(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/shared/test/cluster.test.ts`
Expected: FAIL — cannot resolve `../src/cluster.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/shared/src/cluster.ts
/**
 * Tone-only EQ clustering. Each preset is rendered to its magnitude-response
 * curve (bands only — preamp excluded), mean-normalized so we compare SHAPE not
 * loudness. Distance is RMS dB between curves; clustering is agglomerative with a
 * dB threshold, so the merge/split distance is itself interpretable in dB.
 */
import { responseDb, logSpacedFreqs } from './biquad.js'
import type { Preset } from './preset.js'

/** 48 log-spaced probe frequencies, 20 Hz–20 kHz. */
export const CLUSTER_FREQS: number[] = logSpacedFreqs(48, 20, 20000)

/** Tone-only response curve: bands only (preamp=0), mean-normalized to 0 dB. */
export function presetCurve(preset: Preset, freqs: number[] = CLUSTER_FREQS): number[] {
  const raw = responseDb(preset.bands, 0, freqs)
  const mean = raw.reduce((a, b) => a + b, 0) / raw.length
  return raw.map((v) => v - mean)
}

/** RMS dB difference between two equal-length curves. */
export function curveDistance(a: number[], b: number[]): number {
  if (a.length !== b.length) throw new Error('curveDistance: length mismatch')
  let sum = 0
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i]
    sum += d * d
  }
  return Math.sqrt(sum / a.length)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/shared/test/cluster.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/cluster.ts packages/shared/test/cluster.test.ts
git commit -m "feat(shared): tone-only preset curve + RMS dB distance"
```

---

## Task 4: Agglomerative clustering + cluster description

**Files:**
- Modify: `packages/shared/src/cluster.ts`
- Modify: `packages/shared/test/cluster.test.ts`

- [ ] **Step 1: Add failing tests**

```ts
// append to packages/shared/test/cluster.test.ts
import { clusterPresets, describeCurve } from '../src/cluster.js'

describe('clusterPresets', () => {
  const bassA = preset({ slug: 'bass-a', bands: [{ id: 'b1', type: 'lowshelf', freq: 80, q: 0.7, gain: 5 }] })
  const bassB = preset({ slug: 'bass-b', bands: [{ id: 'b1', type: 'lowshelf', freq: 80, q: 0.7, gain: 5.2 }] })
  const treble = preset({ slug: 'treble', bands: [{ id: 'b1', type: 'highshelf', freq: 8000, q: 0.7, gain: 5 }] })

  it('groups near-identical shapes and separates a different one', () => {
    const r = clusterPresets([bassA, bassB, treble], { threshold: 1.5 })
    expect(r.clusters).toHaveLength(2)
    const big = r.clusters.find((c) => c.members.length === 2)!
    expect(big.members.map((m) => m.slug).sort()).toEqual(['bass-a', 'bass-b'])
  })

  it('reports the dB gap to the nearest other cluster (the splitting variance)', () => {
    const r = clusterPresets([bassA, treble], { threshold: 1.5 })
    expect(r.clusters).toHaveLength(2)
    expect(r.clusters[0].nearestDistanceDb).toBeGreaterThan(1.5)
  })

  it('handles empty input', () => {
    expect(clusterPresets([], {})).toEqual({ threshold: 1.5, clusters: [] })
  })
})

describe('describeCurve', () => {
  it('labels a bass-forward curve', () => {
    const c = presetCurve(preset({ bands: [{ id: 'b1', type: 'lowshelf', freq: 80, q: 0.7, gain: 6 }] }))
    expect(describeCurve(c, CLUSTER_FREQS)).toContain('bass-forward')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/shared/test/cluster.test.ts`
Expected: FAIL — `clusterPresets` / `describeCurve` not exported.

- [ ] **Step 3: Add the implementation**

```ts
// append to packages/shared/src/cluster.ts

export interface ClusterMember {
  slug: string
  title: string
  artist?: string
}

export interface Cluster {
  id: number
  members: ClusterMember[]
  /** Human label from the cluster centroid (e.g. "bass-forward, flat mids, tamed top"). */
  character: string
  /** Id of the nearest other cluster (stable id, not array position). */
  nearestClusterId: number | null
  /** RMS dB gap to that nearest cluster — the variance that keeps them separate. */
  nearestDistanceDb: number | null
}

export interface ClusterResult {
  threshold: number
  clusters: Cluster[]
}

function round1(x: number): number {
  return Math.round(x * 10) / 10
}

function centroid(curves: number[][]): number[] {
  const m = curves[0].length
  const out = new Array<number>(m).fill(0)
  for (const c of curves) for (let i = 0; i < m; i++) out[i] += c[i]
  return out.map((v) => v / curves.length)
}

/** Human label from a normalized curve: average dB in low/mid/high bands. */
export function describeCurve(curve: number[], freqs: number[]): string {
  const band = (lo: number, hi: number): number => {
    const vals = curve.filter((_, i) => freqs[i] >= lo && freqs[i] < hi)
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0
  }
  const low = band(20, 250)
  const mid = band(250, 4000)
  const high = band(4000, 20001)
  return [
    low > 0.5 ? 'bass-forward' : low < -0.5 ? 'lean bass' : 'neutral bass',
    mid > 0.5 ? 'forward mids' : mid < -0.5 ? 'scooped mids' : 'flat mids',
    high > 0.5 ? 'bright top' : high < -0.5 ? 'tamed top' : 'neutral top',
  ].join(', ')
}

/** Average-linkage agglomerative clustering, cut at an RMS-dB threshold. */
export function clusterPresets(
  presets: Preset[],
  opts: { threshold?: number; freqs?: number[] } = {},
): ClusterResult {
  const threshold = opts.threshold ?? 1.5
  const freqs = opts.freqs ?? CLUSTER_FREQS
  if (presets.length === 0) return { threshold, clusters: [] }

  const curves = presets.map((p) => presetCurve(p, freqs))
  let groups: number[][] = presets.map((_, i) => [i])

  const avgDist = (ga: number[], gb: number[]): number => {
    let s = 0
    let n = 0
    for (const i of ga) for (const j of gb) {
      s += curveDistance(curves[i], curves[j])
      n++
    }
    return n ? s / n : Infinity
  }

  // Merge the closest pair until the closest pair exceeds the threshold.
  for (;;) {
    let best = Infinity
    let bi = -1
    let bj = -1
    for (let i = 0; i < groups.length; i++)
      for (let j = i + 1; j < groups.length; j++) {
        const d = avgDist(groups[i], groups[j])
        if (d < best) {
          best = d
          bi = i
          bj = j
        }
      }
    if (bi < 0 || best > threshold) break
    groups[bi] = groups[bi].concat(groups[bj])
    groups.splice(bj, 1)
  }

  // Build clusters with STABLE ids (= final group index), then nearest-neighbor gaps.
  const built: Cluster[] = groups.map((members, id) => ({
    id,
    members: members.map((i) => ({
      slug: presets[i].slug,
      title: presets[i].title,
      artist: presets[i].artist,
    })),
    character: describeCurve(centroid(members.map((i) => curves[i])), freqs),
    nearestClusterId: null,
    nearestDistanceDb: null,
  }))
  for (let i = 0; i < groups.length; i++) {
    let best = Infinity
    let bj = -1
    for (let j = 0; j < groups.length; j++) {
      if (i === j) continue
      const d = avgDist(groups[i], groups[j])
      if (d < best) {
        best = d
        bj = j
      }
    }
    if (bj >= 0) {
      built[i].nearestClusterId = bj
      built[i].nearestDistanceDb = round1(best)
    }
  }

  // Display order: largest clusters first (ids stay stable for nearest refs).
  built.sort((a, b) => b.members.length - a.members.length)
  return { threshold, clusters: built }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/shared/test/cluster.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/cluster.ts packages/shared/test/cluster.test.ts
git commit -m "feat(shared): agglomerative clustering + centroid description"
```

---

## Task 5: Export catalog + cluster from shared index

**Files:**
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Add the re-exports**

Add these two lines after the existing `export * from './camillayaml.js'`:

```ts
export * from './catalog.js'
export * from './cluster.js'
```

- [ ] **Step 2: Verify the package still builds + all shared tests pass**

Run: `npm run build -w packages/shared && npx vitest run packages/shared`
Expected: build succeeds; all shared tests PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/index.ts
git commit -m "feat(shared): export catalog + cluster from package index"
```

---

## Task 6: `PresetStore.allPresets()` accessor

**Files:**
- Modify: `packages/daemon/src/presets.ts`
- Test: `packages/daemon/test/presets.test.ts`

- [ ] **Step 1: Add a failing test**

```ts
// append a test inside packages/daemon/test/presets.test.ts (reuse its existing
// store setup helpers; this asserts the new accessor returns full presets).
import { describe, it, expect } from 'vitest'
// (the file already imports PresetStore + builds a temp store; add:)
describe('allPresets', () => {
  it('returns full Preset objects with bands', async () => {
    // Assumes the file's existing `makeStore()`-style helper that seeds builtins.
    // If the helper differs, adapt the call to match the file's convention.
    const store = await makeStore()
    const all = store.allPresets()
    expect(all.length).toBeGreaterThan(0)
    expect(Array.isArray(all[0].bands)).toBe(true)
  })
})
```

> If `packages/daemon/test/presets.test.ts` has no `makeStore()` helper, mirror
> the construction already used at the top of that file (it builds a
> `new PresetStore({ presetsDir, profilesDir, builtinPresetsDir })` against temp
> dirs and calls `await store.init()`), then call `store.allPresets()`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/daemon/test/presets.test.ts`
Expected: FAIL — `store.allPresets is not a function`.

- [ ] **Step 3: Add the accessor**

In `packages/daemon/src/presets.ts`, add this method to `PresetStore` (right after `getPreset`):

```ts
  /** All full presets — for clustering and other bulk reads. */
  allPresets(): Preset[] {
    return Array.from(this.presets.values())
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/daemon/test/presets.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/daemon/src/presets.ts packages/daemon/test/presets.test.ts
git commit -m "feat(daemon): PresetStore.allPresets() for bulk reads"
```

---

## Task 7: `GET /api/clusters` route

**Files:**
- Create: `packages/daemon/src/routes/clusters.ts`
- Modify: `packages/daemon/src/index.ts`
- Test: `packages/daemon/test/routes-clusters.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/daemon/test/routes-clusters.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildServer } from '../src/index.js'

let server: Awaited<ReturnType<typeof buildServer>>

beforeAll(async () => {
  // lifecycle:false → no audio plane; uses the real builtin presets seeded into a temp dir.
  server = await buildServer({ lifecycle: false })
})
afterAll(async () => {
  await server.close()
})

describe('GET /api/clusters', () => {
  it('returns clusters over the seeded presets', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/clusters' })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { threshold: number; clusters: Array<{ members: unknown[] }> }
    expect(body.threshold).toBe(1.5)
    expect(Array.isArray(body.clusters)).toBe(true)
    expect(body.clusters.length).toBeGreaterThan(0)
  })

  it('honors the threshold query param', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/clusters?threshold=0.1' })
    const body = res.json() as { threshold: number }
    expect(body.threshold).toBe(0.1)
  })
})
```

> `buildServer({ lifecycle: false })` seeds the temp presets dir from
> `presets/builtin` (the store's `init()` copies builtins when the dir is empty).
> If the default `dataDir` (`~/.tonedeck`) is already populated on the dev
> machine, pass `paths: { presetsDir: <tmp> }` exactly as `control.test.ts` does
> to isolate the test.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/daemon/test/routes-clusters.test.ts`
Expected: FAIL — 404 (route not registered).

- [ ] **Step 3: Create the route**

```ts
// packages/daemon/src/routes/clusters.ts
/**
 * Fastify plugin — tone-only EQ clustering over all presets.
 *
 * Routes:
 *   GET /api/clusters?threshold=<db>  → ClusterResult
 */
import type { FastifyPluginAsync } from 'fastify'
import { clusterPresets } from '@tonedeck/shared'
import type { PresetStore } from '../presets.js'

export interface ClustersPluginOpts {
  store: PresetStore
}

const clustersPlugin: FastifyPluginAsync<ClustersPluginOpts> = async (fastify, { store }) => {
  fastify.get('/api/clusters', async (req) => {
    const q = req.query as { threshold?: string }
    const t = q.threshold != null ? Number(q.threshold) : undefined
    return clusterPresets(store.allPresets(), {
      threshold: t != null && Number.isFinite(t) ? t : undefined,
    })
  })
}

export default clustersPlugin
```

- [ ] **Step 4: Register it in the daemon**

In `packages/daemon/src/index.ts`, add the import beside the other route imports:

```ts
import clustersPlugin from './routes/clusters.js'
```

and register it right after the `presetsPlugin` registration:

```ts
  await server.register(clustersPlugin, { store })
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run packages/daemon/test/routes-clusters.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/daemon/src/routes/clusters.ts packages/daemon/src/index.ts packages/daemon/test/routes-clusters.test.ts
git commit -m "feat(daemon): GET /api/clusters route"
```

---

## Task 8: `tonedeck clusters` CLI command

**Files:**
- Modify: `packages/cli/src/format.ts`
- Modify: `packages/cli/src/commands.ts`
- Modify: `packages/cli/src/index.ts`
- Test: `packages/cli/test/clusters.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/cli/test/clusters.test.ts
import { describe, it, expect } from 'vitest'
import { actionClusters } from '../src/commands.js'
import { makeCtx, type FetchFn } from '../src/api.js'
import { fmtClusters } from '../src/format.js'

const RESULT = {
  threshold: 1.5,
  clusters: [
    { id: 0, members: [{ slug: 'a', title: 'A', artist: 'K' }, { slug: 'b', title: 'B', artist: 'K' }], character: 'bass-forward, flat mids, tamed top', nearestClusterId: 1, nearestDistanceDb: 2.4 },
    { id: 1, members: [{ slug: 'c', title: 'C', artist: 'K' }], character: 'lean bass, flat mids, bright top', nearestClusterId: 0, nearestDistanceDb: 2.4 },
  ],
}

describe('fmtClusters', () => {
  it('renders cluster size, character, and the dB gap', () => {
    const s = fmtClusters(RESULT as never)
    expect(s).toContain('2 clusters')
    expect(s).toContain('2 songs')
    expect(s).toContain('2.4 dB')
  })
})

describe('actionClusters', () => {
  it('GETs /api/clusters with the threshold and prints JSON when --json', async () => {
    let calledUrl = ''
    const fetchFn: FetchFn = async (url) => {
      calledUrl = url
      return new Response(JSON.stringify(RESULT), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    const logs: string[] = []
    const orig = console.log
    console.log = (m?: unknown) => { logs.push(String(m)) }
    try {
      await actionClusters(makeCtx('http://x', fetchFn), { json: true, threshold: 2 })
    } finally {
      console.log = orig
    }
    expect(calledUrl).toBe('http://x/api/clusters?threshold=2')
    expect(JSON.parse(logs[0]).clusters).toHaveLength(2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/cli/test/clusters.test.ts`
Expected: FAIL — `actionClusters` / `fmtClusters` not exported.

- [ ] **Step 3: Add `fmtClusters` to format.ts**

```ts
// packages/cli/src/format.ts — add near the other fmt* exports
import type { ClusterResult } from '@tonedeck/shared'

export function fmtClusters(r: ClusterResult): string {
  if (r.clusters.length === 0) return 'No presets to cluster.'
  const lines: string[] = [`${r.clusters.length} clusters @ threshold ${r.threshold} dB RMS`, '']
  for (const c of r.clusters) {
    const gap =
      c.nearestDistanceDb != null ? ` — nearest cluster ${c.nearestDistanceDb} dB away` : ''
    lines.push(`● cluster ${c.id} — ${c.members.length} songs — ${c.character}${gap}`)
    for (const m of c.members.slice(0, 12)) {
      lines.push(`    ${m.title}${m.artist ? ` — ${m.artist}` : ''}`)
    }
    if (c.members.length > 12) lines.push(`    …and ${c.members.length - 12} more`)
    lines.push('')
  }
  return lines.join('\n').trimEnd()
}
```

- [ ] **Step 4: Add `actionClusters` to commands.ts**

Add `fmtClusters` to the existing `import { … } from './format.js'` block, add `ClusterResult` to the `@tonedeck/shared` import, then append:

```ts
// ─── clusters ───────────────────────────────────────────────────────────────

export async function actionClusters(
  ctx: ApiCtx,
  opts: { json: boolean; threshold?: number },
): Promise<void> {
  const qs = opts.threshold != null ? `?threshold=${opts.threshold}` : ''
  const data = await apiGet<ClusterResult>(ctx, `/api/clusters${qs}`)
  out(opts.json, data, fmtClusters(data))
}
```

- [ ] **Step 5: Wire the command in index.ts**

Add `actionClusters` to the `import { … } from './commands.js'` block, then add the command (place it after the `list` command):

```ts
program
  .command('clusters')
  .description('Group presets by tone-only EQ shape; show the dB variance that splits them')
  .option('--threshold <db>', 'RMS dB distance to split clusters (default 1.5)', parseFloat)
  .action((cmdOpts: { threshold?: number }) =>
    wrap(isJson, () => actionClusters(ctx(), { json: isJson(), threshold: cmdOpts.threshold }))(),
  )
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run packages/cli/test/clusters.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/cli/src/format.ts packages/cli/src/commands.ts packages/cli/src/index.ts packages/cli/test/clusters.test.ts
git commit -m "feat(cli): tonedeck clusters command"
```

---

## Task 9: Batch generator core — `runCorpusBuild`

**Files:**
- Create: `packages/daemon/src/corpus.ts`
- Test: `packages/daemon/test/corpus.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/daemon/test/corpus.test.ts
import { describe, it, expect } from 'vitest'
import { runCorpusBuild, type CorpusItem } from '../src/corpus.js'
import type { Preset } from '@tonedeck/shared'

const fakePreset = (slug: string): Preset =>
  ({
    schemaVersion: 1, slug, kind: 'track', title: slug, profile: 'ft1pro', preamp: -3,
    bands: [{ id: 'b1', type: 'peaking', freq: 1000, q: 1, gain: 1 }], intent: 'x',
    provenance: { createdBy: 'claude', history: [] }, version: 1,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  }) as Preset

const items = (slugs: string[]): CorpusItem[] =>
  slugs.map((s) => ({ title: s, artist: 'K', slug: s }))

describe('runCorpusBuild', () => {
  it('generates+saves each new item and skips existing slugs', async () => {
    const saved: string[] = []
    const r = await runCorpusBuild({
      items: items(['a', 'b', 'c']),
      existing: new Set(['b']),
      generate: async (it) => fakePreset(it.slug),
      save: async (p) => { saved.push(p.slug) },
      concurrency: 2,
    })
    expect(r.generated).toBe(2)
    expect(r.skipped).toBe(1)
    expect(r.failed).toEqual([])
    expect(saved.sort()).toEqual(['a', 'c'])
  })

  it('records failures and keeps going', async () => {
    const r = await runCorpusBuild({
      items: items(['a', 'boom', 'c']),
      existing: new Set(),
      generate: async (it) => {
        if (it.slug === 'boom') throw new Error('gen failed')
        return fakePreset(it.slug)
      },
      save: async () => {},
      concurrency: 1,
    })
    expect(r.generated).toBe(2)
    expect(r.failed).toEqual([{ slug: 'boom', error: 'gen failed' }])
  })

  it('never exceeds the concurrency limit', async () => {
    let active = 0
    let peak = 0
    await runCorpusBuild({
      items: items(['a', 'b', 'c', 'd', 'e']),
      existing: new Set(),
      generate: async (it) => {
        active++
        peak = Math.max(peak, active)
        await new Promise((res) => setTimeout(res, 5))
        active--
        return fakePreset(it.slug)
      },
      save: async () => {},
      concurrency: 2,
    })
    expect(peak).toBeLessThanOrEqual(2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/daemon/test/corpus.test.ts`
Expected: FAIL — cannot resolve `../src/corpus.js`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/daemon/src/corpus.ts
/**
 * Resumable, bounded-concurrency bulk EQ generation. Pure orchestration: all IO
 * (generation, storage, "what already exists") is injected, so this is fully
 * unit-tested without the daemon, claude, or the network. The script
 * scripts/corpus-build.ts wires the real deps.
 */
import type { Preset } from '@tonedeck/shared'

export interface CorpusItem {
  title: string
  artist: string
  album?: string
  /** The preset slug this item will be stored under (slugify(artist, title)). */
  slug: string
}

export interface CorpusProgress {
  done: number
  total: number
  slug: string
  status: 'generated' | 'failed'
  error?: string
}

export interface CorpusBuildOpts {
  items: CorpusItem[]
  /** Slugs already present — these are skipped (resumability). */
  existing: Set<string>
  generate: (item: CorpusItem) => Promise<Preset>
  save: (preset: Preset) => Promise<void>
  concurrency?: number
  onProgress?: (p: CorpusProgress) => void
}

export interface CorpusBuildResult {
  generated: number
  skipped: number
  failed: Array<{ slug: string; error: string }>
}

export async function runCorpusBuild(opts: CorpusBuildOpts): Promise<CorpusBuildResult> {
  const concurrency = Math.max(1, opts.concurrency ?? 3)
  const queue = opts.items.filter((it) => !opts.existing.has(it.slug))
  const result: CorpusBuildResult = {
    generated: 0,
    skipped: opts.items.length - queue.length,
    failed: [],
  }
  const total = opts.items.length
  let done = result.skipped
  let next = 0

  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++
      if (i >= queue.length) return
      const item = queue[i]
      try {
        const preset = await opts.generate(item)
        await opts.save(preset)
        result.generated++
        done++
        opts.onProgress?.({ done, total, slug: item.slug, status: 'generated' })
      } catch (e) {
        const error = (e as Error).message
        result.failed.push({ slug: item.slug, error })
        done++
        opts.onProgress?.({ done, total, slug: item.slug, status: 'failed', error })
      }
    }
  }

  const n = Math.min(concurrency, queue.length) || 0
  await Promise.all(Array.from({ length: n }, () => worker()))
  return result
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/daemon/test/corpus.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/daemon/src/corpus.ts packages/daemon/test/corpus.test.ts
git commit -m "feat(daemon): runCorpusBuild — resumable bounded-concurrency batch core"
```

---

## Task 10: Catalog IO helper for scripts

**Files:**
- Create: `scripts/lib/catalog-io.ts`

> Scripts are IO glue verified by running (the repo does not unit-test `scripts/`;
> see `migrate-kanye.ts`). The pure logic they call is already tested in Tasks 1–9.

- [ ] **Step 1: Write the helper**

```ts
// scripts/lib/catalog-io.ts
/** Read/write the song catalog at ~/.tonedeck/catalog.json, merging on write. */
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { mergeCatalog, CatalogEntrySchema, type CatalogEntry } from '@tonedeck/shared'

export const CATALOG_PATH = join(homedir(), '.tonedeck', 'catalog.json')

export async function readCatalog(path = CATALOG_PATH): Promise<CatalogEntry[]> {
  try {
    const raw = await fs.readFile(path, 'utf8')
    const arr = JSON.parse(raw) as unknown[]
    return arr.map((e) => CatalogEntrySchema.parse(e))
  } catch {
    return []
  }
}

/** Merge `incoming` into the on-disk catalog and write it back atomically. */
export async function addToCatalog(incoming: CatalogEntry[], path = CATALOG_PATH): Promise<CatalogEntry[]> {
  const existing = await readCatalog(path)
  const merged = mergeCatalog(existing, incoming)
  await fs.mkdir(join(homedir(), '.tonedeck'), { recursive: true })
  const tmp = `${path}.tmp`
  await fs.writeFile(tmp, JSON.stringify(merged, null, 2) + '\n', 'utf8')
  await fs.rename(tmp, path)
  return merged
}
```

- [ ] **Step 2: Type-check it compiles**

Run: `npx tsc --noEmit -p packages/shared/tsconfig.json && npx tsx -e "import('./scripts/lib/catalog-io.ts').then(()=>console.log('ok'))"`
Expected: prints `ok` (module imports cleanly).

- [ ] **Step 3: Commit**

```bash
git add scripts/lib/catalog-io.ts
git commit -m "feat(scripts): catalog read/merge/write helper"
```

---

## Task 11: `ingest-kanye.ts` — iTunes discography

**Files:**
- Create: `scripts/ingest-kanye.ts`
- Modify: `package.json` (add `ingest:kanye` script)

- [ ] **Step 1: Write the script**

```ts
#!/usr/bin/env tsx
// scripts/ingest-kanye.ts
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
```

- [ ] **Step 2: Add the npm script**

In `package.json` `"scripts"`, add:

```json
    "ingest:kanye": "tsx scripts/ingest-kanye.ts",
```

- [ ] **Step 3: Run it (live verification)**

Run: `npm run build -w packages/shared && npm run ingest:kanye`
Expected: prints album count, then `ingested N Kanye song rows; catalog now M entries` (N in the low hundreds). Confirm `~/.tonedeck/catalog.json` exists and contains Kanye entries.

- [ ] **Step 4: Commit**

```bash
git add scripts/ingest-kanye.ts package.json
git commit -m "feat(scripts): ingest-kanye — iTunes discography into the catalog"
```

---

## Task 12: `ingest-apple-liked.ts` — Apple Music Loved songs

**Files:**
- Create: `scripts/ingest-apple-liked.ts`
- Modify: `package.json` (add `ingest:apple` script)

- [ ] **Step 1: Write the script**

```ts
#!/usr/bin/env tsx
// scripts/ingest-apple-liked.ts
/**
 * Ingest the user's Apple Music Loved/favorited tracks into the catalog via
 * osascript. Property name `favorited` verified 2026-06-16 (`loved` is dead).
 * No login. Run: npm run ingest:apple
 */
import { execFile } from 'node:child_process'
import { parseAppleLoved } from '@tonedeck/shared'
import { addToCatalog } from './lib/catalog-io.js'

// Emit one `title<TAB>artist<TAB>album` line per loved track.
const SCRIPT = `
if application "Music" is running then
  tell application "Music"
    set out to ""
    repeat with t in (every track of playlist "Library" whose favorited is true)
      set out to out & (name of t) & tab & (artist of t) & tab & (album of t) & linefeed
    end repeat
    return out
  end tell
else
  return ""
end if`

function runOsascript(script: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('osascript', ['-e', script], { timeout: 60000, maxBuffer: 1 << 22 }, (err, stdout) =>
      err ? reject(err) : resolve(stdout.toString()),
    )
  })
}

async function main(): Promise<void> {
  const raw = await runOsascript(SCRIPT)
  const entries = parseAppleLoved(raw)
  if (entries.length === 0) {
    console.log('no Loved songs found (is Music.app open and are any tracks favorited?)')
    return
  }
  const merged = await addToCatalog(entries)
  console.log(`ingested ${entries.length} Apple Loved songs; catalog now ${merged.length} entries`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
```

- [ ] **Step 2: Add the npm script**

In `package.json` `"scripts"`, add:

```json
    "ingest:apple": "tsx scripts/ingest-apple-liked.ts",
```

- [ ] **Step 3: Run it (live verification)**

Run: `npm run build -w packages/shared && npm run ingest:apple`
Expected: `ingested N Apple Loved songs; catalog now M entries`. (Requires Music.app and some favorited tracks.)

- [ ] **Step 4: Commit**

```bash
git add scripts/ingest-apple-liked.ts package.json
git commit -m "feat(scripts): ingest-apple-liked — Loved tracks via osascript"
```

---

## Task 13: `ingest-ytmusic.ts` — YouTube Music Liked songs (Playwright)

**Files:**
- Create: `scripts/ingest-ytmusic.ts`
- Modify: `package.json` (add `ingest:ytmusic` script)

> This is the brittle, login-gated source. It opens a **headed** Brave via
> `playwright-core` with a persisted profile so login is one-time, scrolls the
> virtualized list to load all rows, extracts title/artist, and screenshots each
> step to `/tmp` for visual QA.

- [ ] **Step 1: Write the script**

```ts
#!/usr/bin/env tsx
// scripts/ingest-ytmusic.ts
/**
 * Ingest the user's YouTube Music "Liked songs" into the catalog. Opens Brave
 * (headed) via playwright-core with a persisted user-data dir so the Google
 * login is one-time. Run: npm run ingest:ytmusic
 *
 * First run: a browser window opens at the Liked-songs playlist. Log in if
 * prompted, then return to this terminal and press Enter to start scraping.
 */
import { chromium, type BrowserContext } from 'playwright-core'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { parseYtMusicRows } from '@tonedeck/shared'
import { addToCatalog } from './lib/catalog-io.js'

const BRAVE = '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'
const USER_DATA = join(homedir(), '.tonedeck', 'ytmusic-profile')
const LIKED_URL = 'https://music.youtube.com/playlist?list=LM'

function waitForEnter(prompt: string): Promise<void> {
  return new Promise((resolve) => {
    process.stdout.write(prompt)
    process.stdin.resume()
    process.stdin.once('data', () => {
      process.stdin.pause()
      resolve()
    })
  })
}

async function scrapeRows(ctx: BrowserContext): Promise<Array<{ title?: string; artist?: string; album?: string }>> {
  const page = ctx.pages()[0] ?? (await ctx.newPage())
  await page.goto(LIKED_URL, { waitUntil: 'domcontentloaded' })
  await page.screenshot({ path: '/tmp/tonedeck-ytmusic-1-loaded.png' })

  // Scroll the virtualized list until the row count stops growing.
  let prev = -1
  for (let i = 0; i < 60; i++) {
    const count = await page.locator('ytmusic-responsive-list-item-renderer').count()
    if (count === prev) break
    prev = count
    await page.mouse.wheel(0, 4000)
    await page.waitForTimeout(700)
  }
  await page.screenshot({ path: '/tmp/tonedeck-ytmusic-2-scrolled.png' })

  // Each row: first .flex-column title = song; the byline carries the artist.
  return page.$$eval('ytmusic-responsive-list-item-renderer', (rows) =>
    rows.map((row) => {
      const title = row.querySelector('.title')?.textContent?.trim() || undefined
      // The byline (artist • album • duration) lives in the secondary flex column.
      const byline = row.querySelector('.secondary-flex-columns')?.textContent?.trim() || ''
      const artist = byline.split('•')[0]?.trim() || undefined
      const album = byline.split('•')[1]?.trim() || undefined
      return { title, artist, album }
    }),
  )
}

async function main(): Promise<void> {
  const ctx = await chromium.launchPersistentContext(USER_DATA, {
    executablePath: BRAVE,
    headless: false,
    viewport: { width: 1280, height: 900 },
  })
  try {
    const page = ctx.pages()[0] ?? (await ctx.newPage())
    await page.goto(LIKED_URL, { waitUntil: 'domcontentloaded' })
    await waitForEnter('\nLog in if prompted, then press Enter here to scrape… ')
    const rows = await scrapeRows(ctx)
    const entries = parseYtMusicRows(rows)
    if (entries.length === 0) {
      console.log('no rows scraped — check /tmp/tonedeck-ytmusic-*.png; selectors may have changed')
      return
    }
    const merged = await addToCatalog(entries)
    console.log(`ingested ${entries.length} YouTube Music Liked songs; catalog now ${merged.length} entries`)
  } finally {
    await ctx.close()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
```

- [ ] **Step 2: Add the npm script**

In `package.json` `"scripts"`, add:

```json
    "ingest:ytmusic": "tsx scripts/ingest-ytmusic.ts",
```

- [ ] **Step 3: Run it (live verification + visual QA)**

Run: `npm run build -w packages/shared && npm run ingest:ytmusic`
Expected: Brave opens at the Liked-songs page; after login + Enter, prints `ingested N YouTube Music Liked songs`. **Open `/tmp/tonedeck-ytmusic-2-scrolled.png` and confirm rows are visible and the count is plausible.** If 0 rows, inspect the screenshots and adjust the `.title` / `.secondary-flex-columns` selectors.

- [ ] **Step 4: Commit**

```bash
git add scripts/ingest-ytmusic.ts package.json
git commit -m "feat(scripts): ingest-ytmusic — Liked songs via Playwright (one-time login)"
```

---

## Task 14: `corpus-build.ts` — generate EQ for every catalog song

**Files:**
- Create: `scripts/corpus-build.ts`
- Modify: `package.json` (add `corpus:build` script)

> Wires the tested `runCorpusBuild` core to: the on-disk catalog, the `ft1pro`
> profile, `generateTrackEq` (claude CLI), and the **live daemon** for storage
> (`POST /api/presets`) so the in-memory store — and therefore `tonedeck
> clusters` — sees new presets immediately. Resumable: existing slugs are read
> from `GET /api/presets` and skipped.

- [ ] **Step 1: Write the script**

```ts
#!/usr/bin/env tsx
// scripts/corpus-build.ts
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
  const items: CorpusItem[] = catalog.map((e) => ({
    title: e.title,
    artist: e.artist,
    album: e.album,
    slug: slugify(e.artist, e.title),
  }))
  const existing = await existingSlugs()

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
```

- [ ] **Step 2: Add the npm script**

In `package.json` `"scripts"`, add:

```json
    "corpus:build": "tsx scripts/corpus-build.ts",
```

- [ ] **Step 3: Smoke it on a tiny slice first**

With the daemon running, temporarily confirm wiring by checking the existing-skip
path is fast (no catalog → friendly message; full catalog → it begins generating
and logs `[1/N] …`). Cancel after a few succeed (Ctrl-C); the partial work
persists and a re-run skips what's done.

Run: `npm run build -w packages/shared && npm run corpus:build`
Expected: `corpus: N songs, K presets already exist …` then per-song `ok` lines.

- [ ] **Step 4: Commit**

```bash
git add scripts/corpus-build.ts package.json
git commit -m "feat(scripts): corpus-build — bulk per-song EQ generation via the daemon"
```

---

## Task 15: Full pipeline run + README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Run the whole pipeline end-to-end**

```bash
npm run build                 # all packages
npm run ingest:kanye          # ~200 song rows
npm run ingest:apple          # your Loved songs
npm run ingest:ytmusic        # your YT Music Liked songs (one-time login)
npm run corpus:build          # generate EQ for everything new (long-running, resumable)
tonedeck clusters             # the payoff
tonedeck clusters --threshold 1.0
```

Expected: `tonedeck clusters` prints grouped songs, each cluster's tonal
character, and the dB gap to its nearest neighbor. Sanity-check that
near-identical-sounding songs share a cluster and that distinct ones split with a
gap > the threshold.

- [ ] **Step 2: Document it in the README**

Add a section after "Or drive it from the terminal":

```markdown
## 🧬 Corpus & clustering

Build a corpus of songs and group them by how they want to be EQ'd:

| Command | What it does |
|---|---|
| `npm run ingest:kanye` | Pull Kanye's discography from the iTunes API into the catalog |
| `npm run ingest:apple` | Add your Apple Music Loved songs (osascript, no login) |
| `npm run ingest:ytmusic` | Add your YouTube Music Liked songs (one-time Google login in Brave) |
| `npm run corpus:build` | Generate an independent per-song EQ for every catalog song (resumable) |
| `tonedeck clusters [--threshold <db>]` | Group presets by tone-only curve shape; show the dB variance that splits them |

The catalog lives at `~/.tonedeck/catalog.json`; presets are generated into
`~/.tonedeck/presets/`. Clustering compares the **shape** of each preset's
frequency response (loudness normalized out), so two songs that want the same
tonal balance land together regardless of overall level — and the report tells
you, in dB, how far apart any two clusters are.
```

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: corpus + clustering usage"
```

---

## Final verification

- [ ] Run the whole test suite: `npm test` — all green.
- [ ] Type-check everything: `npm run typecheck` — clean.
- [ ] `tonedeck clusters --json | head` returns valid JSON with `threshold` + `clusters`.

---

## Self-review notes (spec coverage)

- **Catalog** (spec §Components.1) → Tasks 1–2, 10.
- **Three ingestors** (spec §Components.2) → Tasks 11 (iTunes), 12 (Apple osascript), 13 (Playwright/YT).
- **Batch generator** (spec §Components.3) → Task 9 (core) + Task 14 (wiring).
- **Clustering engine** (spec §Components.4) → Tasks 3–4 + Task 7 (route) + Task 8 (CLI).
- **Data flow** (spec) → end-to-end in Task 15.
- **Error handling** (spec): per-source isolation = independent scripts; per-song failure logged + resumable = Task 9 tests; clustering handles differing band sets via the curve representation = Task 3.
- **Testing** (spec): pure logic unit-tested (Tasks 1–9); scripts verified by running (Tasks 11–15), matching the repo's existing `scripts/` convention.

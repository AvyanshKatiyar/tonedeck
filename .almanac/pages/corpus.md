---
title: Corpus Build — Bulk Per-Track EQ Generation
summary: How the corpus build pipeline generates a per-track EQ preset for every song in the catalog using resumable bounded-concurrency batch orchestration.
topics: [corpus, systems, flows]
sources:
  - id: corpus-ts
    type: file
    path: packages/daemon/src/corpus.ts
    note: runCorpusBuild and all core types.
  - id: corpus-build-script
    type: file
    path: scripts/corpus-build.ts
    note: Wires real deps (daemon API + eqgen) and adds env-var controls.
status: active
verified: 2026-06-17
---

# Corpus Build

The corpus build pipeline generates a per-track [[preset]] for every song in the [[catalog]] that does not already have one. The result is a library of AI-authored `kind: 'track'` presets that the [[cluster]] engine can group by EQ shape.

## Architecture

`packages/daemon/src/corpus.ts` provides the pure orchestration layer: `runCorpusBuild(opts)`. All IO is injected — generating and saving presets — so the module is fully unit-tested without the daemon, the Claude CLI, or the network.

`scripts/corpus-build.ts` wires the real dependencies:
- Reads the catalog from `~/.tonedeck/catalog.json` via `scripts/lib/catalog-io.ts`.
- Fetches existing preset slugs from `GET /api/presets` on the running daemon.
- Calls [[eqgen]]'s `generateTrackEq` for each pending song.
- Saves via `POST /api/presets` with `{ preset, clamp: true }`.

## Flow

```
catalog.json
  ↓ read
CatalogEntry[]
  ↓ slugify(artist, title) per entry → CorpusItem[]
  ↓ filter out existing.has(slug)  (resumability)
  ↓ LIMIT cap if TONEDECK_CORPUS_LIMIT is set
pending queue
  ↓ runCorpusBuild (concurrency N)
  ├─ generateTrackEq → Preset
  ├─ POST /api/presets → saved
  └─ onProgress callback → console
```

**Requires daemon running**: `npm run corpus:build` assumes the daemon is reachable at `TONEDECK_URL` (default `http://127.0.0.1:5055`).

## Resumability

Any slug that already exists in the daemon's preset store is skipped before queuing. A run can be interrupted and restarted cleanly; only songs without presets will be generated. HTTP 409 (preset already exists) is treated as success — safe under concurrency.

## Concurrency

Default concurrency: 3 parallel `generateTrackEq` calls. Override with `TONEDECK_CORPUS_CONCURRENCY`. Higher values are possible but each call runs the Claude CLI subprocess, so host resource constraints apply.

## Staged Runs

`TONEDECK_CORPUS_LIMIT=<N>` caps the run to the first N not-yet-generated songs. Useful for smoke-testing a sample before committing to a full corpus build.

## `runCorpusBuild` Contract

```ts
interface CorpusBuildOpts {
  items: CorpusItem[]
  existing: Set<string>          // slugs already in store — these are skipped
  generate: (item) => Promise<Preset>
  save: (preset) => Promise<void>
  concurrency?: number           // default 3
  onProgress?: (p: CorpusProgress) => void
}

interface CorpusBuildResult {
  generated: number
  skipped: number
  failed: Array<{ slug: string; error: string }>
}
```

`failed` entries are not retried in the same run. Re-running the script resumes from exactly these items (they will be pending again because they were never saved).

## CorpusItem Shape

```ts
interface CorpusItem {
  title: string
  artist: string
  album?: string
  slug: string   // slugify(artist, title)
}
```

The `slug` is the stable preset identity key. If two catalog entries normalize to the same slug they are the same song.

## Related Pages

- [[catalog]] — source of the song work-list
- [[eqgen]] — called per song to produce the raw preset JSON
- [[preset-store]] — receives presets via `POST /api/presets`; applies house-limit clamp
- [[cluster]] — downstream consumer; groups the resulting presets by EQ shape
- [[preset]] — the data structure produced and stored

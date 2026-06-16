---
title: Catalog — Song Work-List for Corpus Build
summary: The song catalog at ~/.tonedeck/catalog.json — how it is built from ingest scripts, deduplicated, and consumed by the corpus build pipeline.
topics: [corpus, concepts]
sources:
  - id: catalog-ts
    type: file
    path: packages/shared/src/catalog.ts
    note: CatalogEntry schema, catalogKey, mergeCatalog, and all parsers.
  - id: catalog-io-ts
    type: file
    path: scripts/lib/catalog-io.ts
    note: Storage path, readCatalog, addToCatalog (atomic write).
  - id: catalog-test
    type: file
    path: packages/shared/test/catalog.test.ts
    note: Verifies dedup, merge order, and parser correctness.
status: active
verified: 2026-06-17
---

# Catalog

The catalog is ToneDeck's song work-list for [[corpus]] builds. It is separate from [[preset]]s: the catalog is cheap and fast to build (ingest from music services), while presets are slow and expensive to create (each requires a Claude CLI call).

## Storage

`~/.tonedeck/catalog.json` — a JSON array of `CatalogEntry` objects. Writes are atomic (tmp + rename) via `addToCatalog()` in `scripts/lib/catalog-io.ts`.

## Schema

```ts
interface CatalogEntry {
  title: string
  artist: string
  album?: string
  source: 'itunes' | 'apple-liked' | 'ytmusic-liked'
  externalId?: string
}
```

`source` records where the song came from; `externalId` is the platform's track identifier when available (e.g., iTunes `trackId`).

## Deduplication

`catalogKey(artist, title)` computes a stable identity key by applying `slugify` to both fields — the same normalization used for [[preset]] slugs. `"Kanye West / Black Skinhead"` and `"kanye west / black skinhead"` collapse to the same key.

`mergeCatalog(existing, incoming)` maps entries by key and keeps the first-seen entry when duplicates arrive. Ingest pass order determines which source's metadata is retained.

## Ingest Sources

Three parsers and their corresponding ingest scripts:

| Source | Parser | Script |
|---|---|---|
| iTunes Search API | `parseItunesSongs(results, artistId)` | `scripts/ingest-kanye.ts` |
| Apple Music loved tracks (osascript) | `parseAppleLoved(raw)` | `scripts/ingest-apple-liked.ts` |
| YouTube Music liked tracks (scraped rows) | `parseYtMusicRows(rows)` | `scripts/ingest-ytmusic.ts` |

**`parseItunesSongs`** filters to a primary `artistId` to drop guest features (e.g., a song that features Kanye West but is not his primary release).

**`parseAppleLoved`** parses osascript tab-delimited output: `title\tartist\talbum` per line.

**`parseYtMusicRows`** accepts pre-scraped row objects; the caller drives the YouTube Music scraping.

## Relationship to Corpus Build

`scripts/corpus-build.ts` reads the catalog with `readCatalog()`, converts each entry to a `CorpusItem` via `slugify(entry.artist, entry.title)`, then hands the list to `runCorpusBuild`. Catalog entries that already have a preset (matching slug) are skipped by the corpus build's resumability mechanism.

The catalog is never modified by the corpus build — ingest and generation are strictly separate phases.

## Related Pages

- [[corpus]] — the pipeline that consumes the catalog
- [[eqgen]] — generates a preset for each catalog entry
- [[preset]] — the output that the corpus build creates from each catalog entry

---
title: Preset — Schema and Lifecycle
summary: ToneDeck's central data structure — the full Zod schema, field meanings, provenance model, safety pipeline, and how corpus presets differ from builtins.
topics: [concepts, systems]
sources:
  - id: preset-ts
    type: file
    path: packages/shared/src/preset.ts
    note: Canonical Zod schema for Preset, Band, Provenance, Artwork, Profile, and Limits.
  - id: preset-store-ts
    type: file
    path: packages/daemon/src/presets.ts
    note: PresetStore — save, revert, safety pass.
status: active
verified: 2026-06-17
---

# Preset

A Preset is ToneDeck's central data structure. It holds a complete parametric EQ configuration for one album, track, genre, or mood, together with all metadata needed to identify and describe it.

## Schema fields

The canonical Zod schema lives in [[packages/shared/src/preset.ts]]. [@preset-ts]

**Identity**
- `schemaVersion` — always `1`; reserved for future format migrations
- `slug` — kebab-case string, regex `[a-z0-9][a-z0-9-]*` max 64 chars, immutable after creation
- `kind` — `'album' | 'track' | 'genre' | 'mood'`
- `title` — display name; min 1 character; required
- `artist` — optional string
- `album` — optional string
- `version` — positive integer, starts at 1, incremented by [[preset-store]] on every write
- `createdAt` — ISO 8601 datetime string; top-level field, not inside `provenance`
- `updatedAt` — ISO 8601 datetime string; top-level field, updated on every save

**Sound**
- `profile` — string id referencing a [[profile]] (e.g., `'ft1pro'`); all band limits come from the profile
- `preamp` — overall gain offset in dB; schema sanity bounds are -24..24, but [[safety]] clamps to the tighter profile limits (-6..4 for ft1pro) before save
- `bands` — array of [[band]] objects; band ids must be unique within the array

**Band fields** (each entry in `bands`):
- `id` — unique string within the preset (e.g., `'Bass'`, `'b1'`)
- `type` — `'lowshelf' | 'peaking' | 'highshelf'`
- `freq` — 20..20000 Hz
- `q` — 0.3..5 (schema sanity; profile limits may be same or tighter)
- `gain` — -24..24 dB (schema sanity; profile house limits are tighter — -8..6 for ft1pro)

**Curation**
- `intent` — short phrase describing the sonic goal; **required**, not optional
- `notes` — optional string for any additional description; [[eqgen]] populates this with the model's one-sentence explanation for corpus-generated presets

**Provenance**
- `provenance.createdBy` — enum `'claude' | 'user' | 'builtin'`
- `provenance.model` — optional string identifying the model that generated the preset (e.g., `'sonnet (cli)'`); only present when `createdBy: 'claude'`
- `provenance.history` — array of history entries, each with `{ at: datetime, change: string, reason: string }`; grows as tweaks accumulate

**Artwork** (optional, entire block)
- `artwork.itunesCollectionId` — optional iTunes collection ID (number) for artwork lookup
- `artwork.url` — optional URL of the artwork image
- `artwork.cachedFile` — optional path to a locally cached copy

## Versioning and history

Every time [[preset-store]] saves a preset it records the outgoing state before overwriting, enabling `revertPreset()`. The history format is tracked in `provenance.history`.

`revertPreset()` restores the sound fields (`preamp`, `bands`, `intent`, `notes`), preserves the identity fields (`slug`, `title`, `artist`, `kind`), and writes a new version. Revert is itself revertable by a subsequent revert call. The CLI exposes `tonedeck revert <slug>` (last change) and `tonedeck revert <slug> --original` (v1 state).

## Safety pass on save

Before any write, [[preset-store]] runs `_runSafety()`: [[safety]] `clampPreset()` → `autoTrim()` → `headroomVerdict()`. If the verdict is `'rejected'`, the store throws a `StoreError` with code `'rejected'` and the preset is not saved. See [[safety]] for the threshold rules.

## Wire format

`presetJsonSchema()` in [[packages/shared/src/preset.ts]] exports a JSON Schema representation of the Zod schema, intended for future MCP tool schemas. The on-disk format is standard JSON with no special encoding. [@preset-ts]

## Builtin presets

Seventeen presets are shipped in `presets/builtin/` and seeded to `~/.tonedeck/presets/` on first run. They are documented in [[builtin-presets]].

## Corpus track presets

The [[corpus]] build pipeline generates presets with `kind: 'track'` and `provenance.createdBy: 'claude'` for individual songs in the user's [[catalog]]. These differ from builtins: slugs are derived from `slugify(artist, title)`, `kind` is `'track'` (not `'album'`), and they are created on demand rather than seeded. The `notes` field carries the model's one-sentence tuning rationale. The clustering engine ([[cluster]]) operates over these presets to discover groups of tracks with similar tuning requirements.

## Related pages

- [[profile]] — source of limits and the band template; every preset's `profile` field points here
- [[band]] — individual EQ filter unit
- [[safety]] — clamp, trim, and headroom verdict pipeline
- [[preset-store]] — save, revert, version history
- [[eqgen]] — generates corpus presets via Claude CLI
- [[claude-skill]] — interactive tuning; creates and tweaks presets via CLI commands
- [[builtin-presets]] — the 17 shipped presets
- [[corpus]] — batch generation pipeline; produces `kind: 'track'` presets

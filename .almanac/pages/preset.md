---
topics: [concepts, systems]
files: [packages/shared/src/preset.ts, packages/daemon/src/presets.ts]
---

# Preset

A Preset is ToneDeck's central data structure. It holds a complete parametric EQ configuration for one album, track, genre, or mood, together with all metadata needed to identify and describe it.

## Schema fields

The canonical Zod schema lives in [[packages/shared/src/preset.ts]].

**Identity**
- `slug` — kebab-case string, regex `[a-z0-9][a-z0-9-]*`, immutable after creation
- `version` — positive integer, starts at 1, incremented by [[preset-store]] on every write that changes sound fields; identity-only edits also bump version for simplicity
- `kind` — `'album' | 'track' | 'genre' | 'mood'`
- `label` — display name (not unique, not slug-derived)
- `artist` — optional string
- `year` — optional integer 1900..2100
- `schemaVersion` — always `1`; reserved for future format migrations

**Sound**
- `profileId` — references a [[profile]] by id; all bands and limits are interpreted against this profile
- `preamp` — overall gain offset in dB, clamped to `profile.limits.preamp.min` / `profile.limits.preamp.max`
- `bands` — array of [[band]] objects; band ids must be unique within the array

**Provenance**
- `provenance.source` — free string identifying who created or last edited the preset (e.g., `'claude-code'`, `'ui'`)
- `provenance.createdAt` — ISO 8601 datetime string
- `provenance.updatedAt` — ISO 8601 datetime string
- `provenance.change` — imperative string describing the last edit (e.g., `'reduce UpperMidTame by 1.5 dB'`)
- `provenance.reason` — free string explaining why the edit was made

**Artwork**
- `artwork.source` — `'itunes' | 'user'`
- `artwork.url` — URL of the full-resolution image
- `artwork.palette` — optional array of hex color integers extracted from the artwork (used by the UI for theming)

**Curation**
- `intent` — optional string describing what sonic goal the preset pursues
- `notes` — optional string for anything else the curator wants to record

## Versioning and history

Every time [[preset-store]] saves a preset it first writes the outgoing state to `~/.tonedeck/presets/.history/<slug>/v<N>.json`, where N is the current version. The preset is then saved with version N+1. This means history file v1 contains the state that was overwritten to create v2, and so on.

`revertPreset()` reads the most recent history snapshot, restores the sound fields (`preamp`, `bands`, `intent`, `notes`), preserves the identity fields (`slug`, `label`, `artist`, `kind`, `year`), and writes a new version that is higher than the current version. Revert is itself revertable by a subsequent revert call.

## Safety pass on save

Before any write, [[preset-store]] runs `_runSafety()`: [[safety]] `clampPreset()` → `autoTrim()` → `headroomVerdict()`. If the verdict is `'rejected'`, the store throws a `StoreError` with code `'rejected'` and the preset is not saved.

## Wire format

`presetJsonSchema()` exports a JSON Schema representation of the Zod schema, intended for future MCP tool schemas. The on-disk format is standard JSON with no special encoding.

## Builtin presets

Seventeen presets are shipped in `presets/builtin/` and seeded to `~/.tonedeck/presets/` on first run. They are documented in [[builtin-presets]].

## Corpus track presets

The [[corpus]] build pipeline generates presets with `kind: 'track'` and `provenance.createdBy: 'claude'` for individual songs in the user's [[catalog]]. These differ from builtins: slugs are derived from `slugify(artist, title)`, `kind` is `'track'` (not `'album'`), and they are created on demand rather than seeded. The clustering engine ([[cluster]]) operates over these presets to discover groups of tracks with similar tuning requirements.

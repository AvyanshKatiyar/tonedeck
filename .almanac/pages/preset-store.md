---
topics: [systems, daemon]
files: [packages/daemon/src/presets.ts]
---

# Preset Store

`PresetStore` in [[packages/daemon/src/presets.ts]] is the persistence layer for all [[preset]] objects. It holds presets in an in-memory `Map<slug, Preset>` backed by the filesystem at `~/.tonedeck/presets/`.

## Initialization

On first run (empty presets directory), the store seeds from `presets/builtin/` by copying each JSON file into `~/.tonedeck/presets/`. On subsequent runs, it reads only from the user directory. Builtin files are never read again after the first seed — users can freely edit or delete the seeded copies.

## Safety pipeline

Every write (create and update) passes through `_runSafety(preset, profile)`:

```
clampPreset() → autoTrim() → headroomVerdict()
```

If `headroomVerdict()` returns `'rejected'`, the store throws `StoreError` with code `'rejected'` and nothing is written to disk. If it returns `'warn'`, the trimmed preset is written and the warning is passed through to the caller. See [[safety]] for the full pipeline.

## Versioning and history

`_writeSnapshot(preset)` writes the current on-disk state to `~/.tonedeck/presets/.history/<slug>/v<N>.json` before overwriting the main file. N is the current version number. This creates a complete history: `v1.json` holds the original state, `v2.json` holds the state that was overwritten by version 3, and so on.

## revertPreset(slug)

1. Finds the highest-numbered snapshot under `.history/<slug>/`.
2. Reads it and extracts the sound fields: `preamp`, `bands`, `intent`, `notes`.
3. Restores those fields to the current preset, preserving identity fields: `slug`, `label`, `artist`, `kind`, `year`.
4. Increments the version number forward (revert is not a rollback — it creates a new version).
5. Runs `_runSafety()` on the result and writes it.

Revert is itself revertable: the pre-revert state is snapshotted before writing, so a second `revertPreset()` call will undo the revert.

## resetOriginal(slug)

Reads the preset from `presets/builtin/<slug>.json` and saves it over the user copy, running the full safety pipeline. Throws `StoreError('not_found')` if the slug has no corresponding builtin file.

## Error codes

`StoreError` carries one of four codes:

| Code | Meaning |
|---|---|
| `exists` | Attempted to create a preset whose slug is already taken |
| `not_found` | Slug not found in the in-memory map |
| `invalid` | The supplied data failed Zod schema validation |
| `rejected` | Safety pipeline hard-rejected the preset |

[[daemon]] routes map these to HTTP 409 (`exists`), 404 (`not_found`), and 422 (`invalid` / `rejected`).

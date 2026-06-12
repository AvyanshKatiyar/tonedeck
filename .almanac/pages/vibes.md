---
topics: [concepts, systems]
files: [packages/shared/src/vibes.ts]
---

# Vibes

The vibes system translates plain-language taste preferences into per-band gain deltas. It exists so the [[claude-skill]] and the [[ui]] can offer five named sliders that move in music-listener vocabulary rather than frequency-domain vocabulary.

## The five vibes

Each vibe is a named mapping from band id to gain delta per step:

| Vibe | Bands affected | Direction |
|---|---|---|
| `warmth` | Bass | boost |
| `punch` | KickBody | boost |
| `clarity` | UpperMidTame | cut (negative delta) |
| `smoothness` | PresenceTame | cut (negative delta) |
| `sparkle` | Air | boost |

The exact deltas per step are defined in the `VIBES` constant in [[`packages/shared/src/vibes.ts`]].

## Step model

Each vibe has a step value clamped to the integer range −3..+3. Step 0 applies no change. Positive steps boost toward the vibe's character; negative steps reverse it (e.g., negative `warmth` cuts bass).

## `applyVibes(preset, steps, profile)`

1. For each vibe, multiply its `delta` by the corresponding step value to get the applied gain change for each band.
2. For each band referenced by the vibes that does not already exist in `preset.bands`, add it at `gain = 0` using the profile's template band definition.
3. Apply the computed gain change to each affected band.
4. Run [[safety]]'s `clampPreset()` to enforce profile limits.
5. Return the modified preset.

The function does not mutate the input preset; it returns a new object.

## Usage in the CLI

`tonedeck tweak` calls `applyVibes()` before any direct band edits specified with `--band`. The order is: vibes first, then band overrides, then a PUT to the daemon. This means vibe deltas are additive to the current preset state and are then further modified by any explicit band arguments.

## Usage in the UI

The UI store holds `vibes: Record<VibeName, number>` as part of its draft state. When the user moves a vibe slider, the store calls `applyVibes()` on the current `base` preset and stores the result as `draft`. Saving the draft commits the vibe-adjusted state to the daemon.

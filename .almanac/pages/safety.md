---
topics: [safety, systems, audio]
files: [packages/shared/src/safety.ts]
---

# Safety

The safety pipeline prevents presets from exceeding hardware limits or causing digital clipping. It runs as part of every [[preset-store]] write operation, before the data is persisted.

## Pipeline order

```
clampPreset() → autoTrim() → headroomVerdict()
```

These three functions are exported from [[packages/shared/src/safety.ts]] and called in sequence by `PresetStore._runSafety()`.

## `clampPreset(preset, profile)`

Clamps each band's `gain` to `[profile.limits.gain.min, profile.limits.gain.max]` and the preset's `preamp` to `[profile.limits.preamp.min, profile.limits.preamp.max]`. Returns a new preset object. For `ft1pro`: band gain min −8 dB / max +6 dB, preamp min −6 dB / max +4 dB.

## `predictMaxBoostDb(preset)`

Calls [[band]]'s `responseDb()` at 256 log-spaced frequencies from 20 Hz to 20 kHz and returns the maximum total boost in dB found across all frequencies. This is the peak output level relative to 0 dBFS when a 0 dBFS input tone is played at the worst-case frequency.

## `headroomVerdict(peak, profile)`

Returns one of three verdict codes:

- **`ok`** — `peak ≤ profile.limits.clipHeadroomDb`. No action needed.
- **`warn`** — `peak > clipHeadroomDb` but `bandBoostAlone ≤ clipHeadroomDb + 6`. Preamp trim can bring this within spec; `autoTrim()` will be applied. The warning is passed to the caller but does not block the save.
- **`reject`** — `bandBoostAlone > clipHeadroomDb + 6`. Band gains alone (ignoring preamp) push the signal more than 6 dB above the headroom ceiling. No amount of preamp trim can fix this; the store throws `StoreError('rejected')` and the preset is not saved.

`bandBoostAlone` is computed the same way as `predictMaxBoostDb` but with `preamp` forced to 0.

## `autoTrim(preset, peak, profile)`

Reduces the preset's preamp by `(peak − profile.limits.clipHeadroomDb)` dB, then re-clamps to `profile.limits.preamp.min`. Returns the adjusted preset. `autoTrim` is always applied before the verdict check — the verdict is evaluated on the post-trim peak.

## Policy summary

Warnings inform and never block. `autoTrim` is applied silently on every save where trim is needed. Hard rejection is reserved for cases where band boosts alone exceed the headroom ceiling by more than 6 dB — configurations that no preamp adjustment can make safe. The threshold of 6 dB extra before hard-rejection gives room for heavy boost presets while still protecting against accidental extreme configurations.

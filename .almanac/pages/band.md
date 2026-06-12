---
topics: [concepts, audio]
files: [packages/shared/src/biquad.ts, packages/shared/src/preset.ts]
---

# Band

A Band is one parametric EQ filter within a [[preset]]. The [[profile]] template defines the standard set of bands for a headphone model; presets can add, remove, or modify bands within the profile's limits.

## Schema fields

- `id` — string, unique within the preset's `bands` array; matches a template band id by convention but is not enforced to
- `type` — `'lowshelf' | 'peaking' | 'highshelf'`
- `freq` — center or shelf frequency in Hz
- `q` — quality factor (bandwidth control); higher Q = narrower peak for `peaking`, steeper slope for shelves
- `gain` — boost or cut in dB; clamped to `profile.limits.gain.min` / `profile.limits.gain.max` by [[safety]]

## Biquad math

All EQ math is in [[`packages/shared/src/biquad.ts`]] and implements the RBJ Audio EQ Cookbook formulas. The sample rate is fixed at 48000 Hz across all configs.

`biquadCoeffs(type, freq, q, gain, samplerate)` returns the five normalized IIR coefficients `{b0, b1, b2, a1, a2}`. The three supported filter types each use a different RBJ formula:
- `lowshelf` — boosts or cuts all frequencies below `freq`, with the shelf knee at `freq`
- `peaking` — bell-shaped boost or cut centered at `freq`, width controlled by `q`
- `highshelf` — boosts or cuts all frequencies above `freq`

`magnitudeDb(coeffs, freq, samplerate)` computes the exact gain in dB that the filter applies at a single frequency, using `|H(e^jω)|` evaluated on the unit circle.

`responseDb(bands, preamp, frequencies)` sums the dB contributions of all bands plus the preamp value at each frequency in the supplied array. This is used by [[safety]]'s `predictMaxBoostDb()`, which calls it at 256 log-spaced frequencies from 20 Hz to 20 kHz.

## In CamillaDSP YAML

When [[camillayaml-emitter]] renders a preset, each band becomes one entry in the YAML `filters` section. The entry type is `Biquad` with parameters `type`, `freq`, `q`, and `gain` (gain in dB; CamillaDSP recomputes the biquad coefficients internally at its configured sample rate). The `pipeline` section lists each filter by name in order.

## FiiO FT1 Pro band layout

The [[profile]] `ft1pro` defines six bands: Bass (lowshelf 60 Hz Q 0.7), KickBody (peaking 120 Hz Q 0.9), LowMidClean (peaking 250 Hz Q 1.0), UpperMidTame (peaking 3200 Hz Q 1.2), PresenceTame (peaking 5000 Hz Q 2.0), Air (highshelf 10 kHz Q 0.7). The FT1 Pro has a known presence emphasis between 3–6 kHz that these two peaking bands target.

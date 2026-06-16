---
title: Profile — Headphone Profile Schema and ft1pro
summary: How headphone profiles define the EQ band template, gain limits, and houseNotes injected into every EqGen prompt; the only shipped profile is ft1pro.
topics: [concepts, audio]
sources:
  - id: ft1pro-json
    type: file
    path: profiles/ft1pro.json
    note: Only shipped profile; source of bandTemplate, limits, and houseNotes content.
  - id: preset-ts
    type: file
    path: packages/shared/src/preset.ts
    note: Canonical Zod schema for Profile alongside Preset.
---

# Profile

A Profile describes a headphone model — its suggested EQ band layout and the gain/preamp limits that the [[safety]] pipeline enforces for that hardware. Every [[preset]] references a profile by id, and all per-band gain constraints come from the referenced profile.

## Schema fields

The canonical Zod schema is in [[packages/shared/src/preset.ts]] alongside the Preset schema.

- `id` — string identifier, e.g. `'ft1pro'`
- `name` — human display name
- `playbackDeviceName` — CoreAudio device name for headphone output (e.g., `'External Headphones'`); used by [[camillayaml-emitter]] to configure CamillaDSP's playback device
- `captureDeviceName` — CoreAudio device name for capture input; defaults to `'BlackHole 2ch'` in the schema
- `bandTemplate` — array of template [[band]] objects, each with `id`, `type`, `freq`, `q`, and `gain` set to `0`; these define the standard EQ bands for this headphone
- `limits.bandGainDb` — `[min, max]` per-band gain floor and ceiling in dB
- `limits.preampDb` — `[min, max]` overall preamp floor and ceiling in dB
- `limits.q` — `[min, max]` Q factor bounds for bands; ft1pro: `[0.3, 5]`; injected into the `optimizeForPreamp` EqGen prompt as validation bounds
- `limits.freqHz` — `[min, max]` frequency range in Hz; ft1pro: `[20, 20000]`; injected into the `optimizeForPreamp` EqGen prompt as validation bounds
- `limits.clipHeadroomDb` — minimum headroom to leave before the 0 dBFS ceiling; used by `headroomVerdict()` and `autoTrim()`
- `houseNotes` — free-text string injected verbatim into every [[eqgen]] generation prompt as the "chain context" section. Describes preamp defaults, driver characteristics, and the primary EQ levers for the headphone.

## The only shipped profile: ft1pro

`profiles/ft1pro.json` is the only profile distributed with ToneDeck. It targets the FiiO FT1 Pro planar magnetic headphones.

**Template bands** (all at gain 0):

| id | type | freq (Hz) | Q |
|---|---|---|---|
| Bass | lowshelf | 60 | 0.7 |
| KickBody | peaking | 120 | 0.9 |
| LowMidClean | peaking | 250 | 1.0 |
| UpperMidTame | peaking | 3200 | 1.2 |
| PresenceTame | peaking | 5000 | 2.0 |
| Air | highshelf | 10000 | 0.7 |

**Limits:** band gain min −8 dB / max +6 dB, preamp min −6 dB / max +4 dB, clipHeadroomDb 3.

**houseNotes** (verbatim from `profiles/ft1pro.json`, injected into every EqGen prompt):

> House default preamp is +2 dB and the tuning leans loud; combined boosts of roughly +5 dB are tolerated with a warning rather than a rejection. The FT1 Pro planar driver takes the 60 Hz bass shelf cleanly without flab. The 3.2 kHz and 5 kHz peaking cuts are the primary harshness levers — reach for those before touching anything else.

Key implications of these notes for EQ generation:
- The default loudness posture is +2 dB preamp; generated presets should account for this when computing headroom.
- The safety system allows total boosts up to ~+5 dB before issuing a headroom warning (rather than rejecting outright).
- The Bass band (60 Hz lowshelf) is a safe lift — the planar driver handles it without bass bloom.
- UpperMidTame (3.2 kHz) and PresenceTame (5 kHz) are the first-reach harshness levers in the EqGen prompt and the [[claude-skill]] symptom map.

## Role in the hot-swap guarantee

When [[camillayaml-emitter]] generates a CamillaDSP YAML for a preset, the `devices:` block is derived purely from the profile id and the active output device. Two presets on the same profile applied to the same output device will produce byte-identical `devices:` blocks. This byte-identity is the prerequisite for CamillaDSP's glitch-free `SetConfig` hot-swap — only the `filters` and `pipeline` sections differ.

## Profile loading

[[daemon]] loads profiles from the `profiles/` directory on startup. The profile id `'ft1pro'` is hardcoded as the default in the UI boot sequence (`store.tsx` fetches `profile('ft1pro')` at startup). Future multi-profile support would require adding new JSON files to `profiles/` and updating any hardcoded references.

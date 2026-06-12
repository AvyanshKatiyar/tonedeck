---
topics: [concepts, audio]
files: [packages/shared/src/preset.ts, profiles/ft1pro.json]
---

# Profile

A Profile describes a headphone model — its suggested EQ band layout and the gain/preamp limits that the [[safety]] pipeline enforces for that hardware. Every [[preset]] references a profile by id, and all per-band gain constraints come from the referenced profile.

## Schema fields

The canonical Zod schema is in [[`packages/shared/src/preset.ts`]] alongside the Preset schema.

- `id` — string identifier, e.g. `'ft1pro'`
- `label` — human display name
- `bands` — array of template [[band]] objects, each with `id`, `type`, `freq`, `q`, and `gain` set to `0`; these define the standard EQ bands for this headphone
- `limits.gain.min` / `limits.gain.max` — per-band gain floor and ceiling in dB
- `limits.preamp.min` / `limits.preamp.max` — overall preamp floor and ceiling in dB
- `limits.clipHeadroomDb` — minimum headroom to leave before the 0 dBFS ceiling; used by `headroomVerdict()` and `autoTrim()`

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

## Role in the hot-swap guarantee

When [[camillayaml-emitter]] generates a CamillaDSP YAML for a preset, the `devices:` block is derived purely from the profile id and the active output device. Two presets on the same profile applied to the same output device will produce byte-identical `devices:` blocks. This byte-identity is the prerequisite for CamillaDSP's glitch-free `SetConfig` hot-swap — only the `filters` and `pipeline` sections differ.

## Profile loading

[[daemon]] loads profiles from the `profiles/` directory on startup. The profile id `'ft1pro'` is hardcoded as the default in the UI boot sequence (`store.tsx` fetches `profile('ft1pro')` at startup). Future multi-profile support would require adding new JSON files to `profiles/` and updating any hardcoded references.

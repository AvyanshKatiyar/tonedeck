---
topics: [concepts, stack]
files: [presets/builtin/]
---

# Builtin Presets

ToneDeck ships 17 preset files in `presets/builtin/`. Every preset targets a Kanye West album, uses `profileId: "ft1pro"`, and has `kind: "album"` and `artist: "Kanye West"`. They serve as a ready-to-use starting library and as worked examples of how to tune a [[preset]] for a specific recording.

## Seeding

[[preset-store]] copies these files into `~/.tonedeck/presets/` on first run (when the user directory is empty). After the initial seed, the originals in `presets/builtin/` are not consulted during normal operation. Users may freely modify or delete the seeded copies.

`resetOriginal(slug)` reads from `presets/builtin/<slug>.json` and overwrites the user's copy, running the full [[safety]] pipeline on the result. This is the only path that reads from `presets/builtin/` after the initial seed.

## Representative example: mbdtf

`presets/builtin/mbdtf.json` targets *My Beautiful Dark Twisted Fantasy* (2010). The slug is `mbdtf`. Its band configuration reflects the album's dense low-end and orchestral midrange — Bass and KickBody are boosted to reinforce the deliberate low-frequency weight, while UpperMidTame is cut slightly to reduce harshness in the layered guitar and vocal stacks.

## Full album list

The 17 albums covered span Kanye West's discography from *The College Dropout* (2004) through later records. Each slug corresponds to a widely-used abbreviation of the album title (e.g., `graduation`, `yeezus`, `tlop`, `donda`).

## Tuning philosophy

Each builtin was tuned for the [[profile]] `ft1pro` — the FiiO FT1 Pro's six-band template. The presets compensate for the specific recording characteristics of each album (mastering loudness, frequency balance choices by the mixing engineer) while also accounting for the FT1 Pro's known 3–6 kHz presence emphasis. They are starting points, not final judgments — the [[claude-skill]] and [[cli]] exist so users can adjust them.

## Relationship to the profile template

Every builtin uses all six template bands from `ft1pro` (no added or removed bands). Band frequencies and Q values match the profile template exactly; only the gain values differ per preset.

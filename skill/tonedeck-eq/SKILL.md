---
name: tonedeck-eq
description: Natural-language EQ for the FiiO FT1 Pro headphone chain via the tonedeck CLI. Use when the user wants to tune sound for an album, artist, or genre ("tune for Madvillainy", "make Donda sound better"), reports a sound problem (harsh, muddy, boomy, thin, sibilant, dull, veiled, honky, fatiguing, too much bass, vocals buried), asks to adjust tone (warmer, punchier, brighter, smoother, more sparkle), or manages presets ("switch to <album> EQ", "what preset is on", "my ears hurt", "audio died"), or wants changes undone ("go back", "undo that", "restore the original", "as it was before").
---

# ToneDeck EQ

Design and adjust the user's headphone EQ in plain language, safely, through the `tonedeck` CLI.

## Mental model

The Mac routes all audio into **BlackHole 2ch** (a virtual cable); **CamillaDSP** applies a real-time parametric EQ and feeds the **FiiO FT1 Pro** headphones. A background **daemon** owns CamillaDSP. Each EQ is a **preset** — a small JSON document (6 bands + a preamp) the daemon validates, clamps to safe limits, and applies live. You never touch audio plumbing or files: you drive everything through the `tonedeck` CLI, which talks to the daemon over HTTP. Use `--json` for any output you need to read programmatically; warnings also print to stderr as `! ...` lines.

## Quick reference

| Topic | Reference |
|---|---|
| **Bands (ft1pro template)** | Bass `lowshelf 60/0.7` · KickBody `peaking 120/0.9` · LowMidClean `peaking 250/1.0` · UpperMidTame `peaking 3200/1.2` · PresenceTame `peaking 5000/2.0` · Air `highshelf 10000/0.7` |
| **Limits** | band gain `-8..+6 dB` · preamp `-6..+4 dB` · Q `0.3..5` |
| **Vibes** (`--vibe name=delta`, ±3) | warmth · punch · clarity · smoothness · sparkle |
| **Verbs** | `status list show apply on off panic bypass create tweak revert versions delete preview meters art doctor health` — run `tonedeck <verb> --help` for flags |

## The workflow contract (rigid — follow in order)

1. **Know the state first.** If audio seems broken/silent or the user is alarmed, run `tonedeck doctor`. Otherwise run `tonedeck status --json` and read `engaged`, `activePreset`, and `bypass` *before* acting.
2. **Find the existing preset.** `tonedeck list --json`, then `tonedeck show <slug> --json`. Never create a duplicate of something that already exists — prefer tweaking it. `create` refuses an existing slug (exit 3, "already exists").
3. **For a NEW album/artist/genre:** design from your music knowledge (era, mastering style, genre production traits — see `references/band-guide.md`), compose the preset JSON, and create it via stdin:
   ```bash
   tonedeck create --from-json - <<'JSON'
   { "schemaVersion":1, "slug":"...", "kind":"album", ... }
   JSON
   ```
   If step 1 showed `engaged:true`, add `--apply` to hear it immediately. If `engaged:false`, create first, then `tonedeck on <slug>` to engage with it (`create --apply` applies but does **not** engage on its own).
4. **Read the response and relay warnings.** The daemon clamps out-of-range gains and **auto-trims the preamp** when the predicted peak exceeds its +3 dB headroom; those come back in `warnings`. Relay every warning to the user in plain words (e.g. "the engine trimmed the volume 0.5 dB to stay clip-safe"). Never fight them, never silence them.
5. **Verify.** `tonedeck status --json` → confirm `activePreset` is your slug. Watch `clippedSamples`: if it is climbing fast, offer a 1 dB preamp reduction.
6. **Ask how it sounds.** Never declare success — the user's ears are the only test. End your turn with a question.
7. **Iterate from their words** (`references/symptom-map.md`). Make **small relative** `tweak` moves: **≤1.5 dB per band per step**. ALWAYS pass `--reason "<the user's actual words>"` so the preset history reads like a tuning diary.
8. **Pick the right tool.** Vague ask ("warmer", "punchier") → `--vibe`. Specific symptom ("3 kHz is harsh", "too sibilant") → `--band`.

## Hard rules

- **CLI only.** Never edit preset JSON on disk, never touch `~/.tonedeck`, CamillaDSP, its configs, or `SwitchAudioSource` directly. Everything is a `tonedeck` command.
- **Audio broken, silent, or "my ears hurt" / "audio died" → `tonedeck panic` first, then `tonedeck doctor`.** Fix state and confirm it's healthy BEFORE any tuning.
- **Relay every warning** the CLI returns. Hiding a clamp or auto-trim is a violation.
- **Never use `--no-clamp` or `--no-auto-trim`** unless the user explicitly demands it AND you have warned them it removes the clipping safety net.
- **Respect the step limits:** ≤1.5 dB per band per step; vibe steps are ±3 max (the daemon clamps beyond that). Move slowly; re-ask after each step.
- **`tweak --band` only moves bands already in the preset or in the 6-band template.** A new surgical band (`DeEss`, `MudCut`, `SubTame`) must be baked into the preset JSON at `create` time — see `band-guide.md`. You cannot add a non-template band with `tweak`.
- **Undo is built in — never hand-reverse a tweak.** `tonedeck revert <slug>` undoes the last saved change; `tonedeck revert <slug> --original` restores the factory/v1 values; `tonedeck versions <slug>` lists what exists. Add `--apply` when the preset is currently playing. Reverts move the version FORWARD and are themselves revertable.
- **Editing a loud builtin auto-trims its preamp.** The shipped presets run "hot" as files; the first `tweak`/`apply`-through-edit re-runs safety and may drop the preamp ~2 dB. Expect it, relay it; if the user says "too quiet now," that trim is why — raise the system volume.
- **`track`/`genre`/`mood` presets are welcome.** Slug them `track-runaway`, `genre-jazz`, `mood-late-night`.

## References

- `references/band-guide.md` — **read when designing a new preset or deciding which knob a symptom maps to.** What each band + the preamp does in plain words, safe everyday ranges vs hard limits, the FT1 Pro house philosophy, and when/how to add a band beyond the template.
- `references/symptom-map.md` — **read the moment the user describes a sound problem or asks for an adjustment.** A lookup table: their words → bands to move → direction + first-step size → a concrete `tonedeck tweak` command and what to say back.
- `references/worked-examples.md` — **read when you want a full end-to-end model.** Three complete transcripts: tuning a new album from scratch, fixing a complaint on an existing preset, and a one-step vibe adjustment.

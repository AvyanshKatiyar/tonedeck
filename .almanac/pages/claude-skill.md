---
title: Claude Skill — Interactive Natural-Language EQ Tuning
summary: How the tonedeck-eq Claude Code skill handles both creating new presets from scratch and adjusting existing ones via the CLI.
topics: [stack, flows, concepts]
sources:
  - id: skill-md
    type: file
    path: skill/tonedeck-eq/SKILL.md
    note: Defines the full 8-step workflow, hard rules, band guide, symptom map, and references.
  - id: skill-refs
    type: file
    path: skill/tonedeck-eq/references/
    note: band-guide.md, symptom-map.md, and worked-examples.md referenced by the skill.
  - id: session-closed-on-sunday
    type: session
    session_id: 3f9795f1-ad87-427f-9ab5-143182ed5c9f
    note: Session creating track-closed-on-sunday; shows the album-preset reference pattern and confirms the schema gotcha (missing provenance/version/createdAt/updatedAt → exit code 2).
  - id: session-closed-on-sunday-2
    type: session
    session_id: 4c9fa884-2cf0-4e63-a174-2de2bcf966d5
    note: Second session attempting track-closed-on-sunday; demonstrates the label-vs-title schema gotcha variant — model wrote "label" instead of "title" and omitted profile/provenance/version/createdAt/updatedAt.
  - id: session-monster-kanye
    type: session
    session_id: 5169c26e-22dc-4956-82db-41f4a487f133
    note: Session on 2026-06-16 creating track-monster-kanye; demonstrates the multi-step schema failure recovery (missing profile/provenance on attempt 1, missing version/createdAt/updatedAt on attempt 2) and the shell timestamp technique that resolves it.
status: active
verified: 2026-06-17
---

# Claude Skill

The ToneDeck Claude Code skill at `skill/tonedeck-eq/SKILL.md` teaches Claude how to tune a [[preset]] using plain-language descriptions of what the listener wants. It is registered as a Claude Code tool during installation by [[install]] and is the intended interface for natural-language EQ requests.

## Distinction from EqGen

The Claude skill and [[eqgen]] are two separate Claude integration paths in ToneDeck:

- **This skill** is *interactive*. It runs inside a Claude Code session, interprets the user's natural-language request, and drives everything through `tonedeck` CLI commands step by step. It can **create new presets from scratch** or **adjust existing ones incrementally** (≤1.5 dB per step per band).
- **EqGen** is *automated and batch*. It builds a structured prompt and spawns `claude -p` directly, expecting a raw JSON EQ configuration. No CLI commands, no iterative workflow, no user in the loop. Used by the [[corpus]] build pipeline and [[autodj]] for on-demand generation.

## Workflow

The skill defines an 8-step workflow [@skill-md]:

1. **Know the state first.** Run `tonedeck status --json` (or `tonedeck doctor` if audio seems broken) and read `engaged`, `activePreset`, and `bypass` before acting.
2. **Find the existing preset.** `tonedeck list --json`, then `tonedeck show <slug> --json`. Never create a duplicate. **When creating a track preset where an album preset already exists for the same artist**, additionally run `tonedeck show <album-slug> --json` to read the album curve before designing the track preset. The album preset is a design reference, not a template to copy — use it to make informed, intentional choices about what to change (e.g., different preamp headroom, tighter harshness cuts, less air on a sparse mix) rather than starting from scratch with no anchor.
3. **For a new album/artist/genre/track** (no existing preset): design from music knowledge (era, mastering style, genre traits), compose the preset JSON, and create it via stdin:
   ```bash
   tonedeck create --from-json - <<'JSON'
   {
     "schemaVersion": 1,
     "slug": "track-my-song-artist",
     "kind": "track",
     "title": "My Song",
     "artist": "Artist Name",
     "profile": "ft1pro",
     "intent": "brief description of the tuning goal",
     "preamp": -1,
     "version": 1,
     "createdAt": "2026-06-17T00:00:00.000Z",
     "updatedAt": "2026-06-17T00:00:00.000Z",
     "bands": [
       { "id": "Bass",         "type": "lowshelf",  "freq": 60,    "q": 0.7, "gain": 0.0 },
       { "id": "KickBody",     "type": "peaking",   "freq": 120,   "q": 0.9, "gain": 0.0 },
       { "id": "LowMidClean",  "type": "peaking",   "freq": 250,   "q": 1.0, "gain": 0.0 },
       { "id": "UpperMidTame", "type": "peaking",   "freq": 3200,  "q": 1.2, "gain": 0.0 },
       { "id": "PresenceTame", "type": "peaking",   "freq": 5000,  "q": 2.0, "gain": 0.0 },
       { "id": "Air",          "type": "highshelf", "freq": 10000, "q": 0.7, "gain": 0.0 }
     ],
     "provenance": { "createdBy": "user", "history": [] }
   }
   JSON
   ```

   > **Schema gotcha — all fields are required.** The `create --from-json` command validates against the full Zod preset schema. The daemon does **not** auto-populate missing fields from stdin. Omitting any of `title`, `profile`, `provenance`, `version`, `createdAt`, or `updatedAt` causes exit code 2 with a validation error listing the missing keys. Use ISO 8601 strings for `createdAt`/`updatedAt` (they can be identical). `version` starts at `1`.
   >
   > **Timestamp shell technique.** In real sessions, missing `createdAt`/`updatedAt` is the most common source of multi-attempt failures (attempt 1 omits `profile`/`provenance`, attempt 2 omits the timestamps). The reliable fix is to capture the current UTC time with shell substitution before the heredoc: `NOW=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")`, then use `"$NOW"` for both fields. Heredoc variable substitution requires using `<<JSON` (unquoted delimiter); `<<'JSON'` suppresses expansion. [@session-monster-kanye]
   >
   > **`label` is not a valid field.** The correct key for the display name is `title` (a required `string` ≥ 1 char). A recurring mistake is writing `"label": "Song — Artist"` instead of `"title": "Song"` — this is a contamination from the [[eqgen]] response format, which requests `{ preamp, intent, notes, bands }` with no `title`. When the agent composes the full create-JSON from the eqgen-style prompt output, it must use `title`, not `label`. [@session-closed-on-sunday-2]
   >
   > **Field names on the wire differ from `preset.md`.** The JSON key is `profile` (not `profileId`), and `createdAt`/`updatedAt` live at the top level (not inside `provenance`). `provenance` holds only `createdBy` (string) and `history` (empty array at creation).
   >
   > **Discovery tip.** When unsure about the exact required shape, fetch a real preset first: `tonedeck show <any-existing-slug> --json`. Copy that structure and replace the values. This is the fastest way to avoid schema validation failures.

   If `engaged:true`, add `--apply` to hear it immediately. `create --apply` applies but does not engage on its own; use `tonedeck on <slug>` to engage if needed.
4. **Read the response and relay warnings.** The daemon may clamp gains and auto-trim the preamp. Every warning must be relayed to the user in plain words. Never fight or hide them.
5. **Verify.** `tonedeck status --json` → confirm `activePreset` is the correct slug. Watch `clippedSamples`.
6. **Ask how it sounds.** Never declare success — the user's ears are the only test.
7. **Iterate from their words** (`references/symptom-map.md`). Make **small relative** `tweak` moves: **≤1.5 dB per band per step**. Always pass `--reason "<the user's actual words>"` so the preset history reads like a tuning diary.
8. **Pick the right tool.** Vague request ("warmer", "punchier") → `--vibe`. Specific symptom ("3 kHz is harsh", "too sibilant") → `--band`.

## Hard Rules

- **CLI only.** Never edit preset JSON files on disk, never touch `~/.tonedeck` or CamillaDSP directly. Everything is a `tonedeck` command.
- **Audio broken or "my ears hurt" → `tonedeck panic` first, then `tonedeck doctor`.** Fix state before any tuning.
- **≤1.5 dB per step.** Each workflow execution changes any given band by at most 1.5 dB. Multiple steps are required for larger adjustments.
- **Relay every warning** the CLI returns. A clamp or auto-trim that is silenced is a violation.
- **Never use `--no-clamp` or `--no-auto-trim`** unless the user explicitly demands it and has been warned it removes the clipping safety net.
- **`tweak --band` only moves bands already in the preset or in the 6-band FT1 Pro template.** A new surgical band (e.g. `DeEss`, `MudCut`, `SubTame`) must be baked into the preset JSON at `create` time. It cannot be added with `tweak`.
- **Undo is built in — never hand-reverse a tweak.** `tonedeck revert <slug>` undoes the last saved change; `tonedeck revert <slug> --original` restores v1; `tonedeck versions <slug>` lists history.
- **Editing a loud builtin auto-trims its preamp.** Shipped presets run "hot"; the first `tweak` or apply-through-edit re-runs safety and may drop the preamp ~2 dB. Relay this if the user says "too quiet."

## Band Guide

The skill's band guide maps frequency regions to sonic character for the FiiO FT1 Pro's template bands:

| Band id | Type | Freq | Sonic role |
|---|---|---|---|
| Bass | lowshelf | 60 Hz | body, warmth, sub energy |
| KickBody | peaking | 120 Hz | punch, fullness, upper bass |
| LowMidClean | peaking | 250 Hz | muddiness zone — cut to clear mix congestion |
| UpperMidTame | peaking | 3200 Hz | harshness, attack edge, FT1 Pro brightness peak |
| PresenceTame | peaking | 5000 Hz | sibilance, edge, forward vocal presence |
| Air | highshelf | 10 kHz | openness, sparkle, cymbal detail |

## Symptom Map

- "too harsh / too bright" → cut UpperMidTame and/or PresenceTame
- "lacking body / too thin" → boost Bass and/or KickBody
- "muddy / congested" → cut LowMidClean
- "too polite / missing air" → boost Air
- "too sibilant" → cut PresenceTame

## Vibes vs. Direct Band Edits

`tonedeck tweak --vibe <name>=<step>` for vague taste requests; `--band <id>=<gain>` for specific frequency corrections. The 1.5 dB-per-step rule applies to the net change in any band's gain when using either path. See [[vibes]] for the vibe definitions.

## References in the Skill

`skill/tonedeck-eq/references/` contains three documents loaded by Claude on demand:

- `band-guide.md` — when designing a new preset or deciding which band a symptom maps to
- `symptom-map.md` — a lookup table: listener words → bands → direction + first-step size → concrete `tweak` command
- `worked-examples.md` — three complete transcripts: tuning a new album from scratch, fixing a complaint, and a one-step vibe adjustment

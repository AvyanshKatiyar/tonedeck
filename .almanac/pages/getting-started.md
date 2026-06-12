---
topics: [concepts, flows, stack]
---

# Getting Started

ToneDeck is a per-album parametric EQ system for macOS. It wraps [[camilladsp]] — an external DSP binary — in a control plane consisting of a Fastify [[daemon]], a Commander.js [[cli]], and a React/Vite [[ui]]. A [[claude-skill]] enables natural-language tuning through Claude Code.

## Core idea

A [[preset]] holds six parametric EQ bands tuned for one album, artist, genre, or mood. When engaged, the daemon routes all Mac audio output through BlackHole (a virtual loopback device) into CamillaDSP, which applies the active preset's EQ, then sends processed audio to the real headphone output.

## Data model

The two foundational entities are [[preset]] and [[profile]]. A Profile defines the headphone hardware — its template band frequencies and per-parameter limits. A Preset references a profile and holds the actual per-band gains, preamp level, and metadata for one piece of music.

The only shipped profile is `ft1pro` (FiiO FT1 Pro). The 17 shipped presets are [[builtin-presets]], all Kanye West albums.

## Audio path

```
Mac audio output → BlackHole 2ch (capture) → CamillaDSP (biquad EQ) → headphone output
```

The full routing flow, including the BlackHole silence trap and how the daemon guards against it, is in [[audio-chain]].

## Key subsystems

| Subsystem | Page | File(s) |
|---|---|---|
| Preset schema and versioning | [[preset]] | `packages/shared/src/preset.ts` |
| Profile and limits | [[profile]] | `packages/shared/src/preset.ts` |
| RBJ biquad EQ math | [[band]] | `packages/shared/src/biquad.ts` |
| Vibes (taste → gain deltas) | [[vibes]] | `packages/shared/src/vibes.ts` |
| Gain clamping and headroom | [[safety]] | `packages/shared/src/safety.ts` |
| CamillaDSP YAML generation | [[camillayaml-emitter]] | `packages/shared/src/camillayaml.ts` |
| Engage/disengage/watchdog | [[lifecycle]] | `packages/daemon/src/lifecycle.ts` |
| Preset CRUD and history | [[preset-store]] | `packages/daemon/src/presets.ts` |
| CamillaDSP WebSocket client | [[cdsp-client]] | `packages/daemon/src/cdsp.ts` |
| HTTP daemon | [[daemon]] | `packages/daemon/src/` |
| CLI | [[cli]] | `packages/cli/src/` |
| React UI | [[ui]] | `packages/ui/src/` |
| Claude Code skill | [[claude-skill]] | `skill/tonedeck-eq/SKILL.md` |
| macOS install | [[install]] | `scripts/install.sh` |
| CamillaDSP (external) | [[camilladsp]] | — |

## Repository layout

```
packages/
  shared/   — Zod schemas, biquad math, safety, vibes, YAML emitter
  daemon/   — Fastify HTTP+WS server, Lifecycle, PresetStore, CdspClient
  cli/      — Commander.js commands
  ui/       — React 19 + Vite 6 SPA
profiles/   — ft1pro.json (shipped hardware profile)
presets/builtin/  — 17 Kanye West album presets
skill/tonedeck-eq/  — Claude Code skill
scripts/    — install.sh, smoke tests, migration scripts
```

## Data directory

All runtime state lives in `~/.tonedeck/`: preset files, snapshots under `.history/`, `state.json`, generated YAML, artwork cache, and CamillaDSP logs.

## Testing

260+ Vitest unit tests cover all packages without real audio hardware. All external dependencies (exec, spawn, CdspClient, fetch) are injectable.

---
title: EqGen — Automated EQ Generation via Claude CLI
summary: How eqgen.ts builds prompts and spawns the Claude CLI to generate or re-balance per-track presets for the corpus build pipeline.
topics: [corpus, systems, daemon]
sources:
  - id: eqgen-ts
    type: file
    path: packages/daemon/src/eqgen.ts
    note: All code claims in this page.
  - id: eqgen-test
    type: file
    path: packages/daemon/test/eqgen.test.ts
    note: Confirms behavior: JSON extraction, code fence tolerance, band ID reassignment, error wrapping.
  - id: ft1pro-profile
    type: file
    path: profiles/ft1pro.json
    note: Source of houseNotes injected into the generation prompt.
  - id: stdin-fix-commit
    type: commit
    id: 40bb28f
    note: "fix(daemon): eqgen spawns claude with stdin ignored — explains why stdin must be 'ignore' in batch use."
status: active
verified: 2026-06-17
---

# EqGen

`packages/daemon/src/eqgen.ts` generates per-track parametric EQ presets by building a structured prompt and calling the local Claude CLI (`claude -p`). It is the generation engine behind the [[corpus]] build pipeline and also supports the `optimizeForPreamp` path used when the user changes loudness on an existing preset.

This is distinct from the interactive [[claude-skill]], which guides Claude Code through `tonedeck` CLI commands step-by-step. EqGen talks directly to the Claude CLI and expects a raw JSON response — no commands, no UI, no iterative workflow.

## Two Entry Points

### `generateTrackEq(track, profile, opts)`

Produces a new [[preset]] of `kind: 'track'` from scratch. Builds a prompt describing the headphone chain context, the song's identity, and detailed instructions to author a curve fit for that specific recording. On success, validates the raw JSON through `parsePreset`; the house-limit clamp happens later in [[preset-store]].

### `optimizeForPreamp(preset, targetPreamp, profile, opts)`

Re-balances an existing preset to a new preamp level. Uses a different prompt that supplies the current band configuration, the target preamp, and requests gentle Fletcher-Munson compensation: lift lows and highs when moving quieter; restrain boosts when moving louder. Preserves the original `intent` and `slug`.

## How Claude Is Called

```
spawn('claude', ['-p', '--model', 'sonnet', prompt], {
  env: { ...process.env, MAX_THINKING_TOKENS: '0', PATH },
  stdio: ['ignore', 'pipe', 'pipe'],
})
```

**`stdin: 'ignore'` is mandatory.** Without it, `claude -p` blocks for up to 3 seconds waiting for stdin input and may emit prose warnings instead of JSON. Under concurrent batch use (corpus build with concurrency 3+), this contention reliably produced empty or prose output → `EqGenError('no JSON object')`. The fix was committed in `40bb28f`.

**PATH resolution**: The daemon runs under launchd with a minimal PATH that typically excludes user-installed binaries. `eqgen.ts` prepends `~/.local/bin`, `/opt/homebrew/bin`, and `/usr/local/bin` so `claude` resolves regardless of launch context. Override the binary with `TONEDECK_CLAUDE_BIN`.

**Timeout**: 90 s default; SIGKILL on expiry. Configure via `opts.timeoutMs`.

**`MAX_THINKING_TOKENS=0`**: disables extended thinking, which would bloat the response and slow batch runs.

## JSON Extraction

`extractJson(raw)` handles everything the model might emit:

1. Strips code fences (`` ` `` ` `` `json ... ` `` ` ``).
2. Takes the outermost `{..}` block using `indexOf('{')` and `lastIndexOf('}')`.
3. `JSON.parse`s the result.

Leading prose before the JSON, trailing prose after, and code fences are all tolerated. Any model output that does not contain a valid `{..}` block throws `EqGenError('no JSON object in model output')`.

## Band ID Assignment

Any `id` the model emits on a band object is discarded. `eqgen.ts` always assigns `b1, b2, b3, ...` positionally. This avoids the case where the model invents IDs like `"bass_boost"` that would collide with [[profile]] template band ids.

## Error Handling

All failures throw `EqGenError` (a typed subclass of Error). Callers can check `instanceof EqGenError`. Categories:

- Claude CLI process failed (non-zero exit or spawn error)
- Claude CLI timed out
- Model output contained no valid JSON
- JSON had no `bands` array or an empty one
- Generated candidate failed `parsePreset` schema validation

## Prompt Design

The generation prompt includes three main sections:

1. **Chain context**: `"You are tuning a parametric EQ for the headphone chain '${profile.name}' (${profile.houseNotes})."` — `houseNotes` comes from `profiles/ft1pro.json` and describes preamp defaults, driver characteristics, and primary harshness levers for that headphone.

2. **Song identity**: title, artist, album.

3. **Instructions + rules**: band types, frequency range, gain bounds, preamp bounds (all from `profile.limits`).

### Prompt Evolution

An early version of the instructions ended with:

> "Be conservative — small moves, no more than ~4 dB on any single band."

This instruction (visible in session `00bbda43` from 2026-06-16) produced overly safe, homogeneous curves that sounded similar across different recordings.

The current instruction is deliberately anti-conservative:

> "Be decisive, not generic: a dull/dark mix should gain real top-end air; a harsh/loud modern master should get firm presence/upper-mid cuts … Two genuinely different-sounding songs MUST get genuinely different curves — do NOT default to one safe house shape for everything. Use as much of the available range as the track honestly needs."

The shift from conservative to decisive was motivated by observing that the conservative prompt led to a corpus of near-identical curves, defeating the point of per-track tuning.

## Provenance

Presets generated by `generateTrackEq` carry:

```json
"provenance": { "createdBy": "claude", "model": "sonnet (cli)", "history": [] }
```

This is stable in the schema; `provenance.createdBy` is checked in tests and enables filtering corpus presets from user-authored ones.

## Related Pages

- [[corpus]] — orchestrates bulk calls to `generateTrackEq`
- [[preset]] — the output schema; `kind: 'track'` and `provenance.createdBy: 'claude'` are set by eqgen
- [[preset-store]] — applies the house-limit clamp after eqgen's `parsePreset` validation
- [[claude-skill]] — the interactive Claude Code skill; separate from eqgen's batch path
- [[profile]] — source of `houseNotes` and limits injected into every prompt
- [[safety]] — headroom and clamp pipeline; runs inside PresetStore, not eqgen

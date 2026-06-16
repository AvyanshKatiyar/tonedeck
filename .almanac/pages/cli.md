---
title: CLI — Commander.js tonedeck Command
summary: All tonedeck CLI commands, their flags, and the ApiCtx injection model; corrects outdated names (get→show, ls→list, engage→on, disengage→off) and documents the auto and create commands.
topics: [cli, stack]
sources:
  - id: cli-index
    type: file
    path: packages/cli/src/index.ts
    note: All command registrations and flags; canonical source for command names.
  - id: cli-commands
    type: file
    path: packages/cli/src/commands.ts
    note: actionTweak, actionCreate, actionAuto, actionShow, and all other action implementations.
  - id: cli-format
    type: file
    path: packages/cli/src/format.ts
    note: PresetSummaryRow interface and fmtPresetList — confirms the fields and shape of list --json output.
  - id: session-everything-we-need
    type: session
    session_id: 72e6156f-2a2e-4555-a960-896a8f8c72b9
    note: Session on 2026-06-16 creating track-everything-we-need; agent iterated over tonedeck list --json output incorrectly (over the wrapper object instead of .presets), illustrating the scripting pitfall.
status: active
verified: 2026-06-17
---

# CLI

The CLI is a Commander.js 13 program in `packages/cli/`. The binary is `tonedeck`; a separate `tonedeck-panic` script is installed alongside it for recovery use without a running daemon.

## ApiCtx injection

All commands receive an `ApiCtx` object that holds `fetchFn` and `wsFn`. In production these are `node:fetch` and the `ws` package. In tests, fakes are injected. This makes every command fully testable without a live daemon.

## Commands

**Control:**
- `tonedeck status` — prints engaged state, active preset, bypass flag, and output device
- `tonedeck on [slug]` — engage the DSP; optionally with a preset slug to apply simultaneously
- `tonedeck off` — disengage the DSP
- `tonedeck apply <slug>` — hot-swap the active preset. Engages automatically unless `--no-engage` is passed.
- `tonedeck bypass <on|off>` — enable or disable EQ without disengaging
- `tonedeck panic` — emergency DSP teardown; always exits 0

**Preset CRUD:**
- `tonedeck list` — list all presets with slug, title, artist, kind, and version. With `--json`, returns `{ "presets": [{ slug, title, artist?, kind, version }] }`. **Scripting pitfall:** the JSON output is a wrapper object, not a flat array; `for p in json.load(stdin)` iterates over dict keys (`"presets"`), not preset items. Always index into `.presets` first: `data['presets']`.
- `tonedeck show <slug>` — print the full preset as JSON including band configuration and provenance history
- `tonedeck create --from-json <file>` — create a new preset from a JSON file; use `--from-json -` to read from stdin (heredoc). Flags: `--apply` (apply after creating), `--no-clamp` (skip gain clamping), `--no-auto-trim` (skip silent-band trimming). Refuses if the slug already exists (exit 3, "already exists").
- `tonedeck delete <slug>` — delete a preset
- `tonedeck revert <slug>` — revert to the previous snapshot; `--original` restores v1; `--apply` applies after reverting
- `tonedeck versions <slug>` — list saved version history for a preset
- `tonedeck preview --from-json <file>` — preview what a preset JSON would produce without saving it

**Tuning:**
- `tonedeck tweak <slug>` — apply [[vibes]] deltas and/or direct band edits, then save. Flags: `--band <id>` + `--gain <db>` / `--q <q>` / `--freq <hz>` (repeatable pairs), `--vibe <name=delta>`, `--reason <text>`, `--apply`. Implementation: vibes first → band overrides → PUT. `--reason` is recorded in provenance history. **Only bands already in the preset or in the 6-band FT1 Pro template can be targeted with `--band`.**

**AutoDJ:**
- `tonedeck auto [on|off|status]` — arm, disarm, or check [[autodj]] mode
- `tonedeck auto --now` — force-resolve the current Apple Music track immediately (bypasses debounce)

**Monitoring:**
- `tonedeck meters` — open a WebSocket to `/ws/meters` and stream level data to stdout

**Analysis:**
- `tonedeck clusters` — group presets by tone-only EQ shape; show dB variance that splits them. Flag: `--threshold <db>` (default 1.5).

**Artwork:**
- `tonedeck art <slug>` — show or fetch artwork for a preset

**Diagnostics:**
- `tonedeck doctor` — checks daemon reachability, CamillaDSP binary presence and version, SwitchAudioSource availability, BlackHole 2ch device existence in CoreAudio, DSP state consistency, and preset count. Reports each check as pass/fail/warn.
- `tonedeck health` — alias for the daemon reachability check only

## `actionTweak` Detail

`actionTweak` resolves the named preset, applies any `--vibe <name>=<step>` flags via `applyVibes()`, then applies any `--band <id>=<gain>` direct overrides, then PUTs the result to `PUT /api/presets/:slug`. The two-phase order (vibes before bands) means band overrides win over vibe deltas for any band they share.

## `create` Stdin Pattern

The [[claude-skill]] uses `create --from-json -` with a heredoc to create presets from scratch:

```bash
tonedeck create --from-json - <<'JSON'
{ "schemaVersion":1, "slug":"track-water-jesus-is-king", "kind":"track", ... }
JSON
```

This is the canonical path for authoring a new preset in a scripted or Claude-driven context.

## Error Display

Non-2xx HTTP responses are printed with status code and body text. `StoreError` codes `rejected` and `invalid` are printed with the server's error message, which includes the specific headroom or validation failure detail.

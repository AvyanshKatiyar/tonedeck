---
topics: [cli, stack]
files: [packages/cli/src/commands.ts, packages/cli/src/index.ts]
---

# CLI

The CLI is a Commander.js 13 program in `packages/cli/`. The binary is `tonedeck`; a separate `tonedeck-panic` script is installed alongside it for recovery use without a running daemon.

## ApiCtx injection

All commands receive an `ApiCtx` object that holds `fetchFn` and `wsFn`. In production these are `node:fetch` and the `ws` package. In tests, fakes are injected. This makes every command fully testable without a live daemon.

## Commands

**Control:**
- `tonedeck status` — prints engaged state, active preset, bypass flag, and output device
- `tonedeck engage` — starts CamillaDSP and routes Mac output through BlackHole
- `tonedeck disengage` — stops CamillaDSP and restores Mac output
- `tonedeck apply <slug>` — hot-swaps the active preset while engaged
- `tonedeck bypass [on|off]` — enables or disables EQ without disengaging
- `tonedeck panic` — kills CamillaDSP immediately; always exits 0

**Preset CRUD:**
- `tonedeck ls` — lists all presets with slug, label, version, and kind
- `tonedeck get <slug>` — prints the full preset as JSON
- `tonedeck create <slug>` — creates a new preset from a JSON file or interactive prompts
- `tonedeck update <slug>` — replaces a preset from a JSON file
- `tonedeck delete <slug>` — deletes a preset
- `tonedeck revert <slug>` — reverts to the previous snapshot
- `tonedeck reset <slug>` — resets to the original builtin version

**Tuning:**
- `tonedeck tweak <slug> [options]` — applies [[vibes]] deltas and/or direct band edits, then saves. Implementation: vibes first → band overrides → PUT. This is the primary command the [[claude-skill]] uses.

**Monitoring:**
- `tonedeck meters` — opens a WebSocket to `/ws/meters` and streams level data to stdout

**Diagnostics:**
- `tonedeck doctor` — checks daemon reachability, camilladsp binary presence and version, SwitchAudioSource availability, BlackHole 2ch device existence in CoreAudio, DSP state consistency (engaged but no process, or process but not engaged), and preset count. Reports each check as pass/fail/warn.

## `actionTweak` detail

`actionTweak` resolves the named preset, applies any `--vibe <name>=<step>` flags via `applyVibes()`, then applies any `--band <id>=<gain>` direct overrides, then PUTs the result to `PUT /api/presets/:slug`. The two-phase order (vibes before bands) means band overrides win over vibe deltas for any band they share.

## Error display

Non-2xx HTTP responses are printed with status code and body text. `StoreError` codes `rejected` and `invalid` are printed with the server's error message, which includes the specific headroom or validation failure detail.

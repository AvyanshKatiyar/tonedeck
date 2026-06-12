# ToneDeck

Per-album parametric EQ for macOS. A daemon controls CamillaDSP with per-album biquad filter presets; a React UI lets you switch albums by clicking artwork; and a Claude Code skill generates and tunes presets from natural-language descriptions.

## Features

- Glitch-free live switching — applies a new preset without restarting CamillaDSP (no audio dropout)
- Art-forward grid UI — click album art to engage; active album highlighted
- 16-band parametric EQ canvas with real-time frequency curve preview
- Vibe sliders (Warmth, Brightness, Punch, Air, Depth) that translate to biquad adjustments
- Claude Code skill — talk to Claude: "make MBDTF warmer" and it generates and applies the changes
- Safety rails — auto-trim guard prevents inter-band conflicts; silence-trap guard detects BlackHole output without CamillaDSP (fixes automatically); panic always exits 0

## Quickstart

```sh
# 1. Install (builds, installs daemon, registers skill)
./scripts/install.sh

# 2. Open the UI
open http://127.0.0.1:5055

# 3. Click an album to engage EQ
# 4. Talk to Claude: "make Yeezus brighter"
```

## CLI cheatsheet

| Command | Description |
|---|---|
| `tonedeck status` | Show engaged state, active preset, DSP status |
| `tonedeck list` | List all presets |
| `tonedeck on mbdtf` | Engage EQ with MBDTF preset |
| `tonedeck off` | Disengage EQ (stop CamillaDSP) |
| `tonedeck apply yeezus` | Switch to Yeezus while engaged |
| `tonedeck bypass --on` | Bypass EQ (passthrough) |
| `tonedeck tweak mbdtf --vibe warmth=2` | Adjust a vibe slider |
| `tonedeck panic` | Emergency: kill DSP + restore output device |
| `tonedeck doctor` | Healthcheck: daemon, DSP, device |
| `tonedeck create --from-json < preset.json` | Import a preset |

All commands support `--url` to target a non-default daemon URL and `--json` for machine-readable output.

## Architecture

BlackHole 2ch (loopback) → CamillaDSP ← daemon WebSocket control

Presets are canonical JSON (`presets/builtin/*.json` for builtins, `~/.tonedeck/presets/` for user presets). The daemon generates CamillaGUI-compatible YAML on apply and pushes it over the CamillaDSP WebSocket without process restart. The UI connects to the daemon over HTTP/WebSocket on port 5055. The CLI is a thin HTTP client over the same port.

## Recovery

If audio sounds wrong or is silent: see [RECOVERY.md](RECOVERY.md).

## Dev commands

```sh
npm install           # install all workspace dependencies
npm run build         # build all packages (shared → daemon, cli, ui)
npm test              # run tests (vitest)
npm run typecheck     # typecheck all TypeScript packages
npm run dev:daemon    # build shared then run daemon in watch mode (tsx)
npm run smoke:control # live EQ switching smoke (needs camilladsp + headphones)
npm run smoke:skill   # skill command surface smoke (no audio needed)
npm run smoke:panic   # panic script unit test (no audio touched)
```

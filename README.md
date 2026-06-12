# ToneDeck

Per-album (and per-song) parametric EQ for macOS — for people who don't know what a lowshelf is.

A local daemon drives [CamillaDSP](https://github.com/HEnquist/camilladsp) over its websocket API; a dark, album-art-forward web UI switches EQ presets glitch-free with one click; and a bundled [Claude Code](https://claude.com/claude-code) skill lets you tune by talking: *"tune All of the Lights"*, *"this sounds harsh"*, *"make it warmer"*, *"go back to the original"*.


<img width="3420" height="2188" alt="image" src="https://github.com/user-attachments/assets/03c2adf1-7532-4eb9-976a-31ff76eca1fc" />

## Features

- **Glitch-free live switching** — presets hot-swap over the CamillaDSP websocket; the DSP process never restarts between albums (verified PID-stable).
- **Art-forward UI** — album grid with artwork (iTunes, cached locally), live EQ frequency-response curve, L/R meters with a clip light, A/B bypass, and an always-visible panic button.
- **Vibe sliders** — Warmth · Punch · Clarity · Smoothness · Sparkle map plain-language taste onto the underlying biquads, with live preview while you drag.
- **Songs, not just albums** — per-track presets (`kind: "track"`) designed as deltas off their album's preset; add them from the UI's Album/Song search or by asking Claude.
- **Claude Code skill** — a complete tuning methodology (band guide, symptom→band map, worked examples) so Claude designs presets from real production knowledge and iterates from your words, through the CLI only.
- **Versioned with undo** — every save snapshots the previous version; `tonedeck revert` undoes the last change, `--original` restores factory values. Nothing is ever lost.
- **Safety rails in the engine, not the callers** — gain clamps per headphone profile, predicted-headroom auto-trim against clipping, `camilladsp --check` before every apply, a guard against the BlackHole "silence trap", watchdogs that self-heal when macOS steals the output device or the DSP dies, and a panic path that works even with the daemon dead.

## Requirements

macOS (Apple Silicon or Intel), plus:

```sh
brew install blackhole-2ch                      # virtual loopback device
brew install camilladsp                         # the DSP engine (≥ 2.0; built on 4.x)
brew install switchaudio-osx                    # output-device switching
# Node.js ≥ 22
```

The included headphone profile is for the **FiiO FT1 Pro** (`profiles/ft1pro.json`). For other headphones, copy it, adjust the band template/limits/device name, and point your presets' `profile` field at it.

## Install

```sh
git clone https://github.com/AvyanshKatiyar/tonedeck && cd tonedeck
./scripts/install.sh          # builds, installs CLI + panic script, generates the
                              # LaunchAgent for this machine, registers the Claude skill
open http://127.0.0.1:5055
```

Click an album → ToneDeck routes system audio through BlackHole into CamillaDSP and out to your headphones. The **Engage/Disengage** button controls whether ToneDeck owns audio at all; **panic** (UI button or `tonedeck-panic` in a terminal) always returns audio to a real device. `./scripts/uninstall.sh` reverses everything but keeps your presets.

## Talk to it

With [Claude Code](https://claude.com/claude-code) installed, the skill is registered by the installer:

> *"tune Madvillainy for my headphones"* → Claude designs a preset from the album's production character, applies it, verifies, and asks how it sounds.
> *"vocals are buried"* / *"too much bass"* → small, reasoned band moves, logged with your words as the change history.
> *"undo that"* / *"back to the original"* → built-in revert.

## CLI

| Command | What it does |
|---|---|
| `tonedeck status` / `doctor` | State of the chain / full healthcheck |
| `tonedeck list` / `show <slug>` | Browse presets |
| `tonedeck on [slug]` / `off` / `panic` | Engage / disengage / emergency stop |
| `tonedeck apply <slug>` | Switch preset (glitch-free) |
| `tonedeck bypass on\|off` | A/B against flat |
| `tonedeck tweak <slug> --vibe warmth=1` | Vibe or `--band`-level adjustments |
| `tonedeck revert <slug> [--original\|--to N]` | Undo / restore any version |
| `tonedeck create --from-json -` | New preset from stdin JSON |
| `tonedeck meters --watch` | Live RMS/peak/clip readout |

Every verb takes `--json` (machine output, stable exit codes) — the CLI is the contract the Claude skill drives, and the seam a future MCP server will wrap.

## How it works

```
Mac audio → BlackHole 2ch → CamillaDSP (biquad EQ) → your headphones
                               ↑ websocket (SetConfig, meters, clip counters)
                            daemon (Fastify, :5055) ← UI / CLI / Claude skill
```

Presets are canonical JSON (`presets/builtin/`, user copies in `~/.tonedeck/presets/`); CamillaDSP YAML is a generated artifact. The devices block is byte-identical across presets by construction — that's what makes hot-swapping seamless. The daemon is a control plane: it can restart freely without killing audio, and re-adopts a running DSP on boot.

## Development

```sh
npm install && npm run build && npm test   # 260+ tests, no audio hardware needed
npm run typecheck
npm run dev:daemon                          # daemon in watch mode
npm run smoke:control                       # live end-to-end battery (needs camilladsp)
npm run smoke:skill                         # validates every CLI command in the skill docs
npm run smoke:panic                         # panic-script logic, fully shimmed
```

Monorepo: `packages/shared` (schema, RBJ biquad math, safety, YAML emitter) · `packages/daemon` · `packages/cli` · `packages/ui` (Vite + React) · `skill/tonedeck-eq`.

If audio ever sounds wrong: [RECOVERY.md](RECOVERY.md).

## License

[MIT](LICENSE)

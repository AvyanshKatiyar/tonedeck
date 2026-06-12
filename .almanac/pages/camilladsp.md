---
topics: [stack, audio]
files: [packages/daemon/src/cdsp.ts, packages/daemon/src/lifecycle.ts, packages/shared/src/camillayaml.ts]
---

# CamillaDSP

CamillaDSP is an open-source, cross-platform audio DSP engine. ToneDeck uses it as the EQ processing binary — Mac audio flows through it via BlackHole, and it applies the active [[preset]]'s biquad filter chain.

## Version

ToneDeck's WebSocket protocol implementation is verified against CamillaDSP **4.1.3** (commit `05e9cfc`). The protocol may differ in earlier or later versions.

## Config format

CamillaDSP reads a YAML config file on launch and reloads it when sent a `SetConfig` command. The YAML has three top-level sections:
- `devices:` — capture and playback CoreAudio device names, sample rate, chunk size, buffer target
- `filters:` — named filter definitions, each of type `Biquad` with `freq`, `q`, and `gain`
- `pipeline:` — ordered list of filter names to apply; CamillaDSP processes them in sequence

[[camillayaml-emitter]] generates this YAML. The `devices:` block is kept byte-identical across presets on the same [[profile]] + output device to enable glitch-free `SetConfig` hot-swaps.

## WebSocket API

CamillaDSP listens on `ws://127.0.0.1:1234` by default. The protocol is JSON: each message is a JSON object where the top-level key is the command name and the value is the command payload (or null for commands with no payload). Responses are JSON objects with the same key and a result value. Responses arrive in the same FIFO order as requests — there are no correlation IDs.

Key commands used by ToneDeck:

| Command | Purpose |
|---|---|
| `SetConfig` | Load a new YAML config file path; glitch-free if `devices:` is unchanged |
| `GetVolume` | Read current capture/playback volume levels |
| `GetClippedSamples` | Read count of clipped samples since last reset |
| `Stop` | Stop audio processing and exit cleanly |
| `Exit` | Terminate the process |

## Process lifecycle

[[lifecycle]] spawns CamillaDSP with the generated YAML path as argument and captures stderr to `~/.tonedeck/logs/camilladsp.log`. On daemon restart with `AbandonProcessGroup=true` in the LaunchAgent plist, CamillaDSP survives and is re-adopted rather than respawned.

## Config validation

`camilladsp --check <path>` validates a YAML config file and exits 0 if valid. [[lifecycle]] runs this check before every `engage()` and `apply()`. A failed check aborts the operation.

## Fixed parameters

Sample rate is hardcoded at 48000 Hz. BlackHole 2ch operates at 48000 Hz natively; using any other rate would require sample rate conversion. Chunk size is 1024 samples (≈21 ms at 48 kHz). Format is F32 (32-bit floating point).

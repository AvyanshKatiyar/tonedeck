---
topics: [systems, flows, daemon]
files: [packages/daemon/src/lifecycle.ts]
---

# Lifecycle

`Lifecycle` is the class in [[packages/daemon/src/lifecycle.ts]] that owns all engage/disengage state and controls the CamillaDSP process. It extends `EventEmitter` and is the single authority on whether ToneDeck is engaged, which preset is active, and what the current output device is.

## Persistent state

State is stored atomically to `~/.tonedeck/state.json` after every mutation:

```json
{
  "engaged": true,
  "activePreset": "mbdtf",
  "lastRealOutput": "FiiO FT1 Pro",
  "bypass": false
}
```

All file writes go through atomic rename (write temp → fsync → rename) to prevent partial-state files on crash.

## Mutex serialization

All mutating methods (`engage`, `disengage`, `apply`, `bypass`) are serialized through a promise-chain mutex. Only two methods bypass the mutex: `panic()` (must be able to kill the process regardless of what else is running) and `status()` (read-only, always safe to call concurrently).

## Reconcile on boot

On daemon startup, `Lifecycle` reads `state.json`. If `engaged` is `true`, it searches for a running CamillaDSP process by pid or port. If found, it re-adopts the process — wiring up the [[cdsp-client]] to the existing WebSocket without spawning a new process. If not found, it resets `engaged` to `false` in state. The daemon never auto-spawns CamillaDSP on startup.

## engage()

1. Calls `resolvePlaybackDevice()` — finds the real headphone output, never returns a BlackHole device.
2. Writes the active preset's YAML to `~/.tonedeck/generated/active.yml` via [[camillayaml-emitter]].
3. Runs `camilladsp --check active.yml` to validate before launch.
4. Spawns the CamillaDSP process; connects [[cdsp-client]].
5. Calls SwitchAudioSource to set Mac system output to BlackHole 2ch.
6. Persists state.

## apply(slug)

1. Fetches the preset from [[preset-store]].
2. Overwrites `~/.tonedeck/generated/active.yml` with the new preset's YAML.
3. Runs `camilladsp --check` on the new YAML.
4. Sends `SetConfig` over [[cdsp-client]] with the path to the new YAML file.
5. Updates `activePreset` in state.

The hot-swap is glitch-free because the `devices:` block in the YAML is byte-identical across presets on the same [[profile]] + output device. [[camillayaml-emitter]] guarantees this.

## disengage()

1. Sends `Stop` then `Exit` over [[cdsp-client]] using `terminatingCommand()`.
2. Restores Mac system output to `lastRealOutput` via SwitchAudioSource.
3. Resets `engaged`, `activePreset` to null in state.

## bypass(on)

Sets the `bypass` flag in state and sends a `SetConfig` with either the current preset YAML or a flat (zero-gain) YAML. Audio continues routing through BlackHole → CamillaDSP → headphones; EQ is simply not applied.

## panic()

Kills the CamillaDSP process group immediately with SIGKILL, bypassing the mutex and [[cdsp-client]]. Always returns HTTP 200 regardless of prior state. Resets `engaged` to false. Intended for recovery when the daemon is unresponsive or the CamillaDSP process is stuck.

## Device watchdog

A 3-second interval timer runs while engaged and checks:
- **Device vanished**: the playback output device is no longer available in CoreAudio → call `disengage()`.
- **Output stolen**: Mac system output is no longer BlackHole → call SwitchAudioSource to reassert it, with a 15-second cooldown between re-route attempts. On the second theft within the cooldown window, `disengage()` is called instead.

## Events emitted

- `'state'` — emitted after any state mutation; payload is the new state object
- `'applied'` — emitted after a successful `apply()`; payload includes the new preset slug

[[daemon]]'s `MeterBroadcaster` relays both events to all connected WebSocket clients.

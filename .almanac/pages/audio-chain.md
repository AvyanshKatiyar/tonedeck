---
topics: [flows, audio, stack]
files: [packages/daemon/src/lifecycle.ts, packages/shared/src/camillayaml.ts]
---

# Audio Chain

The end-to-end audio path from a Mac application's playback output to headphones, with ToneDeck engaged.

## Signal path

```
Mac audio output (CoreAudio)
  → BlackHole 2ch (virtual loopback — capture device)
  → CamillaDSP process (biquad EQ applied here)
  → Real headphone output (e.g., FiiO FT1 Pro via USB)
```

Mac audio is routed to "BlackHole 2ch" as the system output device (set programmatically by the `engage` command using SwitchAudioSource, or set manually by the user). BlackHole is a kernel extension that makes a virtual audio device appear in CoreAudio. CamillaDSP is configured to read from BlackHole as its capture device and write to the headphone interface as its playback device. The processed audio arrives at the headphones with the active [[preset]]'s parametric EQ applied.

## The BlackHole silence trap

BlackHole is simultaneously the Mac's output device (where apps send audio) and CamillaDSP's input device (where CamillaDSP reads audio). If CamillaDSP's output device is also set to BlackHole, audio routes in a loop: Mac → BlackHole → CamillaDSP → BlackHole → CamillaDSP → … with no path to the headphones. The result is total silence.

This is guarded against at two layers:

1. **`assertSafePlaybackDevice()`** in [[`packages/shared/src/camillayaml.ts`]] throws if the playback device name is empty, the string `"null"`, or contains the substring `"BlackHole"` (case-insensitive).
2. **`resolvePlaybackDevice()`** in [[`packages/daemon/src/lifecycle.ts`]] is the authoritative resolver for which output device to use. It never returns a BlackHole device. If the stored `lastRealOutput` matches a BlackHole pattern, it refuses it and falls back to another available CoreAudio device.

## Device watchdog

[[lifecycle]] runs a watchdog loop every 3 seconds while engaged. It checks two conditions:

- **Device vanished**: the playback device no longer appears in CoreAudio. Response: disengage immediately.
- **Output theft**: another application has changed the Mac's system output device away from BlackHole while ToneDeck is engaged. Response: re-route (call SwitchAudioSource to reassert BlackHole as output) with a 15-second cooldown between re-route attempts. If theft occurs a second time within the cooldown, disengage permanently rather than fighting the other application.

## State persistence

`~/.tonedeck/state.json` records `{engaged, activePreset, lastRealOutput, bypass}`. `lastRealOutput` is the headphone output device name at the time of last engage. On daemon restart, this field lets [[lifecycle]] reconcile: if `engaged` is true and the CamillaDSP process is still running, the daemon re-adopts it rather than spawning a new one.

## Bypass mode

When bypass is active, the active preset's EQ is suspended but audio still routes through BlackHole → CamillaDSP → headphones. CamillaDSP runs with a flat filter chain (all band gains zero). Bypass does not change the system output device.

## Generated YAML location

[[camillayaml-emitter]] writes the current configuration to `~/.tonedeck/generated/active.yml`. CamillaDSP is launched with this file and, on preset changes, receives a `SetConfig` WebSocket command pointing to it (after the file is atomically overwritten).

---
topics: [incidents, audio, daemon]
files: [packages/daemon/src/lifecycle.ts]
---

# Buffer-underrun stutter (2026-06-12)

Audible stutter on the live install: CamillaDSP hit a playback buffer underrun every ~8.5 seconds, logged in `~/.tonedeck/logs/camilladsp.log` as a repeating pair — `Playback interrupted, no data available` followed by `Restarting playback after buffer underrun` (49 occurrences between 20:59 and 21:05).

## Why diagnosis was non-obvious

Every daemon-level health signal was green while audio was audibly broken:

- `tonedeck doctor` — all checks PASS
- `tonedeck status` — `dspState: Running`, `clippedSamples: 0`
- `tonedeck meters` — signal flowing at healthy RMS/peak levels
- Config valid: both BlackHole 2ch and External Headphones at 48000 Hz, `enable_rate_adjust: true`, `target_level: 512`, `chunksize: 1024`

The only evidence was in the CamillaDSP log file. The daemon does not surface underrun warnings.

## Root cause

The camilladsp process had run clean for 57 minutes (started 20:02, first underrun 20:59), then degraded mid-flight with no config change. The metronome-regular underrun cadence with matched sample rates indicates a stale CoreAudio stream — typically the aftermath of a device re-enumeration or sleep/wake event — that the running process never recovered from. The affected instance was one the daemon had *adopted* at boot ([[lifecycle]] adoption path) rather than spawned itself.

## Fix

Cycle the engine so the daemon respawns camilladsp with fresh CoreAudio streams:

```
tonedeck off && tonedeck on <preset>
```

Verified: 45-second log watch after restart showed zero new underruns (the prior cadence would have produced ~5).

## Possible hardening

The watchdog in [[packages/daemon/src/lifecycle.ts]] could tail the camilladsp log for the underrun signature and auto-cycle (or at least surface a warning in `tonedeck status`/`doctor`), since all existing health checks are blind to this failure mode.

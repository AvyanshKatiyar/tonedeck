---
topics: [systems, audio, stack]
files: [packages/shared/src/camillayaml.ts]
---

# CamillaYaml Emitter

[[packages/shared/src/camillayaml.ts]] renders the YAML configuration files that [[camilladsp]] consumes. It uses the `yaml` npm package and never uses string templates, ensuring consistent output.

## `assertSafePlaybackDevice(name)`

Throws if the playback device name is the empty string, the string `"null"`, or contains the substring `"BlackHole"` (checked case-insensitively). This is the first line of defense against the [[audio-chain]] silence trap — routing CamillaDSP's output to BlackHole would cause total silence.

## `emitDevicesBlock(profile, captureDevice, playbackDevice)`

Produces the `devices:` section of the CamillaDSP YAML. Key fixed values:

```yaml
devices:
  samplerate: 48000
  chunksize: 1024
  target_level: 512
  capture:
    type: CoreAudio
    device: "BlackHole 2ch"
    format: F32
  playback:
    type: CoreAudio
    device: "<resolved output device>"
    format: F32
```

The sample rate (48000 Hz), chunk size (1024), target level (512), format (F32), and CoreAudio type are hardcoded. The capture device is always BlackHole 2ch. The playback device comes from [[lifecycle]]'s `resolvePlaybackDevice()`.

## Hot-swap guarantee

Given the same profile id and playback device name, `emitDevicesBlock()` always produces byte-identical output. Two presets on `ft1pro` targeting the same headphone output will have identical `devices:` blocks. Because CamillaDSP's `SetConfig` performs a glitch-free config swap when the `devices:` block is unchanged, applying a new preset while engaged does not interrupt audio.

If the profile or output device changes between presets, the hot-swap guarantee does not hold. In practice this does not occur because ToneDeck's shipped presets all use the `ft1pro` profile.

## `emitCamillaYaml(preset, profile, playbackDevice)`

Calls `assertSafePlaybackDevice()`, builds the full YAML document with three sections:

1. `devices:` — via `emitDevicesBlock()`
2. `filters:` — one entry per band, each of type `Biquad` with `freq`, `q`, and `gain` parameters
3. `pipeline:` — a `Mixer` followed by each filter in band order

The filter names in `filters:` and `pipeline:` are derived from the band id (slugified). The resulting YAML is written to `~/.tonedeck/generated/active.yml` atomically before every `engage()` or `apply()`.

## Validation before use

After writing the YAML, [[lifecycle]] runs `camilladsp --check active.yml` to validate the config before either launching a new CamillaDSP process or sending `SetConfig`. If `--check` exits non-zero, the operation is aborted and the error is surfaced to the caller.

/**
 * CamillaDSP 4.x YAML emitter. Built from objects + the `yaml` package — never
 * string templates — so output is deterministic (stable key order) and the
 * `devices:` block is byte-identical across presets that share a profile and
 * playback device. That byte-identity is what lets the daemon hot-swap configs
 * over CamillaDSP's websocket without an audio glitch (only filters/pipeline
 * differ between presets).
 *
 * The playback-device guard defends a real bug seen live on this machine: a
 * generated config with `device: null` made CamillaDSP play back INTO BlackHole
 * (the capture loopback) → total silence.
 */
import YAML from 'yaml'
import type { Band, Preset, Profile } from './preset.js'

const TYPE_MAP: Record<Band['type'], string> = {
  lowshelf: 'Lowshelf',
  peaking: 'Peaking',
  highshelf: 'Highshelf',
}

function assertSafePlaybackDevice(name: string, captureDeviceName: string): void {
  if (!name) {
    throw new Error(
      'emitCamillaYaml: playbackDeviceName is empty/falsy — refusing to emit. An empty/null playback device makes CamillaDSP output into nothing (silence).',
    )
  }
  const lower = name.toLowerCase()
  if (lower === 'null') {
    throw new Error(
      'emitCamillaYaml: playbackDeviceName is the literal string "null" — refusing to emit. This exact value routed output to a null device → silence.',
    )
  }
  if (lower === captureDeviceName.toLowerCase()) {
    throw new Error(
      `emitCamillaYaml: playbackDeviceName ("${name}") equals the capture device — refusing to emit. Output would loop back into the capture device → silence.`,
    )
  }
  if (lower.includes('blackhole')) {
    throw new Error(
      `emitCamillaYaml: playbackDeviceName ("${name}") contains "blackhole" — refusing to route output into the BlackHole loopback (the silence trap).`,
    )
  }
}

export interface CamillaDevicesBlock {
  samplerate: number
  chunksize: number
  target_level: number
  enable_rate_adjust: boolean
  capture: { type: 'CoreAudio'; channels: number; device: string; format: 'F32' }
  playback: {
    type: 'CoreAudio'
    channels: number
    device: string
    format: 'F32'
    exclusive: boolean
  }
}

/** The CamillaDSP `devices:` block — identical for any preset on this profile. */
export function emitDevicesBlock(
  profile: Profile,
  playbackDeviceName: string,
): CamillaDevicesBlock {
  assertSafePlaybackDevice(playbackDeviceName, profile.captureDeviceName)
  return {
    samplerate: 48000,
    chunksize: 1024,
    target_level: 512,
    enable_rate_adjust: true,
    capture: { type: 'CoreAudio', channels: 2, device: profile.captureDeviceName, format: 'F32' },
    playback: {
      type: 'CoreAudio',
      channels: 2,
      device: playbackDeviceName,
      format: 'F32',
      exclusive: false,
    },
  }
}

/** Render a full, deterministic CamillaDSP 4.x config for a preset. */
export function emitCamillaYaml(
  preset: Preset,
  profile: Profile,
  playbackDeviceName: string,
): string {
  const devices = emitDevicesBlock(profile, playbackDeviceName)

  const filters: Record<string, unknown> = {
    Preamp: {
      type: 'Gain',
      parameters: { gain: preset.preamp, inverted: false, mute: false, scale: 'dB' },
    },
  }
  for (const band of preset.bands) {
    filters[band.id] = {
      type: 'Biquad',
      parameters: { type: TYPE_MAP[band.type], freq: band.freq, gain: band.gain, q: band.q },
    }
  }

  const pipeline = [
    { type: 'Filter', channels: [0, 1], names: ['Preamp', ...preset.bands.map((b) => b.id)] },
  ]

  const config = {
    title: `${profile.name} - ${preset.title}`,
    description: preset.intent,
    devices,
    filters,
    pipeline,
  }

  return YAML.stringify(config)
}

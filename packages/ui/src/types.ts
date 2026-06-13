/**
 * types.ts — UI-facing copies of the daemon's wire shapes (the daemon's
 * internal types aren't a published package, so the contract lives here).
 */
import type { Preset } from '@tonedeck/shared'
export type { Preset, Profile, Band, VibeName } from '@tonedeck/shared'

export interface Status {
  engaged: boolean
  bypass: boolean
  activePreset: string | null
  dspState: string | null
  clippedSamples: number | null
  devices: { current: string | null; saved: string | null; outputs: string[] }
  dspVersion: string | null
  lastEvent: string | null
}

export interface PresetSummary {
  slug: string
  kind: string
  title: string
  artist?: string
  album?: string
  intent: string
  version: number
  profile: string
  artwork?: { itunesCollectionId?: number; url?: string; cachedFile?: string }
  updatedAt: string
}

export interface ArtworkResult {
  collectionId: number
  artistName: string
  collectionName: string
  artworkUrl100: string
  artworkUrl600: string
  /** Present for song searches. */
  trackId?: number
  trackName?: string
}

export interface ApplyResponse {
  status: Status
  warnings: string[]
  verdict: string
}

export interface MutationResponse {
  preset: Preset
  warnings: string[]
  verdict: string
}

export interface Meters {
  rms: [number, number]
  peak: [number, number]
  clippedSamples: number
}

export type WsMessage =
  | { type: 'meters'; rms: [number, number]; peak: [number, number]; clippedSamples?: number }
  | { type: 'state' }
  | { type: 'applied' }
  | { type: 'auto'; mode: 'off' | 'armed' | 'yielded'; generating?: boolean }

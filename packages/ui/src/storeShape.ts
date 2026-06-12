/**
 * storeShape.ts — the store's data shape: state, actions interface, the pure
 * reducer, and constants. Kept separate from the provider/hooks (store.tsx) and
 * the thunked action factory (storeActions.ts) so each file stays focused.
 */
import type { Preset, PresetSummary, Profile, Status, VibeName } from './types.js'

export interface Toast {
  id: number
  kind: 'info' | 'warn' | 'error'
  text: string
}

export const ZERO_VIBES: Record<VibeName, number> = {
  warmth: 0,
  punch: 0,
  clarity: 0,
  smoothness: 0,
  sparkle: 0,
}

export interface State {
  phase: 'loading' | 'ready' | 'unreachable'
  status: Status | null
  presets: PresetSummary[]
  profile: Profile | null
  drawerSlug: string | null
  base: Preset | null
  draft: Preset | null
  vibes: Record<VibeName, number>
  addOpen: boolean
  applyingSlug: string | null
  toasts: Toast[]
  clipAck: number
}

export const initial: State = {
  phase: 'loading',
  status: null,
  presets: [],
  profile: null,
  drawerSlug: null,
  base: null,
  draft: null,
  vibes: ZERO_VIBES,
  addOpen: false,
  applyingSlug: null,
  toasts: [],
  clipAck: 0,
}

export type Action =
  | { t: 'ready'; status: Status; presets: PresetSummary[]; profile: Profile }
  | { t: 'unreachable' }
  | { t: 'status'; status: Status }
  | { t: 'presets'; presets: PresetSummary[] }
  | { t: 'drawerOpen'; slug: string; preset: Preset }
  | { t: 'drawerClose' }
  | { t: 'draft'; draft: Preset }
  | { t: 'vibes'; vibes: Record<VibeName, number>; draft: Preset }
  | { t: 'revert' }
  | { t: 'add'; open: boolean }
  | { t: 'applying'; slug: string | null }
  | { t: 'toast'; toast: Toast }
  | { t: 'untoast'; id: number }
  | { t: 'clipAck'; value: number }

export function reducer(s: State, a: Action): State {
  switch (a.t) {
    case 'ready':
      return { ...s, phase: 'ready', status: a.status, presets: a.presets, profile: a.profile }
    case 'unreachable':
      return { ...s, phase: 'unreachable' }
    case 'status':
      return { ...s, phase: 'ready', status: a.status }
    case 'presets':
      return { ...s, presets: a.presets }
    case 'drawerOpen':
      return { ...s, drawerSlug: a.slug, base: a.preset, draft: a.preset, vibes: ZERO_VIBES }
    case 'drawerClose':
      return { ...s, drawerSlug: null, base: null, draft: null, vibes: ZERO_VIBES }
    case 'draft':
      return { ...s, draft: a.draft }
    case 'vibes':
      return { ...s, vibes: a.vibes, draft: a.draft }
    case 'revert':
      return { ...s, draft: s.base, vibes: ZERO_VIBES }
    case 'add':
      return { ...s, addOpen: a.open }
    case 'applying':
      return { ...s, applyingSlug: a.slug }
    case 'toast':
      return { ...s, toasts: [...s.toasts, a.toast] }
    case 'untoast':
      return { ...s, toasts: s.toasts.filter((t) => t.id !== a.id) }
    case 'clipAck':
      return { ...s, clipAck: a.value }
    default:
      return s
  }
}

export interface Actions {
  refreshStatus: () => Promise<void>
  refreshPresets: () => Promise<void>
  toast: (text: string, kind?: Toast['kind']) => void
  dismissToast: (id: number) => void
  applyPreset: (slug: string) => Promise<void>
  engage: () => Promise<void>
  disengage: () => Promise<void>
  bypass: (on: boolean) => Promise<void>
  panic: () => Promise<void>
  openDrawer: (slug: string) => Promise<void>
  closeDrawer: () => void
  setVibes: (vibes: Record<VibeName, number>) => void
  setDraft: (draft: Preset) => void
  revert: () => void
  preview: (draft: Preset) => Promise<void>
  save: (change: string, reason: string) => Promise<void>
  resetOriginal: () => Promise<void>
  deletePreset: () => Promise<void>
  setAddOpen: (open: boolean) => void
  ackClip: () => void
}

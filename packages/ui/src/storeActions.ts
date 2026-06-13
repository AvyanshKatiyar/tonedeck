/**
 * storeActions.ts — the thunked action factory. Each action calls `api` and
 * dispatches the result; failures surface as error toasts, daemon warnings as
 * warn toasts. Actions read the latest committed state through `ref` (a stable
 * ref the provider updates every render) so their identities never change.
 */
import type { Dispatch, MutableRefObject } from 'react'
import { api, ApiError } from './api.js'
import { applyVibesDraft } from './vibedraft.js'
import { ZERO_VIBES, type Action, type Actions, type State, type Toast } from './storeShape.js'

let toastSeq = 1

export function createActions(
  dispatch: Dispatch<Action>,
  ref: MutableRefObject<State>,
): Actions {
  const toast = (text: string, kind: Toast['kind'] = 'info') => {
    const t = { id: toastSeq++, kind, text }
    dispatch({ t: 'toast', toast: t })
    setTimeout(() => dispatch({ t: 'untoast', id: t.id }), 3000)
  }
  const warnToasts = (warnings: string[]) => warnings.forEach((w) => toast(w, 'warn'))
  const fail = (e: unknown) => toast(e instanceof ApiError ? e.message : String(e), 'error')

  const refreshStatus = async () => {
    try {
      dispatch({ t: 'status', status: await api.status() })
    } catch {
      dispatch({ t: 'unreachable' })
    }
  }
  const refreshPresets = async () => {
    try {
      dispatch({ t: 'presets', presets: await api.presets() })
    } catch (e) {
      fail(e)
    }
  }

  return {
    refreshStatus,
    refreshPresets,
    toast,
    dismissToast: (id) => dispatch({ t: 'untoast', id }),
    applyPreset: async (slug) => {
      dispatch({ t: 'applying', slug })
      try {
        const r = await api.apply(slug, true)
        dispatch({ t: 'status', status: r.status })
        warnToasts(r.warnings)
      } catch (e) {
        fail(e)
      } finally {
        dispatch({ t: 'applying', slug: null })
      }
    },
    engage: async () => {
      try {
        dispatch({ t: 'status', status: await api.engage() })
      } catch (e) {
        fail(e)
      }
    },
    disengage: async () => {
      try {
        dispatch({ t: 'status', status: await api.disengage() })
      } catch (e) {
        fail(e)
      }
    },
    bypass: async (on) => {
      try {
        dispatch({ t: 'status', status: await api.bypass(on) })
      } catch (e) {
        fail(e)
      }
    },
    panic: async () => {
      try {
        await api.panic()
      } catch {
        /* panic is best-effort */
      }
      await refreshStatus()
      toast('Panic — audio released', 'warn')
    },
    openDrawer: async (slug) => {
      try {
        dispatch({ t: 'drawerOpen', slug, preset: await api.preset(slug) })
      } catch (e) {
        fail(e)
      }
    },
    closeDrawer: () => dispatch({ t: 'drawerClose' }),
    setVibes: (vibes) => {
      const { base, profile } = ref.current
      if (!base || !profile) return
      dispatch({ t: 'vibes', vibes, draft: applyVibesDraft(base, vibes, profile) })
    },
    setDraft: (draft) => dispatch({ t: 'draft', draft }),
    revert: () => dispatch({ t: 'revert' }),
    preview: async (draft) => {
      if (!ref.current.status?.engaged) return
      try {
        await api.preview(draft)
      } catch {
        /* preview is non-fatal; the curve already updated locally */
      }
    },
    save: async (change, reason) => {
      const { drawerSlug, draft } = ref.current
      if (!drawerSlug || !draft) return
      try {
        const r = await api.update(drawerSlug, draft, change, reason)
        warnToasts(r.warnings)
        toast('Saved', 'info')
        dispatch({ t: 'drawerOpen', slug: drawerSlug, preset: r.preset })
        await refreshPresets()
      } catch (e) {
        fail(e)
      }
    },
    resetOriginal: async () => {
      const { drawerSlug, status } = ref.current
      if (!drawerSlug) return
      try {
        const r = await api.revertOriginal(drawerSlug)
        // Make it audible immediately if this preset is what's playing.
        if (status?.engaged && status.activePreset === drawerSlug) {
          await api.apply(drawerSlug, false)
        }
        toast(`Restored ${r.revertedTo}`, 'info')
        dispatch({ t: 'drawerOpen', slug: drawerSlug, preset: r.preset })
        dispatch({ t: 'vibes', vibes: ZERO_VIBES, draft: r.preset })
        await refreshPresets()
      } catch (e) {
        fail(e)
      }
    },
    deletePreset: async () => {
      const { drawerSlug, status } = ref.current
      if (!drawerSlug) return
      // Guard duplicated from the UI: never delete what's currently playing.
      if (status?.engaged && status.activePreset === drawerSlug) {
        toast('Switch presets before deleting the active one', 'warn')
        return
      }
      try {
        await api.remove(drawerSlug)
        dispatch({ t: 'drawerClose' })
        toast('Preset deleted', 'info')
        await refreshPresets()
      } catch (e) {
        fail(e)
      }
    },
    setAddOpen: (open) => dispatch({ t: 'add', open }),
    ackClip: () => dispatch({ t: 'clipAck', value: ref.current.status?.clippedSamples ?? 0 }),
    optimizeForPreamp: async () => {
      const { draft } = ref.current
      if (!draft) return
      dispatch({ t: 'optimizingPreamp', on: true })
      try {
        const r = await api.optimizePreamp(draft, draft.preamp)
        dispatch({ t: 'draft', draft: r.preset })
        if (ref.current.status?.engaged) {
          try {
            await api.preview(r.preset)
          } catch {
            /* preview is non-fatal; the curve already updated locally */
          }
        }
      } catch (e) {
        fail(e)
      } finally {
        dispatch({ t: 'optimizingPreamp', on: false })
      }
    },
    setAuto: async (on) => {
      try {
        const r = await api.setAuto(on)
        dispatch({ t: 'auto', mode: r.mode })
      } catch (e) {
        fail(e)
      }
    },
    dispatchAuto: (mode, generating) => dispatch({ t: 'auto', mode, generating }),
  }
}

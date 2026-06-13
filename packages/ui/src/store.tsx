/**
 * store.tsx — context provider + hooks. The data shape + reducer live in
 * storeShape.ts; the thunked action factory in storeActions.ts. Memoized actions
 * read the latest committed state through a stable ref so their identities never
 * change.
 *
 * Draft model: `base` is the last-saved preset (immutable until save/revert).
 * Moving a vibe slider recomputes `draft = applyVibesDraft(base, vibes)`; editing
 * a band/preamp in Advanced overrides the draft directly; revert restores `base`.
 */
import { createContext, useContext, useEffect, useMemo, useReducer, useRef, type ReactNode } from 'react'
import { api } from './api.js'
import { useMeters } from './ws.js'
import { createActions } from './storeActions.js'
import { initial, reducer, type Actions, type State } from './storeShape.js'
import type { Meters } from './types.js'

export type { Toast, Actions, State } from './storeShape.js'

const Ctx = createContext<{ state: State; actions: Actions } | null>(null)

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initial)

  // Stable ref so memoized actions always read the latest committed state.
  const ref = useRef(state)
  ref.current = state

  const actions = useMemo(() => createActions(dispatch, ref), [])

  // Boot: status + presets + profile in parallel; also fetch initial auto state (tolerate failure).
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [status, presets, profile] = await Promise.all([
          api.status(),
          api.presets(),
          api.profile('ft1pro'),
        ])
        if (!cancelled) dispatch({ t: 'ready', status, presets, profile })
      } catch {
        if (!cancelled) dispatch({ t: 'unreachable' })
        return
      }
      try {
        const autoState = await api.getAuto()
        if (!cancelled) dispatch({ t: 'auto', mode: autoState.mode })
      } catch {
        /* auto state defaults to off — non-fatal */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // Fallback status poll while ready (device / lastEvent / clip freshness).
  useEffect(() => {
    if (state.phase !== 'ready') return
    const id = setInterval(() => void actions.refreshStatus(), 5000)
    return () => clearInterval(id)
  }, [state.phase, actions])

  const value = useMemo(() => ({ state, actions }), [state, actions])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useStore() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useStore must be used within StoreProvider')
  return ctx
}

export function useMeterFeed(
  onInvalidate: () => void,
  onAuto: (mode: 'off' | 'armed' | 'yielded', generating?: boolean) => void,
): { meters: Meters | null; connected: boolean } {
  return useMeters(onInvalidate, onAuto)
}

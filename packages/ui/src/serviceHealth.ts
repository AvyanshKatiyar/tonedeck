/**
 * serviceHealth.ts — derive a single live/standby/offline verdict for the
 * ToneDeck backend, for the TopBar status pill and the unreachable RetryPanel.
 *
 *   'offline'  the daemon is unreachable (the status poll failed)
 *   'standby'  daemon reachable, but the CamillaDSP engine is not connected
 *              (dspState is null only when the CamillaDSP WebSocket is down)
 *   'live'     daemon reachable AND CamillaDSP reporting a state
 *
 * Pure function of the two store fields it reads, so it is unit-testable
 * without a provider.
 */
import type { State } from './storeShape.js'

export type ServiceHealth = 'live' | 'standby' | 'offline'

export interface ServiceHealthInfo {
  health: ServiceHealth
  label: string
  /** Human-readable line for the pill's tooltip. */
  detail: string
}

export function serviceHealth(state: Pick<State, 'phase' | 'status'>): ServiceHealthInfo {
  if (state.phase === 'unreachable') {
    return { health: 'offline', label: 'Offline', detail: 'Audio daemon unreachable' }
  }

  const dsp = state.status?.dspState ?? null
  if (dsp) {
    const version = state.status?.dspVersion
    return {
      health: 'live',
      label: 'Live',
      detail: `Daemon up · CamillaDSP ${dsp}${version ? ` (v${version})` : ''}`,
    }
  }

  return { health: 'standby', label: 'Standby', detail: 'Daemon up · EQ engine idle' }
}

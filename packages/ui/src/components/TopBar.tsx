/**
 * TopBar — Spotify-style header that floats over the main panel's top gradient.
 * Left: back/forward nav chevrons (presentational). Right: the active output
 * device pill, the Auto-EQ follow toggle, a settings button, and a profile
 * avatar.
 */
import { useStore } from '../store.js'
import { AutoToggle } from './AutoToggle.js'

export function TopBar() {
  const { state } = useStore()

  const deviceName =
    state.status?.devices?.current ??
    state.profile?.name ??
    null

  return (
    <header className="tb">
      <div className="tb__nav">
        <button type="button" className="tb__chevron" disabled aria-label="Back" title="Back">
          ‹
        </button>
        <button type="button" className="tb__chevron" disabled aria-label="Forward" title="Forward">
          ›
        </button>
      </div>

      <div className="tb__grow" />

      {deviceName && (
        <span className="pill pill--device" title="Active output device">
          {deviceName}
        </span>
      )}

      <AutoToggle />

      <button type="button" className="tb__icon" title="Settings" aria-label="Settings">
        ⚙
      </button>

      <button type="button" className="tb__avatar" title="ToneDeck" aria-label="Profile">
        T
      </button>
    </header>
  )
}

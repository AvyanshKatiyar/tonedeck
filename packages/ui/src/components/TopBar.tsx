/**
 * TopBar — sticky header row. Serif ToneDeck wordmark with amber accent dot,
 * device/profile pill, AutoToggle, and a settings affordance. Matches the
 * Warm Editorial / Vinyl direction-2 mockup (.tb / .wm / .pill).
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
      <div className="wm">
        <span className="wm__dot" aria-hidden />
        ToneDeck
      </div>

      {deviceName && (
        <span className="pill pill--device" title="Active output device">
          {deviceName}
        </span>
      )}

      <div className="tb__grow" />

      <AutoToggle />

      <button
        type="button"
        className="tb__icon"
        title="Settings"
        aria-label="Settings"
      >
        ⚙
      </button>
    </header>
  )
}

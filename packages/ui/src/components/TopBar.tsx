/**
 * TopBar — Spotify-style header floating over the main panel's top gradient.
 * Left: back/forward chevrons that scroll the main content. Right: active output
 * device pill, the Auto-EQ follow toggle, a button that shows/hides the right
 * Now-Playing panel, and a profile avatar.
 */
import { useStore } from '../store.js'
import { AutoToggle } from './AutoToggle.js'

export function TopBar({
  onBack,
  onForward,
  onToggleNowPlaying,
  nowPlayingOpen,
}: {
  onBack: () => void
  onForward: () => void
  onToggleNowPlaying: () => void
  nowPlayingOpen: boolean
}) {
  const { state, actions } = useStore()

  const deviceName = state.status?.devices?.current ?? state.profile?.name ?? null

  return (
    <header className="tb">
      <div className="tb__nav">
        <button type="button" className="tb__chevron" onClick={onBack} aria-label="Scroll up" title="Up">
          ‹
        </button>
        <button type="button" className="tb__chevron" onClick={onForward} aria-label="Scroll down" title="Down">
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

      <button
        type="button"
        className={`tb__icon${nowPlayingOpen ? ' tb__icon--on' : ''}`}
        title={nowPlayingOpen ? 'Hide Now Playing view' : 'Show Now Playing view'}
        aria-label="Toggle Now Playing view"
        aria-pressed={nowPlayingOpen}
        onClick={onToggleNowPlaying}
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M15 4v16" />
        </svg>
      </button>

      <button
        type="button"
        className="tb__avatar"
        title="ToneDeck — FiiO FT1 Pro"
        aria-label="Profile"
        onClick={() => actions.toast(`ToneDeck · ${state.profile?.name ?? 'FiiO FT1 Pro'}`, 'info')}
      >
        T
      </button>
    </header>
  )
}

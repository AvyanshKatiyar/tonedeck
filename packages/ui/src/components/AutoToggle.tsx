/**
 * AutoToggle — reflects the auto-EQ mode (off / armed / yielded) and lets
 * the user arm or disarm it. Visual "on" when mode !== 'off'; amber accent
 * matches the Warm Editorial / Vinyl direction-2 mockup.
 */
import { useStore } from '../store.js'

export function AutoToggle() {
  const { state, actions } = useStore()
  const { mode } = state.auto
  const isOn = mode !== 'off'

  const label =
    mode === 'armed' ? 'Following' : mode === 'yielded' ? 'Yielded' : 'Off'

  const handleClick = () => {
    void actions.setAuto(mode === 'off')
  }

  return (
    <div className={`auto-toggle ${isOn ? 'auto-toggle--on' : ''}`}>
      <button
        type="button"
        className="auto-toggle__btn"
        onClick={handleClick}
        title={
          mode === 'yielded'
            ? 'Auto-EQ yielded — you took over. Click to disarm.'
            : isOn
              ? 'Auto-EQ armed — click to turn off'
              : 'Arm Auto-EQ'
        }
        aria-pressed={isOn}
      >
        <span className={`auto-sw ${isOn ? 'auto-sw--on' : 'auto-sw--off'}`} aria-hidden />
        <span className="auto-toggle__label">
          Auto-EQ · {label}
        </span>
      </button>
      {mode === 'yielded' && (
        <span className="auto-toggle__hint">you took over · resumes next song</span>
      )}
    </div>
  )
}

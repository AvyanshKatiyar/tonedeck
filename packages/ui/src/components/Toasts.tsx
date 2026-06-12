/**
 * Toasts — top-right transient notices (info / warn / error), auto-dismissed by
 * the store after 3s, click to dismiss early. Also exports StatusFooter: a thin
 * bar showing dsp version, current device, and the daemon's last event.
 */
import { useStore } from '../store.js'

export function Toasts() {
  const { state, actions } = useStore()
  return (
    <div className="toasts" role="status" aria-live="polite">
      {state.toasts.map((t) => (
        <button
          type="button"
          key={t.id}
          className={`toast toast--${t.kind}`}
          onClick={() => actions.dismissToast(t.id)}
        >
          {t.text}
        </button>
      ))}
    </div>
  )
}

export function StatusFooter() {
  const { state } = useStore()
  const s = state.status
  const device = s?.devices.current ?? s?.devices.saved ?? '—'
  return (
    <footer className="statusfoot">
      <span>CamillaDSP {s?.dspVersion ?? '—'}</span>
      <span className="statusfoot__sep">·</span>
      <span>{device}</span>
      <span className="statusfoot__sep">·</span>
      <span className="statusfoot__event">{s?.lastEvent ?? 'idle'}</span>
    </footer>
  )
}

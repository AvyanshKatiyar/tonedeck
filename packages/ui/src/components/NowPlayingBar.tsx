/**
 * NowPlayingBar — sticky 64px header. Left: active album thumb + title/artist +
 * engaged-state pill. Centre: live meters. Right: Bypass (A/B) toggle,
 * Engage/Disengage, and an always-visible PANIC button (instant, no confirm).
 */
import { api } from '../api.js'
import { useStore } from '../store.js'
import type { Meters as MeterFrame } from '../types.js'
import { AlbumArt, FallbackArt } from './FallbackArt.js'
import { Meters } from './Meters.js'

export function NowPlayingBar({ meters }: { meters: MeterFrame | null }) {
  const { state, actions } = useStore()
  const { status, presets, clipAck } = state
  const engaged = status?.engaged ?? false
  const bypass = status?.bypass ?? false
  const active = presets.find((p) => p.slug === status?.activePreset) ?? null

  let pill: { text: string; cls: string }
  if (!engaged) pill = { text: 'OFF', cls: 'pill--off' }
  else if (bypass) pill = { text: 'BYPASS', cls: 'pill--bypass' }
  else pill = { text: 'LIVE', cls: 'pill--live' }

  return (
    <header className="npbar">
      <div className="npbar__left">
        <div className="npbar__thumb">
          {active ? (
            <AlbumArt slug={active.slug} title={active.title} src={api.artworkUrl(active.slug)} fontSize={15} />
          ) : (
            <FallbackArt slug="tonedeck" title="ToneDeck" fontSize={13} />
          )}
        </div>
        <div className="npbar__meta">
          <div className="npbar__title">{active ? active.title : 'No album engaged'}</div>
          <div className="npbar__artist">
            {active ? active.artist ?? '—' : 'Click any album to go live'}
          </div>
        </div>
        <span className={`pill ${pill.cls}`}>
          {pill.text === 'LIVE' && <span className="pill__dot" />}
          {pill.text}
        </span>
      </div>

      <div className="npbar__center">
        <Meters
          meters={meters}
          clipped={status?.clippedSamples ?? null}
          clipAck={clipAck}
          onAckClip={actions.ackClip}
          engaged={engaged}
        />
      </div>

      <div className="npbar__right">
        <button
          type="button"
          className={`btn btn--toggle ${bypass ? 'is-on' : ''}`}
          disabled={!engaged}
          onClick={() => actions.bypass(!bypass)}
          title="A/B bypass — hear the EQ vs. flat"
        >
          {bypass ? 'A · flat' : 'B · EQ'}
        </button>
        <button
          type="button"
          className={`btn ${engaged ? '' : 'btn--primary'}`}
          onClick={() => (engaged ? actions.disengage() : actions.engage())}
        >
          {engaged ? 'Disengage' : 'Engage'}
        </button>
        <button type="button" className="btn btn--danger" onClick={() => actions.panic()}>
          PANIC
        </button>
      </div>
    </header>
  )
}

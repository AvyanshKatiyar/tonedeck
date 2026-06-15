/**
 * NowLiveCard — Warm Editorial hero card. Shows the active preset's artwork,
 * title, EQ curve, band chips, and live meters. Fetches the full Preset from
 * the daemon whenever status.activePreset changes; guards against stale
 * responses with a closure-captured slug check.
 */
import { useEffect, useRef, useState } from 'react'
import { api } from '../api.js'
import { useStore } from '../store.js'
import type { Meters as MeterFrame, Preset, Status } from '../types.js'
import { AlbumArt } from './FallbackArt.js'
import { EqCurveCanvas } from './EqCurveCanvas.js'
import { BandChips } from './BandChips.js'
import { Visualizer } from './Visualizer.js'

export function NowLiveCard({
  status,
  auto,
  meters,
}: {
  status: Status
  auto: { mode: string; generating?: boolean }
  meters: MeterFrame | null
}) {
  const { actions } = useStore()
  const [preset, setPreset] = useState<Preset | null>(null)
  // Track the last requested slug so stale fetches don't overwrite newer state.
  const pendingSlug = useRef<string | null>(null)

  useEffect(() => {
    const slug = status.activePreset
    if (!slug) {
      setPreset(null)
      return
    }
    pendingSlug.current = slug
    api.preset(slug).then(
      (p) => {
        if (pendingSlug.current === slug) setPreset(p)
      },
      () => {
        if (pendingSlug.current === slug) setPreset(null)
      },
    )
  }, [status.activePreset])

  // Empty state
  if (!status.engaged || !status.activePreset) {
    return (
      <div className="empty-state">
        <div className="empty-state__title">Good evening</div>
        <div className="empty-state__sub">
          Nothing live right now — pick an album below and hit play to tune your sound.
        </div>
      </div>
    )
  }

  const slug = status.activePreset
  const title = preset?.title ?? slug
  const hasSubtitle = preset?.artist || preset?.album
  const subtitle = hasSubtitle
    ? [preset?.artist, preset?.album].filter(Boolean).join(' — ')
    : null
  const isAuto = preset?.provenance?.createdBy === 'claude'

  return (
    <div className="hero">
      {/* Banner: cover + title block, bottom-aligned like a Spotify album header */}
      <div className="hero__banner">
        <div className="cover">
          <AlbumArt slug={slug} title={title} src={api.artworkUrl(slug)} fontSize={40} />
          {isAuto && <span className="au-badge">◈ AUTO</span>}
          {auto.generating && <div className="tuning-overlay">tuning…</div>}
        </div>
        <div className="hero__head">
          <span className="now-live-label">Now Live · Apple Music</span>
          <h1 className="hero-title">{title}</h1>
          {subtitle && <div className="hero-subtitle">{subtitle}</div>}
        </div>
      </div>

      {/* Detail: live visualizer, EQ curve, band chips, edit button */}
      <div className="hero__detail">
        <div className="hero-visualizer">
          <Visualizer meters={meters} engaged={status.engaged} />
        </div>
        {preset && (
          <div className="hero-curve">
            <EqCurveCanvas preset={preset} />
          </div>
        )}
        {preset && preset.bands.length > 0 && (
          <BandChips bands={preset.bands} preamp={preset.preamp} />
        )}
        <button
          type="button"
          className="btn btn--edit-eq"
          onClick={() => void actions.openDrawer(slug)}
          title="Edit EQ bands, vibe sliders, and save"
        >
          ✎ Edit EQ
        </button>
      </div>
    </div>
  )
}

/**
 * NowLiveCard — Warm Editorial hero card. Shows the active preset's artwork,
 * title, EQ curve, band chips, and live meters. Fetches the full Preset from
 * the daemon whenever status.activePreset changes; guards against stale
 * responses with a closure-captured slug check.
 */
import { useEffect, useRef, useState } from 'react'
import { api } from '../api.js'
import type { Preset, Status } from '../types.js'
import { AlbumArt } from './FallbackArt.js'
import { EqCurveCanvas } from './EqCurveCanvas.js'
import { Meters } from './Meters.js'
import { BandChips } from './BandChips.js'

export function NowLiveCard({
  status,
  auto,
}: {
  status: Status
  auto: { mode: string; generating?: boolean }
}) {
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
        Nothing live — play something in Apple Music
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
      {/* Album cover */}
      <div className="cover">
        <AlbumArt
          slug={slug}
          title={title}
          src={api.artworkUrl(slug)}
          fontSize={36}
        />
        {isAuto && <span className="au-badge">◈ AUTO · SONNET</span>}
        {auto.generating && <div className="tuning-overlay">tuning…</div>}
      </div>

      {/* Middle: meta + curve + chips */}
      <div className="heromid">
        <span className="now-live-label">Now Live · Apple Music</span>
        <div className="hero-title">{title}</div>
        {subtitle && <div className="hero-subtitle">{subtitle}</div>}
        {preset && (
          <div className="hero-curve">
            <EqCurveCanvas preset={preset} />
          </div>
        )}
        {preset && preset.bands.length > 0 && (
          <BandChips bands={preset.bands} preamp={preset.preamp} />
        )}
      </div>

      {/* Right: meters */}
      <div className="hero-meters">
        <Meters
          meters={null}
          clipped={status.clippedSamples}
          clipAck={0}
          onAckClip={() => undefined}
          engaged={status.engaged}
        />
      </div>
    </div>
  )
}

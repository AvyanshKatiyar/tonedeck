/**
 * Human-readable formatters — plain padEnd tables, no external deps.
 */

import type { Preset, ClusterResult } from '@tonedeck/shared'

export function fmtClusters(r: ClusterResult): string {
  if (r.clusters.length === 0) return 'No presets to cluster.'
  const lines: string[] = [`${r.clusters.length} clusters @ threshold ${r.threshold} dB RMS`, '']
  for (const c of r.clusters) {
    const gap =
      c.nearestDistanceDb != null ? ` — nearest cluster ${c.nearestDistanceDb} dB away` : ''
    lines.push(`● cluster ${c.id} — ${c.members.length} songs — ${c.character}${gap}`)
    for (const m of c.members.slice(0, 12)) {
      lines.push(`    ${m.title}${m.artist ? ` — ${m.artist}` : ''}`)
    }
    if (c.members.length > 12) lines.push(`    …and ${c.members.length - 12} more`)
    lines.push('')
  }
  return lines.join('\n').trimEnd()
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function pad(s: string | number | undefined, w: number): string {
  return String(s ?? '').padEnd(w)
}

function trunc(s: string | undefined | null, max: number): string {
  if (!s) return ''
  return s.length > max ? s.slice(0, max - 1) + '…' : s
}

// ─── Status ───────────────────────────────────────────────────────────────────

export interface StatusData {
  engaged: boolean
  bypass: boolean
  activePreset: string | null
  dspState: string | null
  clippedSamples: number | null
  devices: { current: string | null; saved: string | null; outputs: string[] }
  dspVersion: string | null
  lastEvent: string | null
}

export function fmtStatus(s: StatusData): string {
  const lines: string[] = []
  lines.push(`engaged       ${s.engaged ? 'yes' : 'no'}`)
  lines.push(`bypass        ${s.bypass ? 'on' : 'off'}`)
  lines.push(`active preset ${s.activePreset ?? '—'}`)
  lines.push(`dsp state     ${s.dspState ?? '—'}`)
  lines.push(`dsp version   ${s.dspVersion ?? '—'}`)
  if (s.clippedSamples !== null) lines.push(`clipped       ${s.clippedSamples}`)
  lines.push(
    `device        ${s.devices.current ?? '—'} (saved: ${s.devices.saved ?? '—'})`,
  )
  if (s.devices.outputs.length)
    lines.push(`outputs       ${s.devices.outputs.join(', ')}`)
  if (s.lastEvent) lines.push(`last event    ${s.lastEvent}`)
  return lines.join('\n')
}

// ─── Presets list ─────────────────────────────────────────────────────────────

export interface PresetSummaryRow {
  slug: string
  title: string
  artist?: string
  kind: string
  version: number
}

export function fmtPresetList(rows: PresetSummaryRow[]): string {
  if (!rows.length) return '(no presets)'
  const lines: string[] = []
  lines.push(
    `${pad('SLUG', 26)}${pad('TITLE', 30)}${pad('ARTIST', 24)}${pad('KIND', 12)}VER`,
  )
  lines.push('─'.repeat(96))
  for (const r of rows) {
    lines.push(
      `${pad(trunc(r.slug, 26), 26)}${pad(trunc(r.title, 30), 30)}${pad(trunc(r.artist, 24), 24)}${pad(r.kind, 12)}${r.version}`,
    )
  }
  return lines.join('\n')
}

// ─── Preset detail ────────────────────────────────────────────────────────────

export function fmtPreset(p: Preset): string {
  const lines: string[] = []
  lines.push(`slug    ${p.slug}  (v${p.version})`)
  lines.push(`title   ${p.title}`)
  if (p.artist) lines.push(`artist  ${p.artist}`)
  lines.push(`kind    ${p.kind}`)
  lines.push(`profile ${p.profile}`)
  lines.push(`preamp  ${p.preamp} dB`)
  lines.push(`intent  ${p.intent}`)
  lines.push('')
  lines.push(`${'ID'.padEnd(20)}${'TYPE'.padEnd(12)}${'FREQ'.padEnd(10)}${'Q'.padEnd(8)}GAIN`)
  lines.push('─'.repeat(60))
  for (const b of p.bands) {
    lines.push(
      `${pad(b.id, 20)}${pad(b.type, 12)}${pad(b.freq, 10)}${pad(b.q, 8)}${b.gain}`,
    )
  }
  const history = p.provenance.history.slice(-3)
  if (history.length) {
    lines.push('')
    lines.push('History (last 3):')
    for (const h of history) {
      lines.push(`  ${h.at.slice(0, 10)}  ${h.change}`)
      if (h.reason && h.reason !== h.change) lines.push(`             reason: ${h.reason}`)
    }
  }
  return lines.join('\n')
}

// ─── Apply / tweak result ─────────────────────────────────────────────────────

export function fmtVerdict(verdict: string, warnings: string[]): string {
  const w = warnings.length ? '\n' + warnings.map((s) => `  ! ${s}`).join('\n') : ''
  return `verdict: ${verdict}${w}`
}

// ─── Meter summary / live line ────────────────────────────────────────────────

export interface MeterFrame {
  type: string
  rms: number[]
  peak: number[]
  clippedSamples?: number
}

export function fmtMeterSummary(frames: MeterFrame[]): string {
  if (!frames.length) return '(no meter data)'
  const nCh = frames[0]?.rms.length ?? 0
  const rmsAvg = Array.from({ length: nCh }, (_, i) =>
    frames.reduce((a, f) => a + (f.rms[i] ?? 0), 0) / frames.length,
  )
  const peakMax = Array.from({ length: nCh }, (_, i) =>
    Math.max(...frames.map((f) => f.peak[i] ?? -Infinity)),
  )
  const totalClipped = frames.reduce((a, f) => a + (f.clippedSamples ?? 0), 0)
  const chLines = rmsAvg.map(
    (r, i) => `ch${i + 1}: rms ${r.toFixed(1)} dBFS  peak ${(peakMax[i] ?? 0).toFixed(1)} dBFS`,
  )
  return chLines.join('  |  ') + (totalClipped ? `  [${totalClipped} clipped]` : '')
}

export function fmtMeterLine(frame: MeterFrame): string {
  const parts = frame.rms.map(
    (r, i) => `ch${i + 1}: ${r.toFixed(1)}/${(frame.peak[i] ?? 0).toFixed(1)}`,
  )
  return parts.join('  ') + (frame.clippedSamples ? `  [${frame.clippedSamples} clip]` : '')
}

// ─── Doctor ───────────────────────────────────────────────────────────────────

export type CheckStatus = 'PASS' | 'WARN' | 'FAIL'
export interface CheckResult {
  label: string
  status: CheckStatus
  detail?: string
}

export function fmtDoctor(checks: CheckResult[]): string {
  return checks
    .map((c) => {
      const s = c.status.padEnd(5)
      const l = c.label.padEnd(50)
      return `${s} ${l}${c.detail ? c.detail : ''}`
    })
    .join('\n')
}

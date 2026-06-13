/**
 * All CLI action functions, exported for unit-testability.
 * Commander wiring is thin and lives in index.ts.
 *
 * Every function throws CliError on failure; index.ts catches and exits.
 * The `fetchFn` in ApiCtx is injectable so tests never need a live daemon.
 */

import { applyVibes, VIBES, type VibeName, type Preset, type Profile } from '@tonedeck/shared'
import { CliError, type ApiCtx, apiGet, apiPost, apiPut, apiDelete, apiProbe } from './api.js'
import {
  fmtStatus,
  fmtPresetList,
  fmtPreset,
  fmtVerdict,
  fmtMeterSummary,
  fmtMeterLine,
  fmtDoctor,
  type StatusData,
  type PresetSummaryRow,
  type MeterFrame,
  type CheckResult,
} from './format.js'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function out(json: boolean, data: unknown, human: string): void {
  if (json) {
    console.log(JSON.stringify(data))
  } else {
    console.log(human)
  }
}

async function readJsonInput(source: string): Promise<unknown> {
  if (source === '-') {
    return new Promise<unknown>((resolve, reject) => {
      let data = ''
      process.stdin.setEncoding('utf8')
      process.stdin.on('data', (chunk) => (data += chunk))
      process.stdin.on('end', () => {
        try {
          resolve(JSON.parse(data) as unknown)
        } catch (e) {
          reject(new CliError(`Invalid JSON on stdin: ${(e as Error).message}`, 2))
        }
      })
      process.stdin.on('error', (e) => reject(new CliError(e.message, 1)))
    })
  }
  const { readFile } = await import('node:fs/promises')
  let raw: string
  try {
    raw = await readFile(source, 'utf8')
  } catch (e) {
    throw new CliError(`Cannot read file "${source}": ${(e as Error).message}`, 2)
  }
  try {
    return JSON.parse(raw) as unknown
  } catch (e) {
    throw new CliError(`Invalid JSON in "${source}": ${(e as Error).message}`, 2)
  }
}

// ─── status ───────────────────────────────────────────────────────────────────

export async function actionStatus(ctx: ApiCtx, opts: { json: boolean }): Promise<void> {
  const data = await apiGet<StatusData>(ctx, '/api/status')
  out(opts.json, data, fmtStatus(data))
}

// ─── list ─────────────────────────────────────────────────────────────────────

export async function actionList(ctx: ApiCtx, opts: { json: boolean }): Promise<void> {
  const data = await apiGet<{ presets: PresetSummaryRow[] }>(ctx, '/api/presets')
  out(opts.json, data, fmtPresetList(data.presets))
}

// ─── show ─────────────────────────────────────────────────────────────────────

export async function actionShow(
  slug: string,
  ctx: ApiCtx,
  opts: { json: boolean },
): Promise<void> {
  const preset = await apiGet<Preset>(ctx, `/api/presets/${encodeURIComponent(slug)}`)
  out(opts.json, preset, fmtPreset(preset))
}

// ─── versions / revert ────────────────────────────────────────────────────────

interface VersionInfo {
  version: number
  updatedAt: string
  change: string | null
  current: boolean
}

export async function actionVersions(
  slug: string,
  ctx: ApiCtx,
  opts: { json: boolean },
): Promise<void> {
  const data = await apiGet<{ versions: VersionInfo[] }>(
    ctx,
    `/api/presets/${encodeURIComponent(slug)}/versions`,
  )
  if (opts.json) {
    console.log(JSON.stringify(data))
    return
  }
  for (const v of data.versions) {
    const marker = v.current ? '*' : ' '
    console.log(
      `${marker} v${String(v.version).padEnd(3)} ${v.updatedAt.slice(0, 16)}  ${v.change ?? '(initial)'}`,
    )
  }
  console.log('* = current. Revert with: tonedeck revert <slug> [--to <version> | --original]')
}

export async function actionRevert(
  slug: string,
  ctx: ApiCtx,
  opts: { json: boolean; original: boolean; to?: number; reason?: string; apply: boolean },
): Promise<void> {
  const body: Record<string, unknown> = {}
  if (opts.original) body.original = true
  if (opts.to !== undefined) body.toVersion = opts.to
  if (opts.reason) body.reason = opts.reason
  const result = await apiPost<{
    preset: Preset
    warnings: string[]
    verdict: string
    revertedTo: string
  }>(ctx, `/api/presets/${encodeURIComponent(slug)}/revert`, body, 'refused')

  if (opts.apply) {
    await apiPost(ctx, `/api/presets/${encodeURIComponent(slug)}/apply`, { engage: false }, 'refused')
  }

  if (opts.json) {
    console.log(JSON.stringify(result))
  } else {
    for (const w of result.warnings) process.stderr.write(`! ${w}\n`)
    console.log(
      `Reverted "${slug}" to ${result.revertedTo} (now v${result.preset.version})${opts.apply ? ' and applied' : ''}`,
    )
  }
}

// ─── apply ────────────────────────────────────────────────────────────────────

export async function actionApply(
  slug: string,
  ctx: ApiCtx,
  opts: { json: boolean; engage: boolean },
): Promise<void> {
  const result = await apiPost<{ status: StatusData; warnings: string[]; verdict: string }>(
    ctx,
    `/api/presets/${encodeURIComponent(slug)}/apply`,
    { engage: opts.engage },
    'refused',
  )
  if (opts.json) {
    console.log(JSON.stringify(result))
  } else {
    if (result.warnings.length) {
      for (const w of result.warnings) process.stderr.write(`! ${w}\n`)
    }
    console.log(fmtVerdict(result.verdict, []))
  }
}

// ─── on ───────────────────────────────────────────────────────────────────────

export async function actionOn(
  ctx: ApiCtx,
  opts: { json: boolean; preset?: string },
): Promise<void> {
  const body = opts.preset ? { preset: opts.preset } : {}
  const data = await apiPost<StatusData>(ctx, '/api/engage', body, 'refused')
  out(opts.json, data, fmtStatus(data))
}

// ─── off ──────────────────────────────────────────────────────────────────────

export async function actionOff(ctx: ApiCtx, opts: { json: boolean }): Promise<void> {
  const data = await apiPost<StatusData>(ctx, '/api/disengage', {})
  out(opts.json, data, fmtStatus(data))
}

// ─── panic ────────────────────────────────────────────────────────────────────

export async function actionPanic(ctx: ApiCtx, opts: { json: boolean }): Promise<void> {
  const data = await apiPost<StatusData>(ctx, '/api/panic', {})
  out(opts.json, data, fmtStatus(data))
}

// ─── bypass ───────────────────────────────────────────────────────────────────

export async function actionBypass(
  state: 'on' | 'off',
  ctx: ApiCtx,
  opts: { json: boolean },
): Promise<void> {
  const data = await apiPost<StatusData>(ctx, '/api/bypass', { on: state === 'on' }, 'refused')
  out(opts.json, data, fmtStatus(data))
}

// ─── create ───────────────────────────────────────────────────────────────────

export async function actionCreate(
  ctx: ApiCtx,
  opts: {
    json: boolean
    fromJson: string
    clamp: boolean
    autoTrim: boolean
    apply: boolean
  },
): Promise<void> {
  const preset = await readJsonInput(opts.fromJson)
  const result = await apiPost<{ preset: Preset; warnings: string[]; verdict: string }>(
    ctx,
    '/api/presets',
    { preset, clamp: opts.clamp, autoTrim: opts.autoTrim },
    'user',
  )
  if (opts.json) {
    console.log(JSON.stringify(result))
  } else {
    console.log(`created: ${result.preset.slug}`)
    if (result.warnings.length) {
      for (const w of result.warnings) process.stderr.write(`! ${w}\n`)
    }
    console.log(`verdict: ${result.verdict}`)
  }
  if (opts.apply) {
    await actionApply(result.preset.slug, ctx, { json: opts.json, engage: false })
  }
}

// ─── tweak ────────────────────────────────────────────────────────────────────

export interface BandEdit {
  id: string
  gain?: number
  q?: number
  freq?: number
}

export interface TweakOpts {
  json: boolean
  bands: string[]
  gains: number[]
  qs: number[]
  freqs: number[]
  vibes: string[]
  reason: string
  apply: boolean
}

export async function actionTweak(
  slug: string,
  ctx: ApiCtx,
  opts: TweakOpts,
): Promise<void> {
  // 1. Load current preset
  const preset = await apiGet<Preset>(ctx, `/api/presets/${encodeURIComponent(slug)}`)
  // 2. Load profile (needed for applyVibes template)
  const profile = await apiGet<Profile>(ctx, `/api/profiles/${encodeURIComponent(preset.profile)}`)

  const changeParts: string[] = []
  let working = { ...preset, bands: preset.bands.map((b) => ({ ...b })) }

  // 3. Apply vibes
  if (opts.vibes.length) {
    const adjustments: Partial<Record<VibeName, number>> = {}
    const knownVibes = new Set(Object.keys(VIBES))
    for (const spec of opts.vibes) {
      const eq = spec.indexOf('=')
      if (eq < 0) throw new CliError(`Invalid --vibe "${spec}": expected name=delta`, 2)
      const name = spec.slice(0, eq)
      const delta = parseFloat(spec.slice(eq + 1))
      if (!knownVibes.has(name)) {
        throw new CliError(
          `Unknown vibe "${name}". Known: ${[...knownVibes].join(', ')}`,
          2,
        )
      }
      if (isNaN(delta)) throw new CliError(`Invalid delta in --vibe "${spec}"`, 2)
      adjustments[name as VibeName] = (adjustments[name as VibeName] ?? 0) + delta
    }
    const vibeResult = applyVibes(working, adjustments, profile)
    working = vibeResult.preset
    changeParts.push(...vibeResult.changes.filter((c) => c.startsWith('"') || c.startsWith('vibe')))
    // Summarise vibe adjustments
    for (const [name, delta] of Object.entries(adjustments)) {
      changeParts.push(`vibe ${name}${delta >= 0 ? '+' : ''}${delta}`)
    }
  }

  // 4. Apply direct band edits (positional pairing)
  if (opts.bands.length) {
    const bandMap = new Map(working.bands.map((b) => [b.id, b]))
    for (let i = 0; i < opts.bands.length; i++) {
      const id = opts.bands[i]!
      let band = bandMap.get(id)
      if (!band) {
        // Copy from profile template at gain 0
        const tpl = profile.bandTemplate.find((b) => b.id === id)
        if (!tpl) throw new CliError(`Band "${id}" not found in preset or profile template`, 2)
        band = { ...tpl, gain: 0 }
        working.bands.push(band)
        bandMap.set(id, band)
      }
      const edits: string[] = []
      if (opts.gains[i] !== undefined) {
        const before = band.gain
        band.gain = opts.gains[i]!
        edits.push(`gain ${before}→${band.gain}`)
      }
      if (opts.qs[i] !== undefined) {
        const before = band.q
        band.q = opts.qs[i]!
        edits.push(`q ${before}→${band.q}`)
      }
      if (opts.freqs[i] !== undefined) {
        const before = band.freq
        band.freq = opts.freqs[i]!
        edits.push(`freq ${before}→${band.freq}`)
      }
      if (edits.length) changeParts.push(`band ${id} ${edits.join(' ')}`)
    }
  }

  if (!changeParts.length) {
    throw new CliError('No changes specified — pass --vibe or --band/--gain/--q/--freq', 2)
  }

  const change = [...new Set(changeParts)].join('; ')
  const reason = opts.reason || 'manual tweak via CLI'

  // 5. PUT updated preset
  const result = await apiPut<{ preset: Preset; warnings: string[]; verdict: string }>(
    ctx,
    `/api/presets/${encodeURIComponent(slug)}`,
    { preset: working, change, reason },
  )

  if (opts.json) {
    console.log(JSON.stringify(result))
  } else {
    console.log(`change: ${change}`)
    if (result.warnings.length) {
      for (const w of result.warnings) process.stderr.write(`! ${w}\n`)
    }
    console.log(`verdict: ${result.verdict}`)
  }

  if (opts.apply) {
    await actionApply(result.preset.slug, ctx, { json: opts.json, engage: false })
  }
}

// ─── delete ───────────────────────────────────────────────────────────────────

export async function actionDelete(
  slug: string,
  ctx: ApiCtx,
  opts: {
    json: boolean
    yes: boolean
    confirmFn?: () => Promise<boolean>
  },
): Promise<void> {
  if (!opts.yes && !opts.json) {
    const confirm = opts.confirmFn ?? defaultConfirm
    const ok = await confirm()
    if (!ok) {
      console.log('Aborted.')
      return
    }
  }
  await apiDelete(ctx, `/api/presets/${encodeURIComponent(slug)}`)
  if (opts.json) {
    console.log(JSON.stringify({ deleted: slug }))
  } else {
    console.log(`Deleted: ${slug}`)
  }
}

async function defaultConfirm(): Promise<boolean> {
  const { createInterface } = await import('node:readline')
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    rl.question('Delete this preset? [y/N] ', (answer) => {
      rl.close()
      resolve(answer.toLowerCase() === 'y')
    })
  })
}

// ─── preview ─────────────────────────────────────────────────────────────────

export async function actionPreview(
  ctx: ApiCtx,
  opts: { json: boolean; fromJson: string },
): Promise<void> {
  const preset = await readJsonInput(opts.fromJson)
  const result = await apiPost<{ ok: boolean }>(ctx, '/api/preview', { preset }, 'refused')
  out(opts.json, result, `preview ok`)
}

// ─── meters ──────────────────────────────────────────────────────────────────

export async function actionMeters(
  ctx: ApiCtx,
  opts: { watch: boolean; seconds: number; json: boolean },
): Promise<void> {
  const { default: WebSocket } = await import('ws')
  const wsUrl = ctx.baseUrl.replace(/^https?/, (p) => (p === 'https' ? 'wss' : 'ws')) + '/ws'

  return new Promise<void>((resolve, reject) => {
    let ws: InstanceType<typeof WebSocket>
    try {
      ws = new WebSocket(wsUrl)
    } catch (err) {
      reject(new CliError(`WS connect failed: ${(err as Error).message}`, 1))
      return
    }

    const frames: MeterFrame[] = []
    const start = Date.now()
    let timer: ReturnType<typeof setTimeout> | null = null

    ws.on('error', (err) => {
      reject(new CliError(`WS error: ${err.message}`, 1))
    })

    ws.on('open', () => {
      if (!opts.watch) {
        // Collect 1s then summarise
        timer = setTimeout(() => ws.close(), 1000)
      } else if (opts.seconds > 0) {
        timer = setTimeout(() => ws.close(), opts.seconds * 1000)
      }
    })

    ws.on('message', (data) => {
      let frame: MeterFrame
      try {
        frame = JSON.parse(data.toString()) as MeterFrame
      } catch {
        return
      }
      if (frame.type !== 'meters') return
      frames.push(frame)

      if (opts.watch) {
        if (opts.json) {
          console.log(JSON.stringify(frame))
        } else {
          console.log(fmtMeterLine(frame))
        }
      }
    })

    ws.on('close', () => {
      if (timer) clearTimeout(timer)
      if (!opts.watch) {
        if (opts.json) {
          console.log(JSON.stringify({ frames: frames.length, summary: fmtMeterSummary(frames) }))
        } else {
          console.log(fmtMeterSummary(frames))
        }
      }
      resolve()
    })
  })
}

// ─── art ──────────────────────────────────────────────────────────────────────

export async function actionArt(
  slug: string,
  ctx: ApiCtx,
  opts: { json: boolean },
): Promise<void> {
  const preset = await apiGet<Preset>(ctx, `/api/presets/${encodeURIComponent(slug)}`)
  const artwork = preset.artwork ?? {}
  // Probe the artwork endpoint to determine cache state
  let artStatus: 'cached' | 'fetchable' | 'missing'
  try {
    const probe = await apiProbe(ctx, `/api/artwork/${encodeURIComponent(slug)}`)
    if (probe.ok) {
      artStatus = 'cached'
    } else if (probe.status === 502) {
      artStatus = 'fetchable'
    } else {
      artStatus = 'missing'
    }
  } catch {
    artStatus = 'missing'
  }

  const result = { slug, artwork, status: artStatus }
  if (opts.json) {
    console.log(JSON.stringify(result))
  } else {
    console.log(`slug         ${slug}`)
    console.log(`status       ${artStatus}`)
    if ('url' in artwork && artwork.url) console.log(`url          ${artwork.url}`)
    if ('cachedFile' in artwork && artwork.cachedFile)
      console.log(`cachedFile   ${artwork.cachedFile}`)
    if ('itunesCollectionId' in artwork && artwork.itunesCollectionId)
      console.log(`collectionId ${artwork.itunesCollectionId}`)
  }
}

// ─── doctor ───────────────────────────────────────────────────────────────────

export async function actionDoctor(ctx: ApiCtx, opts: { json: boolean }): Promise<void> {
  const { access } = await import('node:fs/promises')
  const { execSync } = await import('node:child_process')

  const checks: CheckResult[] = []

  // 1. Daemon reachable
  try {
    await apiGet<{ ok: boolean }>(ctx, '/api/health')
    checks.push({ label: 'Daemon reachable', status: 'PASS' })
  } catch (e) {
    checks.push({
      label: 'Daemon reachable',
      status: 'FAIL',
      detail: `  run: tonedeck (to start daemon)`,
    })
  }

  // 2. camilladsp binary
  try {
    await access('/opt/homebrew/bin/camilladsp')
    checks.push({ label: 'camilladsp at /opt/homebrew/bin/camilladsp', status: 'PASS' })
  } catch {
    checks.push({ label: 'camilladsp at /opt/homebrew/bin/camilladsp', status: 'FAIL' })
  }

  // 3. SwitchAudioSource
  try {
    execSync('which SwitchAudioSource', { stdio: 'ignore' })
    checks.push({ label: 'SwitchAudioSource in PATH', status: 'PASS' })
  } catch {
    checks.push({ label: 'SwitchAudioSource in PATH', status: 'FAIL' })
  }

  // 4-5. Live checks require daemon reachable
  const daemonUp = checks[0]!.status === 'PASS'
  if (daemonUp) {
    try {
      const status = await apiGet<StatusData>(ctx, '/api/status')

      // 4. BlackHole 2ch in outputs
      const hasBlackHole = status.devices.outputs.includes('BlackHole 2ch')
      checks.push({
        label: '"BlackHole 2ch" in output devices',
        status: hasBlackHole ? 'PASS' : 'FAIL',
        detail: hasBlackHole
          ? undefined
          : `  outputs: [${status.devices.outputs.join(', ')}]`,
      })

      // 5. Engaged-state consistency
      if (status.engaged && status.dspState === null) {
        checks.push({
          label: 'DSP state consistent',
          status: 'WARN',
          detail: '  engaged but DSP not responding — run: tonedeck panic',
        })
      } else {
        checks.push({ label: 'DSP state consistent', status: 'PASS' })
      }
    } catch {
      checks.push({ label: '"BlackHole 2ch" in output devices', status: 'FAIL' })
      checks.push({ label: 'DSP state consistent', status: 'FAIL' })
    }

    // 6. Presets count > 0
    try {
      const { presets } = await apiGet<{ presets: unknown[] }>(ctx, '/api/presets')
      checks.push({
        label: 'Presets loaded',
        status: presets.length > 0 ? 'PASS' : 'FAIL',
        detail: `  count: ${presets.length}`,
      })
    } catch {
      checks.push({ label: 'Presets loaded', status: 'FAIL' })
    }
  } else {
    checks.push({ label: '"BlackHole 2ch" in output devices', status: 'FAIL', detail: '  (daemon unreachable)' })
    checks.push({ label: 'DSP state consistent', status: 'FAIL', detail: '  (daemon unreachable)' })
    checks.push({ label: 'Presets loaded', status: 'FAIL', detail: '  (daemon unreachable)' })
  }

  if (opts.json) {
    console.log(JSON.stringify(checks))
  } else {
    console.log(fmtDoctor(checks))
  }

  if (checks.some((c) => c.status === 'FAIL')) {
    process.exit(1)
  }
}

// ─── health ───────────────────────────────────────────────────────────────────

export async function actionHealth(ctx: ApiCtx, opts: { json: boolean }): Promise<void> {
  const data = await apiGet<{ ok: boolean; version: string; presets: number }>(ctx, '/api/health')
  out(opts.json, data, `ok  version: ${data.version}  presets: ${data.presets}`)
}

// ─── auto ─────────────────────────────────────────────────────────────────────

export async function actionAuto(
  ctx: ApiCtx,
  sub: string | undefined,
  opts: { json: boolean; now?: boolean },
): Promise<void> {
  if (opts.now) {
    await apiPost(ctx, '/api/auto/now')
    const s = await apiGet<{ mode: string; following: boolean }>(ctx, '/api/auto')
    return out(opts.json, s, `auto: ${s.mode}${s.following ? ' (following Apple Music)' : ''}`)
  }
  if (sub === 'on' || sub === 'off') {
    const s = await apiPost<{ mode: string; following: boolean }>(ctx, '/api/auto', { on: sub === 'on' })
    return out(opts.json, s, `auto ${sub} -> ${s.mode}`)
  }
  const s = await apiGet<{ mode: string; following: boolean }>(ctx, '/api/auto')
  out(opts.json, s, `auto: ${s.mode}${s.following ? ' (following Apple Music)' : ''}`)
}

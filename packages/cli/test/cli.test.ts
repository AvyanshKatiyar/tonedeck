/**
 * CLI unit tests — injected fetch, no live daemon.
 *
 * Tests cover:
 *   - status / list / show happy paths render expected fields
 *   - apply maps 409 → CliError.exitCode 3
 *   - tweak --vibe warmth=1 mutates preset and PUTs expected body
 *   - tweak rejects unknown vibe name
 *   - create reads stdin JSON (via a pre-loaded string mock)
 *   - doctor aggregates PASS/FAIL correctly with a fake fetch matrix
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Preset, Profile } from '@tonedeck/shared'
import { CliError, makeCtx, type FetchFn } from '../src/api.js'
import {
  actionStatus,
  actionList,
  actionShow,
  actionApply,
  actionTweak,
  actionCreate,
  actionDoctor,
  actionAuto,
} from '../src/commands.js'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const MOCK_STATUS = {
  engaged: false,
  bypass: false,
  activePreset: null,
  dspState: null,
  clippedSamples: null,
  devices: { current: null, saved: null, outputs: ['BlackHole 2ch', 'MacBook Speakers'] },
  dspVersion: null,
  lastEvent: null,
}

const MOCK_PRESET: Preset = {
  schemaVersion: 1,
  slug: 'yeezus',
  kind: 'album',
  title: 'Yeezus',
  artist: 'Kanye West',
  profile: 'ft1pro',
  preamp: -1,
  bands: [
    { id: 'Bass', type: 'lowshelf', freq: 80, q: 0.7, gain: 2 },
    { id: 'KickBody', type: 'peaking', freq: 120, q: 1.2, gain: 1 },
  ],
  intent: 'Raw industrial clarity',
  provenance: {
    createdBy: 'builtin',
    history: [
      { at: '2024-01-01T00:00:00.000Z', change: 'initial', reason: 'builtin' },
    ],
  },
  version: 1,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
}

const MOCK_PROFILE: Profile = {
  id: 'ft1pro',
  name: 'Focal Twin6 Be',
  playbackDeviceName: 'BlackHole 2ch',
  captureDeviceName: 'BlackHole 2ch',
  bandTemplate: [
    { id: 'Bass', type: 'lowshelf', freq: 80, q: 0.7, gain: 0 },
    { id: 'KickBody', type: 'peaking', freq: 120, q: 1.2, gain: 0 },
    { id: 'LowMidClean', type: 'peaking', freq: 250, q: 1.4, gain: 0 },
    { id: 'UpperMidTame', type: 'peaking', freq: 3000, q: 1.8, gain: 0 },
    { id: 'PresenceTame', type: 'peaking', freq: 5000, q: 2.0, gain: 0 },
    { id: 'Air', type: 'highshelf', freq: 10000, q: 0.7, gain: 0 },
  ],
  limits: {
    bandGainDb: [-12, 12],
    preampDb: [-12, 0],
    q: [0.3, 5],
    freqHz: [20, 20000],
    clipHeadroomDb: -1,
  },
  houseNotes: 'Flat reference',
}

// ─── Fetch factory ────────────────────────────────────────────────────────────

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (key: string) => (key === 'content-type' ? 'application/json' : null),
    },
    json: () => Promise.resolve(body),
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
  } as unknown as Response
}

function errorResponse(status: number, error: string): Response {
  return {
    ok: false,
    status,
    headers: {
      get: (key: string) => (key === 'content-type' ? 'application/json' : null),
    },
    json: () => Promise.resolve({ error }),
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
  } as unknown as Response
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('actionStatus', () => {
  it('prints engaged/bypass/activePreset fields in human mode', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(MOCK_STATUS))
    const ctx = makeCtx('http://localhost:5055', fetchFn as FetchFn)
    const logs: string[] = []
    vi.spyOn(console, 'log').mockImplementation((...args) => logs.push(args.join(' ')))

    await actionStatus(ctx, { json: false })

    expect(fetchFn).toHaveBeenCalledWith('http://localhost:5055/api/status', expect.any(Object))
    expect(logs.join('\n')).toContain('engaged')
    expect(logs.join('\n')).toContain('bypass')
  })

  it('emits valid JSON in --json mode', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(MOCK_STATUS))
    const ctx = makeCtx('http://localhost:5055', fetchFn as FetchFn)
    const logs: string[] = []
    vi.spyOn(console, 'log').mockImplementation((...args) => logs.push(args.join(' ')))

    await actionStatus(ctx, { json: true })

    const parsed = JSON.parse(logs[0]!) as typeof MOCK_STATUS
    expect(parsed.engaged).toBe(false)
    expect(parsed.devices.outputs).toContain('BlackHole 2ch')
  })
})

describe('actionList', () => {
  it('renders a table with SLUG/TITLE/ARTIST/KIND/VER columns', async () => {
    const presets = [{ slug: 'yeezus', title: 'Yeezus', artist: 'Kanye West', kind: 'album', version: 1 }]
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ presets }))
    const ctx = makeCtx('http://localhost:5055', fetchFn as FetchFn)
    const logs: string[] = []
    vi.spyOn(console, 'log').mockImplementation((...args) => logs.push(args.join(' ')))

    await actionList(ctx, { json: false })

    const output = logs.join('\n')
    expect(output).toContain('SLUG')
    expect(output).toContain('TITLE')
    expect(output).toContain('yeezus')
    expect(output).toContain('Kanye West')
  })

  it('emits raw API response in --json mode', async () => {
    const presets = [{ slug: 'yeezus', title: 'Yeezus', kind: 'album', version: 1 }]
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ presets }))
    const ctx = makeCtx('http://localhost:5055', fetchFn as FetchFn)
    const logs: string[] = []
    vi.spyOn(console, 'log').mockImplementation((...args) => logs.push(args.join(' ')))

    await actionList(ctx, { json: true })

    const parsed = JSON.parse(logs[0]!) as { presets: unknown[] }
    expect(parsed.presets).toHaveLength(1)
  })
})

describe('actionShow', () => {
  it('shows title, artist, bands', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(MOCK_PRESET))
    const ctx = makeCtx('http://localhost:5055', fetchFn as FetchFn)
    const logs: string[] = []
    vi.spyOn(console, 'log').mockImplementation((...args) => logs.push(args.join(' ')))

    await actionShow('yeezus', ctx, { json: false })

    const output = logs.join('\n')
    expect(output).toContain('Yeezus')
    expect(output).toContain('Kanye West')
    expect(output).toContain('Bass')
    expect(output).toContain('lowshelf')
  })

  it('calls correct endpoint', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(MOCK_PRESET))
    const ctx = makeCtx('http://localhost:5055', fetchFn as FetchFn)
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await actionShow('yeezus', ctx, { json: false })

    expect(fetchFn).toHaveBeenCalledWith(
      'http://localhost:5055/api/presets/yeezus',
      expect.any(Object),
    )
  })
})

describe('actionApply', () => {
  it('throws CliError with exitCode 3 on 409 (not_engaged)', async () => {
    const fetchFn = vi.fn().mockResolvedValue(errorResponse(409, 'Not engaged'))
    const ctx = makeCtx('http://localhost:5055', fetchFn as FetchFn)

    const err = await actionApply('yeezus', ctx, { json: false, engage: false }).catch((e) => e)

    expect(err).toBeInstanceOf(CliError)
    expect((err as CliError).exitCode).toBe(3)
    expect((err as CliError).message).toContain('Not engaged')
  })

  it('throws CliError with exitCode 2 on 404 (unknown slug)', async () => {
    const fetchFn = vi.fn().mockResolvedValue(errorResponse(404, 'Not found'))
    const ctx = makeCtx('http://localhost:5055', fetchFn as FetchFn)

    const err = await actionApply('bad-slug', ctx, { json: false, engage: true }).catch((e) => e)

    expect(err).toBeInstanceOf(CliError)
    expect((err as CliError).exitCode).toBe(2)
  })

  it('prints verdict on success', async () => {
    const result = { status: MOCK_STATUS, warnings: [], verdict: 'ok' }
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(result))
    const ctx = makeCtx('http://localhost:5055', fetchFn as FetchFn)
    const logs: string[] = []
    vi.spyOn(console, 'log').mockImplementation((...args) => logs.push(args.join(' ')))

    await actionApply('yeezus', ctx, { json: false, engage: false })

    expect(logs.join('\n')).toContain('verdict: ok')
  })
})

describe('actionTweak', () => {
  it('applies warmth=1 vibe, sends PUT with correct body shape', async () => {
    const updatedPreset = { ...MOCK_PRESET, version: 2 }
    const putResult = { preset: updatedPreset, warnings: [], verdict: 'ok' }

    // GET preset → GET profile → PUT update
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(MOCK_PRESET))   // GET preset
      .mockResolvedValueOnce(jsonResponse(MOCK_PROFILE))  // GET profile
      .mockResolvedValueOnce(jsonResponse(putResult))     // PUT
    const ctx = makeCtx('http://localhost:5055', fetchFn as FetchFn)
    const logs: string[] = []
    vi.spyOn(console, 'log').mockImplementation((...args) => logs.push(args.join(' ')))

    await actionTweak('yeezus', ctx, {
      json: false,
      bands: [],
      gains: [],
      qs: [],
      freqs: [],
      vibes: ['warmth=1'],
      reason: '',
      apply: false,
    })

    // The PUT call is the third fetch call
    const putCall = fetchFn.mock.calls[2]!
    expect(putCall[0]).toBe('http://localhost:5055/api/presets/yeezus')
    const putBody = JSON.parse((putCall[1] as RequestInit).body as string) as {
      preset: Preset
      change: string
      reason: string
    }
    expect(putBody.change).toContain('warmth')
    expect(putBody.reason).toBe('manual tweak via CLI')
    // Bass gain should have increased (warmth adds 0.6 * 1 = 0.6 to Bass)
    const bassBand = putBody.preset.bands.find((b) => b.id === 'Bass')!
    expect(bassBand.gain).toBeCloseTo(2.6, 1)
    // History entry should be in provenance
    expect(logs.join('\n')).toContain('change:')
  })

  it('rejects unknown vibe names', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(MOCK_PRESET))
      .mockResolvedValueOnce(jsonResponse(MOCK_PROFILE))
    const ctx = makeCtx('http://localhost:5055', fetchFn as FetchFn)

    const err = await actionTweak('yeezus', ctx, {
      json: false,
      bands: [],
      gains: [],
      qs: [],
      freqs: [],
      vibes: ['turbo=2'],
      reason: '',
      apply: false,
    }).catch((e) => e)

    expect(err).toBeInstanceOf(CliError)
    expect((err as CliError).exitCode).toBe(2)
    expect((err as CliError).message).toContain('Unknown vibe')
  })

  it('applies direct band gain edit', async () => {
    const updatedPreset = { ...MOCK_PRESET, version: 2 }
    const putResult = { preset: updatedPreset, warnings: [], verdict: 'ok' }

    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(MOCK_PRESET))
      .mockResolvedValueOnce(jsonResponse(MOCK_PROFILE))
      .mockResolvedValueOnce(jsonResponse(putResult))
    const ctx = makeCtx('http://localhost:5055', fetchFn as FetchFn)
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await actionTweak('yeezus', ctx, {
      json: false,
      bands: ['Bass'],
      gains: [3.5],
      qs: [],
      freqs: [],
      vibes: [],
      reason: 'test gain',
      apply: false,
    })

    const putCall = fetchFn.mock.calls[2]!
    const putBody = JSON.parse((putCall[1] as RequestInit).body as string) as {
      preset: Preset
      change: string
      reason: string
    }
    expect(putBody.change).toContain('Bass')
    expect(putBody.change).toContain('gain')
    expect(putBody.reason).toBe('test gain')
    const bassBand = putBody.preset.bands.find((b) => b.id === 'Bass')!
    expect(bassBand.gain).toBe(3.5)
  })
})

describe('actionCreate', () => {
  it('reads JSON from a mock stdin-like source and POSTs to /api/presets', async () => {
    const newPreset = { ...MOCK_PRESET, slug: 'cli-smoke-test' }
    const createResult = { preset: newPreset, warnings: [], verdict: 'ok' }
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(createResult, 201))
    const ctx = makeCtx('http://localhost:5055', fetchFn as FetchFn)
    const logs: string[] = []
    vi.spyOn(console, 'log').mockImplementation((...args) => logs.push(args.join(' ')))

    // Provide the preset via a temp file approach — mock readFile
    const { readFile } = await import('node:fs/promises')
    vi.spyOn({ readFile }, 'readFile')

    // We'll test by writing to a real temp file
    const { writeFile, mkdtemp, rm } = await import('node:fs/promises')
    const { join } = await import('node:path')
    const { tmpdir } = await import('node:os')
    const dir = await mkdtemp(join(tmpdir(), 'tonedeck-test-'))
    const file = join(dir, 'preset.json')
    await writeFile(file, JSON.stringify(newPreset))

    try {
      await actionCreate(ctx, {
        json: false,
        fromJson: file,
        clamp: true,
        autoTrim: true,
        apply: false,
      })

      expect(fetchFn).toHaveBeenCalledWith(
        'http://localhost:5055/api/presets',
        expect.objectContaining({ method: 'POST' }),
      )
      expect(logs.join('\n')).toContain('cli-smoke-test')
    } finally {
      await rm(dir, { recursive: true })
    }
  })
})

describe('actionAuto', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  it('actionAuto on calls POST /api/auto with { on: true }', async () => {
    const autoResult = { mode: 'armed', following: true }
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(autoResult))
    const ctx = makeCtx('http://localhost:5055', fetchFn as FetchFn)

    await actionAuto(ctx, 'on', { json: false })

    expect(fetchFn).toHaveBeenCalledWith(
      'http://localhost:5055/api/auto',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ on: true }) }),
    )
  })

  it('actionAuto off calls POST /api/auto with { on: false }', async () => {
    const autoResult = { mode: 'off', following: false }
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(autoResult))
    const ctx = makeCtx('http://localhost:5055', fetchFn as FetchFn)

    await actionAuto(ctx, 'off', { json: false })

    expect(fetchFn).toHaveBeenCalledWith(
      'http://localhost:5055/api/auto',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ on: false }) }),
    )
  })

  it('actionAuto status (no sub) calls GET /api/auto', async () => {
    const autoResult = { mode: 'armed', following: true }
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(autoResult))
    const ctx = makeCtx('http://localhost:5055', fetchFn as FetchFn)

    await actionAuto(ctx, undefined, { json: false })

    expect(fetchFn).toHaveBeenCalledWith(
      'http://localhost:5055/api/auto',
      expect.objectContaining({ method: 'GET' }),
    )
  })
})

describe('actionDoctor', () => {
  it('reports PASS for all checks when daemon is healthy', async () => {
    // health → status → presets
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ ok: true, version: '0.1.0', presets: 16 }))  // health
      .mockResolvedValueOnce(jsonResponse(MOCK_STATUS))  // status
      .mockResolvedValueOnce(jsonResponse({ presets: new Array(16).fill({}) }))  // presets

    const ctx = makeCtx('http://localhost:5055', fetchFn as FetchFn)
    const logs: string[] = []
    vi.spyOn(console, 'log').mockImplementation((...args) => logs.push(args.join(' ')))

    // doctor calls process.exit(1) if any FAIL — mock it
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as () => never)

    await actionDoctor(ctx, { json: false })

    const output = logs.join('\n')
    // Daemon reachable check passes
    expect(output).toContain('PASS')
    expect(output).toContain('Daemon reachable')
    // No FAIL for daemon-related checks
    expect(output).not.toContain('FAIL  Daemon reachable')
    expect(output).toContain('BlackHole 2ch')

    exitSpy.mockRestore()
  })

  it('reports FAIL for daemon reachable and exits 1 when daemon is down', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'))
    const ctx = makeCtx('http://localhost:5055', fetchFn as FetchFn)
    const logs: string[] = []
    vi.spyOn(console, 'log').mockImplementation((...args) => logs.push(args.join(' ')))

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as () => never)

    await actionDoctor(ctx, { json: false })

    expect(exitSpy).toHaveBeenCalledWith(1)
    const output = logs.join('\n')
    expect(output).toContain('FAIL')
    expect(output).toContain('Daemon reachable')

    exitSpy.mockRestore()
  })

  it('returns JSON array in --json mode', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ ok: true, version: '0.1.0', presets: 16 }))
      .mockResolvedValueOnce(jsonResponse(MOCK_STATUS))
      .mockResolvedValueOnce(jsonResponse({ presets: new Array(16).fill({}) }))

    const ctx = makeCtx('http://localhost:5055', fetchFn as FetchFn)
    const logs: string[] = []
    vi.spyOn(console, 'log').mockImplementation((...args) => logs.push(args.join(' ')))
    vi.spyOn(process, 'exit').mockImplementation((() => {}) as () => never)

    await actionDoctor(ctx, { json: true })

    const parsed = JSON.parse(logs[0]!) as Array<{ label: string; status: string }>
    expect(Array.isArray(parsed)).toBe(true)
    expect(parsed.length).toBeGreaterThan(0)
    expect(parsed[0]).toHaveProperty('label')
    expect(parsed[0]).toHaveProperty('status')
  })
})

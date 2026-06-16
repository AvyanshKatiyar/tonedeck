/**
 * PresetStore unit tests — all I/O against temp directories.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { PresetStore, StoreError } from '../src/presets.js'

// Resolve repo root from packages/daemon/test/ → ../../../
const BUILTIN_PRESETS_DIR = fileURLToPath(new URL('../../../presets/builtin', import.meta.url))
const PROFILES_DIR = fileURLToPath(new URL('../../../profiles', import.meta.url))

// A minimal valid preset matching the ft1pro profile.
function makePreset(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    slug: 'test-album',
    kind: 'album',
    title: 'Test Album',
    artist: 'Test Artist',
    profile: 'ft1pro',
    preamp: 0,
    bands: [
      { id: 'Bass', type: 'lowshelf', freq: 60, q: 0.7, gain: 1 },
    ],
    intent: 'test intent',
    provenance: { createdBy: 'user', history: [] },
    version: 1,
    createdAt: '2026-06-12T00:00:00.000Z',
    updatedAt: '2026-06-12T00:00:00.000Z',
    ...overrides,
  }
}

let tmpDir: string
let store: PresetStore

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'td-presets-'))
  store = new PresetStore({
    presetsDir: join(tmpDir, 'presets'),
    profilesDir: PROFILES_DIR,
    builtinPresetsDir: BUILTIN_PRESETS_DIR,
  })
  await store.init()
})

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true })
})

// ── Seeding ───────────────────────────────────────────────────────────────────

describe('init + seeding', () => {
  it('seeds 16 presets from builtin dir on first init', () => {
    expect(store.count).toBe(16)
  })

  it('does not re-seed on second init (idempotent)', async () => {
    const store2 = new PresetStore({
      presetsDir: join(tmpDir, 'presets'),
      profilesDir: PROFILES_DIR,
      builtinPresetsDir: BUILTIN_PRESETS_DIR,
    })
    await store2.init()
    expect(store2.count).toBe(16)
  })

  it('listPresets returns summaries sorted by title (locale order)', () => {
    const titles = store.listPresets().map((p) => p.title)
    // The store uses localeCompare; verify adjacency rather than against default sort.
    for (let i = 0; i < titles.length - 1; i++) {
      expect(titles[i].localeCompare(titles[i + 1])).toBeLessThanOrEqual(0)
    }
    expect(titles.length).toBe(16)
  })
})

// ── getPreset / getProfile ────────────────────────────────────────────────────

describe('reads', () => {
  it('getPreset returns full preset for known slug', () => {
    const p = store.getPreset('mbdtf')
    expect(p).toBeDefined()
    expect(p!.title).toBe('My Beautiful Dark Twisted Fantasy')
    expect(p!.bands.length).toBeGreaterThan(0)
  })

  it('getPreset returns undefined for unknown slug', () => {
    expect(store.getPreset('does-not-exist')).toBeUndefined()
  })

  it('getProfile returns the ft1pro profile', () => {
    const profile = store.getProfile('ft1pro')
    expect(profile).toBeDefined()
    expect(profile!.id).toBe('ft1pro')
  })

  it('getProfile returns undefined for unknown id', () => {
    expect(store.getProfile('no-such-profile')).toBeUndefined()
  })

  it('listProfiles returns at least one profile', () => {
    expect(store.listProfiles().length).toBeGreaterThanOrEqual(1)
  })
})

// ── createPreset ──────────────────────────────────────────────────────────────

describe('createPreset', () => {
  it('creates a valid preset and persists it to disk', async () => {
    const { preset } = await store.createPreset(makePreset())
    expect(preset.slug).toBe('test-album')
    expect(preset.version).toBe(1)
    // Verify the file was written.
    const files = await readdir(join(tmpDir, 'presets'))
    expect(files).toContain('test-album.json')
  })

  it('sets createdAt and updatedAt to now on create', async () => {
    const before = new Date()
    const { preset } = await store.createPreset(makePreset())
    const after = new Date()
    expect(new Date(preset.createdAt) >= before).toBe(true)
    expect(new Date(preset.createdAt) <= after).toBe(true)
    expect(preset.createdAt).toBe(preset.updatedAt)
  })

  it('throws StoreError("exists") when slug already present', async () => {
    await store.createPreset(makePreset())
    await expect(store.createPreset(makePreset())).rejects.toSatisfy(
      (e: unknown) => e instanceof StoreError && (e as StoreError).code === 'exists',
    )
  })

  it('throws StoreError("invalid") for a malformed preset', async () => {
    await expect(
      store.createPreset({ schemaVersion: 1, slug: 'bad' }),
    ).rejects.toSatisfy(
      (e: unknown) => e instanceof StoreError && (e as StoreError).code === 'invalid',
    )
  })

  it('surfaces clamp warnings when a band gain is out-of-limit', async () => {
    // Band gain 10 exceeds ft1pro limit of 6 — clamp should warn.
    const { warnings } = await store.createPreset(
      makePreset({
        slug: 'clamp-test',
        bands: [{ id: 'Bass', type: 'lowshelf', freq: 60, q: 0.7, gain: 10 }],
      }),
      { clamp: true },
    )
    expect(warnings.some((w) => w.includes('clamped'))).toBe(true)
  })

  it('surfaces autoTrim warning when preamp needs trimming', async () => {
    // preamp=4 (max), Bass gain=4 → combined boost exceeds clipHeadroomDb=3.
    const { warnings } = await store.createPreset(
      makePreset({
        slug: 'trim-test',
        preamp: 4,
        bands: [{ id: 'Bass', type: 'lowshelf', freq: 60, q: 0.7, gain: 4 }],
      }),
      { clamp: true, autoTrim: true },
    )
    expect(warnings.some((w) => w.includes('auto-trimmed'))).toBe(true)
  })

  it('throws StoreError("rejected") for absurd gains when clamp:false', async () => {
    // One band at +20 dB, preamp at 0 → even after max preamp trim of 6 dB,
    // residual ≈ 14 dB > clipHeadroomDb(3) + 6 → hard reject.
    const absurd = makePreset({
      slug: 'absurd',
      preamp: 0,
      bands: [{ id: 'Nuke', type: 'peaking', freq: 1000, q: 0.7, gain: 20 }],
    })
    const err = await store.createPreset(absurd, { clamp: false }).catch((e) => e)
    expect(err).toBeInstanceOf(StoreError)
    expect((err as StoreError).code).toBe('rejected')
    expect((err as StoreError).warnings?.length).toBeGreaterThan(0)
  })
})

// ── updatePreset ──────────────────────────────────────────────────────────────

describe('updatePreset', () => {
  it('bumps version and appends history entry', async () => {
    await store.createPreset(makePreset())
    const { preset } = await store.updatePreset(
      'test-album',
      makePreset({ title: 'Updated Album' }),
      { change: 'title edit', reason: 'typo fix' },
    )
    expect(preset.version).toBe(2)
    expect(preset.provenance.history).toHaveLength(1)
    expect(preset.provenance.history[0].change).toBe('title edit')
    expect(preset.provenance.history[0].reason).toBe('typo fix')
  })

  it('preserves createdAt from the original preset', async () => {
    const { preset: original } = await store.createPreset(makePreset())
    await new Promise((r) => setTimeout(r, 5)) // small delay
    const { preset: updated } = await store.updatePreset(
      'test-album',
      makePreset(),
      { change: 'tweak', reason: 'test' },
    )
    expect(updated.createdAt).toBe(original.createdAt)
    expect(updated.updatedAt > original.updatedAt).toBe(true)
  })

  it('preserves provenance.createdBy from the original preset', async () => {
    await store.createPreset(makePreset())
    const { preset } = await store.updatePreset(
      'test-album',
      // Provide different createdBy — should be ignored.
      makePreset({ provenance: { createdBy: 'claude', history: [] } }),
      { change: 'update', reason: 'test' },
    )
    expect(preset.provenance.createdBy).toBe('user')
  })

  it('throws StoreError("not_found") for unknown slug', async () => {
    await expect(
      store.updatePreset('no-such-slug', makePreset(), { change: 'x', reason: 'y' }),
    ).rejects.toSatisfy(
      (e: unknown) => e instanceof StoreError && (e as StoreError).code === 'not_found',
    )
  })

  it('persists the update to disk', async () => {
    await store.createPreset(makePreset())
    await store.updatePreset('test-album', makePreset({ title: 'New Title' }), {
      change: 'title',
      reason: 'test',
    })
    const raw = await readFile(join(tmpDir, 'presets', 'test-album.json'), 'utf-8')
    const json = JSON.parse(raw)
    expect(json.title).toBe('New Title')
    expect(json.version).toBe(2)
  })

  it('accumulates multiple history entries across updates', async () => {
    await store.createPreset(makePreset())
    await store.updatePreset('test-album', makePreset(), { change: 'first', reason: 'r1' })
    const { preset } = await store.updatePreset('test-album', makePreset(), {
      change: 'second',
      reason: 'r2',
    })
    expect(preset.version).toBe(3)
    expect(preset.provenance.history).toHaveLength(2)
  })
})

// ── deletePreset ──────────────────────────────────────────────────────────────

describe('deletePreset', () => {
  it('removes the preset from memory and disk', async () => {
    await store.createPreset(makePreset())
    expect(store.getPreset('test-album')).toBeDefined()
    await store.deletePreset('test-album')
    expect(store.getPreset('test-album')).toBeUndefined()
    const files = await readdir(join(tmpDir, 'presets'))
    expect(files).not.toContain('test-album.json')
  })

  it('throws StoreError("not_found") when slug is absent', async () => {
    await expect(store.deletePreset('ghost')).rejects.toSatisfy(
      (e: unknown) => e instanceof StoreError && (e as StoreError).code === 'not_found',
    )
  })
})

// ── versions + revert ───────────────────────────────────────────────────────────
describe('revertPreset', () => {
  const gainOf = (r: { preset: { bands: { id: string; gain: number }[] } } | { bands: { id: string; gain: number }[] }) => {
    const bands = 'preset' in r ? r.preset.bands : r.bands
    return bands.find((b) => b.id === 'Bass')!.gain
  }

  it('updatePreset snapshots the outgoing version', async () => {
    await store.createPreset(makePreset())
    await store.updatePreset(
      'test-album',
      makePreset({ bands: [{ id: 'Bass', type: 'lowshelf', freq: 60, q: 0.7, gain: 2 }] }),
      { change: 'Bass +1', reason: 'test' },
    )
    const snap = JSON.parse(
      await readFile(join(tmpDir, 'presets', '.history', 'test-album', 'v1.json'), 'utf-8'),
    )
    expect(snap.version).toBe(1)
    expect(gainOf(snap)).toBe(1)
  })

  it('bare revert undoes the last saved change; revert is itself revertable', async () => {
    await store.createPreset(makePreset())
    for (const g of [2, 3]) {
      await store.updatePreset(
        'test-album',
        makePreset({ bands: [{ id: 'Bass', type: 'lowshelf', freq: 60, q: 0.7, gain: g }] }),
        { change: `Bass → ${g}`, reason: 'test' },
      )
    }
    const r = await store.revertPreset('test-album')
    expect(r.revertedTo).toBe('v2')
    expect(r.preset.version).toBe(4) // version moves FORWARD
    expect(gainOf(r)).toBe(2)
    expect(r.preset.provenance.history.at(-1)!.change).toBe('reverted to v2')

    const back = await store.revertPreset('test-album', { toVersion: 3 })
    expect(gainOf(back)).toBe(3)
    expect(back.preset.version).toBe(5)
  })

  it('revert --to restores a specific version; unknown version → not_found', async () => {
    await store.createPreset(makePreset())
    await store.updatePreset(
      'test-album',
      makePreset({ bands: [{ id: 'Bass', type: 'lowshelf', freq: 60, q: 0.7, gain: 4 }] }),
      { change: 'Bass → 4', reason: 'test' },
    )
    const r = await store.revertPreset('test-album', { toVersion: 1 })
    expect(gainOf(r)).toBe(1)
    await expect(store.revertPreset('test-album', { toVersion: 99 })).rejects.toMatchObject({
      code: 'not_found',
    })
  })

  it('revert --original falls back to the factory builtin when no v1 snapshot exists', async () => {
    // Simulate a pre-snapshot tweak: update, then wipe the history dir.
    const yeezus = store.getPreset('yeezus')!
    await store.updatePreset(
      'yeezus',
      { ...yeezus, bands: yeezus.bands.map((b) => (b.id === 'Bass' ? { ...b, gain: 4 } : b)) },
      { change: 'Bass → 4', reason: 'test' },
    )
    await rm(join(tmpDir, 'presets', '.history'), { recursive: true, force: true })

    const r = await store.revertPreset('yeezus', { original: true })
    expect(r.revertedTo).toBe('factory original')
    const factory = JSON.parse(await readFile(join(BUILTIN_PRESETS_DIR, 'yeezus.json'), 'utf-8'))
    expect(r.preset.bands).toEqual(factory.bands)
    expect(r.preset.preamp).toBe(factory.preamp) // exact restore — no autoTrim
  })

  it('custom preset with no snapshots and no builtin → not_found with guidance', async () => {
    await store.createPreset(makePreset())
    await expect(store.revertPreset('test-album')).rejects.toMatchObject({ code: 'not_found' })
    await expect(store.revertPreset('test-album', { original: true })).rejects.toMatchObject({
      code: 'not_found',
    })
  })

  it('listVersions reports snapshots plus current', async () => {
    await store.createPreset(makePreset())
    await store.updatePreset(
      'test-album',
      makePreset({ bands: [{ id: 'Bass', type: 'lowshelf', freq: 60, q: 0.7, gain: 2 }] }),
      { change: 'Bass +1', reason: 'test' },
    )
    const versions = await store.listVersions('test-album')
    expect(versions.map((v) => v.version)).toEqual([1, 2])
    expect(versions.at(-1)).toMatchObject({ current: true, change: 'Bass +1' })
  })

  it('allPresets returns full Preset objects with bands', () => {
    const all = store.allPresets()
    expect(all.length).toBeGreaterThan(0) // seeded from builtins
    expect(Array.isArray(all[0].bands)).toBe(true)
  })
})

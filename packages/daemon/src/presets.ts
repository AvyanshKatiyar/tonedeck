/**
 * PresetStore — file-backed store for ToneDeck presets.
 *
 * Constructor paths are all explicit so tests can point at temp dirs.
 * Atomic writes (tmp + rename) protect against partial writes on crash.
 */
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import {
  parsePreset,
  parseProfile,
  clampPreset,
  headroomVerdict,
  autoTrim,
  type Preset,
  type Profile,
} from '@tonedeck/shared'

// ── Error type ────────────────────────────────────────────────────────────────

export type StoreErrorCode = 'exists' | 'not_found' | 'rejected' | 'invalid'

export class StoreError extends Error {
  readonly code: StoreErrorCode
  readonly warnings?: string[]

  constructor(code: StoreErrorCode, message: string, warnings?: string[]) {
    super(message)
    this.name = 'StoreError'
    this.code = code
    this.warnings = warnings
  }
}

// ── Public shapes ─────────────────────────────────────────────────────────────

export interface PresetSummary {
  slug: string
  kind: string
  title: string
  artist?: string
  intent: string
  version: number
  profile: string
  artwork?: { itunesCollectionId?: number; url?: string; cachedFile?: string }
  updatedAt: string
}

export interface CreateUpdateOpts {
  clamp?: boolean
  autoTrim?: boolean
}

export interface StoreResult {
  preset: Preset
  warnings: string[]
  verdict: string
}

export interface StoreInitOpts {
  presetsDir: string
  profilesDir: string
  builtinPresetsDir: string
}

// ── PresetStore ───────────────────────────────────────────────────────────────

export class PresetStore {
  private readonly presetsDir: string
  private readonly profilesDir: string
  private readonly builtinPresetsDir: string
  private presets = new Map<string, Preset>()
  private profiles = new Map<string, Profile>()

  constructor(opts: StoreInitOpts) {
    this.presetsDir = opts.presetsDir
    this.profilesDir = opts.profilesDir
    this.builtinPresetsDir = opts.builtinPresetsDir
  }

  /** Set up dirs, seed from builtins if empty, load all presets + profiles. */
  async init(): Promise<void> {
    await fs.mkdir(this.presetsDir, { recursive: true })

    // Seed from builtin if the user presets dir is empty.
    const entries = await fs.readdir(this.presetsDir)
    if (!entries.some((f) => f.endsWith('.json'))) {
      const builtins = await fs.readdir(this.builtinPresetsDir)
      await Promise.all(
        builtins
          .filter((f) => f.endsWith('.json'))
          .map((f) =>
            fs.copyFile(join(this.builtinPresetsDir, f), join(this.presetsDir, f)),
          ),
      )
    }

    // Load presets.
    await this._reloadPresets()

    // Load profiles.
    const profileFiles = await fs.readdir(this.profilesDir)
    await Promise.all(
      profileFiles
        .filter((f) => f.endsWith('.json'))
        .map(async (f) => {
          try {
            const raw = await fs.readFile(join(this.profilesDir, f), 'utf-8')
            const p = parseProfile(JSON.parse(raw))
            this.profiles.set(p.id, p)
          } catch {
            /* skip invalid profiles */
          }
        }),
    )
  }

  // ── Reads ──────────────────────────────────────────────────────────────────

  listPresets(): PresetSummary[] {
    return Array.from(this.presets.values())
      .map((p) => ({
        slug: p.slug,
        kind: p.kind,
        title: p.title,
        artist: p.artist,
        intent: p.intent,
        version: p.version,
        profile: p.profile,
        artwork: p.artwork,
        updatedAt: p.updatedAt,
      }))
      .sort((a, b) => a.title.localeCompare(b.title))
  }

  getPreset(slug: string): Preset | undefined {
    return this.presets.get(slug)
  }

  getProfile(id: string): Profile | undefined {
    return this.profiles.get(id)
  }

  listProfiles(): Profile[] {
    return Array.from(this.profiles.values())
  }

  get count(): number {
    return this.presets.size
  }

  // ── Writes ─────────────────────────────────────────────────────────────────

  async createPreset(input: unknown, opts: CreateUpdateOpts = {}): Promise<StoreResult> {
    let preset: Preset
    try {
      preset = parsePreset(input)
    } catch (e) {
      throw new StoreError('invalid', (e as Error).message)
    }

    if (this.presets.has(preset.slug)) {
      throw new StoreError('exists', `Preset "${preset.slug}" already exists`)
    }

    const { preset: safe, warnings, verdict } = this._runSafety(preset, opts)

    const now = new Date().toISOString()
    const final: Preset = { ...safe, createdAt: now, updatedAt: now, version: 1 }

    await this._writePreset(final)
    this.presets.set(final.slug, final)
    return { preset: final, warnings, verdict }
  }

  async updatePreset(
    slug: string,
    input: unknown,
    history: { change: string; reason: string },
    opts: CreateUpdateOpts = {},
  ): Promise<StoreResult> {
    const old = this.presets.get(slug)
    if (!old) throw new StoreError('not_found', `Preset "${slug}" not found`)

    let preset: Preset
    try {
      preset = parsePreset(input)
    } catch (e) {
      throw new StoreError('invalid', (e as Error).message)
    }

    const { preset: safe, warnings, verdict } = this._runSafety(preset, opts)

    const now = new Date().toISOString()
    const newEntry = { at: now, change: history.change, reason: history.reason }
    const final: Preset = {
      ...safe,
      version: old.version + 1,
      updatedAt: now,
      createdAt: old.createdAt,
      provenance: {
        ...safe.provenance,
        createdBy: old.provenance.createdBy,
        history: [...old.provenance.history, newEntry],
      },
    }

    await this._writePreset(final)
    this.presets.set(final.slug, final)
    return { preset: final, warnings, verdict }
  }

  async deletePreset(slug: string): Promise<void> {
    if (!this.presets.has(slug)) {
      throw new StoreError('not_found', `Preset "${slug}" not found`)
    }
    await fs.unlink(join(this.presetsDir, `${slug}.json`))
    this.presets.delete(slug)
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /** Run clamp → autoTrim → headroomVerdict. Throws StoreError on reject. */
  private _runSafety(
    preset: Preset,
    opts: CreateUpdateOpts,
  ): { preset: Preset; warnings: string[]; verdict: string } {
    const { clamp = true, autoTrim: doAutoTrim = true } = opts
    const warnings: string[] = []
    const profile = this.profiles.get(preset.profile)

    if (clamp && profile) {
      const r = clampPreset(preset, profile)
      preset = r.preset
      warnings.push(...r.warnings)
    }

    if (doAutoTrim && profile) {
      const r = autoTrim(preset, profile)
      if (r.trimmedByDb > 0) {
        preset = r.preset
        warnings.push(
          `Preamp auto-trimmed by ${r.trimmedByDb.toFixed(1)} dB to reduce clipping risk`,
        )
      }
    }

    let verdict = 'ok'
    if (profile) {
      const v = headroomVerdict(preset, profile)
      verdict = v.verdict
      warnings.push(...v.warnings)
      if (v.verdict === 'reject') {
        throw new StoreError(
          'rejected',
          'Preset rejected: band gains exceed safe headroom ceiling',
          warnings,
        )
      }
    }

    return { preset, warnings, verdict }
  }

  private async _reloadPresets(): Promise<void> {
    this.presets.clear()
    const files = await fs.readdir(this.presetsDir)
    await Promise.all(
      files
        .filter((f) => f.endsWith('.json'))
        .map(async (f) => {
          try {
            const raw = await fs.readFile(join(this.presetsDir, f), 'utf-8')
            const p = parsePreset(JSON.parse(raw))
            this.presets.set(p.slug, p)
          } catch {
            /* skip invalid */
          }
        }),
    )
  }

  /** Atomic write: write to tmp, then rename. */
  private async _writePreset(preset: Preset): Promise<void> {
    const path = join(this.presetsDir, `${preset.slug}.json`)
    const tmp = `${path}.tmp`
    await fs.writeFile(tmp, JSON.stringify(preset, null, 2) + '\n', 'utf-8')
    await fs.rename(tmp, path)
  }
}

# ToneDeck Auto-EQ + Deck-of-Cards UI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make ToneDeck automatically apply (and switch) the right EQ for whatever song is playing in macOS Apple Music — authoring new ones via the local `claude -p` CLI — and reskin the app as an artist-grouped "deck of cards" library with a hero live-EQ card.

**Architecture:** A new in-daemon `AutoDJ` polls Music.app via `osascript`, debounces track changes, resolves an EQ by a hybrid lookup (track preset → album preset → CLI-generated), and applies it through the existing `Lifecycle`. State persists to `~/.tonedeck/auto.json`. The existing `/ws` `applied` relay already updates the UI on every switch; a new `auto` event surfaces follow/yield state. The UI is rebuilt around an artist→album-deck→song-card tree in a "Warm Editorial" theme.

**Tech Stack:** TypeScript monorepo (`packages/{shared,daemon,cli,ui}`), Zod schemas, Fastify daemon, CamillaDSP, vitest, React + Vite UI. macOS only.

**Spec:** `docs/superpowers/specs/2026-06-13-tonedeck-auto-eq-deck-ui-design.md`

**Conventions for every task below:**
- Run one test file: `npx vitest run <path>` · Whole suite: `npm test` · Typecheck: `npm run typecheck` · Build: `npm run build`.
- Tests import compiled-style paths (`../src/foo.js`) even though the source is `.ts` — match the existing test files.
- Commit after each task. Branch is already `feat/auto-eq-deck-ui`.

---

## File Structure

**Create**
- `packages/shared/src/slug.ts` — deterministic `slugify()` for preset slugs.
- `packages/daemon/src/nowplaying.ts` — Music.app reader + pure parser.
- `packages/daemon/src/eqgen.ts` — CLI (`claude -p`) EQ author.
- `packages/daemon/src/autodj.ts` — watcher + state machine + hybrid resolve.
- `packages/daemon/src/routes/auto.ts` — `/api/auto` Fastify plugin.
- Tests alongside: `packages/shared/test/slug.test.ts`, `packages/daemon/test/{nowplaying,eqgen,autodj}.test.ts`, `packages/daemon/test/routes-auto.test.ts`.
- UI: `packages/ui/src/components/{TopBar,AutoToggle,NowLiveCard,BandChips,ArtistSection,AlbumDeck,SongCard}.tsx`.

**Modify**
- `packages/shared/src/preset.ts` — add `album?` to `PresetSchema`; export from `index.ts`.
- `packages/daemon/src/presets.ts` — add `album?` to `PresetSummary`.
- `packages/daemon/src/lifecycle.ts` — add public `get activeProfile()`.
- `packages/daemon/src/meters.ts` — relay a new `auto` event.
- `packages/daemon/src/index.ts` — construct `AutoDJ`, register `routes/auto`, wire `auto` relay, restore persisted state.
- `packages/cli/src/{api.ts,commands.ts,index.ts}` — `tonedeck auto` command.
- `packages/ui/src/{types.ts,api.ts,ws.ts,library.ts,store.tsx,storeShape.ts,App.tsx,styles.css}` — types, `/api/auto` client, `auto` ws event, grouping rewrite, theme, shell.

---

# Phase 0 — Shared schema

## Task 1: Add optional `album` to the preset schema + slug helper

**Files:**
- Modify: `packages/shared/src/preset.ts`
- Create: `packages/shared/src/slug.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/test/slug.test.ts`, `packages/shared/test/preset.test.ts` (extend)

- [ ] **Step 1: Write failing slug test**

`packages/shared/test/slug.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { slugify } from '../src/slug.js'

describe('slugify', () => {
  it('joins parts, lowercases, strips punctuation', () => {
    expect(slugify('Nas', "Life's a Bitch")).toBe('nas-lifes-a-bitch')
  })
  it('collapses spaces/symbols to single hyphens, trims edges', () => {
    expect(slugify('  MF DOOM ', 'Mm.. Food ')).toBe('mf-doom-mm-food')
  })
  it('always starts with an alphanumeric (drops leading hyphens)', () => {
    expect(slugify('!!!', 'Album')).toMatch(/^[a-z0-9]/)
  })
  it('is stable for the same inputs', () => {
    expect(slugify('A', 'B')).toBe(slugify('A', 'B'))
  })
})
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run packages/shared/test/slug.test.ts`
Expected: FAIL — cannot find `../src/slug.js`.

- [ ] **Step 3: Implement `slug.ts`**

`packages/shared/src/slug.ts`:
```ts
/** Deterministic preset slug from arbitrary parts. Matches PresetSchema's
 *  /^[a-z0-9][a-z0-9-]*$/ rule. Empty/garbage inputs collapse safely. */
export function slugify(...parts: Array<string | undefined | null>): string {
  const raw = parts.filter(Boolean).join(' ')
  const s = raw
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip diacritics
    .replace(/[^a-z0-9]+/g, '-') // non-alphanumerics → hyphen
    .replace(/^-+|-+$/g, '') // trim edge hyphens
    .replace(/-{2,}/g, '-') // collapse runs
    .slice(0, 64)
  return s.replace(/^-+/, '') || 'preset'
}
```

- [ ] **Step 4: Run slug test, verify pass**

Run: `npx vitest run packages/shared/test/slug.test.ts` → PASS.

- [ ] **Step 5: Add `album?` to the schema**

In `packages/shared/src/preset.ts`, inside `PresetSchema` add after the `artist` line:
```ts
  artist: z.string().optional(),
  album: z.string().optional(),
```

In `packages/shared/src/index.ts` add:
```ts
export * from './slug.js'
```

- [ ] **Step 6: Schema test — album round-trips, stays optional**

Add to `packages/shared/test/preset.test.ts` (create the file if absent, mirroring an existing valid-preset fixture):
```ts
import { describe, expect, it } from 'vitest'
import { parsePreset } from '../src/preset.js'

const base = {
  schemaVersion: 1, slug: 'nas-lifes-a-bitch', kind: 'track', title: "Life's a Bitch",
  artist: 'Nas', profile: 'ft1-pro', preamp: -3,
  bands: [{ id: 'b1', type: 'lowshelf', freq: 80, q: 0.7, gain: 3 }],
  intent: 'warmth', provenance: { createdBy: 'claude', history: [] },
  version: 1, createdAt: '2026-06-13T00:00:00.000Z', updatedAt: '2026-06-13T00:00:00.000Z',
}

describe('PresetSchema album field', () => {
  it('accepts and preserves album', () => {
    expect(parsePreset({ ...base, album: 'Illmatic' }).album).toBe('Illmatic')
  })
  it('remains optional', () => {
    expect(parsePreset(base).album).toBeUndefined()
  })
})
```

- [ ] **Step 7: Run + build shared**

Run: `npx vitest run packages/shared/test/ && npm run build -w packages/shared` → PASS / clean build.

- [ ] **Step 8: Add `album?` to daemon's `PresetSummary`**

In `packages/daemon/src/presets.ts`, in `interface PresetSummary` add `album?: string` next to `artist?`. Find where summaries are built (search `title:` in `presets.ts`) and add `album: p.album`.

- [ ] **Step 9: Typecheck daemon + commit**

Run: `npm run typecheck -w packages/daemon` → clean.
```bash
git add packages/shared packages/daemon/src/presets.ts
git commit -m "feat(shared): add optional album field + slugify helper"
```

---

# Phase 1 — Now-playing reader

## Task 2: `nowplaying.ts` — read + parse Music.app state

**Files:**
- Create: `packages/daemon/src/nowplaying.ts`
- Test: `packages/daemon/test/nowplaying.test.ts`

- [ ] **Step 1: Write failing parser test**

`packages/daemon/test/nowplaying.test.ts`:
```ts
import { describe, expect, it, vi } from 'vitest'
import { parseNowPlaying, readNowPlaying } from '../src/nowplaying.js'

describe('parseNowPlaying', () => {
  it('parses a playing track', () => {
    expect(parseNowPlaying('playing|1234|Life\'s a Bitch|Nas|Illmatic')).toEqual({
      state: 'playing', trackId: 1234, title: "Life's a Bitch", artist: 'Nas', album: 'Illmatic',
    })
  })
  it('handles a pipe inside the title (splits on first 4 delimiters)', () => {
    expect(parseNowPlaying('playing|9|A|B|C|D').title).toBe('A')
    expect(parseNowPlaying('playing|9|Intro | Outro|Nas|Illmatic').title).toBe('Intro | Outro')
  })
  it('maps closed/stopped to empty struct', () => {
    expect(parseNowPlaying('closed|||').state).toBe('closed')
    expect(parseNowPlaying('stopped|||').state).toBe('stopped')
    expect(parseNowPlaying('closed|||').trackId).toBeNull()
  })
  it('maps paused', () => {
    expect(parseNowPlaying('paused|5|T|Ar|Al').state).toBe('paused')
  })
})

describe('readNowPlaying', () => {
  it('uses injected exec and returns parsed struct', async () => {
    const exec = vi.fn().mockResolvedValue('playing|7|T|Ar|Al')
    expect(await readNowPlaying(exec)).toMatchObject({ state: 'playing', trackId: 7 })
  })
  it('returns closed when exec throws (Music not scriptable)', async () => {
    const exec = vi.fn().mockRejectedValue(new Error('app not running'))
    expect((await readNowPlaying(exec)).state).toBe('closed')
  })
})
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run packages/daemon/test/nowplaying.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement `nowplaying.ts`**

```ts
/** Reads the macOS Music.app current track + player state via osascript.
 *  The parser is pure; the osascript call is injectable for tests. */
import { execFile } from 'node:child_process'

export type PlayerState = 'playing' | 'paused' | 'stopped' | 'closed'

export interface NowPlaying {
  state: PlayerState
  trackId: number | null
  title: string | null
  artist: string | null
  album: string | null
}

const SCRIPT = `
if application "Music" is running then
  tell application "Music"
    if player state is stopped then return "stopped|||"
    set t to current track
    return (player state as text) & "|" & (database ID of t) & "|" & (name of t) & "|" & (artist of t) & "|" & (album of t)
  end tell
else
  return "closed|||"
end if`

export type ExecLike = (script: string) => Promise<string>

const defaultExec: ExecLike = (script) =>
  new Promise((resolve, reject) => {
    execFile('osascript', ['-e', script], { timeout: 4000 }, (err, stdout) =>
      err ? reject(err) : resolve(stdout.toString().trim()),
    )
  })

export function parseNowPlaying(raw: string): NowPlaying {
  const trimmed = raw.trim()
  const head = trimmed.split('|', 1)[0] as PlayerState
  if (head === 'closed' || head === 'stopped') {
    return { state: head, trackId: null, title: null, artist: null, album: null }
  }
  // Split into exactly 5 fields; title may itself contain '|'.
  const first = trimmed.indexOf('|')
  const rest = trimmed.slice(first + 1)
  const idEnd = rest.indexOf('|')
  const id = rest.slice(0, idEnd)
  const afterId = rest.slice(idEnd + 1)
  // album = after the LAST '|', artist = between the last two, title = remainder.
  const lastBar = afterId.lastIndexOf('|')
  const album = afterId.slice(lastBar + 1)
  const beforeAlbum = afterId.slice(0, lastBar)
  const artistBar = beforeAlbum.lastIndexOf('|')
  const artist = beforeAlbum.slice(artistBar + 1)
  const title = beforeAlbum.slice(0, artistBar)
  const state: PlayerState = head === 'paused' ? 'paused' : 'playing'
  return {
    state,
    trackId: Number(id) || null,
    title: title || null,
    artist: artist || null,
    album: album || null,
  }
}

export async function readNowPlaying(exec: ExecLike = defaultExec): Promise<NowPlaying> {
  try {
    return parseNowPlaying(await exec(SCRIPT))
  } catch {
    return { state: 'closed', trackId: null, title: null, artist: null, album: null }
  }
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `npx vitest run packages/daemon/test/nowplaying.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/daemon/src/nowplaying.ts packages/daemon/test/nowplaying.test.ts
git commit -m "feat(daemon): nowplaying — read + parse Music.app state via osascript"
```

---

# Phase 2 — EQ generation via CLI

## Task 3: `eqgen.ts` — author a track EQ with `claude -p`

**Files:**
- Create: `packages/daemon/src/eqgen.ts`
- Test: `packages/daemon/test/eqgen.test.ts`

- [ ] **Step 1: Write failing test**

`packages/daemon/test/eqgen.test.ts`:
```ts
import { describe, expect, it, vi } from 'vitest'
import { generateTrackEq, EqGenError } from '../src/eqgen.js'
import type { Profile } from '@tonedeck/shared'

const profile: Profile = {
  id: 'ft1-pro', name: 'FT1 Pro', playbackDeviceName: 'FiiO', captureDeviceName: 'BlackHole 2ch',
  bandTemplate: [], limits: { bandGainDb: [-12, 12], preampDb: [-12, 0], q: [0.3, 5], freqHz: [20, 20000], clipHeadroomDb: 1 },
  houseNotes: 'neutral-warm',
}
const track = { state: 'playing' as const, trackId: 1, title: "Life's a Bitch", artist: 'Nas', album: 'Illmatic' }

const goodJson = JSON.stringify({
  preamp: -3, intent: 'warm low end', notes: 'n',
  bands: [{ type: 'lowshelf', freq: 80, q: 0.7, gain: 3 }, { type: 'peaking', freq: 250, q: 1, gain: -2 }],
})

describe('generateTrackEq', () => {
  it('returns a valid Preset built from model JSON', async () => {
    const exec = vi.fn().mockResolvedValue(goodJson)
    const p = await generateTrackEq(track, profile, { slug: 'nas-lifes-a-bitch', exec })
    expect(p.slug).toBe('nas-lifes-a-bitch')
    expect(p.kind).toBe('track')
    expect(p.album).toBe('Illmatic')
    expect(p.provenance.createdBy).toBe('claude')
    expect(p.bands).toHaveLength(2)
    expect(p.bands[0].id).toBeTruthy() // ids assigned
  })
  it('tolerates ```json code fences', async () => {
    const exec = vi.fn().mockResolvedValue('```json\n' + goodJson + '\n```')
    const p = await generateTrackEq(track, profile, { slug: 's', exec })
    expect(p.bands).toHaveLength(2)
  })
  it('throws EqGenError on non-JSON', async () => {
    const exec = vi.fn().mockResolvedValue('I cannot do that')
    await expect(generateTrackEq(track, profile, { slug: 's', exec })).rejects.toBeInstanceOf(EqGenError)
  })
  it('throws EqGenError when exec rejects (timeout)', async () => {
    const exec = vi.fn().mockRejectedValue(new Error('timeout'))
    await expect(generateTrackEq(track, profile, { slug: 's', exec })).rejects.toBeInstanceOf(EqGenError)
  })
})
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run packages/daemon/test/eqgen.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement `eqgen.ts`**

```ts
/** Authors an EQ preset for one track by shelling out to the local Claude CLI
 *  (`claude -p`). No API key. Schema-validates the model output; the PresetStore
 *  applies the authoritative house-limit clamp on create. */
import { execFile } from 'node:child_process'
import { parsePreset, type Preset, type Profile, type NowPlayingTrack } from '@tonedeck/shared'

export class EqGenError extends Error {
  constructor(msg: string) { super(msg); this.name = 'EqGenError' }
}

// Minimal shape we need from nowplaying (avoid a cross-import cycle).
export interface TrackMeta { title: string | null; artist: string | null; album: string | null }

export type GenExec = (prompt: string, timeoutMs: number) => Promise<string>

const defaultExec: GenExec = (prompt, timeoutMs) =>
  new Promise((resolve, reject) => {
    const child = execFile(
      'claude',
      ['-p', '--model', 'sonnet', '--output-format', 'text'],
      { timeout: timeoutMs, env: { ...process.env, MAX_THINKING_TOKENS: '0' }, maxBuffer: 1 << 20 },
      (err, stdout) => (err ? reject(err) : resolve(stdout.toString())),
    )
    child.stdin?.end(prompt)
  })

export interface GenerateOpts { slug: string; exec?: GenExec; timeoutMs?: number }

function buildPrompt(track: TrackMeta, profile: Profile): string {
  const [gLo, gHi] = profile.limits.bandGainDb
  return [
    `You are tuning a parametric EQ for the headphone chain "${profile.name}" (${profile.houseNotes}).`,
    `Song: "${track.title}" by ${track.artist} (album: ${track.album}).`,
    `Author a tasteful corrective/flavor EQ for THIS track on THIS chain.`,
    `Rules: 3-6 bands. Each band: type in {lowshelf, peaking, highshelf}, freq 20-20000 Hz,`,
    `q 0.3-5, gain between ${gLo} and ${gHi} dB. preamp ${profile.limits.preampDb[0]}..${profile.limits.preampDb[1]} dB`,
    `(negative, to leave headroom). Be conservative — small moves. No more than ~4 dB on any single band.`,
    `Respond with ONLY a JSON object, no prose:`,
    `{"preamp": number, "intent": "short phrase", "notes": "one sentence",`,
    ` "bands": [{"type": "...", "freq": n, "q": n, "gain": n}]}`,
  ].join('\n')
}

function extractJson(raw: string): unknown {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const body = fenced ? fenced[1] : raw
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start < 0 || end < 0) throw new EqGenError('no JSON object in model output')
  try { return JSON.parse(body.slice(start, end + 1)) } catch (e) {
    throw new EqGenError(`model output was not valid JSON: ${(e as Error).message}`)
  }
}

export async function generateTrackEq(track: TrackMeta, profile: Profile, opts: GenerateOpts): Promise<Preset> {
  const exec = opts.exec ?? defaultExec
  const timeoutMs = opts.timeoutMs ?? 30_000
  let out: string
  try { out = await exec(buildPrompt(track, profile), timeoutMs) }
  catch (e) { throw new EqGenError(`claude CLI failed: ${(e as Error).message}`) }

  const parsed = extractJson(out) as { preamp?: number; intent?: string; notes?: string; bands?: unknown[] }
  if (!Array.isArray(parsed.bands) || parsed.bands.length === 0) throw new EqGenError('no bands in model output')

  const now = new Date().toISOString()
  const candidate = {
    schemaVersion: 1 as const,
    slug: opts.slug,
    kind: 'track' as const,
    title: track.title ?? 'Unknown', artist: track.artist ?? undefined, album: track.album ?? undefined,
    profile: profile.id,
    preamp: Number(parsed.preamp ?? -3),
    bands: parsed.bands.map((b, i) => ({ id: `b${i + 1}`, ...(b as object) })),
    intent: parsed.intent ?? 'auto', notes: parsed.notes,
    provenance: { createdBy: 'claude' as const, model: 'sonnet (cli)', history: [] },
    version: 1, createdAt: now, updatedAt: now,
  }
  try { return parsePreset(candidate) } // schema sanity; store does the house clamp
  catch (e) { throw new EqGenError(`generated preset failed schema: ${(e as Error).message}`) }
}
```

(Note: `NowPlayingTrack` import is unused here — remove it; `TrackMeta` is the local shape. Keep imports minimal.)

- [ ] **Step 4: Run test, verify pass**

Run: `npx vitest run packages/daemon/test/eqgen.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/daemon/src/eqgen.ts packages/daemon/test/eqgen.test.ts
git commit -m "feat(daemon): eqgen — author track EQ via claude -p (CLI, no key)"
```

---

# Phase 3 — AutoDJ watcher

## Task 4: `autodj.ts` — state machine + hybrid resolve + auto-yield

**Files:**
- Create: `packages/daemon/src/autodj.ts`
- Test: `packages/daemon/test/autodj.test.ts`

- [ ] **Step 1: Write failing test** (drives the whole interface)

`packages/daemon/test/autodj.test.ts`:
```ts
import { describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { AutoDJ } from '../src/autodj.js'

function fakeLifecycle(initial = { engaged: true, activePreset: 'mbdtf' as string | null }) {
  const ee = new EventEmitter()
  const applied: string[] = []
  return Object.assign(ee, {
    engaged: initial.engaged,
    get activePreset() { return initial.activePreset },
    activeProfile: { id: 'ft1-pro', name: 'FT1', playbackDeviceName: 'x', captureDeviceName: 'BlackHole 2ch', bandTemplate: [], limits: { bandGainDb: [-12, 12], preampDb: [-12, 0], q: [0.3, 5], freqHz: [20, 20000], clipHeadroomDb: 1 }, houseNotes: '' },
    applied,
    async applyPreset(slug: string) { applied.push(slug); initial.activePreset = slug; ee.emit('applied', { slug }); return { warnings: [], verdict: 'ok' } },
  })
}
const tracks = {
  ny: { state: 'playing' as const, trackId: 1, title: 'NY State', artist: 'Nas', album: 'Illmatic' },
  life: { state: 'playing' as const, trackId: 2, title: "Life's a Bitch", artist: 'Nas', album: 'Illmatic' },
}
const store = (slugs: string[]) => ({
  getPreset: (s: string) => (slugs.includes(s) ? { slug: s } : undefined),
  createPreset: vi.fn(async (p: any) => ({ preset: p, warnings: [], verdict: 'ok' })),
})

describe('AutoDJ', () => {
  it('does nothing while off', async () => {
    const lc = fakeLifecycle()
    const dj = new AutoDJ({ lifecycle: lc as any, store: store([]) as any, nowPlaying: async () => tracks.ny, generate: vi.fn(), debounceMs: 0 })
    await dj.tick(); await dj.tick()
    expect(lc.applied).toEqual([])
  })

  it('applies an existing track preset (no generation)', async () => {
    const lc = fakeLifecycle()
    const gen = vi.fn()
    const dj = new AutoDJ({ lifecycle: lc as any, store: store(['nas-ny-state']) as any, nowPlaying: async () => tracks.ny, generate: gen, debounceMs: 0 })
    dj.arm()
    await dj.tick() // pending
    await dj.tick() // confirmed → apply
    expect(lc.applied).toContain('nas-ny-state')
    expect(gen).not.toHaveBeenCalled()
  })

  it('falls back to album preset when no track preset', async () => {
    const lc = fakeLifecycle()
    const dj = new AutoDJ({ lifecycle: lc as any, store: store(['nas-illmatic']) as any, nowPlaying: async () => tracks.ny, generate: vi.fn(), debounceMs: 0 })
    dj.arm(); await dj.tick(); await dj.tick()
    expect(lc.applied).toContain('nas-illmatic')
  })

  it('generates + caches + applies when nothing exists', async () => {
    const lc = fakeLifecycle()
    const st = store([])
    const gen = vi.fn(async () => ({ slug: 'nas-ny-state', kind: 'track' }))
    const dj = new AutoDJ({ lifecycle: lc as any, store: st as any, nowPlaying: async () => tracks.ny, generate: gen as any, debounceMs: 0 })
    dj.arm(); await dj.tick(); await dj.tick()
    expect(gen).toHaveBeenCalledOnce()
    expect(st.createPreset).toHaveBeenCalledOnce()
    expect(lc.applied).toContain('nas-ny-state')
  })

  it('yields on a manual apply, resumes on next track', async () => {
    const lc = fakeLifecycle()
    let current = tracks.ny
    const dj = new AutoDJ({ lifecycle: lc as any, store: store(['nas-ny-state', 'nas-lifes-a-bitch']) as any, nowPlaying: async () => current, generate: vi.fn(), debounceMs: 0 })
    dj.arm(); await dj.tick(); await dj.tick()        // applies nas-ny-state
    lc.applyPreset('user-pick')                        // manual override (foreign)
    expect(dj.mode).toBe('yielded')
    await dj.tick()                                    // same track, still yielded → no auto apply
    expect(lc.applied.filter((s) => s === 'nas-ny-state')).toHaveLength(1)
    current = tracks.life                              // track changes
    await dj.tick(); await dj.tick()
    expect(dj.mode).toBe('armed')
    expect(lc.applied).toContain('nas-lifes-a-bitch')
  })

  it('does not re-apply the same track repeatedly', async () => {
    const lc = fakeLifecycle()
    const dj = new AutoDJ({ lifecycle: lc as any, store: store(['nas-ny-state']) as any, nowPlaying: async () => tracks.ny, generate: vi.fn(), debounceMs: 0 })
    dj.arm(); await dj.tick(); await dj.tick(); await dj.tick(); await dj.tick()
    expect(lc.applied.filter((s) => s === 'nas-ny-state')).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run packages/daemon/test/autodj.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement `autodj.ts`**

```ts
import { EventEmitter } from 'node:events'
import { slugify, type Preset, type Profile } from '@tonedeck/shared'
import type { NowPlaying } from './nowplaying.js'

export type AutoMode = 'off' | 'armed' | 'yielded'

export interface AutoDJLifecycle extends EventEmitter {
  readonly engaged: boolean
  readonly activePreset: string | null
  readonly activeProfile: Profile | null
  applyPreset(slug: string): Promise<{ warnings: string[]; verdict: string }>
}
export interface AutoDJStore {
  getPreset(slug: string): { slug: string } | undefined
  createPreset(input: unknown, opts?: { clamp?: boolean }): Promise<{ preset: Preset }>
}
export interface AutoDJOpts {
  lifecycle: AutoDJLifecycle
  store: AutoDJStore
  nowPlaying: () => Promise<NowPlaying>
  generate: (track: NowPlaying, profile: Profile, opts: { slug: string }) => Promise<Preset>
  debounceMs?: number
  maxGenPerHour?: number
  onAuto?: (e: { mode: AutoMode; generating?: boolean; track?: NowPlaying }) => void
}

export class AutoDJ extends EventEmitter {
  mode: AutoMode = 'off'
  private last: NowPlaying | null = null
  private lastAppliedTrackId: number | null = null
  private pendingTrackId: number | null = null
  private pendingSince = 0
  private initiatedSlug: string | null = null
  private inFlight = new Set<number>()
  private genTimestamps: number[] = []
  private readonly o: Required<Pick<AutoDJOpts, 'debounceMs' | 'maxGenPerHour'>> & AutoDJOpts

  constructor(opts: AutoDJOpts) {
    super()
    this.o = { debounceMs: 4000, maxGenPerHour: 30, ...opts }
    opts.lifecycle.on('applied', ({ slug }: { slug: string }) => {
      if (this.mode === 'armed' && slug !== this.initiatedSlug) this.setMode('yielded')
    })
  }

  arm() { if (this.mode === 'off') this.setMode('armed') }
  disarm() { this.setMode('off') }

  private setMode(m: AutoMode) {
    if (this.mode === m) return
    this.mode = m
    const e = { mode: m, track: this.last ?? undefined }
    this.o.onAuto?.(e); this.emit('auto', e)
  }

  /** One poll cycle. Call on an interval (and from tests). Never throws. */
  async tick(now = Date.now()): Promise<void> {
    if (this.mode === 'off') return
    let np: NowPlaying
    try { np = await this.o.nowPlaying() } catch { return }
    this.last = np
    if (np.state !== 'playing' || np.trackId == null) return
    if (np.trackId === this.lastAppliedTrackId) return

    if (np.trackId !== this.pendingTrackId) { this.pendingTrackId = np.trackId; this.pendingSince = now; return }
    if (now - this.pendingSince < this.o.debounceMs) return

    if (this.mode === 'yielded') this.setMode('armed') // resume on the new, stable track
    await this.resolveAndApply(np, now)
  }

  private async resolveAndApply(np: NowPlaying, now: number): Promise<void> {
    if (!this.o.lifecycle.engaged) return // never grabs audio
    const profile = this.o.lifecycle.activeProfile
    if (!profile) return

    const trackSlug = slugify(np.artist ?? '', np.title ?? '')
    const albumSlug = slugify(np.artist ?? '', np.album ?? '')

    let slug: string | null = null
    if (this.o.store.getPreset(trackSlug)) slug = trackSlug
    else if (np.album && this.o.store.getPreset(albumSlug)) slug = albumSlug
    else slug = await this.generateAndStore(np, profile, trackSlug, now)

    if (!slug) return
    this.initiatedSlug = slug
    try { await this.o.lifecycle.applyPreset(slug); this.lastAppliedTrackId = np.trackId } catch { /* keep current */ }
  }

  private async generateAndStore(np: NowPlaying, profile: Profile, slug: string, now: number): Promise<string | null> {
    if (np.trackId != null && this.inFlight.has(np.trackId)) return null
    // soft hourly cap
    this.genTimestamps = this.genTimestamps.filter((t) => now - t < 3_600_000)
    if (this.genTimestamps.length >= this.o.maxGenPerHour) return this.albumFallback(np)
    if (np.trackId != null) this.inFlight.add(np.trackId)
    this.setMode(this.mode) // no-op; keep mode
    this.o.onAuto?.({ mode: this.mode, generating: true, track: np }); this.emit('auto', { mode: this.mode, generating: true, track: np })
    try {
      const preset = await this.o.generate(np, profile, { slug })
      await this.o.store.createPreset(preset, { clamp: true })
      this.genTimestamps.push(now)
      return slug
    } catch {
      return this.albumFallback(np) // album → otherwise null (keep current EQ)
    } finally {
      if (np.trackId != null) this.inFlight.delete(np.trackId)
      this.o.onAuto?.({ mode: this.mode, generating: false, track: np }); this.emit('auto', { mode: this.mode, generating: false, track: np })
    }
  }

  private albumFallback(np: NowPlaying): string | null {
    const albumSlug = slugify(np.artist ?? '', np.album ?? '')
    return np.album && this.o.store.getPreset(albumSlug) ? albumSlug : null
  }
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `npx vitest run packages/daemon/test/autodj.test.ts` → PASS. Fix any interface drift until green.

- [ ] **Step 5: Commit**

```bash
git add packages/daemon/src/autodj.ts packages/daemon/test/autodj.test.ts
git commit -m "feat(daemon): AutoDJ — poll Music.app, hybrid resolve, auto-yield"
```

---

# Phase 4 — Routes, wiring, persistence

## Task 5: Lifecycle `activeProfile` getter + meters `auto` relay

**Files:**
- Modify: `packages/daemon/src/lifecycle.ts`, `packages/daemon/src/meters.ts`
- Test: extend `packages/daemon/test/meters.test.ts`

- [ ] **Step 1: Add `activeProfile` getter to Lifecycle**

Find the private profile resolution (`_activeProfileOrThrow`) and add a public getter near `get activeConfigPath()`:
```ts
/** The profile currently driving safety/clamp, or null if none resolved. */
get activeProfile(): Profile | null {
  try { return this._activeProfileOrThrow() } catch { return null }
}
```
Ensure `Profile` is imported in `lifecycle.ts` (it already uses profiles; add the type import if needed).

- [ ] **Step 2: Failing meters test — relays `auto`**

Add to `packages/daemon/test/meters.test.ts`:
```ts
it('relays auto events from an emitter to ws clients', () => {
  // build a MeterBroadcaster with a fake lifecycle EventEmitter, attach a fake socket,
  // emit 'auto' on the auto source, assert the socket received {type:'auto',...}
})
```
Model it on the existing 'applied' relay test in that file (copy its setup; swap `applied`→`auto`).

- [ ] **Step 3: Implement the relay**

In `meters.ts`, the constructor already wires `lifecycle.on('state'|'applied')`. Add an optional `autoSource` to `MeterBroadcasterOpts`:
```ts
export interface MeterBroadcasterOpts { lifecycle: MeterLifecycle; autoSource?: { on(e: 'auto', l: (p: unknown) => void): unknown } }
```
In the constructor:
```ts
opts.autoSource?.on('auto', (payload) => this._broadcast({ type: 'auto', ...(payload as object) }))
```

- [ ] **Step 4: Run + commit**

Run: `npx vitest run packages/daemon/test/meters.test.ts` → PASS.
```bash
git add packages/daemon/src/lifecycle.ts packages/daemon/src/meters.ts packages/daemon/test/meters.test.ts
git commit -m "feat(daemon): lifecycle.activeProfile + meters relays auto events"
```

## Task 6: `routes/auto.ts` + persistence + wire into `index.ts`

**Files:**
- Create: `packages/daemon/src/routes/auto.ts`
- Modify: `packages/daemon/src/index.ts`
- Test: `packages/daemon/test/routes-auto.test.ts`

- [ ] **Step 1: Failing route test**

`packages/daemon/test/routes-auto.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import Fastify from 'fastify'
import autoPlugin from '../src/routes/auto.js'

function fakeDj() {
  return { mode: 'off' as string, get following() { return this.mode === 'armed' }, arm() { this.mode = 'armed' }, disarm() { this.mode = 'off' }, last: null, lastAppliedSlug: null, backend: 'cli' as const, forceNow: async () => {} }
}

describe('auto routes', () => {
  it('GET returns status', async () => {
    const app = Fastify(); await app.register(autoPlugin, { autodj: fakeDj() as any, persist: async () => {} })
    const r = await app.inject({ method: 'GET', url: '/api/auto' })
    expect(r.statusCode).toBe(200); expect(r.json().mode).toBe('off')
  })
  it('POST {on:true} arms + persists', async () => {
    let saved: boolean | null = null
    const dj = fakeDj()
    const app = Fastify(); await app.register(autoPlugin, { autodj: dj as any, persist: async (v: boolean) => { saved = v } })
    const r = await app.inject({ method: 'POST', url: '/api/auto', payload: { on: true } })
    expect(r.json().mode).toBe('armed'); expect(saved).toBe(true)
  })
})
```

- [ ] **Step 2: Run it, verify it fails**, then implement `routes/auto.ts`:
```ts
import type { FastifyPluginAsync } from 'fastify'
import type { AutoDJ } from '../autodj.js'

export interface AutoPluginOpts { autodj: AutoDJ; persist: (enabled: boolean) => Promise<void> }

const autoPlugin: FastifyPluginAsync<AutoPluginOpts> = async (fastify, { autodj, persist }) => {
  const status = () => ({ mode: autodj.mode, following: autodj.mode === 'armed' })
  fastify.get('/api/auto', async () => status())
  fastify.post('/api/auto', async (req, reply) => {
    const body = (req.body ?? {}) as { on?: unknown }
    if (typeof body.on !== 'boolean') return reply.status(422).send({ error: 'body.on must be a boolean' })
    if (body.on) autodj.arm(); else autodj.disarm()
    await persist(body.on)
    return status()
  })
  fastify.post('/api/auto/now', async () => { await autodj.tick(Date.now() + 10_000_000); return status() })
}
export default autoPlugin
```
(`/api/auto/now` calls `tick` with a far-future `now` so the debounce passes immediately for the current track.)

- [ ] **Step 3: Wire into `index.ts`**

In `buildServer`, after the lifecycle/meters block, add (guarded by `lifecycleEnabled`):
```ts
import { AutoDJ } from './autodj.js'
import { readNowPlaying } from './nowplaying.js'
import { generateTrackEq } from './eqgen.js'
import autoPlugin from './routes/auto.js'
import { promises as fs } from 'node:fs'
// ...
const autoStatePath = join(dataDir, 'auto.json')
let autoEnabled = false
try { autoEnabled = JSON.parse(await fs.readFile(autoStatePath, 'utf8')).enabled === true } catch { /* default off */ }

const autodj = new AutoDJ({
  lifecycle,
  store,
  nowPlaying: () => readNowPlaying(),
  generate: (track, profile, o) => generateTrackEq(track, profile, { slug: o.slug }),
})
const persistAuto = async (enabled: boolean) => {
  const tmp = `${autoStatePath}.tmp`
  await fs.writeFile(tmp, JSON.stringify({ enabled }))
  await fs.rename(tmp, autoStatePath)
}
if (autoEnabled) autodj.arm()
const POLL_MS = Number(process.env.TONEDECK_AUTO_POLL_MS ?? 2000)
const autoTimer = setInterval(() => void autodj.tick(), POLL_MS)
autoTimer.unref?.()

const meters = opts._meters ?? new MeterBroadcaster({ lifecycle, autoSource: autodj })
await server.register(autoPlugin, { autodj, persist: persistAuto })
handle.autodj = autodj // extend ToneDeckServer with `autodj?: AutoDJ`; clear interval in shutdown
```
Add `autodj: AutoDJ | null` to `ToneDeckServer`, set it, and in the `shutdown` handler add `clearInterval(autoTimer)`. Move the `meters` construction so it receives `autoSource: autodj` (replace the existing `new MeterBroadcaster({ lifecycle })`).

- [ ] **Step 4: Typecheck, full suite, commit**

Run: `npm run typecheck -w packages/daemon && npm test`
Expected: clean + green.
```bash
git add packages/daemon
git commit -m "feat(daemon): /api/auto routes, poll loop, persisted auto state"
```

---

# Phase 5 — CLI

## Task 7: `tonedeck auto on|off|status|--now`

**Files:**
- Modify: `packages/cli/src/api.ts`, `packages/cli/src/commands.ts`, `packages/cli/src/index.ts`
- Test: extend `packages/cli/test/cli.test.ts`

- [ ] **Step 1: Add API client methods** in `api.ts` (match existing helpers):
```ts
getAuto: () => req<{ mode: string; following: boolean }>('/api/auto'),
setAuto: (on: boolean) => req('/api/auto', { method: 'POST', body: JSON.stringify({ on }) }),
autoNow: () => req('/api/auto/now', { method: 'POST' }),
```

- [ ] **Step 2: Failing CLI test** in `cli.test.ts` (mirror an existing action test with a fake ApiCtx):
```ts
it('actionAuto on calls setAuto(true)', async () => {
  const setAuto = vi.fn().mockResolvedValue({ mode: 'armed', following: true })
  await actionAuto({ api: { setAuto, getAuto: vi.fn(), autoNow: vi.fn() } } as any, 'on', { json: false })
  expect(setAuto).toHaveBeenCalledWith(true)
})
```

- [ ] **Step 3: Implement `actionAuto`** in `commands.ts`:
```ts
export async function actionAuto(ctx: ApiCtx, sub: string | undefined, opts: { json: boolean; now?: boolean }): Promise<void> {
  if (opts.now) { await ctx.api.autoNow(); const s = await ctx.api.getAuto(); return out(opts.json, s, `auto: ${s.mode}`) }
  if (sub === 'on' || sub === 'off') { const s = await ctx.api.setAuto(sub === 'on'); return out(opts.json, s, `auto ${sub} → ${s.mode}`) }
  const s = await ctx.api.getAuto(); out(opts.json, s, `auto: ${s.mode}${s.following ? ' (following Apple Music)' : ''}`)
}
```

- [ ] **Step 4: Register the command** in `index.ts` (mirror existing `command(...).action(...)`):
```ts
program.command('auto [state]').description('follow Apple Music and auto-EQ each track (on|off|status)')
  .option('--now', 'tune the currently playing track immediately').option('--json', 'JSON output')
  .action((state, o) => run((ctx) => actionAuto(ctx, state, { json: !!o.json, now: !!o.now })))
```

- [ ] **Step 5: Run + build + commit**

Run: `npx vitest run packages/cli/test/cli.test.ts && npm run build -w packages/cli`
```bash
git add packages/cli && git commit -m "feat(cli): tonedeck auto on|off|status|--now"
```

---

# Phase 6 — Deck-of-Cards UI overhaul (Warm Editorial)

> UI components are verified by `npm run typecheck -w packages/ui` + `npm run build -w packages/ui` + the pure-logic vitest in Task 8. Visual QA is the manual smoke in Task 12. Reuse `EqCurveCanvas`, `Meters`, `FallbackArt`, `Toasts`, `PresetDrawer` unchanged.

## Task 8: Grouping rewrite (`library.ts`) — artist → album-deck → song

**Files:**
- Modify: `packages/ui/src/library.ts`, `packages/ui/src/types.ts`
- Test: rewrite `packages/ui/test/library.test.ts` (or create if absent)

- [ ] **Step 1: Add `album?` to UI `PresetSummary`** and the `auto` ws variant in `types.ts`:
```ts
// in PresetSummary: album?: string
// extend WsMessage union:
| { type: 'auto'; mode: 'off' | 'armed' | 'yielded'; generating?: boolean }
```

- [ ] **Step 2: Failing grouping test**

`packages/ui/test/library.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { groupByArtist } from '../src/library.js'

const P = (o: Partial<any>) => ({ slug: o.slug, kind: o.kind ?? 'track', title: o.title, artist: o.artist, album: o.album, intent: '', version: 1, profile: 'ft1', updatedAt: '2026-06-13T00:00:00Z', ...o })

describe('groupByArtist', () => {
  const presets = [
    P({ slug: 'nas-illmatic', kind: 'album', title: 'Illmatic', artist: 'Nas' }),
    P({ slug: 'nas-ny-state', kind: 'track', title: 'NY State', artist: 'Nas', album: 'Illmatic' }),
    P({ slug: 'ye-mbdtf', kind: 'album', title: 'MBDTF', artist: 'Kanye West' }),
  ]
  it('groups artists, then album decks with songs nested', () => {
    const groups = groupByArtist(presets, '')
    expect(groups.map((g) => g.artist)).toEqual(['Kanye West', 'Nas'])
    const nas = groups.find((g) => g.artist === 'Nas')!
    const illmatic = nas.albums.find((a) => a.album === 'Illmatic')!
    expect(illmatic.albumPreset?.slug).toBe('nas-illmatic')
    expect(illmatic.songs.map((s) => s.slug)).toEqual(['nas-ny-state'])
  })
  it('search filters across artist/album/title', () => {
    expect(groupByArtist(presets, 'mbdtf').map((g) => g.artist)).toEqual(['Kanye West'])
  })
  it('buckets missing artist under Unknown Artist', () => {
    expect(groupByArtist([P({ slug: 's', title: 'x' })], '')[0].artist).toBe('Unknown Artist')
  })
})
```

- [ ] **Step 3: Implement `groupByArtist`** in `library.ts` (keep existing `organizeLibrary` exported for any other caller, or remove if unused):
```ts
export interface AlbumDeck { album: string; albumSlug: string | null; albumPreset?: PresetSummary; artwork?: PresetSummary['artwork']; songs: PresetSummary[] }
export interface ArtistGroup { artist: string; albums: AlbumDeck[] }

export function groupByArtist(presets: PresetSummary[], query: string): ArtistGroup[] {
  const q = query.toLowerCase().trim()
  const hit = (p: PresetSummary) => !q || [p.title, p.artist, p.album].some((v) => (v ?? '').toLowerCase().includes(q))
  const byArtist = new Map<string, Map<string, AlbumDeck>>()
  for (const p of presets) {
    if (!hit(p)) continue
    const artist = p.artist?.trim() || 'Unknown Artist'
    const albumName = (p.kind === 'album' ? p.title : p.album) || p.title
    const albums = byArtist.get(artist) ?? new Map()
    byArtist.set(artist, albums)
    const deck = albums.get(albumName) ?? { album: albumName, albumSlug: null, songs: [] }
    if (p.kind === 'album') { deck.albumPreset = p; deck.albumSlug = p.slug; deck.artwork = p.artwork }
    else { deck.songs.push(p); if (!deck.artwork) deck.artwork = p.artwork }
    albums.set(albumName, deck)
  }
  return [...byArtist.entries()]
    .map(([artist, albums]) => ({ artist, albums: [...albums.values()].sort((a, b) => a.album.localeCompare(b.album)) }))
    .sort((a, b) => a.artist.localeCompare(b.artist))
}
```

- [ ] **Step 4: Run test + commit**

Run: `npx vitest run packages/ui/test/library.test.ts` → PASS.
```bash
git add packages/ui/src/library.ts packages/ui/src/types.ts packages/ui/test/library.test.ts
git commit -m "feat(ui): artist→album-deck→song grouping"
```

## Task 9: Warm Editorial theme tokens

**Files:** Modify `packages/ui/src/styles.css`

- [ ] **Step 1:** Add a `:root` token block at the top (replace existing color literals progressively):
```css
:root {
  --bg: #15110f; --panel: #221b16; --line: rgba(255,255,255,.06);
  --ink: #f3ece2; --ink-dim: rgba(243,236,226,.66);
  --accent: #e3a55b; --accent-warm: #e07a5f;
  --radius-card: 8px; --radius-hero: 16px;
  --serif: Georgia, "Times New Roman", serif;
  --shadow-card: 0 6px 18px rgba(0,0,0,.4);
}
body { background: var(--bg); color: var(--ink); }
```
- [ ] **Step 2:** Build to confirm no breakage: `npm run build -w packages/ui`.
- [ ] **Step 3:** Commit: `git commit -am "feat(ui): Warm Editorial theme tokens"`

## Task 10: `BandChips` + `NowLiveCard` (hero live-EQ)

**Files:** Create `packages/ui/src/components/BandChips.tsx`, `packages/ui/src/components/NowLiveCard.tsx`

- [ ] **Step 1: `BandChips.tsx`** — render each band as `±g type Nhz`:
```tsx
import type { Band } from '../types.js'
const fmtFreq = (f: number) => (f >= 1000 ? `${(f / 1000).toFixed(f % 1000 ? 1 : 0)}k` : `${f}`)
export function BandChips({ bands, preamp }: { bands: Band[]; preamp: number }) {
  return (
    <div className="chips">
      {bands.map((b) => (
        <span className="chip" key={b.id}>{b.gain >= 0 ? '+' : ''}{b.gain.toFixed(1)} {b.type.replace('shelf', '-shelf')} {fmtFreq(b.freq)}Hz</span>
      ))}
      <span className="chip chip-pre">preamp {preamp.toFixed(1)}</span>
    </div>
  )
}
```
- [ ] **Step 2: `NowLiveCard.tsx`** — hero: cover + AUTO badge + title/artist/album + `EqCurveCanvas` + `BandChips` + `Meters`. Props: `{ preset: Preset | null; status: Status; auto: { mode: string; generating?: boolean } }`. Show cover via existing artwork URL helper (`api.artworkUrl(slug)`), `FallbackArt` on error. Show `AUTO · SONNET` badge when `preset.provenance.createdBy === 'claude'`. Add a `tuning…` shimmer overlay when `auto.generating`. Reuse `EqCurveCanvas bands={preset.bands}` and `Meters`.
- [ ] **Step 3:** Add `.hero/.cover/.curvebox/.chips/.chip` CSS to `styles.css` per the spec mockup (Warm Editorial values).
- [ ] **Step 4:** Typecheck + commit: `npm run typecheck -w packages/ui` then `git add packages/ui && git commit -m "feat(ui): NowLiveCard hero + BandChips"`.

## Task 11: `SongCard` + `AlbumDeck` + `ArtistSection`

**Files:** Create the three components under `packages/ui/src/components/`.

- [ ] **Step 1: `SongCard.tsx`** — `{ song: PresetSummary; live: boolean; onClick }`; mini `EqCurveCanvas` (fetch bands lazily via `api.show(slug)` or accept a curve path), title, status line (`● LIVE · AUTO` when live, else `tuned`/`album`). `.song.live` styling.
- [ ] **Step 2: `AlbumDeck.tsx`** — `{ deck: AlbumDeck; expanded; activeSlug; onToggle; onApply }`; stacked-card cover (CSS `::before/::after`), album name + `${songs.length} songs`; when `expanded`, render a horizontal `.songrow` of `SongCard`s.
- [ ] **Step 3: `ArtistSection.tsx`** — `{ group: ArtistGroup; ... }`; serif artist header + `.decks` row of `AlbumDeck`s.
- [ ] **Step 4:** Add `.decks/.deck/.expand/.songrow/.song/.sec` CSS from the spec mockup.
- [ ] **Step 5:** Typecheck + commit.

## Task 12: `AutoToggle` + `TopBar` + `App` shell + ws wiring

**Files:** Create `AutoToggle.tsx`, `TopBar.tsx`; modify `App.tsx`, `ws.ts`, `api.ts`, `store.tsx`/`storeShape.ts`.

- [ ] **Step 1: `api.ts`** add `getAuto`/`setAuto`/`autoNow` (same routes as CLI).
- [ ] **Step 2: `ws.ts`** handle `auto`:
```ts
} else if (msg.type === 'auto') {
  onAuto.current(msg) // wire a callback that updates store auto state
} else if (msg.type === 'state' || msg.type === 'applied') {
  cb.current()
}
```
Add an `auto` slice to the store (`{ mode, generating }`), updated by the ws `auto` handler and an initial `getAuto()` fetch.
- [ ] **Step 3: `AutoToggle.tsx`** — switch bound to `auto.mode`; `onChange` → `api.setAuto(!on)`; label `Following`/`Yielded`/`Off`; a small "resumes next song" hint when `yielded`.
- [ ] **Step 4: `TopBar.tsx`** — serif wordmark, profile pill (`status` device/profile), `AutoToggle`, settings icon.
- [ ] **Step 5: `App.tsx`** — assemble: `<TopBar/>`, `<NowLiveCard preset={activePreset} .../>`, then `groupByArtist(presets, query).map(g => <ArtistSection/>)`. Derive `activePreset` from `status.activePreset` (fetch its bands via existing presets fetch / `api.show`). Keep search box + `PresetDrawer` + `AddAlbumModal` + `Toasts`.
- [ ] **Step 6:** Typecheck + build: `npm run typecheck -w packages/ui && npm run build -w packages/ui`.
- [ ] **Step 7: Full suite** `npm test` → green. Commit: `git add packages/ui && git commit -m "feat(ui): TopBar + AutoToggle + deck shell + auto ws state"`.

## Task 13: Manual smoke + ship

- [ ] **Step 1:** `npm run build` (all packages).
- [ ] **Step 2:** Restart the daemon: `launchctl kickstart -k gui/$(id -u)/com.tonedeck.daemon` (per ToneDeck restart runbook).
- [ ] **Step 3:** Engage the chain, then `tonedeck auto on`. Play a song in Apple Music. Verify: within ~6s the EQ switches; the daemon log shows the resolve path; the UI hero card + library highlight update live; a new song generates a preset (first play has a short "tuning…", then switches).
- [ ] **Step 4:** Manually apply a different preset in the UI → toggle shows `Yielded`; skip to the next song → it resumes (`Following`) and applies that track's EQ.
- [ ] **Step 5:** Log out of `claude` (or temporarily rename it on PATH) → `tonedeck auto --now` on a brand-new song falls back (album or no-switch), one log line, no crash; existing presets still apply. (Re-enable `claude` after.)
- [ ] **Step 6:** Grant Automation permission to the daemon's process if macOS prompts on first `osascript`.

---

## Self-review notes (addressed)
- **Spec coverage:** schema `album?` (T1), nowplaying (T2), eqgen CLI+clamp-via-store (T3), AutoDJ hybrid+yield+debounce+cost cap (T4), activeProfile+auto relay (T5), routes+persist+poll+wiring (T6), CLI (T7), grouping (T8), theme (T9), hero+chips (T10), decks (T11), toggle+shell+ws (T12), live reflection (existing `applied` relay + new `auto` event, T5/T12), manual smoke incl. fallback + permissions (T13). All spec sections map to a task.
- **Clamp location corrected:** authoritative house clamp is `PresetStore.createPreset(input,{clamp:true})` → `clampPreset` (in `@tonedeck/shared`), not a daemon `safety.ts`. eqgen only does schema-sanity (T3).
- **Type consistency:** `AutoDJ` exposes `mode`, `arm()`, `disarm()`, `tick(now?)`, `activeProfile` via lifecycle, `auto` event payload `{mode,generating?,track?}` — used identically in T4/T5/T6/T7/T12.
- **No force-engage:** `resolveAndApply` early-returns when `!lifecycle.engaged` (T4), matching the spec non-goal.
```

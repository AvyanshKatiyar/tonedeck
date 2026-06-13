# ToneDeck — Auto-EQ (follow Apple Music) + Deck-of-Cards UI overhaul

- **Date:** 2026-06-13
- **Status:** Design approved (brainstorming) → ready for implementation plan
- **Repo:** `~/Desktop/tonedeck` (monorepo: `packages/{shared,daemon,cli,ui}`)
- **Author:** Avyansh + Claude

## Goal

Two tightly-coupled deliverables in one spec, because the first *causes* the problem the second solves:

1. **Auto-EQ** — while a song plays in the macOS **Apple Music (Music.app)** desktop app, the daemon automatically applies the right EQ for that track and **switches** when the track changes. New songs get an EQ authored by **Claude Sonnet via the local `claude -p` CLI** (no API key), cached as presets so replays are instant.
2. **UI overhaul** — auto-mode generates many per-track presets, which clutters the current flat grid. Replace it with an **artist-grouped "deck of cards" library** (Option B "Shelf Accordion") in a **Warm Editorial / Vinyl** visual language, fronted by a hero **"Now Live" EQ card** and a top-bar **Auto-EQ toggle**. The deck metaphor enforces the product name.

### Non-goals (YAGNI)
- No iPhone / Apple Music web / Spotify now-playing — **Music.app desktop only**.
- No Anthropic API/SDK key path — **CLI-first only**. (The daemon already has no key; we keep it that way.)
- No paid-tier gating/paywall logic — the look should *read* monetizable, but billing is out of scope.
- No system-wide MediaRemote private-framework integration (brittle across macOS versions).
- Auto-mode does **not** force-engage audio; it only switches presets when the chain is already engaged.

---

## Decisions locked during brainstorming

| Fork | Decision |
| --- | --- |
| EQ granularity / caching | **Hybrid lookup**: track preset → album preset → generate+cache as a track preset |
| Control model | **Toggle + auto-yield**: `auto on/off`; a manual apply pauses following for the current song, resumes next track |
| Generation backend | **CLI-first only**: `claude -p --model sonnet` with `MAX_THINKING_TOKENS=0`; no API key |
| Watcher location | **In-daemon `AutoDJ` module** (not a sidecar, not a foreground CLI loop) |
| Library layout | **Option B — Shelf Accordion**: artists are sections; album decks expand into a song-card row |
| Visual language | **Warm Editorial / Vinyl**: warm charcoal + amber accent, serif wordmark, paper-card decks |

---

# Part 1 — Auto-EQ engine (daemon)

## 1.1 Components (new daemon modules)

All new files live in `packages/daemon/src/`, follow the repo's injectable-dependency + vitest style, and never throw across the poll loop (errors are swallowed and retried, like `meters.ts`).

### `nowplaying.ts`
Wraps `osascript` to read Music.app state. Two concerns, split so the parser unit-tests without a subprocess:
- `readNowPlaying(exec?)` — runs one AppleScript via injected `exec` (default `child_process.execFile`), returns the raw delimited string.
- `parseNowPlaying(raw)` — pure parser → `NowPlaying`:
  ```ts
  interface NowPlaying {
    state: 'playing' | 'paused' | 'stopped' | 'closed'
    trackId: number | null   // AppleScript `database ID of current track` — stable per-track key
    title: string | null
    artist: string | null
    album: string | null
  }
  ```
- AppleScript (single `tell application "Music"`), guarded so a closed app returns `closed` rather than erroring:
  ```applescript
  if application "Music" is running then
    tell application "Music"
      if player state is stopped then return "stopped|||"
      set t to current track
      return (player state as text) & "|" & (database ID of t) & "|" & (name of t) & "|" & (artist of t) & "|" & (album of t)
    end tell
  else
    return "closed|||"
  end if
  ```
  Verified working on this machine (Music.app running, `database ID` present). Fields are `|`-joined; titles containing `|` are escaped by the parser splitting on the first 4 delimiters only.

### `eqgen.ts`
Authors an EQ for one track via the CLI.
- `generateTrackEq(track: NowPlaying, profile: Profile, opts): Promise<Preset>`
- Spawns `claude -p --model sonnet --output-format json` with env `MAX_THINKING_TOKENS=0` (the documented gotcha: without it `claude -p` thinks ~140s and times out), `cwd` neutral, **timeout ~30s** (injectable).
- **Prompt** carries: track/artist/album; the active `Profile.bandTemplate` (slots to fill), `Profile.limits` (house ceiling), `Profile.houseNotes`, and a distilled version of the `tonedeck-eq` skill's band-guide rules (FT1 Pro chain, what each band does, the "no more than N dB" discipline). Asks for a strict JSON object: `{ preamp, bands:[{type,freq,q,gain}], intent, notes }`.
- **Parse → validate → clamp**: parse JSON (tolerate code-fence wrapping), assemble a full `Preset` (slug/kind/provenance filled in by caller), validate via `parsePreset`, then **clamp through the existing `safety.ts`** so a hallucinated +18 dB or out-of-house value is pulled back to the profile's limits. Provenance: `createdBy:'claude'`, `model:'sonnet (cli)'`.
- Throws `EqGenError` on timeout / non-JSON / validation failure — the caller (`AutoDJ`) handles the fallback chain. No retries inside (keeps the poll loop bounded).

### `autodj.ts`
The watcher + state machine. Constructed in `buildServer`, given the `Lifecycle`, `PresetStore`, an `Artwork` (for cover lookup on new tracks), and injectable `nowPlaying` + `generate` fns.

State: `'off' | 'armed' | 'yielded'`.

```
poll every POLL_MS (~2000ms):
  np = nowPlaying()
  if state==='off': return
  if np.state !== 'playing' or np.trackId == null: remember, no action
  if np.trackId === lastAppliedTrackId: return            # already on it
  if np.trackId !== pendingTrackId: pendingTrackId=np.trackId; pendingSince=now; return   # debounce
  if now - pendingSince < DEBOUNCE_MS (~4000ms): return    # still settling (skipping)
  # stable track change confirmed:
  if state==='yielded': state='armed'                      # resume on the new song
  resolveAndApply(np)
```

`resolveAndApply(np)` — the **hybrid lookup**:
1. `trackSlug = slugify(np.artist, np.title)` → if `store.getPreset(trackSlug)` exists → apply it.
2. else `albumSlug = slugify(np.artist, np.album)` → if exists → apply it.
3. else `generate`: `eqgen.generateTrackEq(np, profile)` → fill `slug=trackSlug`, `kind:'track'`, `album:np.album`, artwork via `Artwork.search(track, 'song')` best-effort → `store.createPreset(..., {clamp:true})` → apply `trackSlug`.

Apply = `lifecycle.applyPreset(slug)` (only when `lifecycle.engaged`; if disengaged, record desired and skip — never grabs audio). Records `lastAppliedTrackId` + `lastAppliedSlug` and sets an **`initiatedSlug` flag** for the yield detector.

**Auto-yield:** subscribes to `lifecycle.on('applied', {slug})`. If `slug !== initiatedSlug` (a manual / external apply) **and** `state==='armed'` → `state='yielded'`. The `yielded → armed` transition happens only on the next confirmed track change (above), so a manual override sticks for the current song.

**Guards / cost control:**
- In-flight `Set<trackId>` so one track never generates twice concurrently.
- Cache-by-slug means skips, repeats, and re-listens cost zero CLI calls.
- Optional soft cap `MAX_GEN_PER_HOUR` (default e.g. 30) — on exceed, log once and fall back to album/flat (guardrail against a runaway).
- Debounce already prevents generating while scrubbing the queue.

### `routes/auto.ts` (Fastify plugin)
- `GET  /api/auto` → `{ mode: 'off'|'armed'|'yielded', following: boolean, lastTrack, lastSlug, backend: 'cli'|'unavailable' }`
- `POST /api/auto { on: boolean }` → arms/disarms, persists, returns the same status.
- `POST /api/auto/now` → force-resolve the current track immediately (the `tonedeck auto --now` path).

## 1.2 Persistence
`~/.tonedeck/auto.json`: `{ enabled: boolean }`. Loaded on boot; `AutoDJ` starts in `armed` iff `enabled`. Survives the `com.tonedeck.daemon` LaunchAgent restarts. Mirrors the existing lifecycle-state file pattern (atomic write).

## 1.3 Live UI reflection
**Already free for the switch itself**: `Lifecycle.emit('applied')` → `MeterBroadcaster._relay('applied')` → `/ws` → UI `ws.ts` re-fetches `/api/status` + presets → `NowPlayingBar` + `EqCurveCanvas` + library update. Auto-mode applies through the same `applyPreset` path, so switches light up the UI with no new plumbing.

**New event for auto-mode state** (so the toggle reflects auto-yield / generation status live): `MeterBroadcaster` also relays an `auto` event. Add `AutoDJ` as an `EventEmitter` emitting `auto` `{mode, generating?:boolean, track?}`; wire `meters` to relay it; extend the UI `WsMessage` union with `{type:'auto', ...}`.

## 1.4 CLI surface (`packages/cli`)
Add to `commands.ts` (+ `api.ts` client + `index.ts` wiring):
- `tonedeck auto on` / `off` / `status`
- `tonedeck auto --now` (apply current track immediately)
Human + `--json` output, matching existing command style.

## 1.5 Error handling (deterministic — no "it'll fix itself")
| Condition | Behavior |
| --- | --- |
| Music not running / stopped / paused / no track | idle, no calls |
| `osascript` error | swallow, retry next poll |
| Generation timeout / non-JSON / invalid | **fallback: album preset if one exists → otherwise keep the current EQ (no switch)**; one log line; never invent a preset |
| `claude` missing or logged-out | `backend:'unavailable'`; auto still applies *existing* track/album presets; logs once; never blocks |
| Chain disengaged while armed | hold desired track; apply when re-engaged |
| Manual apply while armed | yield for current song, resume next track |

## 1.6 Schema change (shared)
Add **optional `album?: string`** to `PresetSchema` (`packages/shared/src/preset.ts`). Needed so a `kind:'track'` preset knows which album deck it belongs to (today tracks carry only `title`+`artist`). Backward-compatible (optional). Album presets keep `title`=album; tracks gain `album`. `PresetSummary` (daemon + UI `types.ts`) gains `album?` too.

## 1.7 Tests (vitest)
- `nowplaying.test.ts` — parser over playing/paused/stopped/closed/no-track/`|`-in-title strings.
- `eqgen.test.ts` — fake exec returning good JSON → validated, in-house-limits preset; fenced JSON tolerated; malformed/over-limit → throws / clamped.
- `autodj.test.ts` — fake nowPlaying + fake generate + fake Lifecycle: resolve order (track>album>generate), debounce (rapid skips → no generate), yield-on-foreign-apply, resume-on-track-change, off ignores polls, disengaged holds, in-flight dedupe.
- `routes/auto.test.ts` — GET/POST/now contract + persistence.
- Real `osascript`/`claude` calls stay out of unit tests (manual smoke).

---

# Part 2 — Deck-of-Cards UI overhaul (`packages/ui`)

## 2.1 Visual language — "Warm Editorial / Vinyl"
Design tokens (new `:root` in `styles.css`):
- **Surface:** `#15110f` base, `#221b16` panels; 1px `rgba(255,255,255,.06)` hairlines.
- **Ink:** `#f3ece2` primary, `~70%` opacity secondary.
- **Accent:** amber `#e3a55b` (+ `#e07a5f` terracotta for live/curve gradient).
- **Type:** serif wordmark + headings (Georgia/system serif stack); sans (existing) for body/controls.
- **Radii:** 8px cards/decks, 16px hero cover; soft warm shadows.
- Single source of truth so the whole app re-themes from tokens (no per-component hardcoding).

## 2.2 Layout anatomy (top → bottom)
1. **Top bar** — serif `ToneDeck` wordmark + active-profile pill (`FiiO FT1 Pro`); right side: **Auto-EQ toggle** (`Following / Yielded / Off`, bound to `/api/auto`, live via `auto` ws event), settings.
2. **Hero "Now Live" card** — the dedicated live-EQ display:
   - Album cover (with `AUTO · SONNET` badge when the live preset was auto-generated; hidden for manual/builtin).
   - `NOW LIVE · Apple Music` label, serif track title, `artist — album`.
   - Large **EQ curve** (reuse `EqCurveCanvas` from the active preset's bands).
   - **Band chips** (each band as `+3.0 low-shelf 80Hz` etc.) — the "what changed" at a glance.
   - Live **L/R meters** (reuse `Meters`).
   - When auto-mode is generating a brand-new track: a subtle "tuning…" shimmer on the card until the `applied` event lands.
3. **Deck library (Option B)** — artist sections; each section a row of **album decks** (stacked-card look, depth hint + song count). Selecting a deck expands an inline **song-card row** beneath that artist (horizontal scroll); the **live** song-card is highlighted. Search + kind filter retained.

## 2.3 Grouping logic (rewrite `library.ts`, keep pure)
New shape:
```ts
interface ArtistGroup { artist: string; albums: AlbumDeck[] }
interface AlbumDeck   { album: string; albumSlug: string | null; artwork?; songs: PresetSummary[]; albumPreset?: PresetSummary }
```
- Group presets by `artist` (fallback bucket `'Unknown Artist'`; genre/mood presets get a non-album "Singles/Other" deck or a flat tail section).
- Within an artist, group by **album** = `album ?? title` (album presets define the deck; track presets slot in by their new `album` field).
- A deck with an `albumPreset` but no tracks still renders (the album EQ is the deck's own card). A deck with tracks but no album preset renders from the tracks' shared `album`.
- Sort: artists alpha; decks by most-recently-updated; songs by title. Search filters across artist/album/title; expansion state held in the store.

## 2.4 Components
- New: `TopBar.tsx`, `AutoToggle.tsx`, `NowLiveCard.tsx` (hero), `ArtistSection.tsx`, `AlbumDeck.tsx`, `SongCard.tsx`, `BandChips.tsx`.
- Reuse: `EqCurveCanvas`, `Meters`, `FallbackArt`, `PresetDrawer`, `AddAlbumModal`, `Toasts`.
- Refactor: `App.tsx` to the new shell; `NowPlayingBar.tsx` is absorbed into `NowLiveCard`; `LibraryGrid.tsx` → `ArtistSection`/`AlbumDeck` tree; `AlbumCard.tsx` → `AlbumDeck` (stacked look).
- `ws.ts` handles the `auto` event (updates toggle state); `api.ts` + `types.ts` gain `/api/auto` + `album?` + the `auto` ws variant.

## 2.5 States to handle
- Empty library (no presets) — friendly "play something / add an album" deck placeholder.
- Auto off vs armed vs yielded — toggle reflects all three; yielded shows a small "you took over — resumes next song" hint.
- Live song has only an album preset (no per-track) — hero shows the album card, no `AUTO` badge.
- Generation unavailable (`claude` logged out) — toggle still arms; a one-time toast explains existing presets still apply.
- Live preset deleted / not in library — guard already exists in `storeActions.ts` (don't delete what's playing).

## 2.6 Tests
- `library.test.ts` — rewrite for the artist→deck→song grouping (unknown artist, album-only deck, track-only deck, search, sort, genre/mood tail).
- Component smoke tests where the repo already has them; keep `EqCurveCanvas`/`Meters` tests green.

---

## 3. Rollout / order of work
1. **Shared schema:** add `album?` (+ summaries). Keep suite green.
2. **Daemon engine:** `nowplaying` → `eqgen` → `autodj` → `routes/auto` → wire into `index.ts`/`meters.ts`; tests.
3. **CLI:** `auto` command + client; tests.
4. **UI:** tokens/theme → grouping rewrite → shell + components → ws/api wiring; tests.
5. **Manual smoke:** play tracks in Music.app, watch auto-switch + UI reflect; verify yield + resume; verify fallback when `claude` unavailable.
6. Build UI (`packages/ui`), rebuild daemon dist, restart LaunchAgent.

## 4. Risks / open notes
- **CLI latency:** first play of a new song waits on `claude -p` (a few seconds). Mitigation: keep current EQ until the new one is ready; hero shows "tuning…". Acceptable per design (no force-switch to a worse EQ).
- **Quality of CLI-authored EQ** depends on the prompt carrying the `tonedeck-eq` band-guide discipline + house clamp. Clamp guarantees safety; prompt quality governs taste.
- **AppleScript permissions:** first `osascript` to Music.app may prompt for Automation permission for the daemon's process; document in the install/runbook.
- **macOS only**, as designed.

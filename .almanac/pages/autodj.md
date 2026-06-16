---
title: AutoDJ — Automatic Track-Aware EQ Following Apple Music
summary: How AutoDJ polls Apple Music, resolves or generates per-track presets, and applies them live; covers modes, debouncing, rate-limiting, and the API.
topics: [systems, flows, daemon]
sources:
  - id: autodj-ts
    type: file
    path: packages/daemon/src/autodj.ts
    note: Core AutoDJ class — modes, tick, resolve/apply, rate-limiting, backoff.
  - id: nowplaying-ts
    type: file
    path: packages/daemon/src/nowplaying.ts
    note: osascript NowPlaying reader; pipe-in-title handling.
  - id: autodj-test
    type: file
    path: packages/daemon/test/autodj.test.ts
    note: Behavior verification for modes, generation, yielding, backoff, rate-limiting.
  - id: auto-route
    type: file
    path: packages/daemon/src/routes/auto.ts
    note: API routes for arm/disarm and force-now.
  - id: daemon-index
    type: file
    path: packages/daemon/src/index.ts
    note: AutoDJ wiring, poll interval, state persistence path.
status: active
verified: 2026-06-17
---

# AutoDJ

AutoDJ is ToneDeck's automatic EQ-following system. When armed, it polls macOS Music.app every 2 seconds, detects track changes, and applies the best available [[preset]] to the live [[audio-chain]]. If no preset exists for the playing track, it calls [[eqgen]] to generate one on the fly before applying it.

AutoDJ closes the loop between "what's playing" and "how it sounds." Without it, the user must manually select a preset per song. With AutoDJ armed, presets are applied automatically as tracks change — and new presets are generated on demand for uncovered tracks. This is the primary consumer of [[eqgen]]'s `generateTrackEq` during normal listening, as distinct from the bulk [[corpus]] pipeline.

## Modes

Three modes form a state machine [@autodj-ts]:

| Mode | Meaning |
|---|---|
| `off` | Disabled. No polls, no applies. |
| `armed` | Following Apple Music. On each confirmed track change, resolves and applies a preset. |
| `yielded` | Armed, but a user-applied preset took precedence. Steps back until the next track change. |

**Yield behavior**: While `armed`, any `lifecycle.applyPreset(slug)` call where `slug !== initiatedSlug` (i.e. the user manually picked a different preset) transitions AutoDJ to `yielded`. This prevents AutoDJ from immediately overwriting a deliberate choice. The next track change re-arms automatically.

## Tick and Debounce

A `setInterval` fires `autodj.tick()` every 2 seconds by default (override: `TONEDECK_AUTO_POLL_MS`). Each tick [@autodj-ts]:

1. Reads `nowPlaying()` via osascript → Music.app.
2. Skips if `state !== 'playing'` or `trackId` is null.
3. Skips if `trackId === lastAppliedTrackId` (already handled this track).
4. If `trackId` changed since last tick: record it and timestamp; return and wait.
5. If `trackId` has been stable for `debounceMs` (default 4 seconds): proceed to resolve.

The 4-second debounce prevents chasing brief preview plays or fast-forward skips.

## Preset Resolution Order

For a confirmed track [@autodj-ts]:

1. **Track preset**: `slugify(artist, title)` → look up in store.
2. **Album preset**: `slugify(artist, album)` → look up in store.
3. **Generate**: call `eqgen.generateTrackEq` → `store.createPreset({ clamp: true })` → use the new slug.
4. **Album fallback** (on failure): if generation fails, apply the album preset.
5. **Nothing**: if no album preset and generation failed, keep the current EQ.

The album preset as fallback means a well-tuned album preset benefits tracks not yet in the corpus.

## Rate Limiting and Backoff

AutoDJ limits on-demand generation to prevent runaway Claude CLI spawns [@autodj-ts]:

- **Hourly cap**: 30 successful generations per rolling hour (`maxGenPerHour: 30`). When the cap is hit, AutoDJ falls back to the album preset for that tick.
- **Failure cooldown**: After a failed generation for a specific `trackId`, backs off for 60 seconds (`genCooldownMs: 60_000`). Album preset used during cooldown.
- **In-flight deduplication**: `inFlight` set (keyed by `trackId`) prevents spawning a parallel generation for the same track if one is already running.

## State Persistence

AutoDJ's `armed`/`off` state persists to `~/.tonedeck/auto.json` as `{ enabled: boolean }`. On daemon startup, if the file contains `enabled: true`, AutoDJ is armed immediately [@daemon-index].

## NowPlaying

`packages/daemon/src/nowplaying.ts` reads macOS Music.app via `osascript` [@nowplaying-ts]. It handles track titles containing `|` by anchoring artist and album to the last two pipe-delimited fields and letting the title absorb interior delimiters. osascript timeout is 4 seconds. All errors (including Music.app not running) return `{ state: 'closed' }` rather than throwing.

## API Routes

Registered by `packages/daemon/src/routes/auto.ts` [@auto-route]:

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/auto` | Returns `{ mode, following }` |
| `POST` | `/api/auto` | Body `{ on: boolean }` — arm or disarm; persists state |
| `POST` | `/api/auto/now` | Force-resolves current track immediately (passes `Number.MAX_SAFE_INTEGER` as `now` to bypass the debounce) |

## CLI Command

`tonedeck auto [on|off|status]` — arm, disarm, or check mode.  
`tonedeck auto --now` — force-resolve the current track without waiting for the debounce.

## WebSocket Integration

AutoDJ emits `'auto'` events on `{ mode, generating, track }`. `MeterBroadcaster` subscribes and forwards these to all connected WebSocket clients, so the [[ui]] can display the AutoDJ mode and a live "generating..." indicator [@daemon-index].

## Related Pages

- [[eqgen]] — called per track to generate new presets on demand; AutoDJ is its primary real-time consumer
- [[preset-store]] — receives generated presets with `clamp: true`
- [[lifecycle]] — provides `engaged`, `activeProfile`, and `applyPreset`; a foreign `applyPreset` call triggers the yield transition
- [[daemon]] — wires AutoDJ with real `nowPlaying`, `generateTrackEq`, and a 2-second poll timer
- [[corpus]] — bulk alternative; generates all presets upfront offline
- [[ui]] — receives AutoDJ mode/generating events via WebSocket

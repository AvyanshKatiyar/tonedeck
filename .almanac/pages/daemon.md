---
title: Daemon — Fastify HTTP+WebSocket Server
summary: The Fastify 5 daemon owns Lifecycle, PresetStore, CdspClient, AutoDJ, and all HTTP+WebSocket routes; this page covers architecture, routes, signal handling, and subsystem wiring.
topics: [daemon, systems, stack]
sources:
  - id: daemon-index
    type: file
    path: packages/daemon/src/index.ts
    note: buildServer factory, dependency injection, AutoDJ wiring, poll setup.
  - id: control-route
    type: file
    path: packages/daemon/src/routes/control.ts
    note: /api/control/ routes.
  - id: presets-route
    type: file
    path: packages/daemon/src/routes/presets.ts
    note: /api/presets/ CRUD routes.
  - id: artwork-route
    type: file
    path: packages/daemon/src/routes/artwork.ts
    note: /api/artwork/ routes.
  - id: auto-route
    type: file
    path: packages/daemon/src/routes/auto.ts
    note: /api/auto routes for AutoDJ arm/disarm/force-now.
  - id: meters-ts
    type: file
    path: packages/daemon/src/meters.ts
    note: MeterBroadcaster WebSocket endpoint.
---

# Daemon

The daemon is a Fastify 5 HTTP+WebSocket server in `packages/daemon/`. It binds to `127.0.0.1:5055` and is the single process that owns [[lifecycle]], [[preset-store]], and the [[cdsp-client]] connection.

## Factory function

`buildServer(options?)` in [[packages/daemon/src/index.ts]] accepts injectable dependencies:

- `_store` — a `PresetStore` instance (defaults to real filesystem store)
- `_artwork` — an `ArtworkCache` instance
- `_lifecycle` — a `Lifecycle` instance
- `_meters` — a `MeterBroadcaster` instance

This injection pattern lets unit tests swap in fakes for all external dependencies without launching real audio hardware or a real CamillaDSP process.

## AutoDJ Wiring

[[autodj]] is constructed and wired inside `buildServer` [@daemon-index]:

- `nowPlaying` is wired to `readNowPlaying()` from `nowplaying.ts` (osascript → Music.app).
- `generate` is wired to `generateTrackEq` from [[eqgen]].
- `store` is passed directly as the `AutoDJStore` interface.
- If `~/.tonedeck/auto.json` contains `{ enabled: true }`, AutoDJ is armed on startup.
- A 2-second `setInterval` drives `autodj.tick()` (override: `TONEDECK_AUTO_POLL_MS`).
- The interval is `unref()`-ed so it does not keep the process alive.
- On Fastify `onClose`, the interval is cleared.

## Routes

**`/api/control/`** (handled by [[packages/daemon/src/routes/control.ts]])**:**
Maps HTTP verbs to [[lifecycle]] methods. `POST /engage`, `POST /disengage`, `POST /apply/:slug`, `POST /bypass`, `POST /panic`, `GET /status`. `panic` always returns HTTP 200. All other lifecycle errors map to: `not_found` → 404, `not_engaged` → 409, anything else → 422.

**`/api/presets/`** (handled by [[packages/daemon/src/routes/presets.ts]])**:**
Full CRUD plus version history and revert. `GET /api/presets` (list summaries), `GET /api/presets/:slug` (full preset), `POST /api/presets` (create), `PUT /api/presets/:slug` (replace), `PATCH /api/presets/:slug` (partial update), `DELETE /api/presets/:slug`, `GET /api/presets/:slug/versions` (list history), `POST /api/presets/:slug/revert`, `POST /api/presets/:slug/reset`. StoreError codes map to: `exists` → 409, `not_found` → 404, `invalid` / `rejected` → 422.

**`/api/artwork/`** (handled by [[packages/daemon/src/routes/artwork.ts]])**:**
`GET /api/artwork/search?term=` calls the iTunes Search API and returns album artwork results. `GET /api/artwork/:slug` serves the cached JPEG for a preset, downloading it lazily from `preset.artwork.url` on first access.

**`/api/auto/`** (handled by `packages/daemon/src/routes/auto.ts`)**:**
`GET /api/auto` returns `{ mode, following }`. `POST /api/auto { on: boolean }` arms or disarms [[autodj]] and persists the state to `auto.json`. `POST /api/auto/now` force-resolves the current track immediately by bypassing the debounce.

**`/ws/meters`:**
WebSocket endpoint, handled by [[packages/daemon/src/meters.ts]]. Sends meter data and state events to all connected clients. Also relays `'auto'` events from [[autodj]] (mode changes, generation start/end) so the [[ui]] can show AutoDJ status in real time.

## Static file serving

The `packages/ui/dist` directory is served at `/` with SPA fallback (all unmatched paths return `index.html`). The SPA is built separately by Vite; the daemon serves it as static assets.

## Signal handling

`SIGTERM` and `SIGINT` close the Fastify server (HTTP listener and WebSocket connections) cleanly. They do not call `disengage()` — the CamillaDSP process keeps running and audio continues after the daemon exits. This is intentional: the LaunchAgent can restart the daemon without interrupting playback. On the next startup, [[lifecycle]] reconciles with the still-running process.

## MeterBroadcaster

`MeterBroadcaster` polls [[cdsp-client]] every 100 ms (demand-driven — only when at least one WebSocket client is connected). Every 10th tick it fetches `clippedSamples` from CamillaDSP in addition to the volume levels. It also relays `'state'` and `'applied'` events from [[lifecycle]] to all connected WebSocket clients, so the [[ui]] stays in sync without polling.

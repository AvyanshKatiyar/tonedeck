---
topics: [daemon, systems, stack]
files: [packages/daemon/src/index.ts, packages/daemon/src/routes/control.ts, packages/daemon/src/routes/presets.ts, packages/daemon/src/routes/artwork.ts, packages/daemon/src/meters.ts]
---

# Daemon

The daemon is a Fastify 5 HTTP+WebSocket server in `packages/daemon/`. It binds to `127.0.0.1:5055` and is the single process that owns [[lifecycle]], [[preset-store]], and the [[cdsp-client]] connection.

## Factory function

`buildServer(options?)` in [[`packages/daemon/src/index.ts`]] accepts injectable dependencies:

- `_store` — a `PresetStore` instance (defaults to real filesystem store)
- `_artwork` — an `ArtworkCache` instance
- `_lifecycle` — a `Lifecycle` instance
- `_meters` — a `MeterBroadcaster` instance

This injection pattern lets unit tests swap in fakes for all external dependencies without launching real audio hardware or a real CamillaDSP process.

## Routes

**`/api/control/`** (handled by [[`packages/daemon/src/routes/control.ts`]])**:**
Maps HTTP verbs to [[lifecycle]] methods. `POST /engage`, `POST /disengage`, `POST /apply/:slug`, `POST /bypass`, `POST /panic`, `GET /status`. `panic` always returns HTTP 200. All other lifecycle errors map to: `not_found` → 404, `not_engaged` → 409, anything else → 422.

**`/api/presets/`** (handled by [[`packages/daemon/src/routes/presets.ts`]])**:**
Full CRUD plus version history and revert. `GET /api/presets` (list summaries), `GET /api/presets/:slug` (full preset), `POST /api/presets` (create), `PUT /api/presets/:slug` (replace), `PATCH /api/presets/:slug` (partial update), `DELETE /api/presets/:slug`, `GET /api/presets/:slug/versions` (list history), `POST /api/presets/:slug/revert`, `POST /api/presets/:slug/reset`. StoreError codes map to: `exists` → 409, `not_found` → 404, `invalid` / `rejected` → 422.

**`/api/artwork/`** (handled by [[`packages/daemon/src/routes/artwork.ts`]])**:**
`GET /api/artwork/search?term=` calls the iTunes Search API and returns album artwork results. `GET /api/artwork/:slug` serves the cached JPEG for a preset, downloading it lazily from `preset.artwork.url` on first access.

**`/ws/meters`:**
WebSocket endpoint, handled by [[`packages/daemon/src/meters.ts`]]. Sends meter data and state events to all connected clients.

## Static file serving

The `packages/ui/dist` directory is served at `/` with SPA fallback (all unmatched paths return `index.html`). The SPA is built separately by Vite; the daemon serves it as static assets.

## Signal handling

`SIGTERM` and `SIGINT` close the Fastify server (HTTP listener and WebSocket connections) cleanly. They do not call `disengage()` — the CamillaDSP process keeps running and audio continues after the daemon exits. This is intentional: the LaunchAgent can restart the daemon without interrupting playback. On the next startup, [[lifecycle]] reconciles with the still-running process.

## MeterBroadcaster

`MeterBroadcaster` polls [[cdsp-client]] every 100 ms (demand-driven — only when at least one WebSocket client is connected). Every 10th tick it fetches `clippedSamples` from CamillaDSP in addition to the volume levels. It also relays `'state'` and `'applied'` events from [[lifecycle]] to all connected WebSocket clients, so the [[ui]] stays in sync without polling.

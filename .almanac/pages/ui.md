---
topics: [ui, stack]
files: [packages/ui/src/store.tsx, packages/ui/src/storeShape.ts, packages/ui/src/types.ts]
---

# UI

The UI is a React 19 / Vite 6 single-page app in `packages/ui/`. It is built to `packages/ui/dist/` and served as static files by the [[daemon]].

## Store model

State is managed by `useReducer` with a discriminated union of `Action` types. The store shape and reducer live in [[packages/ui/src/storeShape.ts]]; the provider, hooks, and async action factory live in [[packages/ui/src/store.tsx]].

**Phases:**
- `'loading'` — initial state; boot fetches in progress
- `'ready'` — all boot fetches succeeded; normal operation
- `'unreachable'` — daemon is not responding

**Boot sequence:** `StoreProvider` fires three parallel requests at mount: `GET /api/control/status`, `GET /api/presets`, and `GET /api/profile/ft1pro`. On success, dispatches `{ t: 'ready', status, presets, profile }` and transitions to `'ready'`. On failure, dispatches `{ t: 'unreachable' }`.

**Status poll:** In `'ready'` phase, `GET /api/control/status` is called every 5 seconds and dispatches `{ t: 'status', status }`.

## Draft model

The drawer (preset detail panel) maintains a three-part edit state:

- `base` — the last-saved version of the open preset, fetched when the drawer opens; immutable until a save completes or the preset is reverted
- `draft` — the live editable copy; modified by vibe slider changes and direct band edits
- `vibes` — the current vibe slider values as `Record<VibeName, number>`

When the drawer opens (`drawerOpen` action), `base = draft = fetched preset` and `vibes = ZERO_VIBES`. The `revert` action resets `draft = base` and `vibes = ZERO_VIBES`, discarding all unsaved edits without a network call.

## Vibe sliders

Moving a vibe slider dispatches `{ t: 'vibes', vibes, draft }` where `draft` is the result of calling `applyVibes(base, newVibes, profile)` in the action factory. This means vibe adjustments are always relative to `base`, not cumulative — dragging a slider back to 0 always returns to the exact saved state.

## Actions

The `Actions` interface in `storeShape.ts` defines: `refreshStatus`, `refreshPresets`, `toast`, `dismissToast`, `applyPreset`, `engage`, `disengage`, `bypass`, `panic`, `openDrawer`, `closeDrawer`, `setVibes`, `setDraft`, `revert`, `preview`, `save`, `resetOriginal`, `deletePreset`, `setAddOpen`, `ackClip`.

`preview` sends the current `draft` to the daemon's preview endpoint to apply EQ temporarily without saving. `save` PUTs the draft with a `change` description and `reason` string and on success updates `base = draft`.

## Meter WebSocket

`useMeterFeed()` hook connects to `ws://127.0.0.1:5055/ws/meters` and dispatches meter and state events to the store. Clip events (`clippedSamples > 0`) increment `clipAck`, which triggers a visual clip indicator. The `ackClip` action resets it.

## Wire types

[[packages/ui/src/types.ts]] defines UI-facing shapes that match the daemon's JSON responses: `Status`, `PresetSummary`, `ArtworkResult`, `ApplyResponse`, `MutationResponse`, `Meters`, `WsMessage`. These are not the same as the Zod-validated shared schemas — they are plain TypeScript interfaces for the fetch/WebSocket layer.

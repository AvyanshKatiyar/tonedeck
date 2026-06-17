---
topics: [incidents, daemon, stack]
files: [packages/daemon/src/index.ts]
---

# Static UI serving snapshots `dist` at startup (`wildcard: false`)

The [[daemon]] serves the built [[ui]] from `packages/ui/dist` with `@fastify/static` registered as `{ root: uiDist, prefix: '/', wildcard: false }` in [[packages/daemon/src/index.ts]]. With `wildcard: false`, `@fastify/static` enumerates the directory **at registration time** (server startup) and registers one route per file it finds. Files written to `dist` after startup have no route.

## Symptom

After a UI rebuild (`npm run build -w packages/ui`) without restarting the daemon, the UI loads to a **blank page**. The browser console shows a module MIME error on the entry bundle:

```
Failed to load module script: Expected a JavaScript-or-Wasm module script but the
server responded with a MIME type of "text/html". @ /assets/index-<hash>.js
```

`curl -D - http://127.0.0.1:5055/assets/index-<hash>.js` confirms it: `content-type: text/html` with a `content-length` equal to `index.html`'s size, even though the real `.js` file exists on disk.

## Why it happens

Vite emits **content-hashed** asset names (`assets/index-<hash>.js`) and empties `dist` of the previous build on each build. The still-running daemon has static routes only for the *old* filenames. A request for the new hashed asset misses the static routes and falls through to `setNotFoundHandler`, which returns `index.html` for any non-`/api`/`/ws` GET (the SPA-refresh fallback). The browser receives `index.html` (`text/html`) where it expected a JS module, rejects it under strict MIME checking, and React never mounts. New files added to `packages/ui/public/` (e.g. `favicon.svg`) fail the same way — no route until restart.

## Fix

Restart the daemon so `@fastify/static` re-globs `dist`:

```sh
launchctl kickstart -k gui/$UID/com.tonedeck.daemon
```

`AbandonProcessGroup=true` in the [[install]] LaunchAgent keeps CamillaDSP alive across the restart, so audio is not interrupted.

## Not a problem on fresh install

[[install]] runs `npm run build` *before* bootstrapping the LaunchAgent, so the daemon globs an already-current `dist`. The trap is the dev loop: rebuilding the UI against a long-lived daemon. Restart after every UI rebuild, or switch `wildcard` to `true` (a single `/*` route that resolves files per request) if startup-snapshot behavior is not wanted.

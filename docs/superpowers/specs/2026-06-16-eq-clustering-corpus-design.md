# Spec 1 — EQ Corpus + Clustering

**Date:** 2026-06-16
**Status:** Approved (design)
**Author:** Avyansh + Claude

## One-line

Ingest a corpus of songs (Kanye's full discography + the user's Liked songs from
Apple Music and YouTube Music), generate an independent per-song parametric EQ
preset for each, then cluster the presets by **tone-only frequency-response
shape** — reporting, for every split, the **dB variance** that forced a separate
class. CLI-first; no UI in this spec.

## Why

The hypothesis: *songs that need the same EQ should fall in the same cluster, and
when they don't, the distance between clusters is itself the useful signal — a new
way to classify music by how it must be tuned, not by genre/artist metadata.*
Two problems it solves at once:

1. Same EQ → one cluster (dedupe / "these all sound like they want the same curve").
2. Different EQ → measure *how* different, in interpretable dB, so a new class is
   justified by a number rather than a vibe.

This is the first of three specs. The later two (each its own spec→plan→build):

- **Spec 2:** Filter-by-EQ screen in the UI (browse/filter songs by cluster).
- **Spec 3:** Play-a-cluster through Music.app + ToneDeck (pick a cluster → drive
  Apple Music playback → apply the matching EQ live).

Clustering is bundled into Spec 1 (not deferred) because the ingested data alone
is not a deliverable — the cluster report is. The clustering code is small, pure
math over presets that already exist on disk.

## Verified mechanisms (checked 2026-06-16, not assumed)

- **Kanye discography** — iTunes artist id `2715720`;
  `https://itunes.apple.com/lookup?id=2715720&entity=song&limit=200` returns song
  rows with no login. **Caveats:** the API caps at 200 rows per call and mixes in
  tracks where Kanye is only a *feature* (e.g. "I Won (feat. Kanye West)"). The
  ingestor must filter to primary-artist (`artistId === 2715720` /
  `artistName === "Kanye West"`) and paginate past the 200 cap (per-album lookups
  or search offset).
- **Apple Music liked** — `tell application "Music" to get … of (every track of
  playlist "Library" whose favorited is true)` works and returned the user's real
  loved list. The old property name `loved` is **dead** (`-2753 not defined`). Use
  `favorited`.
- **YouTube Music** — no public API; the only path is Playwright against
  `music.youtube.com` with the user's interactive Google login. This is the single
  brittle, login-gated piece.

## Architecture

Approach chosen: **CLI + shared-math + scripts.**

- Clustering math → `packages/shared` (pure, alongside the existing biquad / safety
  / YAML-emitter code).
- `tonedeck clusters` → first-class CLI verb (the README's contract is "every
  capability is a `tonedeck` verb the skill can drive").
- Heavy one-shot ingestion + the long generation batch → `scripts/` (like the
  existing `migrate-kanye.ts`), so **Playwright never enters the daemon runtime**
  and multi-hour batches never run inside the always-on LaunchAgent.

Rejected alternatives:

- *Everything in the daemon* — puts Playwright + multi-hour batches inside the
  always-on audio daemon; bloats the runtime and risks the audio path.
- *All in scripts, no CLI verb* — simplest, but `tonedeck clusters` should be a
  first-class verb the skill/MCP can drive, consistent with the rest of the CLI.

## Components

### 1. Song catalog — `~/.tonedeck/catalog.json`

The work-list. Entries:

```jsonc
{
  "title": "Black Skinhead",
  "artist": "Kanye West",
  "album": "Yeezus",
  "source": "itunes" | "apple-liked" | "ytmusic-liked",
  "externalId": "..."        // optional: iTunes trackId, etc.
}
```

Deduped by normalized `(artist, title)` (reuse `slug.ts` normalization). Separate
from presets because **ingest is cheap + repeatable** while **generation is slow +
resumable**. The catalog records "songs we know about"; presets are "songs we've
tuned."

### 2. Three ingestors (each writes catalog entries; fully independent)

A failure in one (e.g. YT login) never blocks the others; a partial catalog is
valid.

- `scripts/ingest-kanye.ts` — iTunes lookup; filter to primary-artist; paginate
  past the 200 cap; dedup; merge into catalog.
- `scripts/ingest-apple-liked.ts` — osascript `whose favorited is true` (verified);
  parse `name | artist | album` rows; merge into catalog.
- `scripts/ingest-ytmusic.ts` — Playwright against `music.youtube.com` → "Liked
  songs" auto-playlist (`/playlist?list=LM`). Persisted `userDataDir` so login is
  **one-time**. Handles the virtualized infinite-scroll list (scroll until row
  count stabilizes). **Screenshot QA** at each step. The first run can be driven
  live via the Playwright tools to QA selectors while the user logs in.

### 3. Batch generator — `scripts/corpus-build.ts`

Walks the catalog; for each song **without** a preset, calls the existing
`generateTrackEq` (claude CLI, `ft1pro` profile) → `PresetStore.createPreset`.

- **Resumable** — presets on disk are the state; re-runs skip already-tuned songs.
- **Bounded concurrency** — default 3–4 parallel CLI procs (configurable), to not
  melt the machine.
- **Observable** — `X/Y done`, failures logged; failed songs retried on next run.
- `kind: 'track'`, **independent** (no album-delta inheritance) so clusters reflect
  real per-song sound, not which album a track is on.
- No hourly cap (this is explicit user-initiated bulk, unlike AutoDJ's 30/hr).

### 4. Clustering engine — `packages/shared/src/cluster.ts`

- Render each preset to a magnitude response at ~48 log-spaced freqs (20 Hz–20 kHz)
  using the existing biquad math.
- **Tone-only:** subtract each curve's mean dB → compare *shape*, not loudness
  (preamp/level normalized out).
- **Distance:** RMS dB difference between two normalized curves.
- **Cluster:** agglomerative hierarchical (average/complete linkage); cut the
  dendrogram at a dB threshold (default **~1.5 dB RMS**, configurable). **The merge
  height is the variance** — the report says e.g. *"split off at 2.1 dB RMS."*
- k-means rejected: you'd have to guess `k`, and the distances wouldn't be in dB.

`tonedeck clusters [--threshold N] [--json]` → clusters, members, each cluster's
centroid character (e.g. "bass-forward, tamed presence") + the dB gap to its
nearest neighboring cluster.

## Data flow

```
iTunes API ─┐
osascript  ─┼─→ catalog.json ──→ corpus-build (eqgen) ──→ ~/.tonedeck/presets/ ──→ cluster.ts ──→ `tonedeck clusters`
Playwright ─┘                      (resumable, bounded)
```

## Error handling

- **Ingest:** per-source isolation; partial catalog valid. YT session expiry →
  re-login prompt.
- **Generation:** per-song failure logged + skipped + cooldown; batch continues;
  next run retries the failures (resumable).
- **Clustering:** pure/deterministic; the curve representation natively handles
  presets with *different band sets* (no common-band assumption).

## Testing

- Catalog dedup/parse; curve + distance + clustering: unit tests with synthetic
  presets (two identical shapes → one cluster; a clearly different one → splits at
  the expected dB).
- Batch runner: injectable `generate` fn (same pattern as the existing AutoDJ
  tests) → test resumability / skip / concurrency / failure handling.
- YT scraper: parser unit test over captured HTML + screenshot QA (the live login
  flow can't be meaningfully unit-tested).

## Out of scope (this spec)

- Filter-by-EQ UI (Spec 2).
- Driving Music.app playback from a cluster (Spec 3).
- Generating EQ for the entire library beyond Liked songs + Kanye (count is kept
  bounded by using Liked songs, per the cost decision).

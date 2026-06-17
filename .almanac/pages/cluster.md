---
title: Cluster — Tone-Only EQ Clustering Engine
summary: How the clustering engine groups presets by EQ shape using mean-normalized frequency response curves and average-linkage agglomerative clustering with an RMS dB threshold.
topics: [corpus, concepts, systems]
sources:
  - id: cluster-ts
    type: file
    path: packages/shared/src/cluster.ts
    note: presetCurve, curveDistance, clusterPresets, describeCurve, and all types.
  - id: cluster-route
    type: file
    path: packages/daemon/src/routes/clusters.ts
    note: GET /api/clusters Fastify route.
  - id: clusters-test
    type: file
    path: packages/shared/test/cluster.test.ts
    note: Validates clustering correctness.
  - id: cli-clusters
    type: file
    path: packages/cli/src/commands.ts
    note: actionClusters wiring.
  - id: cli-index
    type: file
    path: packages/cli/src/index.ts
    note: `tonedeck clusters` Commander registration.
status: active
verified: 2026-06-17
---

# Cluster

The clustering engine in `packages/shared/src/cluster.ts` groups [[preset]]s by the shape of their EQ frequency response curve — tone only, excluding preamp — so tracks with similar tuning requirements appear together regardless of loudness differences.

## What "Tone-Only" Means

Two presets may have very different preamp values but nearly identical band shapes. Clustering on the full response (preamp included) would conflate loudness preference with tonal character. The engine always evaluates bands at `preamp = 0`, then mean-normalizes the curve to 0 dB before computing distances. This gives pure shape comparison.

## Frequency Probe Grid

`CLUSTER_FREQS` — 48 log-spaced frequencies from 20 Hz to 20 kHz. Log spacing matches how humans perceive frequency (octaves, not Hz).

## Core Computations

**`presetCurve(preset, freqs?)`**:  
`responseDb(preset.bands, 0, freqs)` → subtract the mean → mean-normalized shape curve.

**`curveDistance(a, b)`**:  
RMS dB between two same-length curves. Result is directly interpretable as "the typical dB difference in shape across the spectrum."

## Clustering Algorithm

Average-linkage agglomerative clustering:

1. Start: each preset is its own cluster.
2. Repeat: find the two clusters whose average pairwise curve distance is smallest.
3. If that distance ≤ threshold: merge them. Otherwise: stop.
4. Assign stable numeric IDs (final group indices). Sort by cluster size (largest first). Compute nearest-neighbor gaps.

**Default threshold: 1.5 dB RMS.** Curves within 1.5 dB RMS of each other merge into the same cluster. Two clusters 1.5+ dB apart are genuinely different enough to warrant separate identities.

The threshold is exposed as a query parameter so callers can explore different granularities.

## Output

```ts
interface ClusterResult {
  threshold: number
  clusters: Cluster[]
}

interface Cluster {
  id: number
  members: ClusterMember[]       // { slug, title, artist? }
  character: string              // e.g. "bass-forward, flat mids, tamed top"
  nearestClusterId: number | null
  nearestDistanceDb: number | null
}
```

`character` is produced by `describeCurve(centroid, freqs)`: averages the cluster's centroid curve over three bands (low: 20–250 Hz, mid: 250–4000 Hz, high: 4000–20 kHz) and maps each to a label:

| Average dB | Low | Mid | High |
|---|---|---|---|
| > +0.5 | bass-forward | forward mids | bright top |
| < −0.5 | lean bass | scooped mids | tamed top |
| otherwise | neutral bass | flat mids | neutral top |

`nearestClusterId` and `nearestDistanceDb` indicate how far apart two adjacent clusters are — the gap that separates them.

## HTTP Route

`GET /api/clusters?threshold=<db>` — registered by `packages/daemon/src/routes/clusters.ts`. Calls `store.allPresets()` (added to [[preset-store]] alongside this feature), then `clusterPresets(presets, { threshold })`. Returns a `ClusterResult` JSON object.

Omitting `threshold` uses the default (1.5 dB RMS).

## CLI

```
tonedeck clusters [--threshold <db>] [--json]
```

Hits `/api/clusters`, formats output with `fmtClusters` (human) or raw JSON.

## Relationship to Corpus

Clustering is the analysis layer after [[corpus]] build. Once the corpus generates hundreds of per-track presets, `tonedeck clusters` reveals which recording profiles share tonal requirements — useful for understanding the tuning space and for recommending presets to users.

## Related Pages

- [[corpus]] — generates the presets that this engine groups
- [[eqgen]] — produces each preset's curve via the Claude-authored bands
- [[preset]] — the input to clustering; `bands` drive `presetCurve`
- [[biquad]] (if exists) — `responseDb` called by `presetCurve` to compute the frequency response

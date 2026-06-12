# Worked examples

Three complete transcripts that model the workflow contract end to end. Outputs
are representative of the real CLI (`! ...` lines are warnings on stderr; `--json`
blocks show the machine shape). Every example ends the same way: **verify, then
ask.**

---

## (a) "tune for Madvillainy" — a new preset from album knowledge

**User:** tune for Madvillainy

**Claude** — first, know the state:

```bash
$ tonedeck status --json
{"engaged":true,"bypass":false,"activePreset":"mbdtf","dspState":"Running","clippedSamples":0,"devices":{"current":"BlackHole 2ch","saved":"External Headphones","outputs":["BlackHole 2ch","External Headphones","MacBook Air Speakers"]},"dspVersion":"4.1.3","lastEvent":"applied mbdtf"}

$ tonedeck list --json | grep -i madvillain   # no existing preset → safe to create
```

DSP is engaged, no Madvillainy preset exists. Design reasoning:

- *Madvillainy* (Madvillain, 2004) is lo-fi boom-bap built on Madlib's dusty,
  vinyl-sampled loops. The masters are warm, mid-forward, and nearly mono.
- **Bass `+1.5`** — modest weight; the loops want body, not a club shelf. The
  planar driver takes 60 Hz cleanly.
- **KickBody `+0.8`** — a little thump so the boom-bap drums drive.
- **LowMidClean `−0.5`** — a slight 250 Hz cut to clear sample mud without
  thinning the warmth that defines the record.
- **UpperMidTame `−1.0`** — tame the lo-fi edge in the 3.2 kHz region.
- **PresenceTame `−1.2`** — pull 5 kHz down; dusty samples get spitty up here.
- **Air `+0.8`** — a touch of 10 kHz air to lift the haze without making it bright.
- **preamp `2`** — house default; the engine will trim if it must.

```bash
$ tonedeck create --from-json - --apply <<'JSON'
{
  "schemaVersion": 1,
  "slug": "madvillainy",
  "kind": "album",
  "title": "Madvillainy",
  "artist": "Madvillain",
  "profile": "ft1pro",
  "preamp": 2,
  "bands": [
    { "id": "Bass",         "type": "lowshelf", "freq": 60,    "q": 0.7, "gain": 1.5 },
    { "id": "KickBody",     "type": "peaking",  "freq": 120,   "q": 0.9, "gain": 0.8 },
    { "id": "LowMidClean",  "type": "peaking",  "freq": 250,   "q": 1.0, "gain": -0.5 },
    { "id": "UpperMidTame", "type": "peaking",  "freq": 3200,  "q": 1.2, "gain": -1.0 },
    { "id": "PresenceTame", "type": "peaking",  "freq": 5000,  "q": 2.0, "gain": -1.2 },
    { "id": "Air",          "type": "highshelf","freq": 10000, "q": 0.7, "gain": 0.8 }
  ],
  "intent": "lo-fi boom-bap warmth; dusty samples, mid-forward, controlled edge",
  "provenance": { "createdBy": "claude", "history": [] },
  "version": 1,
  "createdAt": "2026-06-12T00:00:00.000Z",
  "updatedAt": "2026-06-12T00:00:00.000Z"
}
JSON
created: madvillainy
! Preamp auto-trimmed by 0.5 dB to reduce clipping risk
verdict: ok
```

Verify it actually went live:

```bash
$ tonedeck status --json
{"engaged":true,"bypass":false,"activePreset":"madvillainy","dspState":"Running","clippedSamples":0, ... }
```

**Claude → User:** Built a Madvillainy tuning — gentle bass for the dusty loops,
a small 250 Hz mud cut, and the 3–5 kHz edge pulled down so the samples don't
spit, with a touch of air on top. One note: the engine auto-trimmed the volume by
0.5 dB to stay clip-safe, so it's a hair quieter — nudge your system volume up if
you want. **It's live now — how does it sound? Too dark, or about right?**

---

## (b) "Donda sounds harsh tonight" — fix an existing preset

**User:** Donda sounds harsh tonight

**Claude** — state, then look up what's currently set:

```bash
$ tonedeck status --json
{"engaged":true,"bypass":false,"activePreset":"donda", ... }

$ tonedeck show donda --json
{ ... "bands":[ ... {"id":"UpperMidTame","type":"peaking","freq":3200,"q":1.2,"gain":-2}, {"id":"PresenceTame","type":"peaking","freq":5000,"q":2,"gain":-1.8}, ... ], "preamp":2 ... }
```

Symptom map: *harsh* → the 3.2 kHz lever (`UpperMidTame`) first. It's at `−2`; one
small step down to `−3.2` (a 1.2 dB move — `--gain` is absolute, so current −1.2):

```bash
$ tonedeck tweak donda --band UpperMidTame --gain -3.2 --reason "donda sounds harsh tonight" --apply
change: band UpperMidTame gain -2→-3.2
! Preamp auto-trimmed by 2.0 dB to reduce clipping risk
verdict: ok
```

**Claude → User:** Pulled the 3 kHz bite down a step. Heads up: this was the first
edit to Donda, so the engine re-checked headroom and auto-trimmed the preamp 2 dB
— it'll sound a touch quieter; that's the clip-safety net, not a mistake.
**Is the harshness gone, or is it still a bit sharp?**

**User:** better but still a little sharp on the cymbals

That's sibilance/spit territory — the 5 kHz lever (`PresenceTame`, currently `−1.8`).
A smaller second step to `−2.6`:

```bash
$ tonedeck tweak donda --band PresenceTame --gain -2.6 --reason "still a little sharp on the cymbals" --apply
change: band PresenceTame gain -1.8→-2.6
verdict: ok

$ tonedeck status --json
{"engaged":true,"activePreset":"donda","clippedSamples":0, ... }
```

**Claude → User:** Softened 5 kHz where the cymbal spit lives — no further trim
needed this time. **How are the cymbals now — smooth, or did I take too much off?**

---

## (c) "make it warmer" — a one-step vibe while listening

**User:** make it warmer

**Claude** — vague feeling → a vibe, not a frequency. Confirm what's active, then
one `warmth` step:

```bash
$ tonedeck status --json
{"engaged":true,"activePreset":"madvillainy", ... }

$ tonedeck tweak madvillainy --vibe warmth=1 --reason "make it warmer" --apply --json
{"preset":{ ... "bands":[{"id":"Bass", ... "gain":2.1}, {"id":"KickBody", ... "gain":1.2}, {"id":"LowMidClean", ... "gain":-0.2}, ... {"id":"Air", ... "gain":0.5}], "preamp":0.9 ... }, "warnings":["Preamp auto-trimmed by 0.6 dB to reduce clipping risk"], "verdict":"ok"}
```

The `warmth` vibe lifted the lows (Bass → 2.1, KickBody → 1.2), eased the low-mid
cut, and pulled a hair of air off — and the engine auto-trimmed 0.6 dB to stay
clip-safe.

**Claude → User:** Warmed it up — more weight down low and a softer top. The engine
trimmed 0.6 dB for headroom, so bump your volume if it dropped. **Warm enough, or
do you want another step?**

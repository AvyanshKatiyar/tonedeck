# Symptom map — their words → the move

Read this the moment the user describes a sound problem or asks for an
adjustment. Find the row, make ONE small move, then **ask how it sounds.**

**Three things to get right every time:**

1. **`--gain` sets the ABSOLUTE value, not a delta.** `tonedeck show <slug> --json`
   the band first, read its current gain, then set `current ± step`. (Vibes, by
   contrast, are relative steps — `--vibe warmth=1` nudges; it doesn't set.)
2. **Small steps:** ≤1.5 dB per band per step. One move, then re-ask. Two small
   moves beat one big guess.
3. **Always `--reason "<their actual words>"`** so the history reads like a diary.

Command sketches below assume the DSP is engaged (check `tonedeck status --json`);
`--apply` makes the change audible immediately. If `engaged:false`, drop
`--apply`, then `tonedeck on <slug>`.

---

## Vague adjustment words → a vibe (one step)

Use `--vibe` when the ask is a *feeling*, not a frequency. Steps are ±3 (daemon
clamps beyond that); start at 1.

| They say | Vibe | Command sketch |
|---|---|---|
| "warmer", "cozier", "less clinical" | `warmth` | `tonedeck tweak <slug> --vibe warmth=1 --reason "warmer" --apply` |
| "punchier", "more slam", "more groove" | `punch` | `tonedeck tweak <slug> --vibe punch=1 --reason "punchier" --apply` |
| "clearer", "brighter", "more detail", "vocals forward" | `clarity` | `tonedeck tweak <slug> --vibe clarity=1 --reason "clearer" --apply` |
| "smoother", "less fatiguing", "easier on the ears" | `smoothness` | `tonedeck tweak <slug> --vibe smoothness=1 --reason "smoother" --apply` |
| "more sparkle", "more air", "more open up top" | `sparkle` | `tonedeck tweak <slug> --vibe sparkle=1 --reason "more sparkle" --apply` |

## Specific symptoms → a band move (read current gain first)

| They say | Band → direction (first step) | Command sketch (set absolute) | Say back |
|---|---|---|---|
| "harsh", "shrill", "it hurts", "aggressive" | `UpperMidTame` 3.2k **down** ~1.2 | `tonedeck tweak <slug> --band UpperMidTame --gain <cur−1.2> --reason "sounds harsh" --apply` | "Pulled the 3 kHz bite down 1.2 dB — better, or still sharp?" |
| "sibilant", "essy", "the sss hurts", "spitty cymbals" | `PresenceTame` 5k **down** ~1.2 | `tonedeck tweak <slug> --band PresenceTame --gain <cur−1.2> --reason "too sibilant" --apply` | "Softened 5 kHz where the 'sss' lives. If it's still spitting, I can add a narrow de-esser." |
| "muddy", "congested", "thick", "blanket over it" | `LowMidClean` 250 **down** ~1.2 | `tonedeck tweak <slug> --band LowMidClean --gain <cur−1.2> --reason "muddy" --apply` | "Cleared 1.2 dB of mud at 250 Hz — clearer now?" |
| "boomy", "bloated", "one-note bass" | `Bass` 60 **down** ~1.2 | `tonedeck tweak <slug> --band Bass --gain <cur−1.2> --reason "too boomy" --apply` | "Tightened the low-end shelf. Still booming, or controlled?" |
| "thin", "no body", "weightless", "small" | `Bass` 60 **up** ~1.2 | `tonedeck tweak <slug> --band Bass --gain <cur+1.2> --reason "too thin" --apply` | "Added weight at the bottom. More foundation now?" |
| "dull", "veiled", "no air", "closed-in", "dark" | `Air` 10k **up** ~1.2 | `tonedeck tweak <slug> --band Air --gain <cur+1.2> --reason "too dull" --apply` | "Opened up the top with a touch of air. Brighter?" |
| "honky", "boxy", "nasal" | `UpperMidTame` 3.2k **down** ~0.8 + `LowMidClean` 250 **down** ~0.8 | `tonedeck tweak <slug> --band UpperMidTame --gain <cur−0.8> --band LowMidClean --gain <cur−0.8> --reason "honky" --apply` | "Took the honk out of the mids. Natural now?" |
| "fatiguing over time", "tiring", "can't listen long" | `smoothness` vibe (3.2k + 5k + air down together) | `tonedeck tweak <slug> --vibe smoothness=1 --reason "fatiguing" --apply` | "Smoothed the upper mids and presence — give it a long listen and tell me if your ears relax." |
| "vocals buried", "can't hear the singer" | `UpperMidTame` 3.2k **up** ~1.0 (optionally `LowMidClean` down to unmask) | `tonedeck tweak <slug> --band UpperMidTame --gain <cur+1.0> --reason "vocals buried" --apply` | "Brought the vocal presence forward. Sitting on top now?" |
| "bass is flabby", "loose", "wooly" | `KickBody` 120 **down** ~1.2 (tightens punch zone) | `tonedeck tweak <slug> --band KickBody --gain <cur−1.2> --reason "flabby bass" --apply` | "Firmed up the kick zone at 120 Hz. Tighter?" |
| "bass is missing", "where's the low end" | `Bass` 60 **up** ~1.5 | `tonedeck tweak <slug> --band Bass --gain <cur+1.5> --reason "bass missing" --apply` | "Brought the sub-bass shelf up. Enough weight now?" |

---

## Special cases — be honest, not magical

### "Too loud even at low volume" (the preamp)
There is **no direct preamp knob via `tweak`** — `tweak` only moves bands and
vibes. The daemon already auto-trims the preamp for clip safety, so persistent
over-loudness means the **band boosts themselves are large**. Two honest options:

- **Pull the biggest boosts down** (usually `Bass`) a step — this lowers the
  overall level: `tonedeck tweak <slug> --band Bass --gain <cur−1.5> --reason "too loud at low volume" --apply`.
- **If they want the whole preset quieter without changing its shape,** recreate
  it with a lower `preamp` (`tonedeck show <slug> --json` → edit `preamp` down →
  `delete <slug> --yes` → `create --from-json -`). Tell them this resets history;
  only do it if pulling bands down isn't enough.

### "Sounds compressed / no dynamics / flat / lifeless"
Say it plainly: **EQ cannot restore dynamics that were squashed in mastering.**
This is not changing on its own and there is no band that adds dynamic range —
the variable is the master, not the tuning. What EQ *can* do is add perceived
openness with a **gentle smile**: a slight 250 Hz cut plus a little air.

```bash
tonedeck tweak <slug> --band LowMidClean --gain <cur−1.0> --band Air --gain <cur+1.0> --reason "wants more life — gentle smile (mastering is the real limit)" --apply
```

Then set the expectation: "That opens it up a bit, but the flatness is baked into
the master — EQ can't put dynamics back that the mastering took out."

### Sibilance or mud that a template cut won't fix
If `PresenceTame` (sibilance) or `LowMidClean` (mud) cuts aren't surgical enough,
the fix is a **narrow dedicated band** — `DeEss` (6.5 kHz, Q 3) or `MudCut`
(700 Hz, Q 1.4). These **cannot be added with `tweak`**; bake them into the
preset JSON and recreate it. See `band-guide.md` → "Adding a band beyond the template."

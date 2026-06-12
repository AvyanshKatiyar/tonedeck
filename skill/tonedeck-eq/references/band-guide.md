# Band guide — what each knob does on the FT1 Pro

The `ft1pro` profile gives every preset the same 6-band skeleton plus one preamp.
You change an album's character by nudging these. Read this when you are
designing a new preset from scratch or deciding which band a complaint maps to.

**Two kinds of limits:**
- **Safe everyday range** — where good-sounding music tuning lives. Stay here.
- **Hard limit** — the profile's clamp. Go past it and the daemon silently pulls
  you back and tells you (a warning you must relay). Hitting the clamp almost
  always means you reached for the wrong band.

Hard limits for every band: **gain −8..+6 dB**, **Q 0.3..5**. Preamp **−6..+4 dB**.

---

## Bass — `lowshelf` 60 Hz, Q 0.7

- **Layman:** the weight and rumble under everything — the part you feel in your chest.
- **Engineer:** low shelf hinged at 60 Hz; lifts/drops the whole sub-and-low region together.
- **Safe everyday range:** −3 .. +4 dB. The FT1 Pro planar driver takes this shelf cleanly without going flabby, so it is your main "more body" lever.
- **Too much (+):** boomy, one-note, muddies vocals, tiring on long listens.
- **Too little (−):** thin, weightless, "small," no foundation.

## KickBody — `peaking` 120 Hz, Q 0.9

- **Layman:** the punch and thump of the kick drum and bass guitar's knuckle.
- **Engineer:** medium-wide peak at 120 Hz — the "slam" zone just above the sub.
- **Safe everyday range:** −2 .. +2.5 dB.
- **Too much (+):** chesty, thumpy, the kick starts to bloat into the bass.
- **Too little (−):** soft, gutless drums; the beat stops driving.

## LowMidClean — `peaking` 250 Hz, Q 1.0

- **Layman:** warmth vs mud — the "blanket over the speaker" frequency.
- **Engineer:** moderate peak at 250 Hz; the classic mud/congestion band.
- **Safe everyday range:** −3 .. +1.5 dB. This is usually a **cut**, especially on dense or sample-based mixes.
- **Too much (+):** boxy, congested, thick, muddy.
- **Too little (−):** hollow, thin, scooped-out, "phone-y."

## UpperMidTame — `peaking` 3200 Hz, Q 1.2

- **Layman:** bite, edge, and "shout" — where vocals and guitars get aggressive.
- **Engineer:** peak at 3.2 kHz; **the first harshness lever** on this headphone.
- **Safe everyday range:** −3 .. +1.5 dB. Reach here before anything else when something sounds harsh or fatiguing.
- **Too much (+):** shouty, honky, in-your-face, listening fatigue.
- **Too little (−):** dull, recessed, vocals lose intelligibility and forwardness.

## PresenceTame — `peaking` 5000 Hz, Q 2.0

- **Layman:** sharpness, "sss" sibilance, cymbal spit — the part that makes ears wince.
- **Engineer:** tighter peak at 5 kHz; **the second harshness/sibilance lever.**
- **Safe everyday range:** −3 .. +1 dB. Cut for sibilant vocals and splashy, glassy highs.
- **Too much (+):** piercing, sibilant, sharp on consonants, harsh cymbals.
- **Too little (−):** lispy/soft consonants, slightly veiled presence.

## Air — `highshelf` 10000 Hz, Q 0.7

- **Layman:** sparkle, openness, "expensive" top-end shimmer.
- **Engineer:** high shelf hinged at 10 kHz; lifts/drops everything above it together.
- **Safe everyday range:** −2 .. +2.5 dB.
- **Too much (+):** brittle, hissy, etched, tiring.
- **Too little (−):** dull, closed-in, dark, "blanket on the treble."

## Preamp — overall headroom

- **Layman:** the master volume *inside* the EQ. Boosting bands makes peaks louder; the preamp pulls the whole thing back down so it never clips.
- **Engineer:** a single dB offset applied to the full curve. Hard limit −6 .. +4 dB.
- **House default is +2 dB** and the tuning leans loud.
- **The headroom rule (accept it):** when the predicted peak boost exceeds **+3 dB** over unity, the daemon **auto-trims the preamp** to claw it back and returns a warning. Do not fight this — relay it. If the user wants it louder afterward, raise the *system* volume, not `--no-auto-trim`.
- **Combined boosts of ~+5 dB** are tolerated with a warning rather than rejected (the shipped builtins run this hot by design). A preset is only hard-rejected when the band boosts alone are absurd — i.e. even trimming the preamp to its minimum still leaves >+9 dB.

---

## FT1 Pro house philosophy

- **Planar driver:** fast, clean, low distortion. It takes the **60 Hz bass shelf**
  exceptionally well — you can add real weight without the flab a dynamic driver
  would give you. Bass is a safe, satisfying lever here.
- **Harshness lives at 3.2 kHz and 5 kHz.** Those two peaking cuts
  (`UpperMidTame`, `PresenceTame`) are your primary harshness levers. Reach for
  them *before* touching the bass or air when something sounds aggressive,
  shouty, or sibilant.
- **The house leans loud** (preamp +2). That is why the headroom auto-trim exists
  and fires often. It is a feature, not an error — every trim is the engine
  keeping you clip-safe.
- **Builtins ship "hot."** The 16 shipped presets sit at combined ~+5 dB as files.
  The very first time you `tweak` one, the daemon re-runs safety and may
  auto-trim the preamp ~2 dB. Expect the loudness to drop a touch on that first
  edit and tell the user why.

---

## Adding a band beyond the template

Sometimes 6 bands are not enough — a vocal is sibilant in one narrow spot, a
sample drones with low-mid mud, or a track has subsonic rumble. You can add a
**surgical** band. Two firm rules:

1. **New band ids must be PascalCase and descriptive:** `DeEss`, `MudCut`, `SubTame`.
2. **You can only add a non-template band at `create` time** — bake it into the
   `bands` array of the JSON you create. `tweak --band DeEss ...` **fails** on a
   preset that lacks `DeEss`, because `tweak` can only seed bands that exist in
   the preset or the 6-band template. To give an *existing* preset a new band,
   you must recreate it (`delete <slug> --yes` then `create` with the augmented
   JSON) — which resets its history, so only do it when genuinely needed.

| Add this band | Type / freq / Q | Use it for | Sensible gain |
|---|---|---|---|
| `DeEss` | `peaking` 6500 Hz, Q 3 | killing "sss" sibilance and cymbal spit without dulling the whole top | −5 .. −2 dB (always a cut) |
| `MudCut` | `peaking` 700 Hz, Q 1.4 | clearing boxy/honky low-mid congestion a 250 Hz cut can't reach | −4 .. −1.5 dB (always a cut) |
| `SubTame` | `lowshelf` 35 Hz, Q 0.7 | taming subsonic rumble/room boom, or (rarely) adding deep sub | −4 .. +2 dB |

When in doubt, prefer the template bands — most problems are solved with the six
you already have. Add a band only when a problem is narrow and a wide template
band would damage the rest of the sound.

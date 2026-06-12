---
topics: [stack, flows, concepts]
files: [skill/tonedeck-eq/SKILL.md, skill/tonedeck-eq/references/]
---

# Claude Skill

The ToneDeck Claude Code skill at `skill/tonedeck-eq/SKILL.md` teaches Claude how to tune a [[preset]] using plain-language descriptions of what the listener wants. It is registered as a Claude Code tool during installation by [[install]] and is the intended interface for natural-language EQ requests.

## Contract

The skill defines an 8-step workflow:

1. Read the request (what the listener wants to change sonically).
2. Run `tonedeck get <slug>` to see the current preset state.
3. Identify which [[band]]s are relevant to the request using the band guide and symptom map.
4. Compute proposed gain changes: ≤1.5 dB per step per band.
5. Apply via `tonedeck tweak <slug> --band <id>=<gain> [...]` (CLI only — never direct file edits).
6. Read back the saved preset to confirm the change landed.
7. Relay any warnings returned by the server (from [[safety]]).
8. Report what was changed and why.

## Hard rules

- **CLI only.** The skill must never read or write preset JSON files directly. All edits go through `tonedeck tweak` or other CLI commands.
- **≤1.5 dB per step.** Each workflow execution changes any given band by at most 1.5 dB. Multiple steps are required for larger adjustments. This prevents overcorrection.
- **Relay warnings.** If the daemon returns a headroom warning after a save, the skill must surface it to the user verbatim.
- **Revert for undo.** The correct undo command is `tonedeck revert <slug>`, not a manual gain reversal. The skill should suggest this rather than computing the inverse delta.

## Band guide

The skill's band guide maps frequency regions to sonic character for the FiiO FT1 Pro's template bands:
- Bass (60 Hz): body, warmth, sub energy
- KickBody (120 Hz): punch, fullness, upper bass
- LowMidClean (250 Hz): muddiness zone — cutting here often clears mix congestion
- UpperMidTame (3200 Hz): harshness, attack edge, the FT1 Pro's known brightness peak
- PresenceTame (5000 Hz): sibilance, edge, forward vocal presence
- Air (10 kHz): openness, sparkle, cymbal detail

## Symptom map

The skill provides a direct mapping from listener complaints to band targets:
- "too harsh / too bright" → cut UpperMidTame and/or PresenceTame
- "lacking body / too thin" → boost Bass and/or KickBody
- "muddy / congested" → cut LowMidClean
- "too polite / missing air" → boost Air
- "too sibilant" → cut PresenceTame

## Vibes vs. direct band edits

The skill can use either `--vibe <name>=<step>` flags or direct `--band <id>=<gain>` flags on `tonedeck tweak`. Vibes are appropriate for general taste adjustments; direct band edits are appropriate for specific frequency corrections. When using [[vibes]], the 1.5 dB-per-step rule applies to the net change in any band's gain.

## Worked examples

The `skill/tonedeck-eq/references/` directory contains worked examples showing how to handle common requests — from a simple "make it warmer" to multi-band corrections for complex sonic problems.

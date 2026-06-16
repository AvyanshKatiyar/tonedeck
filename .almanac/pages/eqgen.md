---
title: EqGen — Automated EQ Generation via Claude CLI
summary: How eqgen.ts builds prompts and spawns the Claude CLI to generate or re-balance per-track presets for the corpus build pipeline.
topics: [corpus, systems, daemon]
sources:
  - id: eqgen-ts
    type: file
    path: packages/daemon/src/eqgen.ts
    note: All code claims in this page.
  - id: eqgen-dist
    type: file
    path: packages/daemon/dist/eqgen.js
    note: Compiled output the running daemon actually executes; may lag src after prompt edits.
  - id: eqgen-test
    type: file
    path: packages/daemon/test/eqgen.test.ts
    note: Confirms behavior: JSON extraction, code fence tolerance, band ID reassignment, error wrapping.
  - id: ft1pro-profile
    type: file
    path: profiles/ft1pro.json
    note: Source of houseNotes injected into the generation prompt.
  - id: stdin-fix-commit
    type: commit
    id: 40bb28f
    note: "fix(daemon): eqgen spawns claude with stdin ignored — explains why stdin must be 'ignore' in batch use."
  - id: session-build-drift
    type: session
    session_id: 4c9fa884-2cf0-4e63-a174-2de2bcf966d5
    note: Session on 2026-06-17 that received the conservative prompt from dist/eqgen.js 20 minutes after src/eqgen.ts was updated to decisive — confirms the build drift risk.
  - id: session-skill-activation
    type: session
    session_id: 54e64805-6896-4d25-8cb5-b23a81ce4ef8
    note: Session on 2026-06-16 (branch feat/eq-clustering-corpus) where the tonedeck-eq skill activated during a batch eqgen call and Claude read band-guide.md before returning JSON — confirms skill activation in automated mode.
  - id: session-sdk-eqgen-prompt
    type: session
    session_id: 62fb0069-fa8d-45a0-8cdb-d8b4846d8161
    note: Session on 2026-06-16 (branch feat/eq-clustering-corpus) where the eqgen-style prompt was delivered via SDK (sdk-cli entrypoint) instead of claude -p. The agent ran the full 8-step skill workflow — tonedeck status, tonedeck list, tonedeck show — confirming that the JSON-only instruction does NOT reliably suppress CLI tool use when Bash is available via SDK.
  - id: session-sdk-direct-json
    type: session
    session_id: 7424d6cc-d23d-424f-8f84-a9fc55e6ff2f
    note: Session on 2026-06-16 (branch feat/eq-clustering-corpus, sdk-cli entrypoint) for "Devil In a New Dress" on the FT1 Pro chain using the conservative prompt. Agent returned JSON directly in ~5.5 s with no tool calls, despite the tonedeck-eq skill being listed in the session context. Counterexample to the claim that SDK sessions always run the full skill workflow.
  - id: session-sdk-conservative-full-workflow
    type: session
    session_id: 8bbf99d5-de7a-423a-9802-743d2bd8bea3
    note: Session on 2026-06-16 (branch feat/eq-clustering-corpus, sdk-cli entrypoint) for "Jesus Is Lord" (JESUS IS KING) using the same conservative prompt as 7424d6cc. Agent ran the full 8-step tonedeck-eq skill workflow — loaded skill, ran tonedeck status, tonedeck list, read band-guide.md, then created track-jesus-is-lord via tonedeck create --from-json --apply. Counter-example to the hypothesis that the conservative prompt reliably suppresses tool use in SDK mode; the same prompt can produce either direct-JSON or full-workflow behavior across runs.
  - id: session-sdk-direct-json-interlude
    type: session
    session_id: 9a1b3308-6eac-4623-9499-633b86d5017e
    note: Session on 2026-06-16T17:10Z (branch feat/eq-clustering-corpus, sdk-cli entrypoint) for "All of the Lights (Interlude)" by Kanye West using the conservative prompt. Agent returned JSON directly in ~7 s with no tool calls; response was code-fenced (```json...```) but handled by extractJson. Second direct-JSON counterexample alongside 7424d6cc; confirms the same prompt on the same branch can produce direct-JSON behavior non-deterministically regardless of song.
  - id: session-sdk-decisive-bash-failure
    type: session
    session_id: a5ccf506-51ba-4198-aa22-5f23939d042b
    note: Session on 2026-06-16T17:27Z (branch feat/eq-clustering-corpus, sdk-cli entrypoint) for "Lost In the World" (Kanye West, MBDTF) using the decisive prompt. Agent invoked tonedeck-eq skill and attempted tonedeck status --json via Bash — but Bash was blocked with "claude-sonnet-4-6 is temporarily unavailable, so auto mode cannot determine the safety of Bash right now." Read tool continued to work (band-guide.md was read). Session ended with a 500 Internal Server Error; no JSON was produced. Confirms: decisive prompt in SDK mode triggers the full skill workflow (consistent with 62fb0069); Bash auto-mode safety classification can fail independently of the agent model, leaving Read available; 500 Internal Server Error is a terminal failure mode for SDK sessions.
  - id: session-sdk-decisive-retry-succeed
    type: session
    session_id: e4087132-d3e8-4b9e-b643-e09c02e53059
    note: Session on 2026-06-16T17:27Z (branch feat/eq-clustering-corpus, sdk-cli entrypoint) for "We Don't Care" (Kanye West, The College Dropout) using the decisive prompt. Concurrent with the same classifier outage window as a5ccf506 and df17aabe. Agent invoked tonedeck-eq skill; first two Bash calls (tonedeck status --json) were blocked by the classifier error; the third attempt (~1 minute after the first) succeeded and returned the live status JSON (engaged:true, activePreset:track-monster-kanye, dspState:Running, dspVersion:4.1.3, clippedSamples:0). Session transcript captured only through the successful status call — outcome unknown. Adds a third recovery pattern to the classifier-outage taxonomy: retry-then-succeed within the same session when the outage clears.
  - id: session-sdk-decisive-hell-of-a-life
    type: session
    session_id: a91bfb61-ea84-4e01-b88f-6d46644f21ed
    note: Session on 2026-06-16T17:25Z (branch feat/eq-clustering-corpus, sdk-cli entrypoint) for "Hell of a Life" (Kanye West, MBDTF) using the decisive prompt. Agent loaded tonedeck-eq skill, ran tonedeck status --json (active preset was track-monster-kanye), read band-guide.md in parallel, then ran tonedeck list --json. The list output was 35.4KB and exceeded the SDK's inline tool-result limit; the SDK persisted the full output to disk and provided a 2KB preview + file path. The agent issued a second Bash call grepping the persisted file for existing "hell" presets, found none, and was about to create the preset when the transcript was captured. Fourth confirmatory example of decisive-prompt + SDK → full-skill-workflow. Also reveals: when the preset corpus grows large enough that tonedeck list --json exceeds ~35KB, the SDK persists the output and the agent must grep the file rather than reading it inline.
  - id: session-sdk-decisive-intro-college-dropout
    type: session
    session_id: aa1d31ba-a5de-4b71-bcd1-d73729f9c19c
    note: Session on 2026-06-16T17:27Z (branch feat/eq-clustering-corpus, sdk-cli entrypoint) for "Intro" by Kanye West (The College Dropout) using the decisive prompt. Fifth confirmatory example of decisive-prompt + SDK → full-skill-workflow. The SDK injected a command_permissions attachment with allowedTools=[] — but Bash still ran, confirming the field means "no explicit tool additions" not "all tools blocked." The agent's first Bash call piped tonedeck list --json to grep; because tonedeck list outputs a single giant JSON line, the matching grep returned the entire 35.4KB line — defeating the intent of the pipe. The SDK persisted the 35.4KB output. The agent then issued a second Bash call using Python json.load to parse the persisted file and filter for slug matches — first documented use of Python-based JSON filter as a workaround for single-line JSON grep limitation. Session was captured mid-execution before the preset was created.
  - id: session-sdk-conservative-skill-no-cli
    type: session
    session_id: b53964a7-282a-493d-934c-d3218adde78f
    note: Session on 2026-06-16T17:05Z (branch feat/eq-clustering-corpus, sdk-cli entrypoint) for "Hands On (feat. Fred Hammond)" by Kanye West (JESUS IS KING) using the conservative prompt. Agent loaded the tonedeck-eq skill and read band-guide.md (two Read tool calls), then returned a 5-band JSON directly without executing any tonedeck CLI commands — despite Bash being available in SDK mode. Middle-ground behavioral pattern in SDK mode: skill activates and reads domain knowledge, but the CLI workflow is not triggered. Confirms the same band-guide-then-direct-JSON pattern previously observed in claude -p sessions also occurs non-deterministically in SDK sessions with the conservative prompt.
  - id: session-sdk-conservative-use-this-gospel
    type: session
    session_id: d9986553-3d05-433c-8d24-30d7e3bbbc45
    note: Session on 2026-06-16T17:05Z (branch feat/eq-clustering-corpus, sdk-cli entrypoint) for "Use This Gospel (feat. Clipse & Kenny G)" by Kanye West (JESUS IS KING) using the conservative prompt. Agent ran the full 8-step tonedeck-eq skill workflow — tonedeck status, tonedeck list --json | grep, tonedeck show track-all-of-the-lights --json — then created track-use-this-gospel via tonedeck create --from-json in three attempts (schema gotcha: missing band ids on attempt 1, missing provenance/version/timestamps on attempt 2). Another data point confirming the conservative prompt does not suppress tool use in SDK mode; same session confirmed the band-id + provenance two-step failure pattern.
  - id: session-sdk-decisive-blame-game
    type: session
    session_id: df17aabe-d74f-4c01-bbfe-6eb52600c62d
    note: Session on 2026-06-16T17:25Z (branch feat/eq-clustering-corpus, sdk-cli entrypoint) for "Blame Game (feat. John Legend)" by Kanye West (MBDTF) using the decisive prompt. Agent invoked tonedeck-eq skill, then attempted tonedeck status --json via Bash three times (~30 s apart, at 17:26:04, 17:26:23, and 17:26:53) — all three blocked by "claude-sonnet-4-6 is temporarily unavailable, so auto mode cannot determine the safety of Bash right now." Unlike session a5ccf506 (which read band-guide.md after Bash was blocked), this agent made NO Read tool calls after the failures — it only retried Bash and then the session terminated without producing any JSON. Concurrent with a5ccf506 during the same classifier outage window (~17:25–17:27Z on 2026-06-16). Confirms: (a) the retry-then-terminate pattern is distinct from the read-fallback pattern in a5ccf506; (b) agents do not reliably fall back to Read tools when Bash is blocked — the wiki claim that "read-only tools continue to work" is true at the infrastructure level but does not mean the agent will use them.
  - id: session-sdk-decisive-jil-mid-flow
    type: session
    session_id: dfa337bc-7f25-438b-b2c4-bf4b9ec7a0a8
    note: Session on 2026-06-16T17:24Z (branch feat/eq-clustering-corpus, sdk-cli entrypoint) for "Jesus Is Lord" by Kanye West (JESUS IS KING) using the decisive prompt. Agent invoked tonedeck-eq skill, ran tonedeck status --json (active preset was track-monster-kanye), read band-guide.md in parallel, then attempted Python stdin filtering — tonedeck list --json 2>&1 | python3 -c "import json,sys; presets=json.load(sys.stdin); [print(p['slug']) for p in presets]" — which failed with TypeError: string indices must be integers, not 'str' because tonedeck list --json wraps the array in {"presets": [...]} rather than returning a bare array. The agent fell back to tonedeck list --json directly (35.4KB persisted), then ran grep on the persisted file for existing "jesus/lord" slugs, finding track-god-is-jik, jesus-is-king, and track-water-jesus-is-king but no kanye-west-jesus-is-lord. Session was captured mid-flow before preset creation.
status: active
verified: 2026-06-17
---

# EqGen

`packages/daemon/src/eqgen.ts` generates per-track parametric EQ presets by building a structured prompt and calling the local Claude CLI (`claude -p`). It is the generation engine behind the [[corpus]] build pipeline and also supports the `optimizeForPreamp` path used when the user changes loudness on an existing preset.

This is distinct from the interactive [[claude-skill]], which guides Claude Code through `tonedeck` CLI commands step-by-step. EqGen talks directly to the Claude CLI and expects a raw JSON response — no commands, no UI, no iterative workflow.

## Two Entry Points

### `generateTrackEq(track, profile, opts)`

Produces a new [[preset]] of `kind: 'track'` from scratch. Builds a prompt describing the headphone chain context, the song's identity, and detailed instructions to author a curve fit for that specific recording. On success, validates the raw JSON through `parsePreset`; the house-limit clamp happens later in [[preset-store]].

### `optimizeForPreamp(preset, targetPreamp, profile, opts)`

Re-balances an existing preset to a new preamp level. Uses a different prompt that supplies the current band configuration, the target preamp, and requests gentle Fletcher-Munson compensation: lift lows and highs when moving quieter; restrain boosts when moving louder. Preserves the original `intent` and `slug`.

## How Claude Is Called

```
spawn('claude', ['-p', '--model', 'sonnet', prompt], {
  env: { ...process.env, MAX_THINKING_TOKENS: '0', PATH },
  stdio: ['ignore', 'pipe', 'pipe'],
})
```

**`stdin: 'ignore'` is mandatory.** Without it, `claude -p` blocks for up to 3 seconds waiting for stdin input and may emit prose warnings instead of JSON. Under concurrent batch use (corpus build with concurrency 3+), this contention reliably produced empty or prose output → `EqGenError('no JSON object')`. The fix was committed in `40bb28f`.

**PATH resolution**: The daemon runs under launchd with a minimal PATH that typically excludes user-installed binaries. `eqgen.ts` prepends `~/.local/bin`, `/opt/homebrew/bin`, and `/usr/local/bin` so `claude` resolves regardless of launch context. Override the binary with `TONEDECK_CLAUDE_BIN`.

**Timeout**: 90 s default; SIGKILL on expiry. Configure via `opts.timeoutMs`.

**`MAX_THINKING_TOKENS=0`**: disables extended thinking, which would bloat the response and slow batch runs.

## Skill Activation in Batch Mode

The `tonedeck-eq` Claude Code skill fires even in automated `claude -p` calls. The SessionStart hook that loads the skill listing runs unconditionally, regardless of whether the session is interactive or batch. When the model sees the EQ-tuning prompt it matches the `tonedeck-eq` trigger and invokes the skill — then reads `references/band-guide.md` as musical domain knowledge before producing the response. [@session-skill-activation]

In `claude -p` calls, the explicit **"Respond with ONLY a JSON object, no prose"** instruction suppresses the skill's 8-step CLI workflow. No `tonedeck status --json`, `tonedeck list --json`, or other commands are executed. The band guide is used for design reasoning only. The reason this works is mechanical: `claude -p` does not expose the Bash tool, so even if the skill activates and the agent wants to run CLI commands, it has no means to do so.

**SDK sessions behave differently and non-deterministically.** When the same eqgen-style prompt is delivered via an SDK (`sdk-cli`) entrypoint rather than `claude -p`, the agent has full tool access. Three distinct behavioral patterns have been observed:

1. **Full 8-step workflow**: Skill loads, agent runs `tonedeck status --json`, `tonedeck list --json`, `tonedeck show`, etc., then creates the preset via CLI. Observed in sessions `62fb0069` (decisive prompt) [@session-sdk-eqgen-prompt], `a5ccf506` (decisive prompt, "Lost In the World") [@session-sdk-decisive-bash-failure], `a91bfb61` (decisive prompt, "Hell of a Life") [@session-sdk-decisive-hell-of-a-life], `aa1d31ba` (decisive prompt, "Intro") [@session-sdk-decisive-intro-college-dropout], `8bbf99d5` (conservative prompt) [@session-sdk-conservative-full-workflow], and `d9986553` (conservative prompt, "Use This Gospel"). [@session-sdk-conservative-use-this-gospel]

2. **No tool calls**: Agent returns JSON directly without invoking any tools. Observed in sessions `7424d6cc` (~5.5 s, "Devil In a New Dress", conservative prompt) and `9a1b3308` (~7 s, "All of the Lights (Interlude)", conservative prompt). [@session-sdk-direct-json] [@session-sdk-direct-json-interlude]

3. **Middle-ground — skill+band-guide but no CLI**: Agent loads the `tonedeck-eq` skill and reads `band-guide.md`, but does not execute any `tonedeck` CLI commands, then returns JSON directly. Observed in session `b53964a7` ("Hands On", conservative prompt, SDK mode). [@session-sdk-conservative-skill-no-cli] This pattern was previously only documented for `claude -p` sessions (where Bash is mechanically unavailable), but session `b53964a7` confirms it also occurs in SDK mode where Bash IS available but the agent chose not to use it.

The decisive vs. conservative prompt distinction is a weak signal, not a reliable predictor. `62fb0069` and `a5ccf506` (both decisive prompt) ran the full workflow; `7424d6cc` and `9a1b3308` (both conservative prompt) returned JSON with no tool calls. But `8bbf99d5` and `d9986553` (both conservative prompt, same branch) ran the full skill workflow, and `b53964a7` (conservative prompt, same branch) hit the middle-ground pattern. All three outcomes have appeared with the conservative prompt in SDK mode. Cache state, model sampling variance, and session context (skill listing, MCP server load sequence) are all plausible contributors. The JSON-only instruction cannot be relied on as a suppressor. The corpus build pipeline correctly uses `claude -p`; any refactoring that shifts generation to the SDK would need an explicit `--allowedTools []` constraint or equivalent to guarantee batch semantics across all runs.

**SDK sessions have additional failure modes beyond the main model.** The auto-mode safety classifier for Bash is a separate service path from the main model — it can become unavailable independently. When the classifier fails, Bash is fully blocked with the error "claude-sonnet-4-6 is temporarily unavailable, so auto mode cannot determine the safety of Bash right now." Three sessions during the same outage window (~17:25–17:27Z on 2026-06-16) illustrate three distinct agent responses:

- **Read-tool fallback (session `a5ccf506`, "Lost In the World")**: After Bash was blocked, the agent continued and read `band-guide.md` via the Read tool. The session then terminated with a 500 Internal Server Error; no JSON was produced. [@session-sdk-decisive-bash-failure]

- **Retry-then-terminate (session `df17aabe`, "Blame Game")**: After each Bash failure, the agent retried `tonedeck status --json` at ~30-second intervals — three times total (17:26:04, 17:26:23, 17:26:53) — without falling back to Read or any other tool. The session then terminated with no JSON produced. [@session-sdk-decisive-blame-game]

- **Retry-then-succeed (session `e4087132`, "We Don't Care")**: Two consecutive Bash calls were blocked by the classifier error, then a third attempt ~1 minute later succeeded and returned the live status JSON. The classifier outage was transient enough to recover within the session. Session transcript was captured only through the successful status call, so the ultimate outcome is unknown, but the recovery establishes that **the blocking is not always session-terminal**. [@session-sdk-decisive-retry-succeed]

Read-only tools (Read, Grep, Glob) remain available at the infrastructure level when the classifier fails, but agents do not reliably use them. Whether an agent falls back to Read, retries Bash until termination, or retries until the classifier recovers appears to be a combination of model sampling variance and outage duration. These failures are transient and recoverable from the caller's perspective, but they are invisible to `eqgen.ts`'s error handling, which only catches process-level failures from `claude -p`, not SDK-level transport errors.

**Large preset-list output.** As the corpus grows, `tonedeck list --json` output can exceed the SDK's inline tool-result size limit. In sessions `a91bfb61` and `aa1d31ba` the output was 35.4KB; the SDK persisted it to disk and gave the agent a 2KB preview plus a file path. [@session-sdk-decisive-hell-of-a-life] [@session-sdk-decisive-intro-college-dropout]

**Line-based grep is useless against single-line JSON.** `tonedeck list --json` outputs the entire preset array as a single JSON line. Piping it to `grep -i <keyword>` does not filter individual preset entries — if any keyword appears anywhere in that line, grep emits the entire 35.4KB line unchanged. In session `aa1d31ba`, the agent tried exactly this pattern and still received the full 35.4KB output, which was then persisted. The correct follow-up is to use structured JSON parsing: the agent then issued a second Bash call using `python3 -c "import json,sys; ..."` to load and filter the persisted file by slug fields. This Python-based JSON filter is the reliable workaround once the inline limit is hit. In `claude -p` mode this is not an issue because the list command is never called. [@session-sdk-decisive-intro-college-dropout]

**Python stdin piping fails because `tonedeck list --json` wraps output in `{"presets": [...]}`.** A distinct failure mode observed in session `dfa337bc`: the agent tried to filter slugs inline by piping directly into Python — `tonedeck list --json 2>&1 | python3 -c "import json,sys; presets=json.load(sys.stdin); [print(p['slug']) for p in presets]"`. This fails with `TypeError: string indices must be integers, not 'str'` because `json.load(sys.stdin)` returns `{"presets": [...], ...}` (a dict), not a bare array. Iterating `for p in presets` iterates over the dict's keys (e.g., `"presets"`, `"total"`), not the preset entries. The correct inline form is `json.load(sys.stdin)['presets']`. After this failure the agent fell back to running `tonedeck list --json` directly, received the 35.4KB persisted output, and then used `grep -o '"slug":"[^"]*"'` on the persisted file — which successfully found the relevant matches without hitting the single-line grep limitation. The grep-on-persisted-file approach is reliable for keyword presence checks even though it cannot be used to parse structured fields. [@session-sdk-decisive-jil-mid-flow]

**`command_permissions.allowedTools: []` in the SDK does not block tools.** In session `aa1d31ba`, the SDK injected a `command_permissions` attachment with `allowedTools: []` before the agent processed any messages. Despite this, Bash ran successfully. The field appears to record "no tools were explicitly added by the SDK caller" rather than "all tools are blocked." It is not equivalent to passing `--allowedTools []` via the CLI. [@session-sdk-decisive-intro-college-dropout]

**Coupling implication:** `skill/tonedeck-eq/references/band-guide.md` is shared domain knowledge for both interactive sessions and batch corpus generation. A change to the band guide — e.g., adjusting the safe ranges for a band, changing the harshness-first philosophy, or editing the FT1 Pro house notes — propagates to both paths. This is the opposite of what you'd expect from a tool described as "interactive only." Future agents editing the band guide should treat it as affecting corpus EQ quality, not just user-facing tuning sessions.

## JSON Extraction

`extractJson(raw)` handles everything the model might emit:

1. Strips code fences (`` ` `` ` `` `json ... ` `` ` ``).
2. Takes the outermost `{..}` block using `indexOf('{')` and `lastIndexOf('}')`.
3. `JSON.parse`s the result.

Leading prose before the JSON, trailing prose after, and code fences are all tolerated. Any model output that does not contain a valid `{..}` block throws `EqGenError('no JSON object in model output')`.

## Band ID Assignment

Any `id` the model emits on a band object is discarded. `eqgen.ts` always assigns `b1, b2, b3, ...` positionally. This avoids the case where the model invents IDs like `"bass_boost"` that would collide with [[profile]] template band ids.

## Error Handling

All failures throw `EqGenError` (a typed subclass of Error). Callers can check `instanceof EqGenError`. Categories:

- Claude CLI process failed (non-zero exit or spawn error)
- Claude CLI timed out
- Model output contained no valid JSON
- JSON had no `bands` array or an empty one
- Generated candidate failed `parsePreset` schema validation

## Prompt Design

The generation prompt includes three main sections:

1. **Chain context**: `"You are tuning a parametric EQ for the headphone chain '${profile.name}' (${profile.houseNotes})."` — `houseNotes` is a free-text field in `profiles/ft1pro.json` injected verbatim. See [[profile]] for the exact content and its implications for generation behavior.

2. **Song identity**: title, artist, album.

3. **Instructions + rules**: band types, frequency range, gain bounds, preamp bounds (all from `profile.limits`). Note: `buildPrompt` only uses `bandGainDb` and `preampDb`; `buildOptimizePrompt` additionally injects `q` and `freqHz` bounds from the profile.

4. **Expected JSON shape**: The prompt explicitly requests `{ preamp, intent, notes, bands }`. The `notes` field is a one-sentence tuning rationale; `eqgen.ts` stores it directly in `preset.notes` when present.

### Prompt Evolution

An early version of the instructions ended with:

> "Be conservative — small moves, no more than ~4 dB on any single band."

This instruction (visible in session `00bbda43` from 2026-06-16) produced overly safe, homogeneous curves that sounded similar across different recordings.

The current instruction is deliberately anti-conservative:

> "Be decisive, not generic: a dull/dark mix should gain real top-end air; a harsh/loud modern master should get firm presence/upper-mid cuts … Two genuinely different-sounding songs MUST get genuinely different curves — do NOT default to one safe house shape for everything. Use as much of the available range as the track honestly needs."

The shift from conservative to decisive was motivated by observing that the conservative prompt led to a corpus of near-identical curves, defeating the point of per-track tuning.

> **Build drift risk**: prompt changes in `src/eqgen.ts` do not take effect until the daemon is rebuilt from source. The running daemon executes `dist/eqgen.js`, not the TypeScript source. On 2026-06-17, `src/eqgen.ts` was updated to the decisive prompt at 22:51 but `dist/eqgen.js` had last been built at 22:31 — a 20-minute lag. Session `4c9fa884` triggered by AutoDJ that evening still received the conservative prompt. [@session-build-drift] [@eqgen-dist] The only reliable check is to inspect the dist file directly; comparing mtime is unreliable if the build system caches.

## Provenance

Presets generated by `generateTrackEq` carry:

```json
"provenance": { "createdBy": "claude", "model": "sonnet (cli)", "history": [] }
```

This is stable in the schema; `provenance.createdBy` is checked in tests and enables filtering corpus presets from user-authored ones.

## Related Pages

- [[corpus]] — orchestrates bulk calls to `generateTrackEq`
- [[preset]] — the output schema; `kind: 'track'` and `provenance.createdBy: 'claude'` are set by eqgen
- [[preset-store]] — applies the house-limit clamp after eqgen's `parsePreset` validation
- [[claude-skill]] — the interactive Claude Code skill; separate from eqgen's batch path
- [[profile]] — source of `houseNotes` and limits injected into every prompt
- [[safety]] — headroom and clamp pipeline; runs inside PresetStore, not eqgen

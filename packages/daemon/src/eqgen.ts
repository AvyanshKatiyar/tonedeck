/** Authors an EQ preset for one track by shelling out to the local Claude CLI
 *  (`claude -p`). No API key. Schema-validates the model output; the PresetStore
 *  applies the authoritative house-limit clamp on create. */
import { execFile } from 'node:child_process'
import { parsePreset, type Preset, type Profile } from '@tonedeck/shared'

export class EqGenError extends Error {
  constructor(msg: string) { super(msg); this.name = 'EqGenError' }
}

/** Minimal track shape we need (avoids importing the NowPlaying type cycle). */
export interface TrackMeta { title: string | null; artist: string | null; album: string | null }

export type GenExec = (prompt: string, timeoutMs: number) => Promise<string>

const defaultExec: GenExec = (prompt, timeoutMs) =>
  new Promise((resolve, reject) => {
    // The daemon runs under launchd with a minimal PATH (/opt/homebrew/bin:/usr/bin:/bin),
    // which usually does NOT include the Claude CLI (e.g. ~/.local/bin/claude). Prepend the
    // common user-bin locations so `claude` resolves regardless of launch context, and allow
    // an explicit override via TONEDECK_CLAUDE_BIN.
    const home = process.env.HOME ?? ''
    const PATH = [
      `${home}/.local/bin`,
      '/opt/homebrew/bin',
      '/usr/local/bin',
      process.env.PATH ?? '',
    ]
      .filter(Boolean)
      .join(':')
    const bin = process.env.TONEDECK_CLAUDE_BIN || 'claude'
    execFile(
      bin,
      ['-p', '--model', 'sonnet', prompt],
      { timeout: timeoutMs, env: { ...process.env, MAX_THINKING_TOKENS: '0', PATH }, maxBuffer: 1 << 20 },
      (err, stdout) => (err ? reject(err) : resolve(stdout.toString())),
    )
  })

export interface GenerateOpts { slug: string; exec?: GenExec; timeoutMs?: number }

function buildPrompt(track: TrackMeta, profile: Profile): string {
  const [gLo, gHi] = profile.limits.bandGainDb
  const [pLo, pHi] = profile.limits.preampDb
  return [
    `You are tuning a parametric EQ for the headphone chain "${profile.name}" (${profile.houseNotes}).`,
    `Song: "${track.title}" by ${track.artist} (album: ${track.album}).`,
    `Author a tasteful corrective/flavor EQ for THIS track on THIS chain.`,
    `Rules: 3-6 bands. Each band: type in {lowshelf, peaking, highshelf}, freq 20-20000 Hz,`,
    `q 0.3-5, gain between ${gLo} and ${gHi} dB. preamp between ${pLo} and ${pHi} dB`,
    `(negative, to leave headroom). Be conservative — small moves, no more than ~4 dB on any single band.`,
    `Respond with ONLY a JSON object, no prose:`,
    `{"preamp": number, "intent": "short phrase", "notes": "one sentence",`,
    ` "bands": [{"type": "...", "freq": number, "q": number, "gain": number}]}`,
  ].join('\n')
}

function extractJson(raw: string): unknown {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const body = fenced ? fenced[1] : raw
  // Takes the outermost {..}. Leading prose containing a stray '{' (or trailing
  // prose with a stray '}') will fail JSON.parse → EqGenError → caller falls back.
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start < 0 || end < 0) throw new EqGenError('no JSON object in model output')
  try { return JSON.parse(body.slice(start, end + 1)) } catch (e) {
    throw new EqGenError(`model output was not valid JSON: ${(e as Error).message}`)
  }
}

export async function generateTrackEq(track: TrackMeta, profile: Profile, opts: GenerateOpts): Promise<Preset> {
  const exec = opts.exec ?? defaultExec
  const timeoutMs = opts.timeoutMs ?? 90_000
  let out: string
  try { out = await exec(buildPrompt(track, profile), timeoutMs) }
  catch (e) { throw new EqGenError(`claude CLI failed: ${(e as Error).message}`) }

  const parsed = extractJson(out) as { preamp?: number; intent?: string; notes?: string; bands?: unknown[] }
  if (!Array.isArray(parsed.bands) || parsed.bands.length === 0) throw new EqGenError('no bands in model output')

  const now = new Date().toISOString()
  const candidate = {
    schemaVersion: 1 as const,
    slug: opts.slug,
    kind: 'track' as const,
    title: track.title ?? 'Unknown',
    artist: track.artist ?? undefined,
    album: track.album ?? undefined,
    profile: profile.id,
    preamp: Number(parsed.preamp ?? -3),
    bands: parsed.bands.map((b, i) => ({ ...(b as object), id: `b${i + 1}` })),
    intent: parsed.intent ?? 'auto',
    notes: parsed.notes,
    provenance: { createdBy: 'claude' as const, model: 'sonnet (cli)', history: [] },
    version: 1,
    createdAt: now,
    updatedAt: now,
  }
  try { return parsePreset(candidate) } // schema sanity; the store does the house clamp
  catch (e) { throw new EqGenError(`generated preset failed schema: ${(e as Error).message}`) }
}

/** Reads the macOS Music.app current track + player state via osascript.
 *  The parser is pure; the osascript call is injectable for tests. */
import { execFile } from 'node:child_process'

export type PlayerState = 'playing' | 'paused' | 'stopped' | 'closed'

export interface NowPlaying {
  state: PlayerState
  trackId: number | null
  title: string | null
  artist: string | null
  album: string | null
}

const SCRIPT = `
if application "Music" is running then
  tell application "Music"
    if player state is stopped then return "stopped|||"
    set t to current track
    return (player state as text) & "|" & (database ID of t) & "|" & (name of t) & "|" & (artist of t) & "|" & (album of t)
  end tell
else
  return "closed|||"
end if`

export type ExecLike = (script: string) => Promise<string>

const defaultExec: ExecLike = (script) =>
  new Promise((resolve, reject) => {
    execFile('osascript', ['-e', script], { timeout: 4000 }, (err, stdout) =>
      err ? reject(err) : resolve(stdout.toString().trim()),
    )
  })

export function parseNowPlaying(raw: string): NowPlaying {
  const trimmed = raw.trim()
  const head = trimmed.split('|', 1)[0] as PlayerState
  if (head === 'closed' || head === 'stopped') {
    return { state: head, trackId: null, title: null, artist: null, album: null }
  }
  const parts = trimmed.split('|')
  const n = parts.length
  if (n < 5) {
    // Truncated/garbage osascript output — never treat as a real track.
    return { state: 'closed', trackId: null, title: null, artist: null, album: null }
  }
  // Music returns 5 fields: state|id|title|artist|album. A title may itself
  // contain '|', so anchor artist/album to the END (last two fields) and let
  // the title absorb any interior delimiters.
  // e.g. "playing|9|Intro | Outro|Nas|Illmatic" → parts[n-2]=Nas, parts[n-1]=Illmatic, title="Intro | Outro"
  // e.g. "playing|9|A|B|C|D" (n=6) → parts[n-2]=C, parts[n-1]=D, title="A|B"
  const id = parts[1]
  const album = parts[n - 1] ?? ''
  const artist = parts[n - 2] ?? ''
  const title = parts.slice(2, n - 2).join('|')
  const state: PlayerState = head === 'paused' ? 'paused' : head === 'playing' ? 'playing' : 'closed'
  return {
    state,
    trackId: Number(id) > 0 ? Number(id) : null, // Music IDs are always > 0; 0/NaN = absent
    title: title || null,
    artist: artist || null,
    album: album || null,
  }
}

export async function readNowPlaying(exec: ExecLike = defaultExec): Promise<NowPlaying> {
  try {
    return parseNowPlaying(await exec(SCRIPT))
  } catch {
    return { state: 'closed', trackId: null, title: null, artist: null, album: null }
  }
}

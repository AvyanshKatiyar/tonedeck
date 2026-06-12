#!/usr/bin/env node
/**
 * skill-smoke — validates every `tonedeck ...` command documented in the
 * tonedeck-eq skill against a LIVE test daemon, so the skill can never drift
 * from the real CLI surface.
 *
 *   - Boots buildServer({ deviceSwitching:false, temp dataDir, http 5060 }) —
 *     the same pattern as control-smoke. The daemon loads the repo builtins
 *     (read-only) and writes any created presets into a throwaway temp dir.
 *   - Parses SKILL.md + the three references, extracting every command from
 *     fenced code blocks (incl. heredoc stdin) AND inline `tonedeck ...` spans.
 *   - Runs each command and fails on any commander/CLI PARSE error (unknown
 *     option/command, bad arg, unknown vibe, missing band). Runtime refusals
 *     (404 not_found, 409 not_engaged, doctor health FAILs) are EXPECTED and do
 *     not fail the smoke — they prove the command parsed and reached the daemon.
 *   - NEVER engages for real: commands that need an engaged DSP or that stream
 *     (on/off/apply/preview/meters/bypass/panic) are validated SYNTAX-ONLY via
 *     `<verb> --help`, including a check that every long flag used is real.
 *     `panic` in particular does a global `pkill -x camilladsp` — it is never
 *     run live here. `--apply` is stripped from create/tweak before execution.
 *
 * Run:  npm run smoke:skill
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..', '..')
const CLI = join(ROOT, 'packages', 'cli', 'dist', 'index.js')
const DAEMON = join(ROOT, 'packages', 'daemon', 'dist', 'index.js')
const SKILL_DIR = join(ROOT, 'skill', 'tonedeck-eq')

// NOTE: deliberately NOT 5060. 5060 is the SIP port and Node's undici `fetch`
// (which the CLI and this poll both use) fails on 127.0.0.1:5060 on this host
// even though curl succeeds — a SIP-ALG/undici interaction. 5068 is a free,
// working, non-production port distinct from the daemon (5056) and other smokes.
const HTTP_PORT = 5068
const CDSP_PORT = 5099 // unused — we never engage
const BASE = `http://127.0.0.1:${HTTP_PORT}`

const FILES = [
  join(SKILL_DIR, 'SKILL.md'),
  join(SKILL_DIR, 'references', 'band-guide.md'),
  join(SKILL_DIR, 'references', 'symptom-map.md'),
  join(SKILL_DIR, 'references', 'worked-examples.md'),
]

const KNOWN_VERBS = new Set([
  'status', 'list', 'show', 'apply', 'on', 'off', 'panic', 'bypass', 'create',
  'tweak', 'delete', 'preview', 'meters', 'art', 'doctor', 'health',
])
// Engagement-requiring / streaming / destructive → SYNTAX-ONLY (validate via --help).
const SYNTAX_ONLY = new Set(['on', 'off', 'apply', 'preview', 'meters', 'bypass', 'panic'])
// Verbs that are meaningless bare (need a positional arg or --from-json). A bare
// occurrence is a prose name-reference (e.g. "a concrete `tonedeck tweak` command"),
// not a runnable example → skip rather than mis-run it.
const NEEDS_ARGS = new Set(['show', 'apply', 'bypass', 'tweak', 'delete', 'art', 'create', 'preview'])
const GLOBAL_FLAGS = new Set(['--json', '--url'])

// A parse/usage error means the doc cites the CLI wrong → FAIL. Runtime refusals
// (unreachable/not_found/not_engaged/doctor FAIL) are fine.
const FAIL_PATTERNS = [
  /Daemon unreachable/i, // harness/daemon down — a live check that never reached the daemon proves nothing
  /unknown command/i,
  /unknown option/i,
  /missing required option/i,
  /missing required argument/i,
  /too many arguments/i,
  /option .*argument missing/i,
  /Expected a number/i,
  /Invalid --vibe/i,
  /Unknown vibe/i,
  /not found in preset or profile template/i,
  /Invalid JSON/i,
]

// ── preflight ──────────────────────────────────────────────────────────────--
for (const [label, p] of [['CLI', CLI], ['daemon', DAEMON]]) {
  if (!existsSync(p)) {
    console.error(`skill-smoke: ${label} not built at ${p} — run \`npm run build\` first.`)
    process.exit(1)
  }
}
for (const f of FILES) {
  if (!existsSync(f)) {
    console.error(`skill-smoke: missing skill file ${f}`)
    process.exit(1)
  }
}

// ── extraction ───────────────────────────────────────────────────────────────
/** Extract documented commands from one markdown file. */
function extractFromFile(file) {
  const text = readFileSync(file, 'utf8')
  const lines = text.split('\n')
  const out = []
  let inFence = false
  let heredoc = null // { cmd, delim, body[] }

  for (const line of lines) {
    if (heredoc) {
      if (line.trim() === heredoc.delim) {
        out.push({ raw: heredoc.cmd, stdin: heredoc.body.join('\n') + '\n', file })
        heredoc = null
      } else {
        heredoc.body.push(line)
      }
      continue
    }
    if (/^\s*```/.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence) {
      const m = line.match(/^\s*\$?\s*(tonedeck\s+.*)$/)
      if (!m) continue
      let raw = m[1].trim()
      const hd = raw.match(/<<-?\s*'?([A-Za-z_]\w*)'?/)
      if (hd) {
        const cmd = raw.slice(0, raw.indexOf('<<')).trim()
        heredoc = { cmd, delim: hd[1], body: [] }
      } else {
        out.push({ raw, stdin: null, file })
      }
    } else {
      // Inline `tonedeck ...` spans in prose.
      const re = /`(tonedeck\s+[^`]+)`/g
      let im
      while ((im = re.exec(line)) !== null) {
        out.push({ raw: im[1].trim(), stdin: null, file })
      }
    }
  }
  return out
}

/** Find the subcommand token (skipping leading global options). */
function subcommandOf(raw) {
  const toks = raw.split(/\s+/).slice(1) // drop "tonedeck"
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]
    if (t === '--json') continue
    if (t === '--url') { i++; continue }
    if (t.startsWith('-')) continue
    return t
  }
  return null
}

/** Meaningful tokens after the verb (excludes globals + the verb itself). */
function meaningfulArgs(raw, sub) {
  const toks = raw.split(/\s+/)
  const vi = toks.indexOf(sub)
  const after = toks.slice(vi + 1)
  const out = []
  for (let i = 0; i < after.length; i++) {
    const t = after[i]
    if (t === '--json') continue
    if (t === '--url') { i++; continue }
    out.push(t)
  }
  return out
}

/** Long flags used in a command (excludes globals + negative numbers). */
function longFlagsOf(raw) {
  return raw
    .split(/\s+/)
    .filter((t) => /^--[a-z]/.test(t))
    .map((t) => t.split('=')[0])
    .filter((t) => !GLOBAL_FLAGS.has(t))
}

/** Make a command runnable: substitute placeholders, strip pipes/--apply. */
function toRunnable(raw) {
  let cmd = raw
  cmd = cmd.split(' | ')[0] // drop pipe tail (+ trailing comment)
  cmd = cmd.replace(/\s--apply\b/g, '') // never engage
  cmd = cmd.replace(/<slug>|<album[^>]*>|<artist>|<genre>/g, 'donda')
  cmd = cmd.replace(/<[^>]+>/g, '-2') // remaining gain/etc placeholders → valid number
  return cmd.trim()
}

// ── run one command ──────────────────────────────────────────────────────────
function runLive(runnable, stdin) {
  // Replace leading "tonedeck" with the node CLI and target the test daemon.
  const rest = runnable.replace(/^tonedeck\s+/, '')
  const full = `node ${JSON.stringify(CLI)} ${rest} --url ${BASE}`
  const r = spawnSync(full, {
    shell: true,
    input: stdin ?? undefined,
    encoding: 'utf8',
    timeout: 20000,
  })
  const out = `${r.stdout ?? ''}\n${r.stderr ?? ''}`
  const bad = FAIL_PATTERNS.find((re) => re.test(out))
  return { ok: !bad, exit: r.status, detail: bad ? out.trim().split('\n').slice(-1)[0] : '' }
}

function runSyntaxOnly(sub, raw) {
  const r = spawnSync(`node ${JSON.stringify(CLI)} ${sub} --help`, {
    shell: true,
    encoding: 'utf8',
    timeout: 15000,
  })
  const out = `${r.stdout ?? ''}\n${r.stderr ?? ''}`
  if (r.status !== 0 || /unknown command/i.test(out) || !/Usage: tonedeck/.test(out)) {
    return { ok: false, detail: `\`${sub} --help\` failed` }
  }
  const missing = longFlagsOf(raw).filter((f) => !out.includes(f))
  if (missing.length) return { ok: false, detail: `flags not in ${sub} --help: ${missing.join(', ')}` }
  return { ok: true, detail: 'help + flags ok' }
}

// ── test daemon (separate process) ───────────────────────────────────────────
// The CLI runs via spawnSync, which blocks this process's event loop — so the
// daemon CANNOT live in-process (it could never answer the CLI's HTTP call).
// It runs as a child process with deviceSwitching OFF (never touches real audio
// devices) on a temp dataDir, seeded disengaged. We poll /api/health for ready.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function writeLauncher(dataDir) {
  const path = join(dataDir, 'launcher.mjs')
  const src = `
import { buildServer } from ${JSON.stringify(pathToFileURL(DAEMON).href)}
const server = await buildServer({
  dataDir: process.env.SMOKE_DATA_DIR,
  cdspPort: Number(process.env.SMOKE_CDSP_PORT),
  deviceSwitching: false,
})
await server.listen({ host: '127.0.0.1', port: Number(process.env.SMOKE_PORT) })
const close = async () => { try { await server.close() } catch {} process.exit(0) }
process.on('SIGTERM', close)
process.on('SIGINT', close)
`
  writeFileSync(path, src)
  return path
}

async function startDaemon(dataDir) {
  const launcher = writeLauncher(dataDir)
  const proc = spawn('node', [launcher], {
    env: { ...process.env, SMOKE_PORT: String(HTTP_PORT), SMOKE_DATA_DIR: dataDir, SMOKE_CDSP_PORT: String(CDSP_PORT) },
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  let stderr = ''
  proc.stderr.on('data', (d) => (stderr += d.toString()))
  for (let i = 0; i < 60; i++) {
    await sleep(100)
    try {
      const r = await fetch(`${BASE}/api/health`)
      if (r.ok) return proc
    } catch { /* not up yet */ }
  }
  try { proc.kill('SIGKILL') } catch { /* ignore */ }
  throw new Error(`test daemon did not become healthy within 6s on ${BASE}${stderr ? `\n--- launcher stderr ---\n${stderr}` : ''}`)
}

// ── main ─────────────────────────────────────────────────────────────────────
const dataDir = mkdtempSync(join(tmpdir(), 'tonedeck-skill-smoke-'))
writeFileSync(
  join(dataDir, 'state.json'),
  JSON.stringify({ engaged: false, activePreset: null, bypass: false }),
)

let daemon = null
let anyFailed = false
const rows = []

try {
  daemon = await startDaemon(dataDir)

  // Collect + dedupe (keep first occurrence order).
  const seen = new Set()
  const commands = []
  for (const f of FILES) {
    for (const c of extractFromFile(f)) {
      const key = c.raw + ' ' + (c.stdin ?? '')
      if (seen.has(key)) continue
      seen.add(key)
      commands.push(c)
    }
  }

  console.log(`ToneDeck skill smoke — ${commands.length} commands across ${FILES.length} files (daemon ${BASE})\n`)

  for (const c of commands) {
    const sub = subcommandOf(c.raw)
    const label = c.raw.length > 64 ? c.raw.slice(0, 61) + '...' : c.raw
    const fileTag = c.file.split('/').slice(-1)[0]

    if (!sub || !KNOWN_VERBS.has(sub)) {
      rows.push({ status: 'SKIP', mode: 'tmpl', label, fileTag, detail: 'placeholder verb' })
      continue
    }
    if (NEEDS_ARGS.has(sub) && meaningfulArgs(c.raw, sub).length === 0 && !c.stdin) {
      rows.push({ status: 'SKIP', mode: 'tmpl', label, fileTag, detail: 'command name reference (bare verb)' })
      continue
    }

    const skeleton = c.raw.includes('...') || (c.stdin && c.stdin.includes('...'))
    let res
    let mode
    if (SYNTAX_ONLY.has(sub) || skeleton) {
      mode = 'syntax'
      res = runSyntaxOnly(sub, c.raw)
    } else {
      mode = 'live'
      res = runLive(toRunnable(c.raw), c.stdin)
    }
    rows.push({ status: res.ok ? 'PASS' : 'FAIL', mode, label, fileTag, detail: res.detail })
    if (!res.ok) anyFailed = true
  }
} catch (e) {
  console.error('skill-smoke: fatal', e instanceof Error ? e.stack : String(e))
  anyFailed = true
} finally {
  try { if (daemon && daemon.exitCode === null) daemon.kill('SIGKILL') } catch { /* ignore */ }
  await sleep(300)
  try { rmSync(dataDir, { recursive: true, force: true }) } catch { /* ignore */ }
}

// ── report ───────────────────────────────────────────────────────────────────
const w = Math.max(...rows.map((r) => r.label.length), 7)
for (const r of rows) {
  const line = `  ${r.status.padEnd(4)} ${r.mode.padEnd(6)} ${r.label.padEnd(w)}  [${r.fileTag}]`
  console.log(r.detail && (r.status === 'FAIL' || r.status === 'SKIP') ? `${line}  — ${r.detail}` : line)
}

const pass = rows.filter((r) => r.status === 'PASS').length
const skip = rows.filter((r) => r.status === 'SKIP').length
const fail = rows.filter((r) => r.status === 'FAIL').length

// Guard: we must never have spawned camilladsp.
let camillaRunning = false
try {
  const pg = spawnSync('pgrep', ['-x', 'camilladsp'], { encoding: 'utf8' })
  camillaRunning = !!(pg.stdout && pg.stdout.trim())
} catch { /* pgrep absent — ignore */ }
if (camillaRunning) {
  console.log('\n  FAIL — camilladsp is running after smoke (should never be engaged)')
  anyFailed = true
}

console.log(`\n${pass} pass, ${skip} skip (templates/syntax), ${fail} fail`)
console.log(anyFailed ? 'RESULT: FAIL' : 'RESULT: PASS')
process.exit(anyFailed ? 1 : 0)

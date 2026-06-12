#!/usr/bin/env node
/**
 * Live end-to-end smoke for the ToneDeck control plane (lifecycle + control
 * routes + meters + daemon assembly). Spawns a REAL camilladsp 4.1.3 and drives
 * the full HTTP/ws surface — WITHOUT disrupting the user's audio:
 *
 *   - deviceSwitching:false  → the daemon NEVER calls `SwitchAudioSource -s`
 *     (it logs intent instead); reads are still real.
 *   - cdspPort 12345, http 5057 → never the production ports.
 *   - playback device = "External Headphones" if present, else "MacBook Air
 *     Speakers" (mirrors the cdsp smoke). camilladsp captures the silent
 *     BlackHole loopback and plays a silent stream in shared mode → inaudible.
 *
 * Run:  npm run smoke:control
 *
 * If camilladsp / SwitchAudioSource / a safe device is missing, it SKIPs (exit 0).
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import YAML from 'yaml'
import WebSocket from 'ws'
import { buildServer } from '../../packages/daemon/dist/index.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..', '..')

const CAMILLADSP = '/opt/homebrew/bin/camilladsp'
const SWITCHAUDIO = '/opt/homebrew/bin/SwitchAudioSource'
const CDSP_PORT = 12345
const HTTP_PORT = 5057
const BASE = `http://127.0.0.1:${HTTP_PORT}`

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ── step bookkeeping ────────────────────────────────────────────────────────--
let anyFailed = false
function record(name, ok, detail) {
  const tag = ok ? 'PASS' : 'FAIL'
  console.log(`  ${tag}  ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) anyFailed = true
}
async function step(name, fn) {
  try {
    record(name, true, await fn())
  } catch (e) {
    record(name, false, e instanceof Error ? e.message : String(e))
    throw e // abort the battery; cleanup runs in finally
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}
function skip(msg) {
  console.log(`SKIP: ${msg}`)
  process.exit(0)
}

// ── preflight (read-only) ───────────────────────────────────────────────────--
if (!existsSync(CAMILLADSP)) skip(`camilladsp not found at ${CAMILLADSP}`)
if (!existsSync(SWITCHAUDIO)) skip(`SwitchAudioSource not found at ${SWITCHAUDIO}`)

let deviceList = []
try {
  deviceList = execFileSync(SWITCHAUDIO, ['-a', '-t', 'output'], { encoding: 'utf8' })
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
} catch (e) {
  skip(`SwitchAudioSource failed: ${e instanceof Error ? e.message : String(e)}`)
}
const SAFE_DEVICE =
  process.env.TONEDECK_SMOKE_PLAYBACK_DEVICE ||
  (deviceList.includes('External Headphones')
    ? 'External Headphones'
    : deviceList.includes('MacBook Air Speakers')
      ? 'MacBook Air Speakers'
      : null)
if (!SAFE_DEVICE || !deviceList.includes(SAFE_DEVICE)) {
  skip(`no safe playback device present (have: ${deviceList.join(', ')})`)
}

// Refuse to run if a camilladsp is already up on our port (we must own it).
function camillaPids() {
  try {
    return execFileSync('pgrep', ['-f', `port ${CDSP_PORT}`], { encoding: 'utf8' })
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
  } catch {
    return []
  }
}
if (camillaPids().length > 0) skip(`a camilladsp already owns port ${CDSP_PORT}`)

// ── HTTP helpers ────────────────────────────────────────────────────────────--
async function post(path, body) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const json = await res.json().catch(() => null)
  return { status: res.status, json }
}
async function get(path) {
  const res = await fetch(BASE + path)
  const json = await res.json().catch(() => null)
  return { status: res.status, json }
}

console.log(`ToneDeck control smoke — http ${HTTP_PORT}, cdsp ${CDSP_PORT}, playback "${SAFE_DEVICE}"`)

const dataDir = mkdtempSync(join(tmpdir(), 'tonedeck-control-smoke-'))
const activeYml = join(dataDir, 'generated', 'active.yml')

// Seed state so device resolution is deterministic even if the current system
// output happens to be BlackHole at smoke time.
writeFileSync(
  join(dataDir, 'state.json'),
  JSON.stringify({ engaged: false, activePreset: null, lastRealOutput: SAFE_DEVICE, bypass: false }),
)

// Builtin slugs + titles, read straight from the repo.
const builtinDir = join(ROOT, 'presets', 'builtin')
const builtins = readdirSync(builtinDir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(join(builtinDir, f), 'utf8')))
  .map((p) => ({ slug: p.slug, title: p.title }))

let server = null

try {
  await step('build + listen daemon (deviceSwitching off)', async () => {
    server = await buildServer({
      dataDir,
      cdspPort: CDSP_PORT,
      deviceSwitching: false,
    })
    await server.listen({ host: '127.0.0.1', port: HTTP_PORT })
    const h = await get('/api/health')
    assert(h.status === 200, `health ${h.status}`)
    return `health ok, ${builtins.length} builtins`
  })

  let pid = null
  await step('1. POST /api/engage {mbdtf} → 200, engaged, real camilladsp spawned', async () => {
    const r = await post('/api/engage', { preset: 'mbdtf' })
    assert(r.status === 200, `engage ${r.status} ${JSON.stringify(r.json)}`)
    assert(r.json.engaged === true, 'status.engaged not true')
    const pids = camillaPids()
    assert(pids.length === 1, `expected exactly 1 camilladsp on port ${CDSP_PORT}, got ${pids.length}`)
    pid = pids[0]
    return `engaged; camilladsp pid=${pid}`
  })

  await step('2. apply ALL 16 builtins → 200, dspState live, title applied, PID stable', async () => {
    for (const { slug, title } of builtins) {
      const r = await post(`/api/presets/${slug}/apply`, {})
      assert(r.status === 200, `apply ${slug} → ${r.status} ${JSON.stringify(r.json)}`)
      assert(r.json.verdict !== undefined, `apply ${slug} missing verdict`)

      const s = await get('/api/status')
      assert(s.status === 200, `status ${s.status}`)
      assert(
        ['Running', 'Paused', 'Starting'].includes(s.json.dspState),
        `dspState=${s.json.dspState} for ${slug}`,
      )

      const cfg = YAML.parse(readFileSync(activeYml, 'utf8'))
      assert(
        typeof cfg.title === 'string' && cfg.title.includes(title),
        `active.yml title "${cfg.title}" does not contain "${title}"`,
      )

      const pids = camillaPids()
      assert(pids.length === 1 && pids[0] === pid, `PID changed applying ${slug} (was ${pid}, now ${pids})`)
    }
    return `16 applied glitch-free; pid stayed ${pid}`
  })

  await step('3. bypass on → status.bypass true; off → re-apply works; PID stable', async () => {
    const on = await post('/api/bypass', { on: true })
    assert(on.status === 200, `bypass on ${on.status}`)
    const sOn = await get('/api/status')
    assert(sOn.json.bypass === true, 'bypass not reflected true')

    const off = await post('/api/bypass', { on: false })
    assert(off.status === 200, `bypass off ${off.status}`)
    const sOff = await get('/api/status')
    assert(sOff.json.bypass === false, 'bypass not cleared')

    const reapply = await post('/api/presets/mbdtf/apply', {})
    assert(reapply.status === 200, `re-apply after bypass ${reapply.status}`)

    const pids = camillaPids()
    assert(pids.length === 1 && pids[0] === pid, `PID changed across bypass (was ${pid}, now ${pids})`)
    return 'bypass on/off + re-apply, pid stable'
  })

  await step('4. preview (mbdtf bass +1) → 200; active.yml on disk UNCHANGED', async () => {
    const before = readFileSync(activeYml, 'utf8')
    const mbdtf = JSON.parse(readFileSync(join(builtinDir, 'mbdtf.json'), 'utf8'))
    const bass = mbdtf.bands.find((b) => b.id === 'Bass')
    bass.gain = bass.gain + 1
    const r = await post('/api/preview', { preset: mbdtf })
    assert(r.status === 200, `preview ${r.status} ${JSON.stringify(r.json)}`)
    assert(r.json.ok === true, 'preview not ok')
    const after = readFileSync(activeYml, 'utf8')
    assert(before === after, 'active.yml changed during preview (should be ephemeral)')
    return 'preview ephemeral; active.yml untouched'
  })

  await step('5. ws /ws → ≥3 meter frames within 2s while engaged', async () => {
    const wsc = new WebSocket(`ws://127.0.0.1:${HTTP_PORT}/ws`)
    let frames = 0
    wsc.on('message', (d) => {
      try {
        if (JSON.parse(d.toString()).type === 'meters') frames++
      } catch {
        /* ignore */
      }
    })
    await new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error('ws open timeout')), 2000)
      wsc.once('open', () => {
        clearTimeout(t)
        res()
      })
      wsc.once('error', rej)
    })
    await sleep(2000)
    wsc.close()
    assert(frames >= 3, `only ${frames} meter frames in 2s`)
    return `${frames} meter frames`
  })

  await step('6. POST /api/panic → 200; no camilladsp; state engaged=false', async () => {
    const r = await post('/api/panic', {})
    assert(r.status === 200, `panic ${r.status}`)
    await sleep(400)
    const pids = camillaPids()
    assert(pids.length === 0, `camilladsp still alive after panic: ${pids}`)
    const state = JSON.parse(readFileSync(join(dataDir, 'state.json'), 'utf8'))
    assert(state.engaged === false, 'state.engaged not false after panic')
    return 'panicked; no camilladsp; state cleared'
  })
} catch {
  // step() already printed the failing step.
} finally {
  try {
    if (server) await server.close()
  } catch {
    /* ignore */
  }
  // Belt-and-suspenders: kill only OUR camilladsp instance.
  try {
    execFileSync('pkill', ['-f', `port ${CDSP_PORT}`])
  } catch {
    /* none left — good */
  }
  await sleep(300)
  try {
    rmSync(dataDir, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
}

console.log('')
console.log(anyFailed ? 'RESULT: FAIL' : 'RESULT: PASS')
process.exit(anyFailed ? 1 : 0)

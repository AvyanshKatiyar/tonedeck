#!/usr/bin/env node
/**
 * Live smoke test for the CamillaDSP websocket client (packages/daemon/src/cdsp.ts).
 *
 * Spawns a REAL camilladsp 4.1.3 on port 12340 (never 1234; never touches
 * SwitchAudioSource or the macOS default output) and runs the client through a
 * full battery, including a kill/respawn auto-reconnect cycle.
 *
 * Run:  npm run smoke:cdsp
 *
 * DEVICE: by default this targets the FiiO FT1 Pro on the macOS "External
 * Headphones" CoreAudio device (the product's real target). If those headphones
 * are not plugged in, the preflight SKIPS (exit 0). For self-testing on a
 * machine without the headphones connected, set TONEDECK_SMOKE_PLAYBACK_DEVICE
 * to any present, non-BlackHole output device (e.g. "MacBook Air Speakers") —
 * the battery is otherwise identical and exercises the same code paths.
 */
import { spawn, execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { emitCamillaYaml, parsePreset, parseProfile } from '@tonedeck/shared'
import { CdspClient, CdspError } from '../../packages/daemon/dist/cdsp.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..', '..')

const CAMILLADSP = '/opt/homebrew/bin/camilladsp'
const SWITCHAUDIO = '/opt/homebrew/bin/SwitchAudioSource'
const PORT = 12340
const PLAYBACK_DEVICE = process.env.TONEDECK_SMOKE_PLAYBACK_DEVICE || 'External Headphones'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// --- step bookkeeping -------------------------------------------------------
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

// --- preflight (read-only) --------------------------------------------------
function skip(msg) {
  console.log(`SKIP: ${msg}`)
  process.exit(0)
}

if (!existsSync(CAMILLADSP)) skip(`camilladsp not found at ${CAMILLADSP}`)
if (!existsSync(SWITCHAUDIO)) skip(`SwitchAudioSource not found at ${SWITCHAUDIO}`)

let outputs = ''
try {
  outputs = execFileSync(SWITCHAUDIO, ['-a', '-t', 'output'], { encoding: 'utf8' })
} catch (e) {
  skip(`SwitchAudioSource failed: ${e instanceof Error ? e.message : String(e)}`)
}
const deviceList = outputs.split('\n').map((s) => s.trim()).filter(Boolean)
if (!deviceList.includes(PLAYBACK_DEVICE)) {
  skip(
    `playback device "${PLAYBACK_DEVICE}" not present (have: ${deviceList.join(', ')}). ` +
      `Plug in the FT1 Pro, or set TONEDECK_SMOKE_PLAYBACK_DEVICE to a present device.`,
  )
}

// --- generate configs from real presets via @tonedeck/shared ----------------
async function loadJson(p) {
  return JSON.parse(await readFile(p, 'utf8'))
}

console.log(`CamillaDSP websocket smoke — port ${PORT}, playback "${PLAYBACK_DEVICE}"`)

const tmp = mkdtempSync(join(tmpdir(), 'tonedeck-cdsp-smoke-'))
let child = null
const client = new CdspClient({ port: PORT, connectTimeoutMs: 2000, requestTimeoutMs: 3000 })
client.on('error', () => {}) // swallow transient socket errors during kill/respawn

function spawnCamilla(cfgPath) {
  const c = spawn(CAMILLADSP, [cfgPath, '--address', '127.0.0.1', '--port', String(PORT), '--loglevel', 'warn'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let log = ''
  c.stdout.on('data', (d) => (log += d))
  c.stderr.on('data', (d) => (log += d))
  c.getLog = () => log
  return c
}

async function connectWithRetry(timeoutMs) {
  const deadline = Date.now() + timeoutMs
  let lastErr
  while (Date.now() < deadline) {
    try {
      await client.connect()
      return
    } catch (e) {
      lastErr = e
      await sleep(250)
    }
  }
  throw lastErr ?? new Error('connect retry exhausted')
}

try {
  const profile = parseProfile(await loadJson(join(ROOT, 'profiles', 'ft1pro.json')))
  const yeezus = parsePreset(await loadJson(join(ROOT, 'presets', 'builtin', 'yeezus.json')))
  const mbdtf = parsePreset(await loadJson(join(ROOT, 'presets', 'builtin', 'mbdtf.json')))

  const yeezusYaml = emitCamillaYaml(yeezus, profile, PLAYBACK_DEVICE)
  const mbdtfYaml = emitCamillaYaml(mbdtf, profile, PLAYBACK_DEVICE)
  const cfgPath = join(tmp, 'yeezus.yml')
  writeFileSync(cfgPath, yeezusYaml)

  await step('spawn camilladsp + ws accepts connection', async () => {
    child = spawnCamilla(cfgPath)
    await connectWithRetry(8000)
    return `connected to ws://127.0.0.1:${PORT}`
  })

  await step('getVersion', async () => {
    const v = await client.getVersion()
    assert(typeof v === 'string' && v.length > 0, `bad version: ${v}`)
    return v
  })

  await step('getState (Running | Paused | Inactive | Starting)', async () => {
    const s = await client.getState()
    assert(typeof s === 'string' && s.length > 0, `bad state: ${s}`)
    return s
  })

  await step('getConfig round-trip (non-empty YAML)', async () => {
    const cfg = await client.getConfig()
    assert(typeof cfg === 'string' && cfg.length > 0, 'empty config')
    return `${cfg.length} bytes`
  })

  await step('setConfig(mbdtf) then getConfig contains the new title', async () => {
    await client.setConfig(mbdtfYaml)
    await sleep(300)
    const cfg = await client.getConfig()
    assert(
      cfg.includes('My Beautiful Dark Twisted Fantasy'),
      'new config title not reflected after setConfig',
    )
    return 'title applied'
  })

  await step('getPlaybackSignalRms returns 2 channel numbers', async () => {
    const rms = await client.getPlaybackSignalRms()
    assert(Array.isArray(rms) && rms.length === 2, `expected 2 numbers, got ${JSON.stringify(rms)}`)
    assert(rms.every((n) => typeof n === 'number'), `non-number rms: ${JSON.stringify(rms)}`)
    return `[${rms.map((n) => n.toFixed(1)).join(', ')}]`
  })

  await step('getClippedSamples returns a number', async () => {
    const clipped = await client.getClippedSamples()
    assert(typeof clipped === 'number', `expected number, got ${clipped}`)
    return String(clipped)
  })

  await step('SIGKILL camilladsp -> disconnected event + pending request rejects', async () => {
    const dropped = new Promise((res) => client.once('disconnected', res))
    // Fire a small burst so at least one is in-flight/queued when the process dies.
    const pendings = [client.getState(), client.getVersion(), client.getBufferLevel()].map((p) =>
      p.then(() => null).catch((e) => e),
    )
    child.kill('SIGKILL')
    await dropped
    const results = await Promise.all(pendings)
    const rejected = results.filter((r) => r instanceof CdspError)
    assert(rejected.length >= 1, 'no pending request rejected on socket drop')
    child = null
    return `disconnected fired; ${rejected.length}/3 in-flight requests rejected (${rejected[0].kind})`
  })

  await step('respawn camilladsp -> auto-reconnect within 10s + getState works', async () => {
    const reconnected = new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error('no reconnect within 10s')), 10000)
      client.once('connected', () => {
        clearTimeout(t)
        res()
      })
    })
    child = spawnCamilla(cfgPath)
    await reconnected
    assert(client.isConnected, 'client reports not connected after reconnect')
    const s = await client.getState()
    assert(typeof s === 'string' && s.length > 0, `bad state after reconnect: ${s}`)
    return `reconnected; state=${s}`
  })

  await step('client.exit() shuts camilladsp down cleanly', async () => {
    await client.exit()
    await sleep(500)
    return 'exit acknowledged'
  })
} catch {
  // step() already recorded + printed the failing step.
} finally {
  await client.close().catch(() => {})
  if (child && child.exitCode === null) {
    try {
      child.kill('SIGTERM')
    } catch {
      /* already gone */
    }
  }
  // Belt-and-suspenders: ensure no camilladsp lingers on our port's instance.
  await sleep(300)
  try {
    rmSync(tmp, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
}

console.log('')
console.log(anyFailed ? 'RESULT: FAIL' : 'RESULT: PASS')
process.exit(anyFailed ? 1 : 0)

#!/usr/bin/env node
/**
 * Live end-to-end smoke for the ToneDeck album-art UI. Builds the daemon (which
 * serves packages/ui/dist), drives the REAL browser with playwright-core +
 * Brave headless, and exercises the showpiece flows WITHOUT disrupting the
 * user's audio:
 *
 *   - deviceSwitching:false  → the daemon never calls `SwitchAudioSource -s`.
 *   - cdspPort 12346, http 5059 → never the production ports.
 *   - a real camilladsp is spawned on 12346 and torn down in `finally`.
 *
 * Run:  npm run smoke:ui
 *
 * Brave is required (it's our chromium-family driver); if it's absent the smoke
 * FAILS loudly rather than skipping. camilladsp / a safe playback device being
 * absent is an environment gap → SKIP (exit 0), matching the control smoke.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { buildServer } from '../../packages/daemon/dist/index.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..', '..')

const BRAVE = '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'
const CAMILLADSP = '/opt/homebrew/bin/camilladsp'
const SWITCHAUDIO = '/opt/homebrew/bin/SwitchAudioSource'
const CDSP_PORT = 12346
const HTTP_PORT = 5059
const BASE = `http://127.0.0.1:${HTTP_PORT}`
const SHOTS = { grid: '/tmp/tonedeck-ui-grid.png', drawer: '/tmp/tonedeck-ui-drawer.png', panic: '/tmp/tonedeck-ui-panic.png' }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ── result table ─────────────────────────────────────────────────────────────
const rows = []
let anyFailed = false
async function step(name, fn) {
  try {
    const detail = await fn()
    rows.push({ name, ok: true, detail })
    console.log(`  PASS  ${name}${detail ? '  — ' + detail : ''}`)
  } catch (e) {
    anyFailed = true
    const detail = e instanceof Error ? e.message : String(e)
    rows.push({ name, ok: false, detail })
    console.log(`  FAIL  ${name}  — ${detail}`)
    throw e
  }
}
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg)
}
function skip(msg) {
  console.log(`SKIP: ${msg}`)
  process.exit(0)
}
function fail(msg) {
  console.error(`FAIL (blocked): ${msg}`)
  process.exit(1)
}

// ── HTTP helpers ─────────────────────────────────────────────────────────────
async function get(path) {
  const res = await fetch(BASE + path)
  return { status: res.status, json: await res.json().catch(() => null) }
}
function camillaPids() {
  try {
    return execFileSync('pgrep', ['-f', `port ${CDSP_PORT}`], { encoding: 'utf8' })
      .split('\n').map((s) => s.trim()).filter(Boolean)
  } catch {
    return []
  }
}
function anyCamilla() {
  try {
    return execFileSync('pgrep', ['-x', 'camilladsp'], { encoding: 'utf8' })
      .split('\n').map((s) => s.trim()).filter(Boolean)
  } catch {
    return []
  }
}

// ── preflight ────────────────────────────────────────────────────────────────
if (!existsSync(BRAVE)) fail(`Brave not found at ${BRAVE} (no chromium-family browser for playwright-core)`)
if (!existsSync(join(ROOT, 'packages', 'ui', 'dist', 'index.html'))) {
  fail('packages/ui/dist/index.html missing — run `npm run build` first')
}
if (!existsSync(CAMILLADSP)) skip(`camilladsp not found at ${CAMILLADSP}`)
if (!existsSync(SWITCHAUDIO)) skip(`SwitchAudioSource not found at ${SWITCHAUDIO}`)

let deviceList = []
try {
  deviceList = execFileSync(SWITCHAUDIO, ['-a', '-t', 'output'], { encoding: 'utf8' })
    .split('\n').map((s) => s.trim()).filter(Boolean)
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
if (camillaPids().length > 0) skip(`a camilladsp already owns port ${CDSP_PORT}`)

console.log(`ToneDeck UI smoke — http ${HTTP_PORT}, cdsp ${CDSP_PORT}, playback "${SAFE_DEVICE}", Brave headless`)

const dataDir = mkdtempSync(join(tmpdir(), 'tonedeck-ui-smoke-'))
// Seed device resolution so engage is deterministic regardless of system output.
writeFileSync(
  join(dataDir, 'state.json'),
  JSON.stringify({ engaged: false, activePreset: null, lastRealOutput: SAFE_DEVICE, bypass: false }),
)

let server = null
let browser = null
let previewCount = 0

try {
  await step('build + listen daemon (serves built UI, deviceSwitching off)', async () => {
    server = await buildServer({ dataDir, cdspPort: CDSP_PORT, deviceSwitching: false })
    // Count preview POSTs at the wire (set BEFORE listen).
    server.addHook('onRequest', (req, _reply, done) => {
      if (req.method === 'POST' && req.url === '/api/preview') previewCount++
      done()
    })
    await server.listen({ host: '127.0.0.1', port: HTTP_PORT })
    const h = await get('/api/health')
    assert(h.status === 200, `health ${h.status}`)
    return 'listening'
  })

  let page = null
  await step('launch Brave + load app (title contains ToneDeck)', async () => {
    browser = await chromium.launch({ executablePath: BRAVE, headless: true })
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    page = await ctx.newPage()
    await page.goto(BASE + '/', { waitUntil: 'networkidle' })
    const title = await page.title()
    assert(/ToneDeck/i.test(title), `title "${title}" missing ToneDeck`)
    return `title "${title}"`
  })

  await step('grid renders 17 cards (16 albums + add)', async () => {
    await page.waitForSelector('.grid .card', { timeout: 8000 })
    const count = await page.locator('.grid .card').count()
    assert(count === 17, `expected 17 cards, got ${count}`)
    return `${count} cards`
  })

  await step('click MBDTF card → engaged:true, activePreset:mbdtf, camilladsp on 12346', async () => {
    await page.click('[aria-label="Apply My Beautiful Dark Twisted Fantasy"]')
    let s = null
    for (let i = 0; i < 60; i++) {
      s = (await get('/api/status')).json
      if (s?.engaged && s?.activePreset === 'mbdtf') break
      await sleep(250)
    }
    assert(s?.engaged === true, `engaged=${s?.engaged}`)
    assert(s?.activePreset === 'mbdtf', `activePreset=${s?.activePreset}`)
    const pids = camillaPids()
    assert(pids.length === 1, `expected 1 camilladsp on ${CDSP_PORT}, got ${pids.length}`)
    await page.waitForSelector('.card--active', { timeout: 3000 })
    await page.screenshot({ path: SHOTS.grid })
    return `engaged; camilladsp pid=${pids[0]}`
  })

  await step('open drawer on active card → canvas present with non-zero size', async () => {
    await page.click('.card--active .card__tune')
    await page.waitForSelector('.drawer .eq-canvas canvas', { timeout: 4000 })
    const box = await page.locator('.drawer .eq-canvas canvas').boundingBox()
    assert(box && box.width > 0 && box.height > 0, `canvas size ${JSON.stringify(box)}`)
    await sleep(350) // let the slide-in animation settle before capture
    await page.screenshot({ path: SHOTS.drawer })
    return `canvas ${Math.round(box.width)}×${Math.round(box.height)}`
  })

  await step('drag Warmth +1 → POST /api/preview hits daemon within 1.5s', async () => {
    const before = previewCount
    await page.$eval('input[aria-label="Warmth"]', (el) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(el, '1')
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
    })
    let hit = false
    for (let i = 0; i < 15; i++) {
      if (previewCount > before) {
        hit = true
        break
      }
      await sleep(100)
    }
    assert(hit, `no /api/preview within 1.5s (count ${before}→${previewCount})`)
    return `preview count ${before}→${previewCount}`
  })

  await step('click PANIC → engaged:false, no camilladsp', async () => {
    // Close the drawer backdrop first so PANIC is reachable, then click it.
    await page.keyboard.press('Escape').catch(() => {})
    await page.click('.drawer-backdrop', { timeout: 1500 }).catch(() => {})
    await page.click('button.btn--danger')
    let s = null
    for (let i = 0; i < 40; i++) {
      s = (await get('/api/status')).json
      if (s && s.engaged === false) break
      await sleep(200)
    }
    assert(s?.engaged === false, `engaged=${s?.engaged} after panic`)
    await sleep(400)
    assert(camillaPids().length === 0, `camilladsp still on ${CDSP_PORT}: ${camillaPids()}`)
    await page.screenshot({ path: SHOTS.panic })
    return 'panicked; no camilladsp'
  })
} catch {
  // step() already printed the failing row.
} finally {
  try {
    if (browser) await browser.close()
  } catch {
    /* ignore */
  }
  try {
    if (server) await server.close()
  } catch {
    /* ignore */
  }
  // Belt-and-suspenders: kill only OUR camilladsp.
  try {
    execFileSync('pkill', ['-f', `port ${CDSP_PORT}`])
  } catch {
    /* none left */
  }
  await sleep(300)
  try {
    rmSync(dataDir, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
}

// ── summary ──────────────────────────────────────────────────────────────────
console.log('\n  RESULT TABLE')
console.log('  ' + '-'.repeat(64))
for (const r of rows) console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.name}`)
console.log('  ' + '-'.repeat(64))
console.log(`  screenshots: ${SHOTS.grid}, ${SHOTS.drawer}, ${SHOTS.panic}`)
const leftover = anyCamilla()
console.log(`  pgrep -x camilladsp after cleanup: ${leftover.length === 0 ? 'EMPTY (clean)' : leftover.join(', ')}`)
if (leftover.length > 0) anyFailed = true

console.log('')
console.log(anyFailed ? 'RESULT: FAIL' : 'RESULT: PASS')
process.exit(anyFailed ? 1 : 0)

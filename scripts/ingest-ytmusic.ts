#!/usr/bin/env tsx
/**
 * Ingest the user's YouTube Music "Liked songs" into the catalog. Opens Brave
 * (headed) via playwright-core with a persisted user-data dir so the Google
 * login is one-time. Run: npm run ingest:ytmusic
 *
 * First run: a browser window opens at the Liked-songs playlist. Log in if
 * prompted, then return to this terminal and press Enter to start scraping.
 */
import { chromium, type BrowserContext } from 'playwright-core'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { parseYtMusicRows } from '@tonedeck/shared'
import { addToCatalog } from './lib/catalog-io.js'

const BRAVE = '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'
const USER_DATA = join(homedir(), '.tonedeck', 'ytmusic-profile')
const LIKED_URL = 'https://music.youtube.com/playlist?list=LM'

function waitForEnter(prompt: string): Promise<void> {
  return new Promise((resolve) => {
    process.stdout.write(prompt)
    process.stdin.resume()
    process.stdin.once('data', () => {
      process.stdin.pause()
      resolve()
    })
  })
}

async function scrapeRows(
  ctx: BrowserContext,
): Promise<Array<{ title?: string; artist?: string; album?: string }>> {
  const page = ctx.pages()[0] ?? (await ctx.newPage())
  await page.goto(LIKED_URL, { waitUntil: 'domcontentloaded' })
  await page.screenshot({ path: '/tmp/tonedeck-ytmusic-1-loaded.png' })

  // Scroll the virtualized list until the row count stops growing.
  let prev = -1
  for (let i = 0; i < 60; i++) {
    const count = await page.locator('ytmusic-responsive-list-item-renderer').count()
    if (count === prev) break
    prev = count
    await page.mouse.wheel(0, 4000)
    await page.waitForTimeout(700)
  }
  await page.screenshot({ path: '/tmp/tonedeck-ytmusic-2-scrolled.png' })

  // Each row: first .title = song; the byline (artist • album • duration) lives
  // in the secondary flex column.
  return page.$$eval('ytmusic-responsive-list-item-renderer', (rows) =>
    rows.map((row) => {
      const title = row.querySelector('.title')?.textContent?.trim() || undefined
      const byline = row.querySelector('.secondary-flex-columns')?.textContent?.trim() || ''
      const artist = byline.split('•')[0]?.trim() || undefined
      const album = byline.split('•')[1]?.trim() || undefined
      return { title, artist, album }
    }),
  )
}

async function main(): Promise<void> {
  const ctx = await chromium.launchPersistentContext(USER_DATA, {
    executablePath: BRAVE,
    headless: false,
    viewport: { width: 1280, height: 900 },
  })
  try {
    const page = ctx.pages()[0] ?? (await ctx.newPage())
    await page.goto(LIKED_URL, { waitUntil: 'domcontentloaded' })
    await waitForEnter('\nLog in if prompted, then press Enter here to scrape… ')
    const rows = await scrapeRows(ctx)
    const entries = parseYtMusicRows(rows)
    if (entries.length === 0) {
      console.log('no rows scraped — check /tmp/tonedeck-ytmusic-*.png; selectors may have changed')
      return
    }
    const merged = await addToCatalog(entries)
    console.log(`ingested ${entries.length} YouTube Music Liked songs; catalog now ${merged.length} entries`)
  } finally {
    await ctx.close()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

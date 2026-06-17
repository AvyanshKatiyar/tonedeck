#!/usr/bin/env tsx
/**
 * Ingest the user's Apple Music Loved/favorited tracks into the catalog via
 * osascript. Property name `favorited` verified 2026-06-16 (`loved` is dead).
 * No login. Run: npm run ingest:apple
 */
import { execFile } from 'node:child_process'
import { parseAppleLoved } from '@tonedeck/shared'
import { addToCatalog } from './lib/catalog-io.js'

// Emit one `title<TAB>artist<TAB>album` line per loved track.
const SCRIPT = `
if application "Music" is running then
  tell application "Music"
    set out to ""
    repeat with t in (every track of playlist "Library" whose favorited is true)
      set out to out & (name of t) & tab & (artist of t) & tab & (album of t) & linefeed
    end repeat
    return out
  end tell
else
  return ""
end if`

function runOsascript(script: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('osascript', ['-e', script], { timeout: 60000, maxBuffer: 1 << 22 }, (err, stdout) =>
      err ? reject(err) : resolve(stdout.toString()),
    )
  })
}

async function main(): Promise<void> {
  const raw = await runOsascript(SCRIPT)
  const entries = parseAppleLoved(raw)
  if (entries.length === 0) {
    console.log('no Loved songs found (is Music.app open and are any tracks favorited?)')
    return
  }
  const merged = await addToCatalog(entries)
  console.log(`ingested ${entries.length} Apple Loved songs; catalog now ${merged.length} entries`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

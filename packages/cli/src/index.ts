#!/usr/bin/env node
/**
 * tonedeck CLI — thin commander wiring over the daemon REST API.
 *
 * Exit codes:
 *   0  success
 *   1  daemon unreachable / network error
 *   2  user error (unknown slug, bad args, invalid preset)
 *   3  daemon refused (not_engaged, rejected, upstream failure)
 */

import { Command } from 'commander'
import { CliError, makeCtx, type FetchFn } from './api.js'
import {
  actionStatus,
  actionList,
  actionClusters,
  actionShow,
  actionVersions,
  actionRevert,
  actionApply,
  actionOn,
  actionOff,
  actionPanic,
  actionBypass,
  actionCreate,
  actionTweak,
  actionDelete,
  actionPreview,
  actionMeters,
  actionArt,
  actionDoctor,
  actionHealth,
  actionAuto,
} from './commands.js'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function collectStr(val: string, prev: string[]): string[] {
  return [...prev, val]
}

function collectNum(val: string, prev: number[]): number[] {
  const n = parseFloat(val)
  if (isNaN(n)) throw new CliError(`Expected a number, got "${val}"`, 2)
  return [...prev, n]
}

/** Wrap an async action: catch CliError → print + exit, rethrow others. */
function wrap(
  jsonGetter: () => boolean,
  action: () => Promise<void>,
): () => void {
  return () => {
    action().catch((err) => {
      const json = jsonGetter()
      if (err instanceof CliError) {
        if (json) {
          console.log(JSON.stringify({ error: err.message, code: err.exitCode }))
        } else {
          console.error(`error: ${err.message}`)
        }
        process.exit(err.exitCode)
      }
      throw err
    })
  }
}

// ─── Program ──────────────────────────────────────────────────────────────────

const program = new Command()

program
  .name('tonedeck')
  .description('Per-album EQ for macOS via CamillaDSP')
  .version('0.1.0')
  .option(
    '--url <url>',
    'Daemon base URL',
    process.env.TONEDECK_URL ??
      `http://127.0.0.1:${process.env.TONEDECK_PORT ?? 5055}`,
  )
  .option('--json', 'Machine-friendly JSON output (one object per stdout line)')
  .addHelpText(
    'after',
    `
Exit codes:
  0  success
  1  daemon unreachable / network error
  2  user error (unknown slug, bad args, invalid preset)
  3  daemon refused (not_engaged, 409/422/502)
`,
  )

function ctx(fetchFn?: FetchFn) {
  const opts = program.opts<{ url: string; json: boolean }>()
  return makeCtx(opts.url, fetchFn)
}
function isJson() {
  return program.opts<{ json: boolean }>().json ?? false
}

// ─── Commands ─────────────────────────────────────────────────────────────────

program
  .command('status')
  .description('Show daemon + DSP state')
  .action(wrap(isJson, () => actionStatus(ctx(), { json: isJson() })))

program
  .command('list')
  .description('List all presets')
  .action(wrap(isJson, () => actionList(ctx(), { json: isJson() })))

program
  .command('clusters')
  .description('Group presets by tone-only EQ shape; show the dB variance that splits them')
  .option('--threshold <db>', 'RMS dB distance to split clusters (default 1.5)', parseFloat)
  .action((cmdOpts: { threshold?: number }) =>
    wrap(isJson, () => actionClusters(ctx(), { json: isJson(), threshold: cmdOpts.threshold }))(),
  )

program
  .command('show <slug>')
  .description('Show preset detail (bands, provenance history)')
  .action((slug: string) => wrap(isJson, () => actionShow(slug, ctx(), { json: isJson() }))())

program
  .command('apply <slug>')
  .description('Apply a preset (POST /api/presets/:slug/apply)')
  .option('--no-engage', 'Do not engage if not already engaged')
  .action((slug: string, cmdOpts: { engage: boolean }) =>
    wrap(isJson, () =>
      actionApply(slug, ctx(), { json: isJson(), engage: cmdOpts.engage }),
    )(),
  )

program
  .command('on [slug]')
  .description('Engage the DSP (optionally with a preset slug)')
  .action((slug?: string) =>
    wrap(isJson, () => actionOn(ctx(), { json: isJson(), preset: slug }))(),
  )

program
  .command('off')
  .description('Disengage the DSP')
  .action(wrap(isJson, () => actionOff(ctx(), { json: isJson() })))

program
  .command('panic')
  .description('Emergency DSP teardown (always succeeds)')
  .action(wrap(isJson, () => actionPanic(ctx(), { json: isJson() })))

program
  .command('bypass <state>')
  .description('Set bypass on/off')
  .action((state: string) => {
    if (state !== 'on' && state !== 'off') {
      console.error('error: bypass state must be "on" or "off"')
      process.exit(2)
    }
    wrap(isJson, () => actionBypass(state, ctx(), { json: isJson() }))()
  })

program
  .command('create')
  .description('Create a preset from JSON file or stdin')
  .requiredOption('--from-json <file>', 'JSON file path or "-" for stdin')
  .option('--no-clamp', 'Do not clamp gain values to profile limits')
  .option('--no-auto-trim', 'Do not auto-trim silent bands')
  .option('--apply', 'Apply (without engage) after creating')
  .action((cmdOpts: { fromJson: string; clamp: boolean; autoTrim: boolean; apply: boolean }) =>
    wrap(isJson, () =>
      actionCreate(ctx(), {
        json: isJson(),
        fromJson: cmdOpts.fromJson,
        clamp: cmdOpts.clamp,
        autoTrim: cmdOpts.autoTrim,
        apply: cmdOpts.apply,
      }),
    )(),
  )

program
  .command('tweak <slug>')
  .description('Adjust a preset with vibes or direct band edits')
  .option('--band <id>', 'Band ID to edit (repeatable)', collectStr, [] as string[])
  .option('--gain <db>', 'Gain (dB) for the corresponding --band', collectNum, [] as number[])
  .option('--q <q>', 'Q factor for the corresponding --band', collectNum, [] as number[])
  .option('--freq <hz>', 'Frequency (Hz) for the corresponding --band', collectNum, [] as number[])
  .option(
    '--vibe <name=delta>',
    'Apply a named vibe at a step value (e.g. warmth=1)',
    collectStr,
    [] as string[],
  )
  .option('--reason <text>', 'Reason recorded in provenance history')
  .option('--apply', 'Apply (without engage) after updating')
  .action(
    (
      slug: string,
      cmdOpts: {
        band: string[]
        gain: number[]
        q: number[]
        freq: number[]
        vibe: string[]
        reason?: string
        apply: boolean
      },
    ) =>
      wrap(isJson, () =>
        actionTweak(slug, ctx(), {
          json: isJson(),
          bands: cmdOpts.band,
          gains: cmdOpts.gain,
          qs: cmdOpts.q,
          freqs: cmdOpts.freq,
          vibes: cmdOpts.vibe,
          reason: cmdOpts.reason ?? '',
          apply: cmdOpts.apply,
        }),
      )(),
  )

program
  .command('versions <slug>')
  .description('List saved versions of a preset')
  .action((slug: string) => wrap(isJson, () => actionVersions(slug, ctx(), { json: isJson() }))())

program
  .command('revert <slug>')
  .description('Restore a previous version (default: undo the last saved change)')
  .option('--original', 'Restore the original (v1 / factory builtin) values')
  .option('--to <version>', 'Restore a specific saved version', (v: string) => Number(v))
  .option('--reason <text>', 'Reason recorded in provenance history')
  .option('--apply', 'Apply (without engage) after reverting')
  .action(
    (slug: string, cmdOpts: { original?: boolean; to?: number; reason?: string; apply?: boolean }) =>
      wrap(isJson, () =>
        actionRevert(slug, ctx(), {
          json: isJson(),
          original: cmdOpts.original ?? false,
          to: cmdOpts.to,
          reason: cmdOpts.reason,
          apply: cmdOpts.apply ?? false,
        }),
      )(),
  )

program
  .command('delete <slug>')
  .description('Delete a preset')
  .option('-y, --yes', 'Skip confirmation prompt')
  .action((slug: string, cmdOpts: { yes: boolean }) =>
    wrap(isJson, () =>
      actionDelete(slug, ctx(), { json: isJson(), yes: cmdOpts.yes }),
    )(),
  )

program
  .command('preview')
  .description('Preview a preset ephemerallyvia the DSP (must be engaged)')
  .requiredOption('--from-json <file>', 'JSON file path or "-" for stdin')
  .action((cmdOpts: { fromJson: string }) =>
    wrap(isJson, () => actionPreview(ctx(), { json: isJson(), fromJson: cmdOpts.fromJson }))(),
  )

program
  .command('meters')
  .description('Show live meter data from the DSP')
  .option('--watch', 'Stream lines until Ctrl-C or --seconds elapsed')
  .option('--seconds <n>', 'Stop after N seconds (with --watch)', parseFloat)
  .action((cmdOpts: { watch: boolean; seconds?: number }) =>
    wrap(isJson, () =>
      actionMeters(ctx(), {
        json: isJson(),
        watch: cmdOpts.watch ?? false,
        seconds: cmdOpts.seconds ?? 0,
      }),
    )(),
  )

program
  .command('art <slug>')
  .description("Show a preset's artwork metadata and cache status")
  .action((slug: string) =>
    wrap(isJson, () => actionArt(slug, ctx(), { json: isJson() }))(),
  )

program
  .command('doctor')
  .description('Run system health checks')
  .action(wrap(isJson, () => actionDoctor(ctx(), { json: isJson() })))

program
  .command('health')
  .description('Check daemon reachability (alias for first doctor check)')
  .action(wrap(isJson, () => actionHealth(ctx(), { json: isJson() })))

program
  .command('auto [state]')
  .description('Follow Apple Music and auto-EQ each track (on|off|status)')
  .option('--now', 'Tune the currently playing track immediately')
  .action((state: string | undefined, cmdOpts: { now?: boolean }) =>
    wrap(isJson, () => actionAuto(ctx(), state, { json: isJson(), now: cmdOpts.now }))(),
  )

program.parse()

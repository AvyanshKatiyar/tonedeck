---
topics: [install, stack, flows]
files: [scripts/install.sh, RECOVERY.md]
---

# Install

`scripts/install.sh` is an idempotent macOS installer for ToneDeck. It sets up the LaunchAgent daemon, CLI symlinks, and the [[claude-skill]] registration. The script can be run multiple times safely; it overwrites any existing plist and symlinks.

## Prerequisites

The installer requires:
- Node.js ≥ 22
- Homebrew (used for the `$(brew --prefix)/bin/` symlink target)
- The CamillaDSP binary at a known path (checked during install)
- BlackHole 2ch virtual audio device installed (available from Existential Audio)
- SwitchAudioSource (a Homebrew-installable CLI tool for programmatic CoreAudio routing)

## LaunchAgent plist

The installer generates `~/Library/LaunchAgents/com.tonedeck.daemon.plist` at install time with the resolved absolute paths to `node` and the repo root. Generating at install time rather than shipping a static plist avoids "binary not found" failures from path differences across machines.

**Critical flag: `AbandonProcessGroup=true`**

This plist key causes launchd to orphan child processes when the daemon exits, rather than sending SIGTERM to the entire process group. The effect: when the daemon is stopped or restarted (e.g., via `launchctl kickstart`), the CamillaDSP child process survives. Audio playback with EQ applied continues uninterrupted across daemon restarts. On the next daemon startup, [[lifecycle]] reconciles with the still-running CamillaDSP process.

Without `AbandonProcessGroup=true`, every daemon restart would kill CamillaDSP and cause an audible dropout.

## CLI and panic script

The installer creates two symlinks in `$(brew --prefix)/bin/`:
- `tonedeck` → the CLI binary (`packages/cli/dist/index.js`)
- `tonedeck-panic` → a minimal shell script that kills the CamillaDSP process via `pkill` without requiring the daemon to be running

`tonedeck-panic` is the recovery tool of last resort — documented in `RECOVERY.md`. It requires no daemon, no Node.js runtime at invocation, and exits 0 even if no CamillaDSP process is found.

## Claude Code skill registration

The installer registers `skill/tonedeck-eq/SKILL.md` as a Claude Code tool so it appears in Claude Code's skill list. The exact mechanism depends on the Claude Code version's skill registration API; the installer uses the `claude` CLI to register the skill path.

## Recovery paths

`RECOVERY.md` documents three recovery scenarios:
1. **Panic** — `tonedeck-panic` from any terminal; no daemon required.
2. **Manual audio reset** — System Settings → Sound → Output → switch away from BlackHole manually.
3. **Daemon restart** — `launchctl kickstart -k gui/$UID/com.tonedeck.daemon`.

Log paths: `~/.tonedeck/logs/camilladsp.log` (CamillaDSP stderr), and the daemon's own stdout/stderr captured by launchd to `~/Library/Logs/tonedeck/`.

#!/bin/zsh
# install.sh — ToneDeck cutover installer.
# Idempotent. Each step is echoed. Supports --dry-run (prints what WOULD run,
# executes nothing). Pass --no-build to skip npm install + build.
#
# Never touches unrelated audio tooling (e.g. a CamillaGUI LaunchAgent).
# The plist is GENERATED here (not shipped) so node/repo paths resolve on the
# installing machine. Homebrew prefix is detected (Apple Silicon vs Intel).
#
# Usage:
#   ./scripts/install.sh              # live install
#   ./scripts/install.sh --dry-run    # preview without executing
#   ./scripts/install.sh --no-build   # skip npm steps (already built)

set -euo pipefail

# ── flags ─────────────────────────────────────────────────────────────────────
DRY_RUN=0
NO_BUILD=0
for arg in "$@"; do
  case "$arg" in
    --dry-run)  DRY_RUN=1 ;;
    --no-build) NO_BUILD=1 ;;
    *)
      print -u2 "Unknown flag: $arg (valid: --dry-run, --no-build)"
      exit 2
      ;;
  esac
done

# ── paths ─────────────────────────────────────────────────────────────────────
SCRIPT_DIR="${0:A:h}"
REPO_ROOT="${SCRIPT_DIR:h}"
DAEMON_DIST="${REPO_ROOT}/packages/daemon/dist/index.js"
CLI_DIST="${REPO_ROOT}/packages/cli/dist/index.js"
PANIC_SRC="${SCRIPT_DIR}/tonedeck-panic"
PLIST_LABEL="com.tonedeck.daemon"
PLIST_DEST="${HOME}/Library/LaunchAgents/${PLIST_LABEL}.plist"
# Pre-rename install of this project (cleaned up if present).
OLD_LABEL="com.avyansh.tonedeck.daemon"
OLD_PLIST="${HOME}/Library/LaunchAgents/${OLD_LABEL}.plist"
# Optional migration from the legacy FT1 Pro shell-script switcher (no-op elsewhere).
LEGACY_PLIST="${HOME}/Library/LaunchAgents/com.avyansh.ft1pro.album-switcher.plist"
LEGACY_LABEL="com.avyansh.ft1pro.album-switcher"
BIN_DIR="$( [[ -d /opt/homebrew/bin ]] && print /opt/homebrew/bin || print /usr/local/bin )"
DATA_DIR="${TONEDECK_DATA_DIR:-${HOME}/.tonedeck}"
STATE_FILE="${DATA_DIR}/state.json"
LEGACY_OUTPUT_FILE="${HOME}/camilladsp/last-real-output.txt"
NODE="$(command -v node || print "${BIN_DIR}/node")"

# ── helpers ───────────────────────────────────────────────────────────────────
step() { print -P "\n%F{cyan}[install] $*%f" }
run() {
  if (( DRY_RUN )); then
    print -P "  %F{yellow}DRY-RUN:%f $*"
  else
    eval "$*"
  fi
}
service_loaded() {
  launchctl print "gui/$(id -u)/$1" &>/dev/null
}

print ""
print "ToneDeck install.sh"
print "  REPO_ROOT : ${REPO_ROOT}"
print "  DATA_DIR  : ${DATA_DIR}"
(( DRY_RUN )) && print "  MODE      : DRY-RUN (nothing will be executed)"

# ── Step 1: npm install + build ───────────────────────────────────────────────
step "1. Build"
if (( NO_BUILD )); then
  print "  --no-build: skipping npm install + build"
else
  run "cd '${REPO_ROOT}' && npm install"
  run "cd '${REPO_ROOT}' && npm run build"
fi

# ── Step 2: mkdir -p ~/.tonedeck/logs ─────────────────────────────────────────
step "2. Create data directories"
run "mkdir -p '${DATA_DIR}/logs'"
print "  ${DATA_DIR}/logs"

# ── Step 3: Seed state.json from legacy last-real-output.txt (if missing) ─────
step "3. Seed state.json"
if [[ ! -f "${STATE_FILE}" ]] || (( DRY_RUN )); then
  if [[ -f "${LEGACY_OUTPUT_FILE}" ]]; then
    LAST_OUTPUT=$(< "${LEGACY_OUTPUT_FILE}")
    # Strip only newline/carriage-return, not spaces (device names can have spaces)
    LAST_OUTPUT="${LAST_OUTPUT//[$'\t\r\n']}"
    print "  seeding lastRealOutput='${LAST_OUTPUT}' from ${LEGACY_OUTPUT_FILE}"
    run "python3 -c \"
import json, os
state = {'engaged': False, 'activePreset': None, 'lastRealOutput': '${LAST_OUTPUT}', 'bypass': False}
os.makedirs('${DATA_DIR}', exist_ok=True)
with open('${STATE_FILE}', 'w') as f:
    json.dump(state, f)
print('  written: ${STATE_FILE}')
\""
  else
    print "  no legacy output file at ${LEGACY_OUTPUT_FILE} — skipping seed (state.json will be created on first run)"
  fi
else
  print "  state.json already exists — skipping seed"
fi

# ── Step 4: Install CLI wrapper to /opt/homebrew/bin/tonedeck ─────────────────
step "4. Install CLI wrapper"
CLI_WRAPPER="${BIN_DIR}/tonedeck"
print "  writing wrapper: ${CLI_WRAPPER}"
run "print '#!/bin/zsh\nexec ${NODE} ${CLI_DIST} \"\$@\"' > '${CLI_WRAPPER}'"
run "chmod +x '${CLI_WRAPPER}'"

# ── Step 5: Install tonedeck-panic to /opt/homebrew/bin/ ──────────────────────
step "5. Install tonedeck-panic"
PANIC_DEST="${BIN_DIR}/tonedeck-panic"
print "  copying: ${PANIC_SRC} → ${PANIC_DEST}"
run "cp '${PANIC_SRC}' '${PANIC_DEST}'"
run "chmod +x '${PANIC_DEST}'"

# ── Step 6: Install skill ──────────────────────────────────────────────────────
step "6. Install Claude Code skill"
run "'${SCRIPT_DIR}/install-skill.sh'"

# ── Step 7: Boot out anything else holding port 5055 ─────────────────────────
step "7. Clear port 5055 occupants"
if service_loaded "${LEGACY_LABEL}" || (( DRY_RUN )); then
  print "  booting out ${LEGACY_LABEL} (legacy switcher — frees port 5055)"
  run "launchctl bootout 'gui/$(id -u)' '${LEGACY_PLIST}' 2>/dev/null || true"
else
  print "  no legacy switcher loaded — nothing to boot out"
fi
if service_loaded "${OLD_LABEL}"; then
  print "  migrating from old label ${OLD_LABEL}"
  run "launchctl bootout 'gui/$(id -u)' '${OLD_PLIST}' 2>/dev/null || true"
  run "rm -f '${OLD_PLIST}'"
fi

# ── Step 8: Generate + boot daemon LaunchAgent ────────────────────────────────
step "8. Generate and boot ToneDeck daemon LaunchAgent"
print "  generating plist: ${PLIST_DEST}"
print "    node:  ${NODE}"
print "    entry: ${DAEMON_DIST}"
if (( ! DRY_RUN )); then
  cat > "${PLIST_DEST}" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${PLIST_LABEL}</string>

  <key>ProgramArguments</key>
  <array>
    <string>${NODE}</string>
    <string>${DAEMON_DIST}</string>
  </array>

  <key>EnvironmentVariables</key>
  <dict>
    <key>TONEDECK_PORT</key>
    <string>5055</string>
    <key>PATH</key>
    <string>${BIN_DIR}:/usr/bin:/bin</string>
  </dict>

  <key>RunAtLoad</key>
  <true/>

  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>

  <key>ThrottleInterval</key>
  <integer>10</integer>

  <!-- camilladsp is spawned detached and must outlive daemon restarts
       (control plane down must not mean audio down). -->
  <key>AbandonProcessGroup</key>
  <true/>

  <key>StandardOutPath</key>
  <string>${DATA_DIR}/logs/daemon.out.log</string>

  <key>StandardErrorPath</key>
  <string>${DATA_DIR}/logs/daemon.err.log</string>
</dict>
</plist>
PLIST
  plutil -lint "${PLIST_DEST}" >/dev/null
else
  print "  DRY-RUN: would generate plist with the values above"
fi

# Boot out any stale running instance first (idempotent)
if service_loaded "${PLIST_LABEL}" || (( DRY_RUN )); then
  print "  booting out existing instance (idempotent)"
  run "launchctl bootout 'gui/$(id -u)' '${PLIST_DEST}' 2>/dev/null || true"
fi

run "launchctl bootstrap 'gui/$(id -u)' '${PLIST_DEST}'"
run "launchctl kickstart -k 'gui/$(id -u)/${PLIST_LABEL}'"

# ── Step 9: Verification ───────────────────────────────────────────────────────
step "9. Verification"
if (( DRY_RUN )); then
  print "  DRY-RUN: skipping live verification"
  print ""
  print "  When run live, this step will:"
  print "    curl http://127.0.0.1:5055/api/health"
  print "    tonedeck doctor"
  print "    open http://127.0.0.1:5055"
else
  print "  Waiting for daemon to come up..."
  for i in $(seq 1 20); do
    if curl -sf http://127.0.0.1:5055/api/health -o /dev/null 2>/dev/null; then
      print "  daemon health: OK"
      break
    fi
    sleep 1
    (( i == 20 )) && print "  WARNING: daemon did not respond after 20s — check logs at ${DATA_DIR}/logs/"
  done
  print ""
  tonedeck doctor || true
  print ""
  print "  open http://127.0.0.1:5055"
fi

print ""
print "ToneDeck install complete."

#!/bin/zsh
# uninstall.sh — ToneDeck uninstaller.
# Idempotent. Supports --dry-run. Preserves ~/.tonedeck data and the legacy system.
#
# NEVER touches: com.avyansh.ft1pro.camillagui.plist, legacy start/stop-ft1pro-eq.
#
# Usage:
#   ./scripts/uninstall.sh            # live uninstall
#   ./scripts/uninstall.sh --dry-run  # preview without executing

set -euo pipefail

# ── flags ─────────────────────────────────────────────────────────────────────
DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    *)
      print -u2 "Unknown flag: $arg (valid: --dry-run)"
      exit 2
      ;;
  esac
done

# ── paths ─────────────────────────────────────────────────────────────────────
PLIST_LABEL="com.avyansh.tonedeck.daemon"
PLIST_DEST="${HOME}/Library/LaunchAgents/com.avyansh.tonedeck.daemon.plist"
BIN_DIR="/opt/homebrew/bin"
SKILL_LINK="${HOME}/.claude/skills/tonedeck-eq"

# ── helpers ───────────────────────────────────────────────────────────────────
step() { print -P "\n%F{cyan}[uninstall] $*%f" }
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
print "ToneDeck uninstall.sh"
(( DRY_RUN )) && print "  MODE: DRY-RUN (nothing will be executed)"

# ── Step 1: Boot out + remove daemon LaunchAgent ──────────────────────────────
step "1. Stop and remove daemon LaunchAgent"
if service_loaded "${PLIST_LABEL}" || (( DRY_RUN )); then
  print "  booting out ${PLIST_LABEL}"
  run "launchctl bootout 'gui/$(id -u)' '${PLIST_DEST}' 2>/dev/null || true"
else
  print "  ${PLIST_LABEL} not loaded — nothing to boot out"
fi

if [[ -f "${PLIST_DEST}" ]] || (( DRY_RUN )); then
  print "  removing plist: ${PLIST_DEST}"
  run "rm -f '${PLIST_DEST}'"
fi

# ── Step 2: Remove CLI wrapper ─────────────────────────────────────────────────
step "2. Remove CLI wrapper"
if [[ -f "${BIN_DIR}/tonedeck" ]] || (( DRY_RUN )); then
  print "  removing ${BIN_DIR}/tonedeck"
  run "rm -f '${BIN_DIR}/tonedeck'"
fi

# ── Step 3: Remove tonedeck-panic ─────────────────────────────────────────────
step "3. Remove tonedeck-panic"
if [[ -f "${BIN_DIR}/tonedeck-panic" ]] || (( DRY_RUN )); then
  print "  removing ${BIN_DIR}/tonedeck-panic"
  run "rm -f '${BIN_DIR}/tonedeck-panic'"
fi

# ── Step 4: Remove skill symlink ──────────────────────────────────────────────
step "4. Remove Claude Code skill symlink"
if [[ -L "${SKILL_LINK}" ]] || (( DRY_RUN )); then
  print "  removing symlink: ${SKILL_LINK}"
  run "rm -f '${SKILL_LINK}'"
elif [[ -e "${SKILL_LINK}" ]]; then
  print "  WARNING: ${SKILL_LINK} exists but is not a symlink — leaving untouched"
fi

# ── Done ──────────────────────────────────────────────────────────────────────
print ""
print "ToneDeck uninstall complete."
print ""
print "Preserved (untouched):"
print "  ~/.tonedeck/            — all data, state, logs, presets"
print "  ~/camilladsp/           — legacy system (camilladsp config, logs)"
print "  com.avyansh.ft1pro.camillagui.plist — CamillaGUI on :5005 (stays)"
print "  /opt/homebrew/bin/start-ft1pro-eq  — legacy panic path (stays)"
print "  /opt/homebrew/bin/stop-ft1pro-eq   — legacy panic path (stays)"

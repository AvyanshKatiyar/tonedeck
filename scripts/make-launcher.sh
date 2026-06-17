#!/bin/zsh
# make-launcher.sh — generate a double-clickable ToneDeck.app launcher.
#
# The launcher is a tiny macOS .app bundle that, when opened:
#   1. ensures the ToneDeck daemon LaunchAgent is up (kickstarts it if the UI
#      port is dead), then
#   2. opens the UI in a chromeless app-mode window (Chrome → Brave → default
#      browser).
#
# It carries the EQ-faders icon from assets/ToneDeck.icns. Idempotent: re-running
# overwrites the bundle in place.
#
# Usage:
#   ./scripts/make-launcher.sh                 # → ~/Desktop/ToneDeck.app
#   ./scripts/make-launcher.sh /Applications   # → /Applications/ToneDeck.app
#   TONEDECK_LAUNCHER_DIR=~/Desktop ./scripts/make-launcher.sh

set -euo pipefail

SCRIPT_DIR="${0:A:h}"
REPO_ROOT="${SCRIPT_DIR:h}"
ICNS_SRC="${REPO_ROOT}/assets/ToneDeck.icns"

DEST_DIR="${1:-${TONEDECK_LAUNCHER_DIR:-${HOME}/Desktop}}"
APP="${DEST_DIR}/ToneDeck.app"
URL="http://127.0.0.1:5055/"

print "make-launcher: building ${APP}"

rm -rf "${APP}"
mkdir -p "${APP}/Contents/MacOS" "${APP}/Contents/Resources"

# ── launcher executable ───────────────────────────────────────────────────────
cat > "${APP}/Contents/MacOS/ToneDeck" <<'LAUNCHER'
#!/bin/zsh
# ToneDeck launcher — make sure the daemon is serving the UI, then open it
# in a clean app-mode browser window (no tabs, no address bar).
export PATH="/usr/bin:/bin:/usr/sbin:/sbin"

URL="http://127.0.0.1:5055/"
DAEMON="com.tonedeck.daemon"

# 1. If the UI port isn't answering, (re)start the LaunchAgent and wait for it.
if ! curl -sf -o /dev/null --max-time 1 "$URL"; then
  launchctl kickstart "gui/$(id -u)/$DAEMON" 2>/dev/null
  for i in {1..40}; do
    curl -sf -o /dev/null --max-time 1 "$URL" && break
    sleep 0.2
  done
fi

# 2. Open the UI. Prefer a chromeless app window (Chrome → Brave);
#    fall back to the default browser if neither is installed.
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
BRAVE="/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"
if [ -x "$CHROME" ]; then
  "$CHROME" --app="$URL" >/dev/null 2>&1 &
elif [ -x "$BRAVE" ]; then
  "$BRAVE" --app="$URL" >/dev/null 2>&1 &
else
  open "$URL"
fi
LAUNCHER
chmod +x "${APP}/Contents/MacOS/ToneDeck"

# ── icon ──────────────────────────────────────────────────────────────────────
if [[ -f "${ICNS_SRC}" ]]; then
  cp "${ICNS_SRC}" "${APP}/Contents/Resources/ToneDeck.icns"
  ICON_KEY='  <key>CFBundleIconFile</key><string>ToneDeck</string>'
else
  print "make-launcher: WARNING ${ICNS_SRC} missing — bundle will use the generic icon"
  ICON_KEY=''
fi

# ── Info.plist ────────────────────────────────────────────────────────────────
cat > "${APP}/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>ToneDeck</string>
  <key>CFBundleDisplayName</key><string>ToneDeck</string>
  <key>CFBundleIdentifier</key><string>com.tonedeck.launcher</string>
  <key>CFBundleVersion</key><string>1.0</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundleExecutable</key><string>ToneDeck</string>
${ICON_KEY}
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
PLIST

plutil -lint "${APP}/Contents/Info.plist" >/dev/null

# ── refresh Finder's icon/bundle cache ─────────────────────────────────────────
touch "${APP}"
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister \
  -f "${APP}" 2>/dev/null || true

print "make-launcher: done → ${APP}"
print "  Double-click it, or drag it to the Dock / Applications."

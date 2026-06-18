#!/bin/zsh
# make-launcher.sh — generate a double-clickable ToneDeck.app launcher.
#
# The launcher is a real, single-instance macOS .app (a tiny native Cocoa +
# WKWebView host — NOT a browser shortcut). When opened it:
#   1. ensures the ToneDeck daemon LaunchAgent is up (kickstarts it if the UI
#      port is dead), then
#   2. shows the UI in its own app window.
#
# Why native instead of a Chrome `--app=` launcher (the previous design):
#   The old launcher was a zsh script that forked `chrome --app=URL` and exited.
#   macOS therefore never saw "ToneDeck" as a running app, so every Dock/Finder
#   click re-ran the script, and Chrome forwards each `--app=` to the existing
#   profile instance as a BRAND-NEW window. Result: a new window every click.
#   A native app is single-instance for free — LaunchServices activates the
#   running process instead of relaunching, and `applicationShouldHandleReopen`
#   re-shows the window if it was closed. One window, click brings it to front,
#   no duplicates, and no Accessibility/Automation permission prompts.
#
# It carries the EQ-faders icon from assets/ToneDeck.icns. Idempotent: re-running
# overwrites the bundle in place.
#
# Requires the Swift toolchain (ships with the Xcode Command Line Tools).
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

if ! command -v swiftc >/dev/null 2>&1; then
  print -u2 "make-launcher: ERROR swiftc not found."
  print -u2 "  Install the Xcode Command Line Tools, then re-run:"
  print -u2 "    xcode-select --install"
  exit 1
fi

print "make-launcher: building ${APP}"

rm -rf "${APP}"
mkdir -p "${APP}/Contents/MacOS" "${APP}/Contents/Resources"

# ── native launcher source ────────────────────────────────────────────────────
BUILD_DIR="$(mktemp -d)"
trap 'rm -rf "${BUILD_DIR}"' EXIT
SRC="${BUILD_DIR}/ToneDeck.swift"

cat > "${SRC}" <<'SWIFT'
// ToneDeck — native single-instance host for the daemon-served UI.
import Cocoa
import WebKit

let kURL    = "http://127.0.0.1:5055/"
let kHealth = "http://127.0.0.1:5055/api/health"
let kDaemon = "com.tonedeck.daemon"

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate {
    var window: NSWindow!
    var webView: WKWebView!
    var retries = 0

    func applicationDidFinishLaunching(_ note: Notification) {
        buildMenu()
        buildWindow()
        loadUI()
        // Make sure the daemon is serving the UI, off the main thread, then
        // reload once it answers. Keeps the window responsive while it warms up.
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            self?.ensureDaemon()
            DispatchQueue.main.async { self?.loadUI() }
        }
        NSApp.activate(ignoringOtherApps: true)
    }

    func buildWindow() {
        let frame = NSRect(x: 0, y: 0, width: 1180, height: 820)
        window = NSWindow(
            contentRect: frame,
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered, defer: false)
        window.title = "ToneDeck"
        window.minSize = NSSize(width: 760, height: 560)
        window.setFrameAutosaveName("ToneDeckMain")
        if !window.setFrameUsingName("ToneDeckMain") { window.center() }

        webView = WKWebView(frame: frame, configuration: WKWebViewConfiguration())
        webView.navigationDelegate = self
        webView.autoresizingMask = [.width, .height]
        window.contentView = webView
        window.makeKeyAndOrderFront(nil)
    }

    func loadUI() {
        guard let u = URL(string: kURL) else { return }
        webView.load(URLRequest(url: u))
    }

    // MARK: - Daemon readiness (mirrors the old launcher's curl/kickstart loop)
    func ensureDaemon() {
        if portAlive() { return }
        kickstart()
        for _ in 0..<40 {
            if portAlive() { return }
            usleep(200_000) // 0.2s
        }
    }

    func portAlive() -> Bool {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/usr/bin/curl")
        p.arguments = ["-sf", "-o", "/dev/null", "--max-time", "1", kHealth]
        do { try p.run() } catch { return false }
        p.waitUntilExit()
        return p.terminationStatus == 0
    }

    func kickstart() {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/bin/launchctl")
        p.arguments = ["kickstart", "gui/\(getuid())/\(kDaemon)"]
        try? p.run()
        p.waitUntilExit()
    }

    // MARK: - Single-window app lifecycle
    // Dock / Finder click while running: re-show the window if it was closed,
    // then bring it to the front. (When a window is already visible, macOS
    // activates the existing instance on its own — no second window is spawned.)
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag { window.makeKeyAndOrderFront(nil) }
        NSApp.activate(ignoringOtherApps: true)
        return true
    }

    // Keep the app alive after the window is closed so the Dock icon reopens it
    // instead of cold-launching a fresh process.
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        return false
    }

    // MARK: - Initial-load retry while the daemon finishes booting
    func webView(_ wv: WKWebView, didFailProvisionalNavigation nav: WKNavigation!, withError error: Error) {
        guard retries < 25 else { return }
        retries += 1
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { [weak self] in self?.loadUI() }
    }

    func webView(_ wv: WKWebView, didFinish nav: WKNavigation!) { retries = 0 }

    // MARK: - Minimal menu so Cmd-Q and clipboard shortcuts work in the web UI
    func buildMenu() {
        let main = NSMenu()

        let appItem = NSMenuItem()
        main.addItem(appItem)
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "Hide ToneDeck",
                        action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        appMenu.addItem(NSMenuItem.separator())
        appMenu.addItem(withTitle: "Quit ToneDeck",
                        action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu

        let editItem = NSMenuItem()
        main.addItem(editItem)
        let edit = NSMenu(title: "Edit")
        edit.addItem(withTitle: "Cut",        action: #selector(NSText.cut(_:)),       keyEquivalent: "x")
        edit.addItem(withTitle: "Copy",       action: #selector(NSText.copy(_:)),      keyEquivalent: "c")
        edit.addItem(withTitle: "Paste",      action: #selector(NSText.paste(_:)),     keyEquivalent: "v")
        edit.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editItem.submenu = edit

        NSApp.mainMenu = main
    }
}

let app = NSApplication.shared
app.setActivationPolicy(.regular)
let delegate = AppDelegate()
app.delegate = delegate
app.run()
SWIFT

print "make-launcher: compiling native host (swiftc)…"
swiftc -O \
  -target arm64-apple-macos12.0 \
  -framework Cocoa -framework WebKit \
  -o "${APP}/Contents/MacOS/ToneDeck" \
  "${SRC}"

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
  <key>CFBundleVersion</key><string>2.0</string>
  <key>CFBundleShortVersionString</key><string>2.0</string>
  <key>CFBundleExecutable</key><string>ToneDeck</string>
${ICON_KEY}
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>NSPrincipalClass</key><string>NSApplication</string>
  <key>LSMinimumSystemVersion</key><string>12.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSAppTransportSecurity</key>
  <dict>
    <key>NSAllowsLocalNetworking</key><true/>
  </dict>
</dict>
</plist>
PLIST

plutil -lint "${APP}/Contents/Info.plist" >/dev/null

# ── ad-hoc code signature ──────────────────────────────────────────────────────
# Apple Silicon refuses to run unsigned Mach-O bundles; an ad-hoc signature is
# enough for a locally built app.
codesign --force --sign - "${APP}" >/dev/null 2>&1 || \
  print "make-launcher: WARNING ad-hoc codesign failed — app may not launch"

# ── refresh Finder's icon/bundle cache ─────────────────────────────────────────
touch "${APP}"
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister \
  -f "${APP}" 2>/dev/null || true

print "make-launcher: done → ${APP}"
print "  Double-click it, or drag it to the Dock / Applications."

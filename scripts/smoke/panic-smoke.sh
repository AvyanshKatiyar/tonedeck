#!/bin/zsh
# panic-smoke.sh — unit-test tonedeck-panic WITHOUT touching real audio.
#
# Uses a temp dir as TONEDECK_DATA_DIR with a fake state.json, and a shim
# directory containing fake SwitchAudioSource, pkill, pgrep, and curl binaries.
# Real audio devices, camilladsp, and the daemon are never touched.
#
# Test cases:
#   1. lastRealOutput device present in -a list → switch to it directly.
#   2. lastRealOutput NOT in list → fallback to first non-BlackHole line.
#
# Exits 0 on full PASS, 1 on any failure.
#
# Usage: npm run smoke:panic

set -uo pipefail

SCRIPT_DIR="${0:A:h}"
PANIC_SCRIPT="${SCRIPT_DIR:h}/tonedeck-panic"
FAIL=0
PASS_COUNT=0
FAIL_COUNT=0

pass() { print -P "  %F{green}PASS%f  $*"; (( PASS_COUNT++ )); }
fail() { print -P "  %F{red}FAIL%f  $*"; (( FAIL_COUNT++ )); FAIL=1; }

assert_eq() {
  local label="$1" expected="$2" actual="$3"
  if [[ "$actual" == "$expected" ]]; then
    pass "${label}: '${actual}'"
  else
    fail "${label}: expected='${expected}' actual='${actual}'"
  fi
}
assert_log_contains() {
  local label="$1" needle="$2" logfile="$3"
  # Use -- to prevent needle (which may start with -) from being parsed as flags.
  if grep -qF -- "${needle}" "${logfile}" 2>/dev/null; then
    pass "${label}"
  else
    fail "${label}: '${needle}' NOT found in shim log"
    print "  (log: $(cat ${logfile} 2>/dev/null | tr '\n' '|' || echo '<empty>'))"
  fi
}
assert_output_contains() {
  local label="$1" needle="$2" haystack="$3"
  if echo "${haystack}" | grep -qF "${needle}"; then
    pass "${label}"
  else
    fail "${label}: '${needle}' NOT found in script output"
  fi
}
assert_json_field() {
  local label="$1" file="$2" field="$3" expected="$4"
  local actual
  actual=$(python3 -c "import json; d=json.load(open('${file}')); print(str(d.get('${field}', 'MISSING')).lower())" 2>/dev/null || echo "error")
  assert_eq "${label}" "${expected}" "${actual}"
}

print ""
print "tonedeck-panic smoke test"
print "PANIC_SCRIPT: ${PANIC_SCRIPT}"

if [[ ! -x "${PANIC_SCRIPT}" ]]; then
  print "FATAL: panic script not found or not executable at ${PANIC_SCRIPT}"
  exit 1
fi

# ── Build shim directory ───────────────────────────────────────────────────────
SHIM_DIR=$(mktemp -d)
DATA_DIR=$(mktemp -d)
SHIM_LOG="${SHIM_DIR}/calls.log"
touch "${SHIM_LOG}"
export SHIM_LOG

# IMPORTANT: all shim scripts use single-quoted heredocs (<<'SHIM') so that
# $* and "$*" are NOT expanded at write time — they expand at runtime when the
# shim is executed by the panic script. ${SHIM_LOG} IS exported and expands
# at shim runtime from the environment.

# fake curl: exits 7 (connection refused = daemon down), logs the call
cat > "${SHIM_DIR}/curl" <<'SHIM'
#!/bin/zsh
echo "curl $*" >> "${SHIM_LOG}"
exit 7
SHIM
chmod +x "${SHIM_DIR}/curl"

# fake pkill: always succeeds, logs call
cat > "${SHIM_DIR}/pkill" <<'SHIM'
#!/bin/zsh
echo "pkill $*" >> "${SHIM_LOG}"
exit 0
SHIM
chmod +x "${SHIM_DIR}/pkill"

# fake pgrep: no camilladsp running
cat > "${SHIM_DIR}/pgrep" <<'SHIM'
#!/bin/zsh
echo "pgrep $*" >> "${SHIM_LOG}"
exit 1
SHIM
chmod +x "${SHIM_DIR}/pgrep"

# ── Test case 1: device IS in the -a list ─────────────────────────────────────
print "\n--- Test 1: lastRealOutput device present in -a list ---"

python3 -c "
import json
with open('${DATA_DIR}/state.json', 'w') as f:
    json.dump({'engaged': True, 'activePreset': 'mbdtf',
               'lastRealOutput': 'FakeDevice', 'bypass': False}, f)
"

# Single-quoted heredoc: $* and ${SHIM_LOG} expand at shim runtime.
cat > "${SHIM_DIR}/SwitchAudioSource" <<'SHIM'
#!/bin/zsh
echo "SwitchAudioSource $*" >> "${SHIM_LOG}"
case "$*" in
  *"-a"*)
    echo "FakeDevice"
    echo "BlackHole 2ch"
    echo "MacBook Air Speakers"
    ;;
  *"-c"*)
    echo "FakeCurrentDevice"
    ;;
  *"-s"*)
    echo "switched"
    ;;
esac
exit 0
SHIM
chmod +x "${SHIM_DIR}/SwitchAudioSource"

> "${SHIM_LOG}"

OUTPUT=$(TONEDECK_DATA_DIR="${DATA_DIR}" TONEDECK_PORT=5055 \
  PATH="${SHIM_DIR}:/usr/bin:/bin" \
  zsh "${PANIC_SCRIPT}" 2>&1) || true

assert_log_contains "curl attempted" "curl" "${SHIM_LOG}"
assert_log_contains "pkill -x camilladsp called" "pkill -x camilladsp" "${SHIM_LOG}"
assert_log_contains "SwitchAudioSource -s FakeDevice" "-s FakeDevice" "${SHIM_LOG}"
assert_json_field "state.json engaged=false" "${DATA_DIR}/state.json" "engaged" "false"
assert_output_contains "Step 1 in output" "Step 1" "${OUTPUT}"
assert_output_contains "Step 5 in output" "Step 5" "${OUTPUT}"

PANIC_EXIT=0
TONEDECK_DATA_DIR="${DATA_DIR}" TONEDECK_PORT=5055 \
  PATH="${SHIM_DIR}:/usr/bin:/bin" \
  zsh "${PANIC_SCRIPT}" >/dev/null 2>&1 || PANIC_EXIT=$?
assert_eq "exit code 0 (case1)" "0" "${PANIC_EXIT}"

# ── Test case 2: device NOT in list → fallback to first non-BlackHole ─────────
print "\n--- Test 2: lastRealOutput NOT in -a list → fallback ---"

python3 -c "
import json
with open('${DATA_DIR}/state.json', 'w') as f:
    json.dump({'engaged': True, 'activePreset': 'yeezus',
               'lastRealOutput': 'NoSuchDevice', 'bypass': False}, f)
"

# -a list does NOT include NoSuchDevice; first non-BlackHole = MacBook Air Speakers
cat > "${SHIM_DIR}/SwitchAudioSource" <<'SHIM'
#!/bin/zsh
echo "SwitchAudioSource $*" >> "${SHIM_LOG}"
case "$*" in
  *"-a"*)
    echo "BlackHole 2ch"
    echo "MacBook Air Speakers"
    ;;
  *"-c"*)
    echo "MacBook Air Speakers"
    ;;
  *"-s"*)
    echo "switched"
    ;;
esac
exit 0
SHIM
chmod +x "${SHIM_DIR}/SwitchAudioSource"

> "${SHIM_LOG}"

OUTPUT2=$(TONEDECK_DATA_DIR="${DATA_DIR}" TONEDECK_PORT=5055 \
  PATH="${SHIM_DIR}:/usr/bin:/bin" \
  zsh "${PANIC_SCRIPT}" 2>&1) || true

assert_log_contains "fallback -s MacBook Air Speakers" "-s MacBook Air Speakers" "${SHIM_LOG}"
assert_output_contains "warning: device absent" "NOT in device list" "${OUTPUT2}"
assert_json_field "state.json engaged=false (case2)" "${DATA_DIR}/state.json" "engaged" "false"

PANIC_EXIT2=0
TONEDECK_DATA_DIR="${DATA_DIR}" TONEDECK_PORT=5055 \
  PATH="${SHIM_DIR}:/usr/bin:/bin" \
  zsh "${PANIC_SCRIPT}" >/dev/null 2>&1 || PANIC_EXIT2=$?
assert_eq "exit code 0 (case2)" "0" "${PANIC_EXIT2}"

# ── Cleanup ────────────────────────────────────────────────────────────────────
rm -rf "${SHIM_DIR}" "${DATA_DIR}"

# ── Result ────────────────────────────────────────────────────────────────────
print ""
print "${PASS_COUNT} pass, ${FAIL_COUNT} fail"
if (( FAIL == 0 )); then
  print "RESULT: PASS"
  exit 0
else
  print "RESULT: FAIL"
  exit 1
fi

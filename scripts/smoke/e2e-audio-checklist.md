# ToneDeck Cutover — Human Audio Checklist

Run this checklist with the user present, in order. Check each box before proceeding.

## Preconditions

- [ ] FiiO FT1 Pro headphones are plugged in (External Headphones visible in System Settings → Sound)
- [ ] Music is playing through headphones before you start
- [ ] CamillaGUI is running (com.avyansh.ft1pro.camillagui on :5005)
- [ ] Terminal open in `/Users/avyanshkatiyar/Desktop/tonedeck`

---

## Install

- [ ] Run `./scripts/install.sh` — observe output, all steps echo without error
- [ ] Step 7 says "booting out com.avyansh.ft1pro.album-switcher" (or "not loaded")
- [ ] Step 8 boots the new daemon
- [ ] `curl http://127.0.0.1:5055/api/health` returns `{"ok":true,...}`
- [ ] `tonedeck doctor` shows all checks PASS (or known-OK skips)

---

## UI

- [ ] `open http://127.0.0.1:5055` — browser opens, album grid loads, 16+ cards visible
- [ ] Click the **MBDTF** card — card highlights, engaged indicator appears
- [ ] Music now passes through EQ (audible change vs. bypassed)
- [ ] Run `pgrep -x camilladsp` — note the PID

---

## Preset switching (glitch-free)

- [ ] Click 5 different album cards in sequence, listening between each
  - [ ] Preset 1: _______________________
  - [ ] Preset 2: _______________________
  - [ ] Preset 3: _______________________
  - [ ] Preset 4: _______________________
  - [ ] Preset 5: _______________________
- [ ] No audible glitch or dropout during any switch
- [ ] `pgrep -x camilladsp` PID unchanged (same process throughout)

---

## Bypass

- [ ] Click the **Bypass** button (or run `tonedeck bypass --on`) — EQ off, music sounds flat
- [ ] Toggle bypass off — EQ re-engages, sound returns to EQ'd character
- [ ] `pgrep -x camilladsp` PID still unchanged

---

## Vibe slider

- [ ] Open the drawer on the active album card
- [ ] Drag the **Warmth** slider to +2
- [ ] Hear the low-frequency change within 1–2 seconds (live preview)
- [ ] Drag back to 0 — character returns to baseline

---

## Panic

- [ ] Run `tonedeck-panic` in terminal
- [ ] Output: "daemon handled panic" (if daemon responds) AND "camilladsp stopped"
- [ ] Output: "current output device: External Headphones" (or similar real device)
- [ ] Music now plays through headphones directly (no EQ)
- [ ] `pgrep -x camilladsp` returns empty (process gone)
- [ ] `cat ~/.tonedeck/state.json` shows `"engaged": false`

---

## Re-engage

- [ ] `tonedeck on mbdtf` — EQ re-engages
- [ ] Music through EQ again
- [ ] UI shows MBDTF as active if refreshed

---

## Reboot test

- [ ] Reboot the Mac
- [ ] After login, wait ~15 seconds
- [ ] `pgrep -x camilladsp` — should be **empty** (daemon does NOT auto-engage on boot)
- [ ] Music plays through headphones normally (no EQ)
- [ ] `tonedeck doctor` — daemon healthy
- [ ] `cat ~/.tonedeck/state.json` — `"engaged": false`

---

## Claude skill

- [ ] Open Claude Code in this repo (`claude`)
- [ ] Type: `make donda warmer`
- [ ] Claude invokes the tonedeck-eq skill and runs `tonedeck tweak` or `tonedeck create`
- [ ] A preset change is applied; audio character shifts

---

## Sign-off

Tested by: _____________________________  Date: _______________

All boxes checked: [ ] YES  [ ] NO (describe failures below)

Notes:

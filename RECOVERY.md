# ToneDeck Recovery Runbook

## "Audio is broken / wrong device / silence"

Follow these steps in order. Stop at the first one that restores audio.

### Step 1 — tonedeck-panic (fastest)

```sh
tonedeck-panic
```

This kills CamillaDSP, restores the saved real output device (External Headphones or fallback), and clears the engaged flag. Works without the daemon running. Always exits 0.

### Step 2 — Legacy stop-ft1pro-eq

```sh
stop-ft1pro-eq
```

This is the old panic path that predates ToneDeck. Safe to run alongside Step 1. It calls the original Python switcher's stop routine.

### Step 3 — Manual System Settings

1. Open **System Settings → Sound → Output**.
2. Select **External Headphones** (or MacBook Air Speakers if headphones are not connected).
3. Confirm music plays through speakers/headphones.

### Step 4 — Verify output device

```sh
SwitchAudioSource -c -t output
```

Expected: `External Headphones` (or your real output). If it shows `BlackHole 2ch`, repeat Step 1 or Step 3.

### Step 5 — Check daemon logs

```sh
cat ~/.tonedeck/logs/daemon.err.log | tail -40
cat ~/.tonedeck/logs/daemon.out.log | tail -20
tonedeck doctor
```

---

## "UI unreachable but audio is fine"

The daemon may be down. Check:

```sh
launchctl print gui/$(id -u)/com.tonedeck.daemon
tonedeck doctor
```

To restart the daemon:

```sh
launchctl kickstart -k gui/$(id -u)/com.tonedeck.daemon
```

Then reload `http://127.0.0.1:5055`.

---

## "Engaged but silent — BlackHole trap"

This happens when ToneDeck is engaged but no CamillaDSP is running (e.g. after a crash). Output is BlackHole 2ch (the loopback) and no EQ is applied, so audio disappears.

Fix:

```sh
tonedeck-panic        # kills any DSP remnant, restores real output
tonedeck on mbdtf     # or whichever preset you want to re-engage
```

The daemon's `reconcile()` on next boot also auto-clears stale engaged state.

---

## Log locations

| File | Contents |
|---|---|
| `~/.tonedeck/logs/daemon.out.log` | Daemon stdout |
| `~/.tonedeck/logs/daemon.err.log` | Daemon stderr (errors, reconcile output) |
| `~/.tonedeck/state.json` | Current engaged/preset/device state |
| `~/camilladsp/album-switcher.log` | Legacy switcher log (historical) |

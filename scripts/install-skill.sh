#!/bin/zsh
# install-skill.sh — symlink the tonedeck-eq skill into ~/.claude/skills.
#
# Idempotent: re-running is safe. It creates ~/.claude/skills if missing,
# (re)points a symlink named tonedeck-eq at this repo's skill/tonedeck-eq, and
# refuses to clobber a real directory there (tells you to remove it yourself).
#
# Run at cutover (Task K), not before. Nothing here starts audio or the daemon.
set -euo pipefail

# Resolve this repo's skill source dir relative to the script (works from anywhere).
SCRIPT_DIR="${0:A:h}"
SRC="${SCRIPT_DIR:h}/skill/tonedeck-eq"
DEST_DIR="${HOME}/.claude/skills"
DEST="${DEST_DIR}/tonedeck-eq"

if [[ ! -d "$SRC" ]]; then
  print -u2 "error: skill source not found at $SRC"
  exit 1
fi

mkdir -p "$DEST_DIR"

if [[ -L "$DEST" ]]; then
  # Existing symlink — refresh it (covers stale/relocated targets).
  current="$(readlink "$DEST")"
  if [[ "$current" == "$SRC" ]]; then
    print "ok: already linked — $DEST -> $SRC"
  else
    rm "$DEST"
    ln -s "$SRC" "$DEST"
    print "ok: relinked (was $current) — $DEST -> $SRC"
  fi
elif [[ -e "$DEST" ]]; then
  # A real file/dir is in the way — never clobber it.
  print -u2 "error: $DEST exists and is not a symlink."
  print -u2 "       Remove or back it up, then re-run:  rm -rf '$DEST' && $0"
  exit 1
else
  ln -s "$SRC" "$DEST"
  print "ok: linked — $DEST -> $SRC"
fi

# Verification line.
print "verify: $(ls -ld "$DEST" | sed 's/  */ /g')"

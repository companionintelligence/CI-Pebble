#!/usr/bin/env bash
# scripts/emulator-shots.sh: real screenshots of the running app on each Pebble emulator.
#
#   scripts/emulator-shots.sh [outdir] [platform ...]
#   defaults: assets/appstore/screenshots  aplite basalt chalk diorite emery
#
# Needs pebble-tool + SDK (see scripts/build-modern.sh), xvfb, libsdl2. For each platform it
# boots the emulator, installs the build, then captures: 01 main menu, 02 Ask list, 03 an
# answer (pushed as the phone would send it), 04 an error. Nothing is drawn by hand.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$REPO/assets/appstore/screenshots}"; shift || true
PLATFORMS=("${@:-aplite basalt chalk diorite emery}")
read -ra PLATFORMS <<<"${PLATFORMS[*]}"
PY="$(head -1 "$(command -v pebble)" | sed 's/^#!//')"
export DISPLAY="${DISPLAY:-:99}"
pgrep Xvfb >/dev/null || { Xvfb "$DISPLAY" -screen 0 800x600x24 >/dev/null 2>&1 & sleep 2; }

export PBW_WORK="${PBW_WORK:-/tmp/ci-pebble-shots}"
"$REPO/scripts/build-modern.sh" "$PBW_WORK/companion-memory.pbw" >/dev/null
cd "$PBW_WORK/proj"; mkdir -p "$OUT"

ANSWER='- Ada Lovelace: mathematician
- [I wrote, Sep 27, 2026] "Team standup notes"
- [Task:open] Book dentist
+2 more'
ERROR='Key rejected. Paste it again in settings.'

for P in "${PLATFORMS[@]}"; do
  echo "== $P"
  pebble kill >/dev/null 2>&1 || true; pkill -9 -x qemu-pebble 2>/dev/null || true; sleep 2
  timeout 60 pebble install --emulator "$P" >/dev/null 2>&1 || true   # launches QEMU (and a pypkjs we do not want)
  sleep 3; pkill -f 'python -m pypkjs' 2>/dev/null || true            # pypkjs would hold the QEMU channel we need
  PORT="$("$PY" - "$P" <<'PYEOF'
import json, sys
d = json.load(open("/tmp/pb-emulator.json"))[sys.argv[1]]
print(next(iter(d.values()))["qemu"]["port"])
PYEOF
)"
  Q=(--qemu "localhost:$PORT")
  rm -f /tmp/boot.png
  for i in $(seq 1 60); do                                          # wait for firmware boot (boot screen is < 1 KB)
    timeout 30 pebble screenshot "${Q[@]}" /tmp/boot.png >/dev/null 2>&1 || true
    [ "$(stat -c %s /tmp/boot.png 2>/dev/null || echo 0)" -gt 1200 ] && break; sleep 4
  done
  timeout 120 pebble install "${Q[@]}" --platform "$P" >/dev/null 2>&1
  sleep 5
  shot() { timeout 40 pebble screenshot "${Q[@]}" "$OUT/$P-$1.png" >/dev/null 2>&1; echo "  $P-$1.png"; }
  click() { timeout 30 pebble emu-button "${Q[@]}" click "$1" >/dev/null 2>&1; sleep 1.2; }
  shot 01-main-menu
  click down; click select; shot 02-ask
  click back
  timeout 60 "$PY" "$REPO/scripts/pebble-inject.py" "$PORT" "2=$ANSWER"; sleep 2; shot 03-answer
  click back
  timeout 60 "$PY" "$REPO/scripts/pebble-inject.py" "$PORT" "3=$ERROR"; sleep 2; shot 04-error
done
pebble kill >/dev/null 2>&1 || true; pkill -9 -x qemu-pebble 2>/dev/null || true

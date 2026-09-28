#!/usr/bin/env bash
# scripts/build-modern.sh: compile the watch app with the current Pebble SDK.
#
#   scripts/build-modern.sh [output.pbw]     default: build/companion-memory.pbw
#
# The repo keeps the classic appinfo.json layout (src/c, src/js) because that is what
# CloudPebble's GitHub sync reads. The current SDK builds package.json projects, so this
# generates a throwaway one from appinfo.json, compiles for every target platform with the
# SDK's own -Werror flags, and copies the bundle out. Needs `pebble` (uv tool install pebble-tool)
# and an installed SDK (pebble sdk install latest). Prints the work dir on stderr; the build tree
# stays there so scripts/emulator-shots.sh can install from it (set PBW_WORK to reuse one).
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$REPO/build/companion-memory.pbw}"
W="${PBW_WORK:-$(mktemp -d)}"
rm -rf "$W/proj" && mkdir -p "$W"
( cd "$W" && pebble new-project proj >/dev/null )
rm -rf "$W/proj/src" && mkdir -p "$W/proj/src/pkjs"
cp -r "$REPO/src/c" "$W/proj/src/c"
cp "$REPO/src/js/pebble-js-app.js" "$W/proj/src/pkjs/index.js"
python3 - "$REPO/appinfo.json" "$W/proj/package.json" <<'PY'
import json, sys
a = json.load(open(sys.argv[1]))
pkg = {"name": "ci-pebble", "author": a["companyName"], "version": "1.0.0", "keywords": ["pebble-app"],
       "private": True, "dependencies": {},
       "pebble": {"displayName": a["shortName"], "uuid": a["uuid"], "sdkVersion": a["sdkVersion"],
                  "enableMultiJS": True, "targetPlatforms": a["targetPlatforms"], "watchapp": a["watchapp"],
                  "capabilities": a["capabilities"], "messageKeys": list(a["appKeys"].keys()),
                  "resources": a["resources"]}}
json.dump(pkg, open(sys.argv[2], "w"), indent=2)
PY
[ -d "$REPO/resources" ] && cp -r "$REPO/resources" "$W/proj/resources"
( cd "$W/proj" && pebble build )
mkdir -p "$(dirname "$OUT")" && cp "$W/proj/build/proj.pbw" "$OUT"
echo "built $OUT (work dir: $W/proj)" >&2

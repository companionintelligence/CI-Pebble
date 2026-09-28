#!/usr/bin/env bash
# scripts/vendor-brand.sh: pull the pinned CI brand bundle into vendor/brand/ (CONSUMING.md, Route B).
#
#   scripts/vendor-brand.sh [version]     default 1.0.0; needs `gh` with read access to CI-Common
#
# Keeps only the subset this repo uses, then writes SHA256SUMS for it. Re-run
# scripts/sync-brand.mjs afterwards.
set -euo pipefail
VERSION="${1:-1.0.0}"
TAG="@companionintelligence/tokens@${VERSION}"
OUT="$(cd "$(dirname "$0")/.." && pwd)/vendor/brand"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT

gh release download "$TAG" --repo companionintelligence/CI-Common --pattern "ci-brand-${VERSION}.tar.gz*" --dir "$tmp"
( cd "$tmp" && sha256sum -c "ci-brand-${VERSION}.tar.gz.sha256" )
mkdir "$tmp/x" && tar -xzf "$tmp/ci-brand-${VERSION}.tar.gz" -C "$tmp/x" --strip-components=1
( cd "$tmp/x" && sha256sum -c SHA256SUMS --quiet )

keep=(tokens/tokens.css tokens/tokens.json copy.json
      logos/mark.svg logos/mark-tight.svg logos/mark-mono.svg logos/lockup.svg logos/lockup-on-light.svg logos/wordmark.svg logos/app-icon-source.png
      fonts/manrope-latin-var.woff2 fonts/jetbrains-mono-latin-var.woff2 fonts/LICENSE-Manrope.txt fonts/LICENSE-JetBrains-Mono.txt)
rm -rf "$OUT/tokens" "$OUT/logos" "$OUT/fonts" "$OUT/copy.json" "$OUT/SHA256SUMS"
for f in "${keep[@]}"; do mkdir -p "$OUT/$(dirname "$f")"; cp "$tmp/x/$f" "$OUT/$f"; done
echo "$VERSION" > "$OUT/.version"
( cd "$OUT" && printf '%s\n' "${keep[@]}" | sort | xargs sha256sum > SHA256SUMS )
echo "vendored CI brand ${VERSION} into ${OUT}"

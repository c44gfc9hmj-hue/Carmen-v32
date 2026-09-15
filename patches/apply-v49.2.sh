#!/bin/sh
# Apply Carmen v49.2 patches onto a v49.0 tree when the tree has not
# already been updated. Safe to run more than once.
set -eu
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

already() {
  grep -q "49.2-topic-map-retrieval" worker.js 2>/dev/null
}

if already; then
  echo "v49.2 already present in worker.js"
  exit 0
fi

apply_one() {
  f="$1"
  if [ -f "$f" ] && git apply --check "$f"; then
    git apply "$f"
    echo "applied $f"
  elif [ -f "$f" ] && git apply --check --reject "$f"; then
    git apply --reject "$f" || true
    echo "applied with reject $f"
  else
    echo "skip or mismatch $f"
  fi
}

apply_one patches/v49.2-worker.patch
apply_one patches/v49.2-frontend.patch
apply_one patches/v49.2-docs-tests.patch
exit 0

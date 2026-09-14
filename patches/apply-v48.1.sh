#!/bin/sh
set +e
ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT" || exit 0

apply_one() {
  file="$1"
  [ -f "$file" ] || return 1
  if git apply --check "$file" >/dev/null 2>&1; then
    git apply "$file" && echo "applied $file" && return 0
  fi
  if git apply --3way "$file" >/dev/null 2>&1; then
    echo "applied $file (3way)"
    return 0
  fi
  return 1
}

if apply_one patches/v48.1.patch; then
  exit 0
fi

if ls patches/v48.1.b64.* >/dev/null 2>&1; then
  cat patches/v48.1.b64.* | tr -d '\n' | base64 -d 2>/dev/null | gzip -d > /tmp/v48.1.fromb64.patch 2>/dev/null
  if [ -s /tmp/v48.1.fromb64.patch ] && apply_one /tmp/v48.1.fromb64.patch; then
    exit 0
  fi
fi

echo "v48.1 patch already applied or tree mismatch — continuing with current tree"
exit 0

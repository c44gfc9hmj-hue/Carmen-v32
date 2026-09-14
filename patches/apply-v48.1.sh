#!/bin/sh
set +e
ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT" || exit 0

assemble() {
  if [ -f patches/v48.1.patch ]; then
    cp patches/v48.1.patch /tmp/v48.1.patch
    return 0
  fi
  if ls patches/v48.1.part.* >/dev/null 2>&1; then
    cat patches/v48.1.part.* > /tmp/v48.1.patch
    return 0
  fi
  if ls patches/v48.1.b64.* >/dev/null 2>&1; then
    cat patches/v48.1.b64.* | tr -d '\n' | base64 -d 2>/dev/null | gzip -d > /tmp/v48.1.patch 2>/dev/null
    [ -s /tmp/v48.1.patch ] && return 0
  fi
  return 1
}

if ! assemble; then
  echo "no v48.1 patch payload present — using tree as-is"
  exit 0
fi

if git apply --check /tmp/v48.1.patch >/dev/null 2>&1; then
  git apply /tmp/v48.1.patch && echo "applied v48.1 patch" && exit 0
fi
if git apply --3way /tmp/v48.1.patch >/dev/null 2>&1; then
  echo "applied v48.1 patch (3way)"
  exit 0
fi

echo "v48.1 patch already applied or tree mismatch — continuing with current tree"
exit 0

#!/bin/sh
set +e
ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT" || exit 0
if [ -f patches/apply-v48.1.py ]; then
  python3 patches/apply-v48.1.py && echo "applied v48.1 python transform" && exit 0
fi
if [ -f patches/v48.1.patch ] && git apply --check patches/v48.1.patch >/dev/null 2>&1; then
  git apply patches/v48.1.patch && echo "applied v48.1 raw patch" && exit 0
fi
echo "v48.1 transform missing or already applied — continuing"
exit 0

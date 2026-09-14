#!/bin/sh
set +e
ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT" || exit 0
if [ -f patches/apply-v48.1-core.py ]; then
  python3 patches/apply-v48.1-core.py
fi
if [ -f patches/apply-v48.1.py ]; then
  python3 patches/apply-v48.1.py
fi
echo "v48.1 transform step finished"
exit 0

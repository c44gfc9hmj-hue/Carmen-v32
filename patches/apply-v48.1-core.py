#!/usr/bin/env python3
"""v48.1 deploy-time transform.

The v48.1 retrieval, metrics, and focus-mode implementation now lives in
source (worker.js / public/*). This script is kept so older checkouts still
stamp version/build if they somehow still contain the v47.8 strings. It is a
no-op on the current tree.
"""
from pathlib import Path
root = Path(__file__).resolve().parents[1]
def sub(rel, old, new):
    p = root / rel
    s = p.read_text()
    if old in s:
        p.write_text(s.replace(old, new, 1))
        print('patched', rel, old[:48])
    else:
        print('skip', rel, old[:48])

sub('worker.js', "version: '47.8'", "version: '48.1'")
sub('worker.js', "build: '47.8-source-first'", "build: '48.1-direct-lanes'")
sub('public/app.js', "const VERSION = '47.8';", "const VERSION = '48.1';")
print('core done (source-canonical v48.1)')

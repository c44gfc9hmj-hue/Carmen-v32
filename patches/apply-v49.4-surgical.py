#!/usr/bin/env python3
"""Apply v49.4 surgical retrieval / identity fixes if not already present."""
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
DIFF = Path(__file__).with_name("v49.4-surgical.diff")
PLANNER = ROOT / "investigation-planner.js"
WORKER = ROOT / "worker.js"

def main():
    planner = PLANNER.read_text()
    if "export function resolveIdentityAnchor" in planner and "RETRIEVAL_PHASES" in planner and "subsequentRetrievalFromFeedback" in planner:
        worker = WORKER.read_text()
        if "resolveIdentityAnchor" in worker and "phases: ['identity', 'intersection', 'adult']" in worker:
            print("v49.4 surgical retrieval fixes already present")
            return 0
    if not DIFF.exists():
        print("surgical diff not in tree yet — skip (planner/worker unchanged this checkout)")
        return 0
    r = subprocess.run(["git", "apply", "--whitespace=nowarn", str(DIFF)], cwd=str(ROOT), capture_output=True, text=True)
    if r.returncode != 0:
        r2 = subprocess.run(["patch", "-p1", "--forward", "--batch", "-i", str(DIFF)], cwd=str(ROOT), capture_output=True, text=True)
        if r2.returncode != 0:
            sys.stderr.write((r.stderr or "") + (r2.stderr or "") + (r2.stdout or ""))
            return 1
        print("applied v49.4 surgical fixes via patch")
        return 0
    print("applied v49.4 surgical fixes via git apply")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())

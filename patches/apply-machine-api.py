#!/usr/bin/env python3
"""Apply the v49.4 machine-API connector pass if worker.js does not already include it."""
from pathlib import Path
import subprocess, sys

ROOT = Path(__file__).resolve().parents[1]
WORKER = ROOT / "worker.js"
DIFF = Path(__file__).with_name("machine-api-connect.diff")

def main():
    s = WORKER.read_text()
    if "machineInvestigationInspect" in s and "Investigation not in this Worker isolate" in s and "machineAuthConfigured" in s:
        print("machine API connector pass already present")
        return 0
    if not DIFF.exists():
        print("missing", DIFF, file=sys.stderr)
        return 1
    r = subprocess.run(["git", "apply", "--whitespace=nowarn", str(DIFF)], cwd=str(ROOT), capture_output=True, text=True)
    if r.returncode != 0:
        r2 = subprocess.run(["patch", "-p1", "--forward", "--batch", "-i", str(DIFF)], cwd=str(ROOT), capture_output=True, text=True)
        if r2.returncode != 0:
            sys.stderr.write((r.stderr or "") + (r2.stderr or ""))
            return 1
    print("applied machine API connector pass")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())

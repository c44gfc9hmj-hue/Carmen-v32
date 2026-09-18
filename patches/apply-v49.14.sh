#!/bin/sh
set -e
if [ ! -f patches/v49.14-person-image.patch ]; then echo missing patch; exit 1; fi
if grep -q "49.14-person-image-results" investigation-planner.js 2>/dev/null; then echo already applied; exit 0; fi
git apply --whitespace=nowarn patches/v49.14-person-image.patch
echo applied

#!/bin/sh
set -e
cat patches/v48.1.b64.aa patches/v48.1.b64.ab patches/v48.1.b64.ac patches/v48.1.b64.ad | base64 -d | gunzip > /tmp/v48.1.patch
git apply /tmp/v48.1.patch
echo applied v48.1

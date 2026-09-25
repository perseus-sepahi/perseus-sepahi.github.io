#!/usr/bin/env bash
# Mirror the site to a UWaterloo (or any SSH-reachable) personal web space.
#
# Usage:
#   UW_USER=<watiam-id> ./scripts/deploy-uwaterloo.sh
# Optional overrides:
#   UW_HOST  ssh host            (default linux.student.math.uwaterloo.ca)
#   UW_PATH  remote web folder   (default public_html)
#   UW_BASE  URL path prefix     (default /~$UW_USER)
#   UW_URL   public site URL     (default https://www.student.math.uwaterloo.ca$UW_BASE)
#
# The build is regenerated with the university path prefix so every link works under /~userid/.
set -euo pipefail
: "${UW_USER:?set UW_USER to your WatIAM userid}"
UW_HOST="${UW_HOST:-linux.student.math.uwaterloo.ca}"
UW_PATH="${UW_PATH:-public_html}"
UW_BASE="${UW_BASE:-/~$UW_USER}"
UW_URL="${UW_URL:-https://www.student.math.uwaterloo.ca$UW_BASE}"
cd "$(dirname "$0")/.."
node build.js --base "$UW_BASE" --url "$UW_URL" --out dist-uw
rsync -avz --delete --chmod=Du=rwx,Dgo=rx,Fu=rw,Fgo=r dist-uw/ "$UW_USER@$UW_HOST:$UW_PATH/"
echo "Deployed to $UW_URL"

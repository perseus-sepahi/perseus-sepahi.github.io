#!/usr/bin/env bash
# Publish a compiled app to its PUBLIC distribution repo as a GitHub release.
# The source repo stays private; only the built artifacts are uploaded here.
#
# Usage:
#   scripts/publish-release.sh <owner/repo> <version> <file> [more files...]
# Example:
#   scripts/publish-release.sh psepahi/chisel-app 1.0.0 ~/build/Chisel-1.0.0.dmg
#
# Requires the GitHub CLI:  brew install gh && gh auth login
set -euo pipefail

if [ $# -lt 3 ]; then
  sed -n '2,12p' "$0"; exit 1
fi

REPO="$1"; VERSION="$2"; shift 2
TAG="v${VERSION#v}"

command -v gh >/dev/null || { echo "error: gh not installed. Run: brew install gh && gh auth login"; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "error: not logged in. Run: gh auth login"; exit 1; }

for f in "$@"; do
  [ -f "$f" ] || { echo "error: no such file: $f"; exit 1; }
  size=$(stat -f%z "$f")
  if [ "$size" -gt 2147483648 ]; then
    echo "error: $f is $((size/1024/1024)) MB, over GitHub's 2 GiB per-asset limit"; exit 1
  fi
  printf '  %-50s %6s MB\n' "$(basename "$f")" "$((size/1024/1024))"
done

# Warn about unsigned macOS apps before they reach users.
for f in "$@"; do
  case "$f" in
    *.dmg|*.zip|*.app)
      if codesign -dv "$f" 2>&1 | grep -q 'adhoc'; then
        echo "warning: $(basename "$f") is ad-hoc signed. Users will see a Gatekeeper warning."
        echo "         Document the right-click-Open workaround in the release notes."
      fi;;
  esac
done

NOTES_FILE="$(mktemp)"
trap 'rm -f "$NOTES_FILE"' EXIT
cat > "$NOTES_FILE" <<NOTES
## What's new in $TAG

- 

## Install

macOS: open the .dmg and drag the app to Applications. On first launch, right-click the app and
choose Open (this build is not notarized yet).
NOTES

"${EDITOR:-vi}" "$NOTES_FILE"

gh release create "$TAG" --repo "$REPO" --title "${REPO##*/} $VERSION" --notes-file "$NOTES_FILE" "$@"

echo
echo "Released: https://github.com/$REPO/releases/tag/$TAG"
echo "Make sure the app's JSON in content/software/ has:  \"releases\": \"$REPO\""

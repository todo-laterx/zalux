#!/bin/bash
# Patch plugins inside resources/app.asar (call UI: center notice, IR filter, call-end cleanup).
# Usage: patch-asar.sh <AppDir>
set -e
DIR="${1:?usage: patch-asar.sh <AppDir>}"
HERE="$(cd "$(dirname "$0")" && pwd)"
ASAR="$DIR/resources/app.asar"
[ -f "$ASAR" ] || exit 0
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
npx --yes @electron/asar extract "$ASAR" "$TMP" >/dev/null
cp "$HERE/incoming.js" "$TMP/plugins/zcall/incoming.js"
cp "$HERE/zcall-window.js" "$TMP/plugins/zcall/window.js"
npx --yes @electron/asar pack "$TMP" "$ASAR" >/dev/null
echo "patched asar: $ASAR"

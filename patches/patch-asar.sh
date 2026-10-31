#!/bin/bash
# Patch plugins inside resources/app.asar (no Node/npm required).
# Usage: patch-asar.sh <AppDir>
set -e
DIR="${1:?usage: patch-asar.sh <AppDir>}"
HERE="$(cd "$(dirname "$0")" && pwd)"
ASAR="$DIR/resources/app.asar"
[ -f "$ASAR" ] || exit 0
command -v python3 >/dev/null || { echo "Cần python3 để patch asar" >&2; exit 1; }
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
python3 "$HERE/asar.py" extract "$ASAR" "$TMP" >/dev/null
mkdir -p "$TMP/plugins/zcall"
cp "$HERE/incoming.js" "$TMP/plugins/zcall/incoming.js"
cp "$HERE/zcall-window.js" "$TMP/plugins/zcall/window.js"
[ -f "$ASAR.orig" ] || cp "$ASAR" "$ASAR.orig"
python3 "$HERE/asar.py" pack "$TMP" "$ASAR" >/dev/null
echo "patched asar: $ASAR"

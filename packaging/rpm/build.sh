#!/usr/bin/env bash
set -euo pipefail
SRC="${1:?usage: build.sh <Zalux.AppImage | AppDir> [version]}"
VER="${2:-$(cat "$(dirname "$0")/../../VERSION")}"
R="$(cd "$(dirname "$0")/../.." && pwd)"
command -v rpmbuild >/dev/null || { echo "Cần rpmbuild: sudo apt install rpm (hoặc dnf install rpm-build)" >&2; exit 1; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/app"

if [ -d "$SRC" ]; then
  cp -a "$SRC/." "$WORK/app/"
else
  (cd "$WORK/app" && "$SRC" --appimage-extract >/dev/null && mv squashfs-root/* . && rm -rf squashfs-root)
fi

cp "$R/assets/zalux.png" "$WORK/zalux.png"
cp "$R/NOTICE" "$WORK/NOTICE"
tar -czf "$WORK/zalux-payload.tar.gz" -C "$WORK" app NOTICE
sed "s/@VERSION@/$VER/" "$R/packaging/rpm/zalux.spec" > "$WORK/zalux.spec"
rpmbuild -bb --define "_sourcedir $WORK" --define "_topdir $WORK/rpm" "$WORK/zalux.spec"
mkdir -p "$R/dist"
cp "$WORK"/rpm/RPMS/*/*.rpm "$R/dist/"
echo "built $R/dist"

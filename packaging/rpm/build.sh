#!/bin/bash
set -e
APP="${1:?usage: build.sh <AppImage> [version]}"
VER="${2:-$(cat "$(dirname "$0")/../../VERSION")}"
R="$(cd "$(dirname "$0")/../.." && pwd)"
command -v rpmbuild >/dev/null || { echo "Cần rpmbuild: sudo apt install rpm (hoặc dnf install rpm-build)" >&2; exit 1; }
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/app"
cd "$WORK/app"
"$APP" --appimage-extract >/dev/null
mv squashfs-root/* .
rm -rf squashfs-root
cp -a "$R/patches" "$WORK/patches"
"$WORK/patches/apply.sh" "$WORK/app" >/dev/null
cp "$R/assets/zalux.png" "$WORK/zalux.png"
tar -czf "$WORK/zalux-payload.tar.gz" -C "$WORK" app patches
sed "s/@VERSION@/$VER/" "$R/packaging/rpm/zalux.spec" > "$WORK/zalux.spec"
rpmbuild -bb --define "_sourcedir $WORK" --define "_topdir $WORK/rpm" "$WORK/zalux.spec"
mkdir -p "$R/dist"; cp "$WORK"/rpm/RPMS/*/*.rpm "$R/dist/"
echo "built $R/dist"

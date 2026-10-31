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
ZALUX_PACKAGE=1 "$WORK/patches/apply.sh" "$WORK/app" >/dev/null
rm -f "$WORK/app/resources/app.asar.orig"
cp "$R/assets/zalux.png" "$WORK/zalux.png"
cp "$R/THIRD_PARTY_NOTICES.md" "$WORK/THIRD_PARTY_NOTICES.md"
tar -czf "$WORK/zalux-payload.tar.gz" -C "$WORK" app patches THIRD_PARTY_NOTICES.md
sed "s/@VERSION@/$VER/" "$R/packaging/rpm/zalux.spec" > "$WORK/zalux.spec"
rpmbuild -bb --define "_sourcedir $WORK" --define "_topdir $WORK/rpm" "$WORK/zalux.spec"
mkdir -p "$R/dist"; cp "$WORK"/rpm/RPMS/*/*.rpm "$R/dist/"
echo "built $R/dist"

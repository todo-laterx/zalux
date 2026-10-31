#!/bin/bash
# Install/update Zalux from an AppImage into ~/.local (no root).
# Usage: install.sh /path/to/Zalo-*.AppImage
set -e
APP="${1:?usage: install.sh <Zalux.AppImage>}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIR="$HOME/.local/opt/zalux"
BIN="$HOME/.local/bin/zalux"
mkdir -p "$HOME/.local/bin" "$HOME/.local/share/applications" "$DIR"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cp "$APP" "$DIR/Zalux.AppImage"
chmod +x "$DIR/Zalux.AppImage"
cd "$TMP"
"$DIR/Zalux.AppImage" --appimage-extract >/dev/null
rm -rf "$DIR/app"
mkdir -p "$DIR/app"
cp -a squashfs-root/. "$DIR/app"/
rm -rf "$DIR/patches"
cp -a "$ROOT/patches" "$DIR/patches"
"$DIR/patches/apply.sh" "$DIR/app" >/dev/null
install -m 0755 "$ROOT/installer/zalux-run" "$BIN"
mkdir -p "$HOME/.local/share/icons"
cp "$ROOT/assets/zalux.png" "$HOME/.local/share/icons/zalux.png"
sed "s#@HOME@#$HOME#g" "$ROOT/installer/zalux.desktop" > "$HOME/.local/share/applications/zalux.desktop"
echo "Installed Zalux to $DIR"
echo "Run: $BIN"

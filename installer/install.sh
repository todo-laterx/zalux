#!/usr/bin/env bash
# install.sh — Cài đặt/cập nhật Zalux vào ~/.local (không cần quyền root).
# Cách dùng:
#   ./installer/install.sh /path/to/Zalux-<version>-x86_64.AppImage
#   ./installer/install.sh /path/to/AppDir
set -euo pipefail

SRC="${1:?usage: install.sh <Zalux.AppImage | AppDir>}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIR="$HOME/.local/opt/zalux"
BIN="$HOME/.local/bin/zalux"

mkdir -p "$HOME/.local/bin" \
         "$HOME/.local/share/applications" \
         "$HOME/.local/share/icons/hicolor/256x256/apps" \
         "$HOME/.local/share/icons/hicolor/512x512/apps" \
         "$DIR"

rm -rf "$DIR/app" "$DIR/patches"
rm -f "$DIR"/*.md
mkdir -p "$DIR/app"

if [ -d "$SRC" ]; then
    cp -a "$SRC/." "$DIR/app/"
else
    TMP="$(mktemp -d "$DIR/.extract-XXXXXX")"
    trap 'rm -rf "$TMP"' EXIT
    cp "$SRC" "$DIR/Zalux.AppImage"
    chmod +x "$DIR/Zalux.AppImage"
    rm -rf "$DIR/app"
    (cd "$TMP" && "$DIR/Zalux.AppImage" --appimage-extract >/dev/null)
    mv "$TMP/squashfs-root" "$DIR/app"
fi
chmod 0755 "$DIR/app"
[ -s "$DIR/app/zalo" ] && [ -s "$DIR/app/zalux.desktop" ] || {
    echo "install.sh: giải nén AppImage không đầy đủ (kiểm tra dung lượng ổ đĩa)" >&2
    exit 1
}

install -m 0755 "$ROOT/installer/zalux-run" "$BIN"
install -m 0644 "$ROOT/assets/zalux.png" "$HOME/.local/share/icons/zalux.png"
install -m 0644 "$ROOT/assets/zalux.png" "$HOME/.local/share/icons/hicolor/256x256/apps/zalux.png"
install -m 0644 "$ROOT/assets/zalux.png" "$HOME/.local/share/icons/hicolor/512x512/apps/zalux.png"
install -m 0644 "$ROOT/NOTICE" "$DIR/NOTICE"
sed "s#@HOME@#$HOME#g" "$ROOT/installer/zalux.desktop" > "$HOME/.local/share/applications/zalux.desktop"

echo "Đã cài Zalux vào $DIR"
echo "Khởi chạy: $BIN"

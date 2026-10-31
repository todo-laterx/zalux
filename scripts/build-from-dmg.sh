#!/bin/bash
# Build từ DMG macOS official bằng toolchain upstream (không fork).
# Cần: git, node/npm, 7z, rust/cargo, g++, pkg-config, libssl-dev, liblzma-dev.
# Cần internet cho lần đầu (npm + Electron + DMG).
set -e
R="$(cd "$(dirname "$0")/.." && pwd)"
VER="${1:?usage: build-from-dmg.sh <version, vd 26.10.20>}"
WORK="$R/build/upstream"
mkdir -p "$R/build"
if [ ! -d "$WORK/.git" ]; then
  git clone --depth 1 https://github.com/VN-Linux-Family/zalo-for-linux.git "$WORK"
fi
cd "$WORK"
npm install --no-audit --no-fund
# Upstream tải DMG official theo ZALO_VERSION và đóng gói Original + ZaDark.
# Nếu chỉ muốn Original, sửa tạm scripts/build.js bỏ Phase 2 (ZaDark) trong bản clone.
ZALO_VERSION="$VER" npm run main
out=$(ls -t dist/*Original*x86_64.AppImage 2>/dev/null | head -1 || true)
[ -n "$out" ] || { echo "Không thấy AppImage output" >&2; exit 1; }
cp "$out" "$R/dist/Zalux-$VER.AppImage"
"$R/installer/install.sh" "$R/dist/Zalux-$VER.AppImage"
echo "$VER" > "$R/VERSION"

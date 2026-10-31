#!/bin/bash
# Build AppImage Zalux từ DMG macOS official, dùng toolchain upstream (không lấy AppImage của họ).
# Cần: git, node/npm, 7z, rust/cargo, g++, pkg-config, libssl-dev, liblzma-dev, python3.
set -e
R="$(cd "$(dirname "$0")/.." && pwd)"
VER="${1:?usage: build-from-dmg.sh <version, vd 26.10.20>}"
WORK="$R/build/upstream"
mkdir -p "$R/build" "$R/dist"
if [ ! -d "$WORK/.git" ]; then
  git clone --depth 1 https://github.com/VN-Linux-Family/zalo-for-linux.git "$WORK"
fi
cd "$WORK"
npm install --no-audit --no-fund
ZALO_VERSION="$VER" node scripts/download.js
python3 - <<'PY'
import pathlib
p=pathlib.Path('scripts/prepare-app.js'); s=p.read_text()
s=s.replace("  const { main: patchZocrRuntime } = require('./patches/patch-zocr-runtime');\n  await patchZocrRuntime();", "  // OCR runtime cần Windows installer; bỏ qua.\n  // const { main: patchZocrRuntime } = require('./patches/patch-zocr-runtime');\n  // await patchZocrRuntime();")
p.write_text(s)
p=pathlib.Path('scripts/build.js'); s=p.read_text()
s=s.replace("    logger.step('PHASE 2: Building Zalo (with ZaDark)');\n\n    // Patch ZaDark directly into APP_DIR\n    await integrateZaDark();\n    await build('(with ZaDark)', '-ZaDark');", "    // ZaDark bỏ qua: build Original từ DMG official.\n    // await integrateZaDark();\n    // await build('(with ZaDark)', '-ZaDark');")
p.write_text(s)
PY
ZALO_VERSION="$VER" node scripts/prepare-app.js
mkdir -p app/plugins/zcall
cp "$R/patches/incoming.js" plugins/zcall/incoming.js
cp "$R/patches/zcall-window.js" plugins/zcall/window.js
ZALUX_PACKAGE=1 "$R/patches/apply.sh" "$WORK" >/dev/null
BUILD=true node scripts/build.js
out=$(ls -t dist/*Original*x86_64.AppImage 2>/dev/null | head -1)
[ -n "$out" ] || { echo "Không thấy AppImage output" >&2; exit 1; }
cp "$out" "$R/dist/Zalux-$VER-x86_64.AppImage"
chmod +x "$R/dist/Zalux-$VER-x86_64.AppImage"
sha256sum "$R/dist/Zalux-$VER-x86_64.AppImage"
echo "Toolchain: VN-Linux-Family/zalo-for-linux (MIT, Copyright (c) 2024 doandat943); không liên kết."
echo "Xong: $R/dist/Zalux-$VER-x86_64.AppImage"

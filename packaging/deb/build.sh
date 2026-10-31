#!/bin/bash
set -e
APP="${1:?usage: build.sh <AppImage> [version]}"
VER="${2:-$(cat "$(dirname "$0")/../../VERSION")}"
R="$(cd "$(dirname "$0")/../.." && pwd)"
ROOT="$(mktemp -d)"; trap 'rm -rf "$ROOT"' EXIT
mkdir -p "$ROOT/opt/zalux" "$ROOT/usr/bin" "$ROOT/usr/share/applications" "$ROOT/usr/share/icons/hicolor/512x512/apps" "$ROOT/DEBIAN"
cd "$ROOT/opt/zalux"
"$APP" --appimage-extract >/dev/null
mv squashfs-root/* .
rm -rf squashfs-root
cp -a "$R/patches" "$ROOT/opt/zalux/patches"
ZALUX_PACKAGE=1 "$ROOT/opt/zalux/patches/apply.sh" "$ROOT/opt/zalux" >/dev/null
rm -f "$ROOT/opt/zalux/resources/app.asar.orig"
cat > "$ROOT/usr/bin/zalux" <<'WRAP'
#!/bin/sh
P=/opt/zalux/patches
if [ -f "$P/install-userscripts.py" ]; then python3 "$P/install-userscripts.py" >/dev/null 2>&1 || true; fi
mkdir -p "$HOME/.local/share/zalo-linux/sounds"
cp -n "$P/sounds/"*.mp3 "$HOME/.local/share/zalo-linux/sounds/" 2>/dev/null || true
exec /usr/bin/env -u ELECTRON_RUN_AS_NODE /opt/zalux/zalo --no-sandbox --enable-gpu-rasterization --enable-zero-copy --disable-crash-reporter --js-flags=--max-old-space-size=768 "$@"
WRAP
chmod +x "$ROOT/usr/bin/zalux"
cp "$R/assets/zalux.png" "$ROOT/usr/share/icons/hicolor/512x512/apps/zalux.png"
cat > "$ROOT/usr/share/applications/zalux.desktop" <<'DESK'
[Desktop Entry]
Name=Zalux
Comment=Zalux - Zalo Linux
Exec=/usr/bin/zalux
Icon=zalux
Terminal=false
Type=Application
StartupWMClass=zalo
Categories=Network;InstantMessaging;Chat;
MimeType=x-scheme-handler/zalo;
DESK
cat > "$ROOT/DEBIAN/control" <<CTL
Package: zalux
Version: $VER
Section: net
Priority: optional
Architecture: amd64
Maintainer: Zalux <noreply@example.com>
Depends: libgtk-3-0 | libgtk-3-0t64, libnss3, libx11-xcb1, libxcb-dri3-0, libxcomposite1, libxdamage1, libxrandr2, libgbm1, libasound2 | libasound2t64, libatk-bridge2.0-0, libatspi2.0-0, libcups2, libpango-1.0-0, libcairo2, libdrm2, libxss1, libxtst6, libsecret-1-0, python3, libopus0, pulseaudio-utils, xdg-utils
Description: Zalux - unofficial Zalo desktop for Linux
 Zalo macOS client repackaged for Linux with native calls and local patches.
CTL
mkdir -p "$R/dist"
dpkg-deb --build --root-owner-group "$ROOT" "$R/dist/zalux_${VER}_amd64.deb"
echo "built $R/dist/zalux_${VER}_amd64.deb"

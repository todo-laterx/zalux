#!/usr/bin/env bash
set -euo pipefail
SRC="${1:?usage: build.sh <Zalux.AppImage | AppDir> [version]}"
VER="${2:-$(cat "$(dirname "$0")/../../VERSION")}"
R="$(cd "$(dirname "$0")/../.." && pwd)"
ROOT="$(mktemp -d)"
chmod 0755 "$ROOT"
trap 'rm -rf "$ROOT"' EXIT

mkdir -p "$ROOT/opt/zalux" \
         "$ROOT/usr/bin" \
         "$ROOT/usr/share/applications" \
         "$ROOT/usr/share/icons/hicolor/256x256/apps" \
         "$ROOT/usr/share/icons/hicolor/512x512/apps" \
         "$ROOT/DEBIAN"

if [ -d "$SRC" ]; then
  cp -a "$SRC/." "$ROOT/opt/zalux/"
else
  (cd "$ROOT/opt/zalux" && "$SRC" --appimage-extract >/dev/null && mv squashfs-root/* . && rm -rf squashfs-root)
fi

install -d "$ROOT/usr/share/doc/zalux"
cp "$R/NOTICE" "$R/LICENSE" "$ROOT/usr/share/doc/zalux/"

cat > "$ROOT/usr/bin/zalux" <<'WRAP'
#!/bin/sh
if [ -z "${GTK_THEME:-}" ] && command -v gsettings >/dev/null 2>&1; then
  case "$(gsettings get org.gnome.desktop.interface color-scheme 2>/dev/null || true)" in
    *dark*)
      _theme="$(gsettings get org.gnome.desktop.interface gtk-theme 2>/dev/null | tr -d "'" || true)"
      [ -n "$_theme" ] && export GTK_THEME="$_theme"
      ;;
  esac
fi
if [ -n "${DISPLAY:-}" ] && [ "${ZALUX_WAYLAND_NATIVE:-0}" != "1" ]; then
  set -- --ozone-platform=x11 --enable-features=JXL,WebRTCPipeWireCapturer "$@"
else
  set -- --ozone-platform=wayland --enable-features=JXL,WaylandWindowDecorations,WebRTCPipeWireCapturer "$@"
fi
exec /usr/bin/env \
  -u ELECTRON_RUN_AS_NODE \
  -u GIO_LAUNCHED_DESKTOP_FILE \
  -u GIO_LAUNCHED_DESKTOP_FILE_PID \
  -u SNAP \
  -u SNAP_NAME \
  -u SNAP_APP_DESKTOP_FILE \
  CHROME_DESKTOP=zalux.desktop \
  BAMF_DESKTOP_FILE_HINT=/usr/share/applications/zalux.desktop \
  /opt/zalux/zalo \
  --no-sandbox \
  --disable-crash-reporter \
  --disable-gpu-memory-buffer-video-frames \
  "$@"
WRAP
chmod 0755 "$ROOT/usr/bin/zalux"

cp "$R/assets/zalux.png" "$ROOT/usr/share/icons/hicolor/256x256/apps/zalux.png"
cp "$R/assets/zalux.png" "$ROOT/usr/share/icons/hicolor/512x512/apps/zalux.png"

cat > "$ROOT/usr/share/applications/zalux.desktop" <<'DESK'
[Desktop Entry]
Name=Zalux
Comment=Zalux - Zalo Desktop for Linux
Exec=/usr/bin/zalux %U
Icon=zalux
Terminal=false
Type=Application
StartupWMClass=Zalo
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
Depends: libgtk-3-0 | libgtk-3-0t64, libnss3, libx11-xcb1, libxcb-dri3-0, libxcomposite1, libxdamage1, libxrandr2, libgbm1, libasound2 | libasound2t64, libatk-bridge2.0-0, libatspi2.0-0, libcups2 | libcups2t64, libpango-1.0-0, libcairo2, libdrm2, libxss1, libxtst6, libsecret-1-0, libopus0, libpipewire-0.3-0 | libpipewire-0.3-0t64, pulseaudio-utils, ffmpeg, xdg-utils
Recommends: xdg-desktop-portal, xdg-desktop-portal-gnome | xdg-desktop-portal-kde | xdg-desktop-portal-gtk | xdg-desktop-portal-wlr
Description: Zalux - unofficial Zalo desktop for Linux
 Zalo desktop client on Linux powered by native Rust call engine and N-API modules.
CTL

mkdir -p "$R/dist"
dpkg-deb --build --root-owner-group "$ROOT" "$R/dist/zalux_${VER}_amd64.deb"
echo "built $R/dist/zalux_${VER}_amd64.deb"

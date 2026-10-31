#!/bin/bash
# Cài Zalux từ AppImage trong Releases của repo này (build từ DMG official).
# Dùng AppImage của bạn:
#   ZALUX_APPIMAGE_URL=/path/to/Zalux.AppImage ./scripts/install-latest.sh
#   ./scripts/install-latest.sh /path/to/Zalux.AppImage
set -e
R="$(cd "$(dirname "$0")/.." && pwd)"
url="${ZALUX_APPIMAGE_URL:-${1:-}}"
if [ -z "$url" ]; then
  echo "Lấy AppImage mới nhất từ Releases của todo-laterx/zalux..."
  url=$(curl -s https://api.github.com/repos/todo-laterx/zalux/releases/latest | python3 -c 'import json,sys
for a in json.load(sys.stdin).get("assets",[]):
  n=a["name"]
  if n.startswith("Zalux-") and n.endswith("x86_64.AppImage"): print(a["browser_download_url"]); break')
fi
[ -n "$url" ] || { echo "Chưa có AppImage release. Dùng ZALUX_APPIMAGE_URL hoặc scripts/build-from-dmg.sh." >&2; exit 1; }
echo "Nguồn AppImage: $url"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
if [ -f "$url" ]; then
  out="$url"
else
  out="$tmp/Zalux.AppImage"
  curl -L --fail --max-time 900 -o "$out" "$url"
fi
chmod +x "$out"
"$R/installer/install.sh" "$out"

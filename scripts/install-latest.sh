#!/usr/bin/env bash
# install-latest.sh — Cài Zalux từ Releases của repo hoặc từ AppImage/AppDir có sẵn.
# Ví dụ:
#   ./scripts/install-latest.sh
#   ./scripts/install-latest.sh /path/to/Zalux-26.10.20-x86_64.AppImage
#   ./scripts/install-latest.sh ./build/AppDir
set -euo pipefail

R="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
url="${ZALUX_APPIMAGE_URL:-${1:-}}"

if [ -z "$url" ]; then
  echo "Đang kiểm tra bản phát hành mới nhất trên GitHub Releases..."
  url="$(curl -s https://api.github.com/repos/todo-laterx/zalux/releases/latest | python3 -c 'import json,sys
for a in json.load(sys.stdin).get("assets",[]):
  n=a["name"]
  if n.startswith("Zalux-") and n.endswith("x86_64.AppImage"):
    print(a["browser_download_url"])
    break')"
fi

[ -n "$url" ] || {
  echo "Chưa tìm thấy AppImage phát hành. Hãy dùng ./scripts/build-from-dmg.sh <version> để đóng gói từ DMG chính thức." >&2
  exit 1
}

if [ -e "$url" ]; then
  exec "$R/installer/install.sh" "$url"
fi

echo "Tải gói cài đặt: $url"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
out="$tmp/Zalux.AppImage"
curl -L --fail --max-time 900 -o "$out" "$url"
chmod +x "$out"
"$R/installer/install.sh" "$out"

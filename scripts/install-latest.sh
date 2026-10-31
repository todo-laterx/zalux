#!/bin/bash
# Cài Zalux: lấy AppImage gốc (mặc định từ upstream) rồi áp patch.
# Dùng AppImage của bạn:
#   ZALUX_APPIMAGE_URL=https://... ./scripts/install-latest.sh
#   ./scripts/install-latest.sh /path/to/Zalo.AppImage
set -e
R="$(cd "$(dirname "$0")/.." && pwd)"
url="${ZALUX_APPIMAGE_URL:-${1:-}}"
if [ -z "$url" ]; then
  echo "Chưa có AppImage — lấy bản Original mới nhất từ upstream VN-Linux-Family/zalo-for-linux..."
  url=$(curl -s https://api.github.com/repos/VN-Linux-Family/zalo-for-linux/releases/latest | python3 -c 'import json,sys
for a in json.load(sys.stdin).get("assets",[]):
  n=a["name"]
  if "Original" in n and n.endswith("x86_64.AppImage"): print(a["browser_download_url"]); break')
fi
[ -n "$url" ] || { echo "Không thấy AppImage Original x86_64. Dùng ZALUX_APPIMAGE_URL hoặc build từ DMG official." >&2; exit 1; }
echo "Nguồn AppImage: $url"
echo "Lưu ý: đây là AppImage gốc (upstream); Zalux áp patch sau khi tải."
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
if [ -f "$url" ]; then
  out="$url"
else
  out="$tmp/Zalux.AppImage"
  curl -L --fail --max-time 900 -o "$out" "$url"
fi
chmod +x "$out"
"$R/installer/install.sh" "$out"

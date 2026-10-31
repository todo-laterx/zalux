#!/bin/bash
# Tải AppImage Original mới nhất của upstream rồi cài Zalux (không cần root).
set -e
R="$(cd "$(dirname "$0")/.." && pwd)"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
url=$(curl -s https://api.github.com/repos/VN-Linux-Family/zalo-for-linux/releases/latest | python3 -c 'import json,sys
for a in json.load(sys.stdin).get("assets",[]):
  n=a["name"]
  if "Original" in n and n.endswith("x86_64.AppImage"): print(a["browser_download_url"]); break')
[ -n "$url" ] || { echo "Không thấy AppImage Original x86_64" >&2; exit 1; }
out="$tmp/Zalux.AppImage"
echo "Tải $(basename "$url")"
curl -L --fail --max-time 900 -o "$out" "$url"
chmod +x "$out"
"$R/installer/install.sh" "$out"

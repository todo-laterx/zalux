#!/bin/bash
# Tải AppImage Original mới nhất của upstream rồi cài + patch.
set -e
R="$(cd "$(dirname "$0")/.." && pwd)"
tag=$(curl -s https://api.github.com/repos/VN-Linux-Family/zalo-for-linux/releases/latest | python3 -c 'import json,sys;print(json.load(sys.stdin)["tag_name"])')
url=$(curl -s https://api.github.com/repos/VN-Linux-Family/zalo-for-linux/releases/latest | python3 -c 'import json,sys
for a in json.load(sys.stdin).get("assets",[]):
  n=a["name"]
  if "Original" in n and n.endswith("x86_64.AppImage"): print(a["browser_download_url"]); break')
[ -n "$url" ] || { echo "Không thấy asset Original x86_64" >&2; exit 1; }
out="$R/dist/Zalux-$tag.AppImage"
mkdir -p "$R/dist"
echo "Tải $url"
curl -L --fail --max-time 900 -o "$out" "$url"
chmod +x "$out"
"$R/installer/install.sh" "$out"
echo "$tag" > "$R/VERSION"

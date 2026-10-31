#!/bin/bash
# So sánh version official (DMG macOS) với upstream AppImage và bản đang cài.
set -e
UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36'
official=$(curl -sI -A "$UA" "https://zalo.me/download/zalo-pc?utm=90000" | awk 'tolower($1)=="location:"{print $2}' | sed -E 's#.*-([0-9.]+)\.dmg.*#\1#' | tr -d '\r')
upstream=$(curl -s https://api.github.com/repos/VN-Linux-Family/zalo-for-linux/releases/latest | python3 -c 'import json,sys;print(json.load(sys.stdin).get("tag_name",""))')
installed=$(cat "$(dirname "$0")/../VERSION" 2>/dev/null || echo unknown)
printf 'official DMG : %s\n' "${official:-?}"
printf 'upstream AppImage: %s\n' "${upstream:-?}"
printf 'installed    : %s\n' "$installed"
if [ -n "$official" ] && [ "$official" = "$upstream" ]; then
  echo "→ upstream đã có bản khớp official; chạy scripts/update.sh"
elif [ -n "$official" ]; then
  echo "→ upstream chưa có $official; cần build từ DMG (scripts/build-from-dmg.sh)"
fi

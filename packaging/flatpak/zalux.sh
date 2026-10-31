#!/bin/sh
P=/app/zalux/patches
if [ -f "$P/install-userscripts.py" ]; then python3 "$P/install-userscripts.py" >/dev/null 2>&1 || true; fi
mkdir -p "$HOME/.local/share/zalo-linux/sounds"
cp -n "$P/sounds/"*.mp3 "$HOME/.local/share/zalo-linux/sounds/" 2>/dev/null || true
exec /usr/bin/env -u ELECTRON_RUN_AS_NODE /app/zalux/zalo --no-sandbox --enable-gpu-rasterization --enable-zero-copy --disable-crash-reporter --js-flags=--max-old-space-size=768 "$@"

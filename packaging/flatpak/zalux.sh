#!/bin/sh
if [ -n "${DISPLAY:-}" ] && [ "${ZALUX_WAYLAND_NATIVE:-0}" != "1" ]; then
  set -- --ozone-platform=x11 --enable-features=JXL,WebRTCPipeWireCapturer "$@"
else
  set -- --ozone-platform=wayland --enable-features=JXL,WaylandWindowDecorations,WebRTCPipeWireCapturer "$@"
fi
exec /usr/bin/env -u ELECTRON_RUN_AS_NODE /app/zalux/zalo --no-sandbox --disable-crash-reporter --disable-gpu-memory-buffer-video-frames "$@"

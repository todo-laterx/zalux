#!/bin/bash
# Gỡ Zalux (giữ dữ liệu Zalo trong ~/.config/ZaloData).
set -e
rm -rf "$HOME/.local/opt/zalux"
rm -f "$HOME/.local/bin/zalux"
rm -f "$HOME/.local/share/applications/zalux.desktop"
rm -f "$HOME/.config/autostart/zalo.desktop"
echo "Đã gỡ Zalux. Dữ liệu Zalo vẫn ở ~/.config/ZaloData (xoá tay nếu muốn)."

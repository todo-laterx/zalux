#!/usr/bin/env bash
# bootstrap.sh — Cài Zalux một dòng: tải repo + cài bản phát hành mới nhất vào ~/.local.
set -euo pipefail
SRC="$HOME/.local/share/zalux/src"
rm -rf "$SRC"
mkdir -p "$(dirname "$SRC")"
git clone --depth 1 https://github.com/todo-laterx/zalux.git "$SRC"
"$SRC/scripts/install-latest.sh" "$@"

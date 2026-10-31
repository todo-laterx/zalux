#!/bin/bash
# Cài Zalux một dòng: tải repo + AppImage upstream + patch + cài vào ~/.local.
set -e
SRC="$HOME/.local/share/zalux/src"
rm -rf "$SRC"
mkdir -p "$(dirname "$SRC")"
git clone --depth 1 https://github.com/todo-laterx/zalux.git "$SRC"
"$SRC/scripts/install-latest.sh"

#!/usr/bin/env python3
"""patch-titlebar.py — ẩn titlebar macOS thừa và đổi tên cửa sổ trên Linux.

1. `main-dist/preload-render.js`: nối một IIFE (chạy với nodeIntegration của
   preload) để inject CSS trên Linux:
     - #titleBar, .header-action-zone-mac, traffic-light -> display:none
     - thêm #zalo-drag-strip để kéo cửa sổ bằng vùng trống trên cùng
   Marker: `ZALO LINUX HIDE TITLEBAR START/END`.

2. `pc-dist/**/*.js`: đổi tên cửa sổ:
     `Zalo - ${name}` -> `Zalo (Linux)`;  "Zalo" (fallback) -> "Zalo (Linux)";
     document.title="Zalo" -> document.title="Zalo (Linux)".
   Chỉ đụng các bundle renderer, không đụng chuỗi thông báo/ngôn ngữ.

Idempotent: marker preload + phép thay thế một chiều (chạy lại không đổi gì).
File preload được backup một lần thành *.zalo-linux.orig; các bundle lớn được
kiểm tra + ghi atomically thay vì backup (tránh nhân đôi ~80 MB).
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
APP = Path(os.environ.get("ZALO_APP_DIR") or (ROOT / "build" / "app-extracted"))
MAIN = APP / "main-dist" / "main.js"
PRELOAD = APP / "main-dist" / "preload-render.js"
PC_DIST = APP / "pc-dist"
MARKER_START = "ZALO LINUX HIDE TITLEBAR START"
MARKER_END = "ZALO LINUX HIDE TITLEBAR END"
MAIN_MARKER = "ZALO LINUX MAIN ENHANCEMENTS START"

MAIN_FRAME_ORIG = 'minWidth:me.MIN_LOGIN_WIDTH,minHeight:me.MIN_LOGIN_HEIGHT,frame:!1,titleBarStyle:"hidden"'
MAIN_FRAME_NATIVE = 'minWidth:me.MIN_LOGIN_WIDTH,minHeight:me.MIN_LOGIN_HEIGHT,frame:("linux"===process.platform||!1),titleBarStyle:("linux"===process.platform?"default":"hidden")'

CHILD_FRAME_ORIG = 'overrideBrowserWindowOptions:r(r(r({frame:!1,show:!1,titleBarStyle:"hidden",resizable:!0'
CHILD_FRAME_NATIVE = 'overrideBrowserWindowOptions:r(r(r({frame:("linux"===process.platform||!1),show:!1,titleBarStyle:("linux"===process.platform?"default":"hidden"),resizable:!0'

PHOTO_TBS_ORIG = 'skipTaskbar:!1,titleBarStyle:"hidden",show:!1,resizable:!0,backgroundColor:"#1f1f1f"'
PHOTO_TBS_NATIVE = 'skipTaskbar:!1,titleBarStyle:("linux"===process.platform?"default":"hidden"),show:!1,resizable:!0,backgroundColor:"#1f1f1f"'

MAIN_BLOCK = """// ZALO LINUX MAIN ENHANCEMENTS START
(function () {
  if (process.platform !== 'linux') return;
  try {
    require('../plugins/zalux/main-enhancements').init();
  } catch (_err) {
    try {
      const { app } = require('electron');
      app.on('browser-window-created', (_evt, win) => {
        try {
          win.setMenu(null);
          win.autoHideMenuBar = true;
        } catch (_) {}
      });
    } catch (_) {}
  }
})();
// ZALO LINUX MAIN ENHANCEMENTS END
"""

PRELOAD_BLOCK = """// ZALO LINUX HIDE TITLEBAR START
(function () {
  if (typeof process === 'undefined' || process.platform !== 'linux') return;
  try {
    require('../plugins/zalux/preload-enhancements');
  } catch (_err) {
    const CSS = [
      '#titleBar{display:none!important;}',
      '.header-action-zone-mac{display:none!important;}',
      '.traffic-light,[class*="traffic-light"],[class*="trafficLight"]{display:none!important;}'
    ].join('');
    function inject() {
      const root = document.head || document.documentElement;
      if (!root || document.getElementById('zalo-linux-hide-mac-titlebar')) return;
      const style = document.createElement('style');
      style.id = 'zalo-linux-hide-mac-titlebar';
      style.textContent = CSS;
      root.appendChild(style);
    }
    inject();
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', inject);
  }
})();
// ZALO LINUX HIDE TITLEBAR END
"""

# Cửa sổ chính: `X=X?`Zalo - ${X}`:"Zalo"` -> `Zalux`.
TITLE_EXPR = re.compile(r'\?`Zalo - \$\{[A-Za-z_$][\w$]*\}`:"Zalo"')
TITLE_EXPR_LEGACY = '?`Zalo (Linux)`:"Zalo (Linux)"'
TITLE_EXPR_NEW = '?`Zalux`:"Zalux"'
TITLE_TEMPLATE = re.compile(r"`Zalo - \$\{[A-Za-z_$][\w$]*\}`")
TITLE_TEMPLATE_LEGACY = "`Zalo (Linux)`"
TITLE_TEMPLATE_NEW = "`Zalux`"
DOC_TITLE = 'document.title="Zalo"'
DOC_TITLE_LEGACY = 'document.title="Zalo (Linux)"'
DOC_TITLE_NEW = 'document.title="Zalux"'


def fail(msg: str) -> None:
    print(f"patch-titlebar: LỖI: {msg}", file=sys.stderr)
    raise SystemExit(1)


def node_check(path: Path) -> None:
    node = shutil.which("node")
    if not node:
        print("    ! không có node, bỏ qua node --check", file=sys.stderr)
        return
    res = subprocess.run([node, "--check", str(path)], capture_output=True, text=True)
    if res.returncode != 0:
        fail(f"node --check thất bại cho {path}:\n{res.stderr.strip()}")


def atomic_write(path: Path, data: bytes) -> None:
    fd, name = tempfile.mkstemp(prefix=path.name + ".", suffix=".tmp", dir=str(path.parent))
    tmp = Path(name)
    try:
        with os.fdopen(fd, "wb") as fh:
            fh.write(data)
        # mkstemp tạo file 0600; giữ nguyên quyền của bundle gốc.
        shutil.copymode(path, tmp)
        os.replace(tmp, path)
    finally:
        if tmp.exists():
            tmp.unlink()


def patch_preload() -> bool:
    if not PRELOAD.is_file():
        fail(f"không thấy {PRELOAD}")
    text = PRELOAD.read_text(encoding="utf-8")
    if MARKER_START in text:
        idx1 = text.find(f"// {MARKER_START}")
        idx2 = text.find(f"// {MARKER_END}")
        if idx1 != -1 and idx2 != -1:
            patched = text[:idx1] + PRELOAD_BLOCK.strip() + text[idx2 + len(f"// {MARKER_END}"):]
        else:
            patched = text
    else:
        backup = PRELOAD.with_suffix(PRELOAD.suffix + ".zalo-linux.orig")
        if not backup.exists():
            shutil.copy2(PRELOAD, backup)
            print(f"    backup: {backup.name}")
        patched = text.rstrip("\n") + "\n\n" + PRELOAD_BLOCK

    # Đuôi .js để `node --check` chấp nhận (Node 22+ từ chối đuôi lạ).
    fd, name = tempfile.mkstemp(prefix="preload-render.", suffix=".js", dir=str(PRELOAD.parent))
    tmp = Path(name)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(patched)
        shutil.copymode(PRELOAD, tmp)
        node_check(tmp)
        os.replace(tmp, PRELOAD)
    finally:
        if tmp.exists():
            tmp.unlink()
    print("    + preload-render.js: ẩn thanh đệm traffic-light macOS (#titleBar), dùng titlebar hệ thống")
    return True


def patch_main() -> bool:
    if not MAIN.is_file():
        fail(f"không thấy {MAIN}")
    text = MAIN.read_text(encoding="utf-8")
    m_start = "// ZALO LINUX MAIN ENHANCEMENTS START"
    m_end = "// ZALO LINUX MAIN ENHANCEMENTS END"
    if m_start in text:
        idx1 = text.find(m_start)
        idx2 = text.find(m_end)
        if idx1 != -1 and idx2 != -1:
            text = text[:idx1].rstrip() + "\n" + text[idx2 + len(m_end):].lstrip()
    if MAIN_FRAME_ORIG in text:
        text = text.replace(MAIN_FRAME_ORIG, MAIN_FRAME_NATIVE, 1)
    if CHILD_FRAME_ORIG in text:
        text = text.replace(CHILD_FRAME_ORIG, CHILD_FRAME_NATIVE, 1)
    if PHOTO_TBS_ORIG in text:
        text = text.replace(PHOTO_TBS_ORIG, PHOTO_TBS_NATIVE)

    patched = text.rstrip("\n") + "\n\n" + MAIN_BLOCK

    fd, name = tempfile.mkstemp(prefix="main.", suffix=".js", dir=str(MAIN.parent))
    tmp = Path(name)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(patched)
        shutil.copymode(MAIN, tmp)
        node_check(tmp)
        os.replace(tmp, MAIN)
    finally:
        if tmp.exists():
            tmp.unlink()
    print("    + main.js: native system frame/titlebar + ẩn MenuBar + phím tắt DevTools")
    return True


def patch_bundle(path: Path) -> tuple[int, int]:
    """Trả về (số thay thế tên cửa sổ, số thay thế document.title)."""
    raw = path.read_bytes()
    text = raw.decode("utf-8", errors="surrogateescape")
    titles = (
        len(TITLE_EXPR.findall(text))
        + len(TITLE_TEMPLATE.findall(text))
        + text.count(TITLE_EXPR_LEGACY)
        + text.count(TITLE_TEMPLATE_LEGACY)
    )
    docs = text.count(DOC_TITLE) + text.count(DOC_TITLE_LEGACY)
    if not titles and not docs:
        return 0, 0

    updated = TITLE_EXPR.sub(TITLE_EXPR_NEW, text)
    updated = TITLE_TEMPLATE.sub(TITLE_TEMPLATE_NEW, updated)
    updated = updated.replace(TITLE_EXPR_LEGACY, TITLE_EXPR_NEW)
    updated = updated.replace(TITLE_TEMPLATE_LEGACY, TITLE_TEMPLATE_NEW)
    updated = updated.replace(DOC_TITLE, DOC_TITLE_NEW)
    updated = updated.replace(DOC_TITLE_LEGACY, DOC_TITLE_NEW)
    if updated == text:
        return 0, 0
    atomic_write(path, updated.encode("utf-8", errors="surrogateescape"))
    return titles, docs


def main() -> None:
    if not APP.is_dir():
        fail(f"không thấy {APP} — chạy extract-dmg.sh trước")

    changed_preload = patch_preload()
    changed_main = patch_main()

    total_titles = total_docs = files = 0
    for path in sorted(PC_DIST.rglob("*.js")):
        t, d = patch_bundle(path)
        if t or d:
            files += 1
            total_titles += t
            total_docs += d
            print(f"    + {path.relative_to(APP)}: {t} title, {d} document.title")

    print("patch-titlebar: xong.")
    print(f"    preload: {'đã patch' if changed_preload else 'không đổi'}")
    print(f"    main   : {'đã patch' if changed_main else 'không đổi'}")
    print(f"    bundle : {files} file, {total_titles} tên cửa sổ, {total_docs} document.title")


if __name__ == "__main__":
    main()

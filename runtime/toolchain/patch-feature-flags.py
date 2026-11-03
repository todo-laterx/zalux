#!/usr/bin/env python3
"""patch-feature-flags.py — chặn crash chụp màn hình trên Linux & tuỳ chọn cấu hình Kiki sạch.

Áp trực tiếp lên bundle đã bóc (`build/app-extracted` hoặc app đang đóng gói):

1. **Chụp màn hình (`startScreenshot`)**: Zalo PC dùng helper native macOS (`$zscreencap`,
   các API `screen-capture`/`start-screen-capture`). Linux không có helper → bấm nút chụp
   thì app ẩn cửa sổ rồi lỗi, renderer chết (`crashed event`). Patcher chặn `startScreenshot`
   trên Linux: hiện thông báo và không ẩn cửa sổ.

2. **Kiki assistant (`features.kiki_assistant`)**:
   Tuyệt đối KHÔNG tự quét log phiên đăng nhập cục bộ để tránh đóng cứng
   token cá nhân vào gói phát hành. Mặc định đảm bảo trạng thái sạch (`enable:0, h5_url:""`,
   tự động gỡ bỏ mọi URL/token từng ghi nhầm trước đó); chỉ ghi `h5_url` khi người dùng
   chủ động truyền `--kiki-url` trên máy cá nhân.

usage:
    python3 scripts/toolchain/patch-feature-flags.py [--app DIR] [--kiki-url URL] [--no-screenshot-guard]
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_APP = Path(os.environ.get("ZALO_APP_DIR") or (ROOT / "build" / "app-extracted"))

KIKI_CLEAN = 'kiki_assistant:{enable:0,h5_url:""'
RE_KIKI_BAKED = re.compile(r'kiki_assistant:\{enable:[01],h5_url:"(?:\\.|[^"\\])*"')

SCREENCAP_OLD = "startScreenshot:function(e,t){"
SCREENCAP_MARK = "/*ZFL_LINUX_SCREENCAP_GUARD*/"
SCREENCAP_GUARD = (
    SCREENCAP_MARK
    + 'if("undefined"!=typeof process&&"linux"===process.platform){'
    'try{require("electron").dialog.showMessageBox({type:"info",title:"Chụp màn hình",'
    'message:"Zalo chưa hỗ trợ chụp màn hình trực tiếp trên Linux (hãy dùng phím PrintScreen rồi dán Ctrl+V vào khung chat).",'
    'buttons:["OK"],noLink:!0})}catch(_){}return}'
)


def patch_kiki(app: Path, explicit_url: str | None) -> int:
    hits = 0
    target = (
        f"kiki_assistant:{{enable:1,h5_url:{json.dumps(explicit_url)}"
        if explicit_url
        else KIKI_CLEAN
    )
    for path in sorted(app.rglob("*.js")):
        if path.name.endswith(".orig"):
            continue
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        if "kiki_assistant:{" not in text:
            continue
        new_text, count = RE_KIKI_BAKED.subn(lambda _m: target, text)
        if count and new_text != text:
            path.write_text(new_text, encoding="utf-8")
            hits += 1
            mode_label = "enable=1 (explicit)" if explicit_url else "clean (enable=0, no token)"
            print(f"  + {path.relative_to(app)}: kiki_assistant -> {mode_label}")
    return hits


def patch_screenshot(app: Path) -> int:
    main_js = app / "main-dist" / "main.js"
    if not main_js.exists():
        print("  ! không thấy main-dist/main.js")
        return 0
    text = main_js.read_text(encoding="utf-8", errors="replace")
    if SCREENCAP_MARK in text:
        print("  = main.js: đã có guard chụp màn hình")
        return 1
    if SCREENCAP_OLD not in text:
        print("  ! main.js: không khớp startScreenshot (bundle đổi?)")
        return 0
    text = text.replace(SCREENCAP_OLD, SCREENCAP_OLD + SCREENCAP_GUARD, 1)
    main_js.write_text(text, encoding="utf-8")
    print("  + main-dist/main.js: chặn startScreenshot trên Linux")
    return 1


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--app", default=str(DEFAULT_APP), help="thư mục app đã bóc (mặc định $ZALO_APP_DIR hoặc build/app-extracted)")
    ap.add_argument("--kiki-url", default=None, help="tuỳ chọn h5_url Kiki riêng trên máy cá nhân (mặc định: để trống để giữ sạch)")
    ap.add_argument("--no-screenshot-guard", action="store_true", help="không vá chụp màn hình")
    args = ap.parse_args()

    app = Path(args.app).resolve()
    if not (app / "main-dist" / "main.js").exists():
        print(f"patch-feature-flags: không phải app Zalux đã bóc: {app}", file=sys.stderr)
        return 1

    print(f">>> [1/2] Vệ sinh cấu hình Kiki assistant (explicit url: {'có' if args.kiki_url else 'không'})")
    kiki = patch_kiki(app, args.kiki_url)

    print(">>> [2/2] Chặn crash chụp màn hình")
    shot = 0 if args.no_screenshot_guard else patch_screenshot(app)

    print(f"patch-feature-flags: xong (kiki_updated={kiki}, screenshot_guard={shot})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

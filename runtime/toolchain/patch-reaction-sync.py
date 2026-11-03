#!/usr/bin/env python3
"""patch-reaction-sync.py — kích hoạt đồng bộ tin nhắn, danh sách Media/File/Link & reaction 2 chiều trên Linux.

1. `pc-dist/lazy/main-startup.*.js`:
   - Bật cưỡng bức `msgSync` (`isEnable`, `isEnableBySrc`, `isEnableResume` -> `!0`).
   - Bỏ ném ngoại lệ `NO_NETWORK` giả lập khi đang sync socket.
   - Tắt resync-loop của `sync-controller` (`isFeatureEnabled(){return !1}`) tránh khoá SQLite.
   - Mở thông `Guard Service` (`checkFeatureEnabled` & `checkNetwork` -> `{ok:!0}`).

2. Cả 4 bundle lớn trong `pc-dist/` (`default-login-...-znotification.*.js`,
   `compact-app-pc.*.js`, `search-worker.*.js`, `sync-v2-sub-worker.*.js`):
   - Khởi tạo `this.stateCur = u.CONNECTED` thay vì `u.NOT_SET` và dùng `this.stateCur`
     trực tiếp trong `networkConnected()` / `_checkNetwork()` để `shared-worker` &
     `sync-v2-sub-worker` không huỷ API tải danh sách Ảnh/File/Link và luồng sync ngầm.
   - Rẽ thẳng WebSocket `case "transfer_msg":` sang `SyncMessageController.handleTransferAfterLoginCtrlEvents(...)`
     để nhận cập nhật thả tim / số đếm like / tin nhắn đồng bộ realtime từ phía bên kia.

3. `main-dist/preload-sqlite.js`, `main-dist/main.js`, `main-dist/utility-process-sqlite.js`:
   - Bật `cross_setting: {enable: !0, offFeature: !1, isMobileSupport: !0, ...}`.
   - Bật 2 cờ session/backup SQLite (`!1` -> `!0`).

Idempotent: kiểm tra mẫu trước khi sửa; kiểm tra cú pháp bằng `node --check`.
"""

from __future__ import annotations

import glob
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
APP = Path(os.environ.get("ZALO_APP_DIR") or (ROOT / "build" / "app-extracted"))
PC_DIST = APP / "pc-dist"
MAIN_DIST = APP / "main-dist"
MARKER = "/* zalo-linux-reaction-sync-v3 */"


def fail(msg: str) -> None:
    print(f"patch-reaction-sync: LỖI: {msg}", file=sys.stderr)
    raise SystemExit(1)


def node_check(path: Path) -> None:
    node = shutil.which("node")
    if not node:
        return
    res = subprocess.run([node, "--check", str(path)], capture_output=True, text=True)
    if res.returncode != 0:
        fail(f"node --check thất bại cho {path}:\n{res.stderr.strip()}")


def atomic_write(path: Path, text: str) -> None:
    fd, tmp = tempfile.mkstemp(prefix=path.name + ".", suffix=".js", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(text)
        shutil.copymode(path, tmp)
        node_check(Path(tmp))
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def patch_main_startup() -> None:
    matches = glob.glob(str(PC_DIST / "lazy" / "main-startup.*.js"))
    if not matches:
        fail("không tìm thấy pc-dist/lazy/main-startup.*.js")
    path = Path(matches[0])
    orig = path.read_text(encoding="utf-8", errors="surrogateescape")
    text = orig

    m1_old = (
        'this.messageReadinessChecker=h}isEnable(){const e=this.config.get("cross_setting.offFeature"),'
        't=this.config.get("cross_setting.enable");return!e&&t}isEnableBySrc(e){if(this.metricts.onCheckSyncSuggestion(e),'
        '!this.isEnable())return!1;switch(e){case Eb.j.FIRST_TIME_LOGIN:return this.config.get("cross_setting.enableFirstTimeUse");'
        'case Eb.j.MANUAL:return this.config.get("cross_setting.enableManual");'
        'case Eb.j.OVERFLOW:return this.config.get("cross_setting.enableOverQueue");'
        'case Eb.j.E2EE_MISSING_MESSAGE:return this.config.get("notify_missing_e2ee_message.enable")}return!0}'
        'isEnableResume(){return!!this.isEnable()&&this.config.get("cross_setting.enableResume")}'
    )
    m1_new = "this.messageReadinessChecker=h}isEnable(){return !0}isEnableBySrc(e){return!0}isEnableResume(){return !0}"

    m2_old = "Bt.b.getStateNetwork()===Bt.a.DISCONNECT||Xm.default.getSocketState()!==Zm.l.OPEN)throw new qle.a(Wle.c.NO_NETWORK)"
    m2_new = "!1)throw new qle.a(Wle.c.NO_NETWORK)"

    m3_old = "isFeatureEnabled(){return this.syncConfigService.isFeatureEnabled()}isFeatureEnabledBySyncSource(e){return this.syncConfigService.isFeatureEnabledBySyncSource(e)}"
    m3_new = "isFeatureEnabled(){return !1}isFeatureEnabledBySyncSource(e){return !1}"

    m4_old = 'checkFeatureEnabled(){return this.configService.isFeatureEnabled()?{ok:!0}:(this.logger.zsymb(9,"McyN2K",["Guard feature disabled by server config","H4I92H"]),{ok:!1,reason:"feature_disabled"})}'
    m4_new = "checkFeatureEnabled(){return{ok:!0}}"

    m5_old = 'checkNetwork(){const e=Bt.b.getStateNetwork();return e!==Bt.a.DISCONNECT?{ok:!0}:(this.logger.zsymb(9,"HDOPl6",["Guard network disconnected","jfMl0p"],{networkState:e}),{ok:!1,reason:"network_disconnected",networkState:e})}'
    m5_new = "checkNetwork(){return{ok:!0}}"

    for old, new in [(m1_old, m1_new), (m2_old, m2_new), (m3_old, m3_new), (m4_old, m4_new), (m5_old, m5_new)]:
        if old in text:
            text = text.replace(old, new, 1)
        elif new not in text:
            fail(f"{path.name}: không tìm thấy mẫu cần patch: {old[:60]}...")

    text = re.sub(r"^/\* zalo-linux-reaction-sync-v\d+ \*/\n?", "", text)
    text = f"{MARKER}\n" + text

    if text != orig:
        atomic_write(path, text)
        print(f"    + {path.name}: đã bật msgSync, Guard Service & gỡ NO_NETWORK ({MARKER})")
    else:
        print(f"    = {path.name}: đã ở trạng thái {MARKER}")


RE_TRANSFER_MSG = re.compile(
    r'case"transfer_msg":[A-Za-z_$][\w$]*\.ModuleContainer\.resolve\([A-Za-z_$][\w$]*\.SyncController\)\.isFeatureEnabled\(\)'
    r"\?this\._processSync2Ctrl\(([A-Za-z_$][\w$]*\[[A-Za-z_$][\w$]*\])\)"
    r":([A-Za-z_$][\w$]*\.GlobalResolver\.SyncMessageController\.handleTransferAfterLoginCtrlEvents\(\1\));break;"
)


def patch_worker_and_renderer_bundles() -> None:
    patterns = [
        "lazy/default-login-main-startup-shared-worker-znotification.*.js",
        "compact-app-pc.*.js",
        "search-worker.*.js",
        "sync-v2-sub-worker.*.js",
    ]
    net_repls = [
        (
            'constructor(){this.stateCur=u.NOT_SET,this.preStateCur=null,this.domainIdle="https://www.google.com"',
            'constructor(){this.stateCur=u.CONNECTED,this.preStateCur=null,this.domainIdle="https://www.google.com"',
        ),
        (
            "networkConnected(){this.getStateNetwork()!==u.CONNECTED&&",
            "networkConnected(){this.stateCur!==u.CONNECTED&&",
        ),
        (
            "const n=()=>{this.getStateNetwork()===u.CHECKING?this.ping=this._pingToDomain",
            "const n=()=>{this.stateCur===u.CHECKING?this.ping=this._pingToDomain",
        ),
        (
            '--t,t<=0?(this.getStateNetwork()===u.CONNECTED?d.zsymb(3,"THesj3"',
            '--t,t<=0?(this.stateCur===u.CONNECTED?d.zsymb(3,"THesj3"',
        ),
    ]

    for pat in patterns:
        matches = sorted(glob.glob(str(PC_DIST / pat)))
        if not matches:
            fail(f"không tìm thấy bundle khớp {pat}")
        for m in matches:
            path = Path(m)
            orig = path.read_text(encoding="utf-8", errors="surrogateescape")
            text = orig
            hits = 0

            for old, new in net_repls:
                if old in text:
                    text = text.replace(old, new, 1)
                    hits += 1
                elif new not in text:
                    fail(f"{path.name}: thiếu mẫu network state: {old[:55]}...")

            text, n = RE_TRANSFER_MSG.subn(r'case"transfer_msg":\2;break;', text)
            if n == 0 and 'case"transfer_msg":' in text and "_processSync2Ctrl" in text:
                # Kiểm tra xem nhánh case"transfer_msg" đã gọn chưa
                if not re.search(r'case"transfer_msg":[A-Za-z_$][\w$]*\.GlobalResolver\.SyncMessageController\.handleTransferAfterLoginCtrlEvents', text):
                    fail(f"{path.name}: không thể patch case transfer_msg")
            hits += n

            if text != orig:
                atomic_write(path, text)
                print(f"    + {path.name}: sửa stateCur=CONNECTED + transfer_msg ({hits} điểm)")
            else:
                print(f"    = {path.name}: network state & transfer_msg đã được patch")


RE_BACKUP_FLAGS = re.compile(
    r'(FAILED_TO_DELETE_BACKUP",e\}\(\{\}\);const [A-Za-z_$][\w$]*=)!1'
    r'(,[A-Za-z_$][\w$]*="--backupdata",[A-Za-z_$][\w$]*="ABORT_BACKING_UP_FOR_ALL_SESSION",[A-Za-z_$][\w$]*="CREATE_BACKING_UP_FOR_NO_SESSION";const [A-Za-z_$][\w$]*=)!1(\})'
)


def patch_sqlite_and_session_flags() -> None:
    preload_sqlite = MAIN_DIST / "preload-sqlite.js"
    if preload_sqlite.is_file():
        orig = preload_sqlite.read_text(encoding="utf-8", errors="surrogateescape")
        old_cs = "cross_setting:{offFeature:!1,isMobileSupport:!1,"
        new_cs = "cross_setting:{enable:!0,offFeature:!1,isMobileSupport:!0,"
        if old_cs in orig:
            atomic_write(preload_sqlite, orig.replace(old_cs, new_cs, 1))
            print("    + preload-sqlite.js: bật cross_setting.enable=!0 & isMobileSupport=!0")
        elif new_cs in orig:
            print("    = preload-sqlite.js: cross_setting đã được bật")

    for name in ("main.js", "utility-process-sqlite.js"):
        p = MAIN_DIST / name
        if not p.is_file():
            continue
        orig = p.read_text(encoding="utf-8", errors="surrogateescape")
        text, n = RE_BACKUP_FLAGS.subn(r"\g<1>!0\g<2>!0\g<3>", orig)
        if n > 0 and text != orig:
            atomic_write(p, text)
            print(f"    + {name}: bật 2 cờ session/backup SQLite")
        else:
            print(f"    = {name}: cờ session/backup SQLite đã bật")


def main() -> None:
    print(">>> [reaction-sync] Đang patch đồng bộ tin nhắn, danh sách media & reaction 2 chiều...")
    patch_main_startup()
    patch_worker_and_renderer_bundles()
    patch_sqlite_and_session_flags()
    print("patch-reaction-sync: hoàn thành.")


if __name__ == "__main__":
    main()

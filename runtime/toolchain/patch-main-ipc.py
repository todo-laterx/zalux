#!/usr/bin/env python3
"""patch-main-ipc.py — đưa IPC của Zalo Call sang TCP loopback trên Linux và kích hoạt Call Window.

Bối cảnh:
  - main.js (module `3Zc2`) mở 2 Unix Domain Socket cho helper ZaloCall:
      /tmp/socketzalorecv2021  helper -> main  (dữ liệu call state)
      /tmp/socketzalosend2021  main -> helper  (lệnh từ renderer)
  - Trên Linux ta thay bằng TCP loopback:
      29631  helper -> main (recv)
      29632  main -> helper (send)
  - Helper nhận argv: --recv <port> --send <port> --token <token> [--ui-port <p> --ui-token <t>];
    dòng đầu tiên của mỗi kết nối TCP là token (kèm '\\n'). Token sinh ngẫu nhiên mỗi lần chạy,
    truyền qua argv + env ZALO_LINUX_CALL_IPC_TOKEN / ZCALL_TOKEN.
  - Tự giải phóng cờ gửi `F` ngay trong callback `e.write(t, cb)` trên TCP (kèm watchdog 2s)
    để xả tức thì các frame đa mảnh (`call-init` + `makeCall` + `recvSignal`) không bị kẹt `K-geaR`.
  - Lưu hàm getter động `SG = n` (`() => Ne`) trong `configure(e, t, n)` để luôn gửi IPC về
    `mainWindow` đang sống ngay cả khi cửa sổ chính được khởi tạo lại.
  - Bơm lại gói `D` (`call-init`) trước lệnh `makeCall` và reset `L=!1` khi helper thoát.
  - Khởi động Call Window UI Bridge (`plugins/zcall/bridge.js`) một lần duy nhất khi `app.whenReady()`.
  - Bỏ qua check MD5 macOS `h(e, p)` trên Linux.

Script idempotent: kiểm tra marker ZALO_LINUX_CALL_IPC_PATCHED_V8.
Ghi atomically; kiểm tra cú pháp bằng `node --check` trước khi thay thế.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
APP = Path(os.environ.get("ZALO_APP_DIR") or (ROOT / "build" / "app-extracted"))
MAIN = APP / "main-dist" / "main.js"
MARKER = "ZALO_LINUX_CALL_IPC_PATCHED_V8"

# --- các mảnh cần thay (mỗi mảnh phải xuất hiện đúng số lần trong bản gốc) ----

HEAD_OLD = (
    r'g="win32"===n("jle/").platform(),'
    r'y=g?"\\\\.\\pipe\\PipeZCallSend":"/tmp/socketzalosend2021",'
    r'v=g?"\\\\.\\pipe\\PipeZCallRecv":"/tmp/socketzalorecv2021",'
)
HEAD_NEW = (
    r'g="win32"===n("jle/").platform(),'
    r'LZ="linux"===process.platform,'
    r'ZT=process.env.ZALO_LINUX_CALL_IPC_TOKEN||require("crypto").randomBytes(16).toString("hex"),'
    r'y=g?"\\\\.\\pipe\\PipeZCallSend":LZ?29632:"/tmp/socketzalosend2021",'
    r'v=g?"\\\\.\\pipe\\PipeZCallRecv":LZ?29631:"/tmp/socketzalorecv2021",'
)

LET_S_OLD = "let S,O,D,C,N,A=null,"
LET_S_NEW = "let S,SG,O,D,C,N,A=null,"

DISPATCH_Z_OLD = (
    'function z(e){switch(e.type){case"update":if("native-ready"===e.command)'
    'for(D&&(d.zsymb(4,"CL_4d4",["sending init data","_hMQuZ"]),O(D));P.length>0;){const e=P.shift();O(e)}'
    'else S.webContents.send("call-update",e.command,e.data);break;'
    'case"sendSignal":S.webContents.send("call-send-signal",e.command,e.data);break;'
    'case"request":"killMe"===e.command?(N&&"function"==typeof N.kill&&(M=!0,N.stdin.pause(),N.kill("SIGINT"),d.zsymb(22,"Srt3o9",["do kill native","Q5OM0h"])),d.zsymb(22,"r8ZNfp",["kill native","d0WVsp"])):S.webContents.send("call-request",e.command,e.data);break;'
    'case"response":S.webContents.send("call-response-"+e.command,e.data)}}'
)
DISPATCH_Z_NEW = (
    'const SW=()=>{const e="function"==typeof SG?SG():S;'
    "return e&&!e.isDestroyed()&&e.webContents&&!e.webContents.isDestroyed()?e.webContents:"
    "S&&!S.isDestroyed()&&S.webContents&&!S.webContents.isDestroyed()?S.webContents:null};"
    'function z(e){const w=SW();switch(e.type){case"update":if("native-ready"===e.command)'
    'for(D&&(d.zsymb(4,"CL_4d4",["sending init data","_hMQuZ"]),O(D));P.length>0;){const e=P.shift();O(e)}'
    'else w&&w.send("call-update",e.command,e.data);break;'
    'case"sendSignal":w&&w.send("call-send-signal",e.command,e.data);break;'
    'case"request":"killMe"===e.command?(N&&"function"==typeof N.kill&&(M=!0,N.stdin.pause(),N.kill("SIGINT"),d.zsymb(22,"Srt3o9",["do kill native","Q5OM0h"])),d.zsymb(22,"r8ZNfp",["kill native","d0WVsp"])):w&&w.send("call-request",e.command,e.data);break;'
    'case"response":w&&w.send("call-response-"+e.command,e.data)}}'
)

FREE_STATE_OLD = 'S&&S.webContents&&S.webContents.send("call-update","callState",{state:"free"})'
FREE_STATE_NEW = '(w=>{w&&w.send("call-update","callState",{state:"free"})})(SW())'

SEND_END_FREE_OLD = 'S&&!S.isDestroyed()&&S.webContents&&!S.webContents.isDestroyed()&&S.webContents.send("call-update","callState",{state:"free"})'
SEND_END_FREE_NEW = '(w=>{w&&w.send("call-update","callState",{state:"free"})})(SW())'

DRAIN_GUARD_OLD = 'W=e=>{if(U)if(F)d.zsymb(4,"K-geaR",["socket send is sending","xmB5Wx"]);else if(e){'
DRAIN_GUARD_NEW = 'W=e=>{if(U)if(F)d.zsymb(4,"K-geaR",["socket send is sending","xmB5Wx"]);else if(e&&!e.destroyed){'

DO_SEND_OLD = '$=(e,t)=>{if(t&&t.constructor==String)try{F=!0,e.write(t)}catch(n)'
DO_SEND_NEW = '$=(e,t)=>{if(t&&t.constructor==String)try{if(F=!0,LZ){const r=setTimeout((()=>{F&&(F=!1,W(e))}),2e3);e.write(t,(()=>{clearTimeout(r),F=!1,W(e)}))}else e.write(t)}catch(n)'

QUEUE_SEND_OLD = "O=t=>{g?V(e,t):G(e,t)}"
QUEUE_SEND_NEW = "O=t=>{g?V(e,t):!LZ||e&&!e.destroyed?G(e,t):x.push(t)}"

SEND_DATA_OLD = (
    'e.on("data",(t=>{d.zsymb(4,"ki-Wxl",["serverSend on data","h6P5nc"],t),'
    "g||(F=!1,W(e))}))"
)
SEND_DATA_NEW = (
    'LZ?LZK(e,(t=>{d.zsymb(4,"ki-Wxl",["serverSend on data","h6P5nc"],t),'
    "F=!1,W(e)})):" + SEND_DATA_OLD
)

# Hàm đọc token ở dòng đầu tiên của kết nối TCP. Buffer cho phép dữ liệu nhị
# phân đi qua nguyên vẹn (video Annex-B), khác với setEncoding().
TOKEN_GATE = (
    "const LZK=(e,t)=>{"
    "let b=Buffer.alloc(0),d=!1;"
    "const h=n=>{"
    "if(d)return t(n);"
    "b=Buffer.concat([b,Buffer.isBuffer(n)?n:Buffer.from(n)]);"
    "const i=b.indexOf(10);"
    "if(i<0)return void(b.length>4096&&e.destroy());"
    'const l=b.subarray(0,i).toString("utf8").replace(/\\r$/,"");'
    "if(l!==ZT)return void e.destroy();"
    'd=!0,e.removeListener("data",h);'
    "const r=b.subarray(i+1);"
    'e.on("data",t),r.length&&t(r)'
    "};"
    'e.on("data",h)'
    "};"
)

E_RESOLVE_OLD = (
    'e=function(){let e=null;return"win32"===process.platform?'
    'e=u()?o.join(__dirname,"..","native","qt-call-and-cap","ZaloCall.exe"):o.join(o.dirname(i.getPath("exe")),"plugins","capture","ZaloCall.exe"):'
    '(e=u()?o.join(__dirname,"..","native","qt-call-cap-mac","ZaloHelper.app"):o.join(o.dirname(i.getPath("exe")),"..","ZaloHelper.app"),'
    'e=o.join(e,"Contents","MacOS","ZaloCall")),e}();'
)
E_RESOLVE_NEW = (
    'e=function(){let e=null;return"win32"===process.platform?'
    'e=u()?o.join(__dirname,"..","native","qt-call-and-cap","ZaloCall.exe"):o.join(o.dirname(i.getPath("exe")),"plugins","capture","ZaloCall.exe"):'
    "LZ?(e=function(){"
    'const fs=require("fs");'
    "let b=process.env.ZCALL_ENGINE_BIN||process.env.ZCALL_ENGINE;"
    "if(b&&fs.existsSync(b))return b;"
    "const cands=["
    'process.resourcesPath?o.join(process.resourcesPath,"app.asar.unpacked","zcall-engine"):"",'
    'o.join(o.dirname(i.getPath("exe")),"zcall-engine"),'
    'o.join(__dirname,"..","zcall-engine"),'
    'process.resourcesPath?o.join(process.resourcesPath,"app.asar.unpacked","native","qt-call-cap-mac","ZaloHelper.app","Contents","MacOS","ZaloCall"):"",'
    'process.resourcesPath?o.join(process.resourcesPath,"native","qt-call-cap-mac","ZaloHelper.app","Contents","MacOS","ZaloCall"):"",'
    'o.join(__dirname,"..","native","qt-call-cap-mac","ZaloHelper.app","Contents","MacOS","ZaloCall")'
    "];"
    'for(const c of cands){if(c&&(!c.includes(".asar/")||c.includes(".asar.unpacked/"))&&fs.existsSync(c))return c;}'
    'return""}())'
    ':(e=u()?o.join(__dirname,"..","native","qt-call-cap-mac","ZaloHelper.app"):o.join(o.dirname(i.getPath("exe")),"..","ZaloHelper.app"),'
    'e=o.join(e,"Contents","MacOS","ZaloCall")),e}();'
)

VERIFY_MD5_OLD = 'h(e,p).then((t=>{if(T&&!t)return L=!1,j(w.DID_LOAD_FAIL),void d.zsymb(22,"hjs9A2",["invalid call","36BT8D"]);'
VERIFY_MD5_NEW = '(LZ?Promise.resolve(!0):h(e,p)).then((t=>{if(T&&!t)return L=!1,j(w.DID_LOAD_FAIL),void d.zsymb(22,"hjs9A2",["invalid call","36BT8D"]);'

SPAWN_OLD = "N=i(e,[v,y])"
SPAWN_NEW = (
    "LZ?(function(){"
    'const LZ_ARGS=["--recv",String(v),"--send",String(y),"--token",ZT];'
    'if(process.env.ZCALL_UI_PORT){LZ_ARGS.push("--ui-port",process.env.ZCALL_UI_PORT,"--ui-token",process.env.ZCALL_UI_TOKEN||"");}'
    "const LZ_ENV=Object.assign({},process.env,{ZALO_LINUX_CALL_IPC_TOKEN:ZT,ZCALL_TOKEN:ZT});"
    'if(e.endsWith(".js")){'
    'LZ_ENV.ELECTRON_RUN_AS_NODE="1";'
    "N=i(process.execPath,[e,...LZ_ARGS],{env:LZ_ENV});"
    "}else{"
    'for(const _k of Object.keys(LZ_ENV)){if(/^(SNAP|LD_LIBRARY_PATH|LD_PRELOAD|GIO_MODULE_DIR|GTK_PATH|GTK_EXE_PREFIX|LOCPATH)/.test(_k))delete LZ_ENV[_k];}'
    "N=i(e,LZ_ARGS,{env:LZ_ENV});"
    "}"
    "})():N=i(e,[v,y])"
)

CHILD_ERR_OLD = 'N.on("error",(e=>{d.zsymb(22,"1ZoLBj",["client error","4VJfAv"],e)}))'
CHILD_ERR_NEW = 'N.on("error",(e=>{LZ&&(L=!1),d.zsymb(22,"1ZoLBj",["client error","4VJfAv"],e)})),LZ&&N.on("exit",(()=>{L=!1}))'

CONFIGURE_OLD = 'configure:function(e,t,n){S=n(),C=_.logControl,e&&e.on("call-send-to-native",((e,t)=>{t._optional?delete t._optional:K(),O(t)}))'
CONFIGURE_NEW = 'configure:function(e,t,n){SG=n,S="function"==typeof n?n():n,C=_.logControl,e&&e.on("call-send-to-native",((e,t)=>{t._optional?delete t._optional:K(),LZ&&U&&t&&"makeCall"===t.command&&D&&O(D),O(t)}))'

CALL_WIN_INJECT = (
    "\n// ZALO LINUX CALL WINDOW START\n"
    "(function(){\n"
    '  if (process.platform !== "linux" || global.__zaloCallWindowStarted) return;\n'
    "  global.__zaloCallWindowStarted = true;\n"
    "  try {\n"
    '    const { app: _zaApp } = require("electron");\n'
    '    const _zaZcall = require("../plugins/zcall/bridge");\n'
    "    _zaApp.whenReady().then(async () => {\n"
    "      await _zaZcall.start();\n"
    '      console.log("[zcall] Call Window UI Server started, UI_PORT=" + process.env.ZCALL_UI_PORT);\n'
    "    });\n"
    "  } catch (_zaErr) {\n"
    '    console.error("[zcall] Failed to start Call Window server:", _zaErr);\n'
    "  }\n"
    "})();\n"
    "// ZALO LINUX CALL WINDOW END\n"
    "\n// ZALO LINUX HIDE MAC TITLEBAR ALL WINDOWS START\n"
    "(function(){\n"
    '  if (process.platform !== "linux" || global.__zaloHideMacBar) return;\n'
    "  global.__zaloHideMacBar = true;\n"
    "  try {\n"
    '    const { app } = require("electron");\n'
    "    const CSS = '#titleBar{display:none!important}'\n"
    "      + '.header-action-zone-mac{display:none!important}'\n"
    "      + '.traffic-light,[class*=\"traffic-light\"],[class*=\"trafficLight\"]{display:none!important}';\n"
    '    app.on("web-contents-created", (_evt, wc) => {\n'
    "      const apply = () => { try { wc.insertCSS(CSS); } catch (_) {} };\n"
    "      try {\n"
    '        wc.on("did-finish-load", apply);\n'
    '        wc.on("did-navigate-in-page", apply);\n'
    '        wc.on("dom-ready", apply);\n'
    "      } catch (_) {}\n"
    "    });\n"
    "  } catch (_) {}\n"
    "})();\n"
    "// ZALO LINUX HIDE MAC TITLEBAR ALL WINDOWS END\n"
)

REPLACEMENTS: list[tuple[str, str, str, int]] = [
    ("khai báo cổng/token Linux", HEAD_OLD, HEAD_NEW, 1),
    ("khai báo getter động SG cho mainWindow", LET_S_OLD, LET_S_NEW, 1),
    ("dispatch z(e) qua getter động SW()", DISPATCH_Z_OLD, DISPATCH_Z_NEW, 1),
    ("callState free qua SW() khi end/exit", FREE_STATE_OLD, FREE_STATE_NEW, 2),
    ("callState free qua SW() trên serverSend end", SEND_END_FREE_OLD, SEND_END_FREE_NEW, 1),
    ("send queue: kiểm tra !e.destroyed", DRAIN_GUARD_OLD, DRAIN_GUARD_NEW, 1),
    ("doSendToNative: xả tức thì qua write callback trên TCP", DO_SEND_OLD, DO_SEND_NEW, 1),
    ("queue fallback khi socket đóng", QUEUE_SEND_OLD, QUEUE_SEND_NEW, 1),
    ("recv: bỏ unlink khi EADDRINUSE", "g||a.unlink(v,", "g||LZ||a.unlink(v,", 1),
    ("send: bỏ unlink khi EADDRINUSE", "g||(U=!1,a.unlink(y,", "g||LZ||(U=!1,a.unlink(y,", 1),
    (
        "recv: listen(29631, 127.0.0.1) lần đầu",
        'I.listen(v,(()=>{d.zsymb(4,"HeLRt6"',
        'I.listen(v,LZ?"127.0.0.1":void 0,(()=>{d.zsymb(4,"HeLRt6"',
        1,
    ),
    (
        "recv: listen(29631, 127.0.0.1) khi phục hồi",
        'I.listen(v,(()=>{d.zsymb(3,"IDOs1S"',
        'I.listen(v,LZ?"127.0.0.1":void 0,(()=>{d.zsymb(3,"IDOs1S"',
        1,
    ),
    (
        "send: listen(29632, 127.0.0.1) lần đầu",
        'A.listen(y,(()=>{d.zsymb(4,"S_K_F_"',
        'A.listen(y,LZ?"127.0.0.1":void 0,(()=>{d.zsymb(4,"S_K_F_"',
        1,
    ),
    (
        "send: listen(29632, 127.0.0.1) khi phục hồi",
        'A.listen(y,(()=>{d.zsymb(3,"Fjoz_b"',
        'A.listen(y,LZ?"127.0.0.1":void 0,(()=>{d.zsymb(3,"Fjoz_b"',
        1,
    ),
    (
        "recv: kiểm tra token dòng đầu",
        'e.on("data",(e=>{Y(e)}))',
        'LZ?LZK(e,Y):e.on("data",(e=>{Y(e)}))',
        1,
    ),
    ("send: kiểm tra token dòng đầu", SEND_DATA_OLD, SEND_DATA_NEW, 1),
    ("helper binary resolution Linux", E_RESOLVE_OLD, E_RESOLVE_NEW, 1),
    ("bỏ qua verifyMd5 trên Linux", VERIFY_MD5_OLD, VERIFY_MD5_NEW, 1),
    ("spawn helper với argv + token + ui", SPAWN_OLD, SPAWN_NEW, 1),
    ("reset L=!1 khi helper error/exit", CHILD_ERR_OLD, CHILD_ERR_NEW, 1),
    ("configure getter SG + bơm call-init (D) trước makeCall", CONFIGURE_OLD, CONFIGURE_NEW, 1),
    (
        "chèn token gate & ghép mảnh dòng $ (kể cả multipart #msgId#total#idx#)",
        'const Y=e=>{e=e.toString(),d.zsymb(15,"rhbp6Y",["serverRecv on data","C9Lkzz"],e);const t=e.split(/\\$/gm);for(let r of t)',
        TOKEN_GATE
        + 'let LZY="";const LZM=new Map;const LZF=r=>{'
        + 'if(!r||!r.includes("#"))return r;'
        + 'const p=r.split("#");'
        + 'if(5!==p.length||""!==p[4])return r;'
        + 'const[h,id,ts,is]=p,tot=Number(ts),idx=Number(is);'
        + 'if(!h||!(tot>0)||tot>4096||idx<0||idx>=tot)return null;'
        + 'let st=LZM.get(id);if(!st){st={t:tot,p:new Map};LZM.set(id,st)}'
        + 'st.t=tot,st.p.set(idx,h);'
        + 'if(st.p.size<st.t)return"";'
        + 'LZM.delete(id);let out="";'
        + 'for(let i=0;i<st.t;i++){const c=st.p.get(i);if(!c)return null;out+=c}'
        + 'return out};'
        + 'const Y=e=>{LZY+=e.toString(),d.zsymb(15,"rhbp6Y",["serverRecv on data","C9Lkzz"],e);const t=LZY.split("$");LZY=t.pop()||"";for(let r of t)if(r=LZF(r),null===r)d.zsymb(22,"Lt8SMT",["cannot parse payload","vTypgR"]);else ',
        1,
    ),
]


def fail(msg: str) -> "NoReturn":  # type: ignore[name-defined]
    print(f"patch-main-ipc: LỖI: {msg}", file=sys.stderr)
    raise SystemExit(1)


def run_node_check(path: Path) -> None:
    node = shutil.which("node")
    if not node:
        print("    ! không có node, bỏ qua node --check", file=sys.stderr)
        return
    res = subprocess.run([node, "--check", str(path)], capture_output=True, text=True)
    if res.returncode != 0:
        fail(f"node --check thất bại:\n{res.stderr.strip()}")


def main() -> None:
    if not MAIN.is_file():
        fail(f"không thấy {MAIN} — chạy extract-dmg.sh trước")

    current_text = MAIN.read_text(encoding="utf-8")
    if MARKER in current_text:
        print(f"patch-main-ipc: đã patch ({MARKER}), bỏ qua.")
        return

    backup = MAIN.with_suffix(MAIN.suffix + ".zalo-linux.orig")
    if backup.exists():
        source_text = backup.read_text(encoding="utf-8")
    else:
        source_text = current_text
        shutil.copy2(MAIN, backup)
        print(f"    backup: {backup.name}")

    patched = source_text
    changes: list[str] = []
    for label, old, new, expected in REPLACEMENTS:
        count = patched.count(old)
        if count != expected:
            fail(f'"{label}": tìm thấy {count} lần, mong đợi {expected}')
        patched = patched.replace(old, new, expected)
        changes.append(label)

    patched = f"// {MARKER}\n" + patched + CALL_WIN_INJECT

    fd, tmp_name = tempfile.mkstemp(prefix="main.js.", suffix=".js", dir=str(MAIN.parent))
    tmp = Path(tmp_name)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(patched)
        shutil.copymode(MAIN, tmp)
        run_node_check(tmp)
        os.replace(tmp, MAIN)
    finally:
        if tmp.exists():
            tmp.unlink()

    print("patch-main-ipc: hoàn thành.")
    for label in changes:
        print(f"    + {label}")
    print("    ports: 29631 (helper -> main recv), 29632 (main -> helper send)")
    print("    Call Window: tự động start server và nhận incoming/outgoing call")


if __name__ == "__main__":
    main()

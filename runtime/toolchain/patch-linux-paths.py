#!/usr/bin/env python3
"""patch-linux-paths.py — vá toàn diện API Platform ID, đường dẫn XDG Linux, Disk Check, Clipboard & Notification.

1. `main-dist/main.js`:
   - Đổi `platformType` của `LINUX` từ `25` -> `23` (giả danh macOS client ID để server Zalo
     cấp đủ feature flags: Media/File/Link list, Reaction push sync, Call, Cross-device sync).
   - Bỏ `mainWindow.show()` khi đang thoát ứng dụng trên Linux.
   - Bọc `async try/catch` + cấu hình đường dẫn cho `AutoLaunch` trên Linux.
   - Tự đóng cửa sổ thông báo sau 5s (`y.closeIfSafe()`) tránh treo popup sau cuộc gọi.

2. Đường dẫn người dùng theo chuẩn XDG (`Documents`, `Downloads`, `Zalo Received Files`,
   `resolveLocalizedUserPath`, `checkDownloadDirectoryExists`) trên toàn bộ **12 bundle**:
   - 8 file `main-dist/`: `main.js`, `utility-process-sqlite.js`, `preload-render.js`,
     `preload-sqlite.js`, `preload-shared-worker.js`, `preload-noti.js`,
     `compact-app.js`, `compact-app-preload.js`.
   - 4 bundle `pc-dist/`: `lazy/default-login-main-startup-shared-worker-znotification.*.js`,
     `compact-app-pc.*.js`, `search-worker.*.js`, `sync-v2-sub-worker.*.js`.
   - Bổ sung kiểm tra `n.isDirectory()` trên Linux trong `main.js` & `compact-app.js`.

3. `analyzeMainDisk()` trên 4 bundle `pc-dist/`:
   - Đổi kiểm tra cứng `e="/"` sang `Object(<pathMod>.getZaloDirSync)()` để đo đúng phân vùng chứa dữ liệu Zalo.

4. Clipboard Paste Ảnh/Screenshot/File trên Linux (Wayland `wl-paste` + X11 `xclip` + Electron `clipboard` + giải mã `file://`):
   - Thay thế `startGetClipboard` & `startRewriteClipboard` trong `main.js` và `compact-app.js` để đọc trực tiếp ảnh chụp màn hình và URI file local trên Linux (không phụ thuộc helper macOS), ghi cache PNG định danh `/tmp/zalux-clipboard/clip-<sha1>.png` và cấp quyền `setTrustPath`.
   - Nâng cấp `getClipboardImage` (+ `getClipboardImagePNG`, `getClipboardFilePath`, `deleteFile`, `saveClipboardImageToTemp`) trong 5 file preload (`preload-render.js`, `preload-sqlite.js`, `preload-shared-worker.js`, `preload-noti.js`, `compact-app-preload.js`).
   - Vá luồng paste ảnh/screenshot trong `pc-dist/` (`default-login-main-startup-shared-worker-znotification.*.js` & `compact-app-pc.*.js`): xử lý `getAsFile()===null` trên Wayland/XWayland, giữ nguyên dấu `/` cho `loadClipboardFiles` trên Linux, chặn mảng `[""]` khi `content` rỗng.

5. Notification Dark Theme & Watchdog (`preload-noti.js`):
   - Tự huỷ cửa sổ thông báo rỗng (1.2s / 3s) và đóng an toàn sau 6s.

Idempotent: kiểm tra marker/mẫu trước khi sửa; xác thực cú pháp bằng `node --check`.
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
MAIN_DIST = APP / "main-dist"
PC_DIST = APP / "pc-dist"


def fail(msg: str) -> None:
    print(f"patch-linux-paths: LỖI: {msg}", file=sys.stderr)
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


# ---------------------------------------------------------------------------
# 1. XDG Localized Paths (12 files)
# ---------------------------------------------------------------------------

XDG_EXPORTS_INJECT = (
    'n.d(t,"getdocumentsDir",(function(){return zflGetDocumentsDir})),'
    'n.d(t,"getdocumentsDirSync",(function(){return zflGetDocumentsDirSync})),'
    'n.d(t,"getdownloadsDir",(function(){return zflGetDownloadsDir})),'
    'n.d(t,"getdownloadsDirSync",(function(){return zflGetDownloadsDirSync})),'
    'n.d(t,"resolveLocalizedUserPath",(function(){return zflResolveLocalizedUserPath})),'
    'n.d(t,"getexeDir",'
)

RE_MGR_DB = re.compile(
    r"(const ([A-Za-z_$][\w$]*)=[A-Za-z_$][\w$]*\.ModuleContainer\.resolve\([A-Za-z_$][\w$]*\.a\)\.createAppPathManager\(\),"
    r'([A-Za-z_$][\w$]*)=(?:"renderer"===__SCRIPT_TYPE__\?\$znode\.path:n\("ipWf"\)|n\("oyvS"\)),)'
    r'([A-Za-z_$][\w$]*=async e=>\{const\{getDbSearchPaths:t\}=n\("Acu\+"\);)'
)

RE_MGR_PRELOAD = re.compile(
    r"(const ([A-Za-z_$][\w$]*)=[A-Za-z_$][\w$]*\.ModuleContainer\.resolve\([A-Za-z_$][\w$]*\.a\)\.createAppPathManager\(\),"
    r"([A-Za-z_$][\w$]*)=\$znode\.path,)"
    r'([A-Za-z_$][\w$]*=\(\)=>\2\.getPathSync\("userData"\))'
)

RE_ZRF_ASYNC = re.compile(
    r'([A-Za-z_$][\w$]*)\.join\(await [A-Za-z_$][\w$]*\(\),"Documents","Zalo Received Files",\1\.sep\)'
)

RE_ZRF_SYNC = re.compile(
    r'([A-Za-z_$][\w$]*)=\(\)=>([A-Za-z_$][\w$]*)\.join\([A-Za-z_$][\w$]*\(\),"Documents","Zalo Received Files",\2\.sep\),'
    r'([A-Za-z_$][\w$]*)=\(\)=>\2\.join\([A-Za-z_$][\w$]*\(\),"Documents","Zalo Received Files",\2\.sep\)'
)

RE_RESOLVE_ZRF = re.compile(
    r"(const e=\$znode\.path,n=Object\(([A-Za-z_$][\w$]*)\.gethomeDirSync\)\(\),([A-Za-z_$][\w$]*)=)"
    r"e\.resolve\(n,t\.path\)"
    r"(;return \$znode\.fsExtra\.ensureDirSync\(\3\))"
)

RE_DEFAULT_DOC_CHECK = re.compile(
    r'([A-Za-z_$][\w$]*)\.join\(Object\(([A-Za-z_$][\w$]*)\.gethomeDirSync\)\(\),"Documents","Zalo Received Files",\1\.sep\)'
)

RE_DOWNLOAD_EXISTS = re.compile(
    r"checkDownloadDirectoryExists\(\)\{try\{let e=await Object\(([A-Za-z_$][\w$]*)\.gethomeDir\)\(\),"
    r't=[A-Za-z_$][\w$]*\.join\(e,"Downloads"\);return this\.folderExist\(t\)\?t:null\}'
)


def make_xdg_helpers(mgr: str, path_var: str) -> str:
    return (
        f'zflGetDocumentsDir=async()=>({path_var}.join(await {mgr}.getPath("documents"),{path_var}.sep)),'
        f'zflGetDocumentsDirSync=()=>({path_var}.join({mgr}.getPathSync("documents"),{path_var}.sep)),'
        f'zflGetDownloadsDir=async()=>({path_var}.join(await {mgr}.getPath("downloads"),{path_var}.sep)),'
        f'zflGetDownloadsDirSync=()=>({path_var}.join({mgr}.getPathSync("downloads"),{path_var}.sep)),'
        f"zflResolveLocalizedUserPath=e=>{{"
        f"if({path_var}.isAbsolute(e))return {path_var}.resolve(e);"
        f"const t=e.split(/[\\\\/]+/),n=t[0].toLowerCase();"
        f'return"documents"===n?{path_var}.resolve(zflGetDocumentsDirSync(),...t.slice(1)):'
        f'"downloads"===n?{path_var}.resolve(zflGetDownloadsDirSync(),...t.slice(1)):'
        f'{path_var}.resolve({mgr}.getPathSync("home"),e)'
        f"}},"
    )


def apply_xdg_paths(text: str, label: str, is_pc_bundle: bool = False) -> tuple[str, int]:
    hits = 0

    if '"resolveLocalizedUserPath"' not in text:
        anchor = 'n.d(t,"getexeDir",'
        if text.count(anchor) != 1:
            fail(f"{label}: tìm thấy {text.count(anchor)} lần '{anchor}', mong đợi 1")
        text = text.replace(anchor, XDG_EXPORTS_INJECT, 1)
        hits += 1

    mgr_var: str | None = None
    m1 = RE_MGR_DB.search(text)
    m2 = RE_MGR_PRELOAD.search(text)
    if "zflResolveLocalizedUserPath=" not in text:
        if m1:
            mgr_var = m1.group(2)
            path_var = m1.group(3)
            helpers = make_xdg_helpers(mgr_var, path_var)
            text = text[: m1.start()] + m1.group(1) + helpers + m1.group(4) + text[m1.end() :]
            hits += 1
        elif m2:
            mgr_var = m2.group(2)
            path_var = m2.group(3)
            helpers = make_xdg_helpers(mgr_var, path_var)
            text = text[: m2.start()] + m2.group(1) + helpers + m2.group(4) + text[m2.end() :]
            hits += 1
        else:
            fail(f"{label}: không tìm thấy createAppPathManager để chèn XDG helpers")
    else:
        # Đã chèn trước đó -> lấy lại tên biến mgr_var
        m_existing = re.search(r'zflGetDocumentsDir=async\(\)=>\(?[A-Za-z_$][\w$]*\.join\(await ([A-Za-z_$][\w$]*)\.getPath\("documents"\)', text)
        if m_existing:
            mgr_var = m_existing.group(1)

    if mgr_var:
        text, n = RE_ZRF_ASYNC.subn(rf'\1.join(await {mgr_var}.getPath("documents"),"Zalo Received Files",\1.sep)', text)
        hits += n
        text, n = RE_ZRF_SYNC.subn(
            rf'\1=()=>\2.join({mgr_var}.getPathSync("documents"),"Zalo Received Files",\2.sep),'
            rf'\3=()=>\2.join({mgr_var}.getPathSync("documents"),"Zalo Received Files",\2.sep)',
            text,
        )
        hits += n

    text, n = RE_RESOLVE_ZRF.subn(r"\1Object(\2.resolveLocalizedUserPath)(t.path)\4", text)
    hits += n

    if is_pc_bundle:
        text, n = RE_DEFAULT_DOC_CHECK.subn(r'\1.join(Object(\2.getdocumentsDirSync)(),"Zalo Received Files",\1.sep)', text)
        hits += n
        text, n = RE_DOWNLOAD_EXISTS.subn(
            r"checkDownloadDirectoryExists(){try{let t=await Object(\1.getdownloadsDir)();return this.folderExist(t)?t:null}",
            text,
        )
        hits += n

    return text, hits


# ---------------------------------------------------------------------------
# 2. Clipboard Wayland/X11 + Notification Watchdog + Main/Compact fixes
# ---------------------------------------------------------------------------

MAIN_SCREENCAP_CLIPBOARD_MARKER = "/*ZFL_MAIN_CLIPBOARD_V1*/"
RE_MAIN_SCREENCAP_CLIPBOARD = re.compile(
    r'startGetClipboard:function\(e\)\{return new Promise\(\(\(t,n\)=>\{[A-Za-z_$][\w$]*&&[A-Za-z_$][\w$]*!==[A-Za-z_$][\w$]*\.DIE\?'
    r'\([A-Za-z_$][\w$]*\[e\+"-get-clipboard"\]=\{resolve:t,reject:n\},[A-Za-z_$][\w$]*\.getClipboard\(e\)\):'
    r'\([A-Za-z_$][\w$]*\.zsymb\(21,"qoD7bD",\["get-clipboard: app not ready, appState: \{\}, capture process: \{\}","zbA1Px"\],[A-Za-z_$][\w$]*,!![A-Za-z_$][\w$]*\),n\(new Error\("clipboard native not ready"\)\)\)\}\)\)\},'
    r'(restartCap:function\(e\)\{[^}]+\}),'
    r'startRewriteClipboard:function\(e\)\{return new Promise\(\(\(t,n\)=>\{[A-Za-z_$][\w$]*&&[A-Za-z_$][\w$]*!==[A-Za-z_$][\w$]*\.DIE\?'
    r'\([A-Za-z_$][\w$]*\[e\+"-rewrite-clipboard"\]=\{resolve:t,reject:n\},[A-Za-z_$][\w$]*\.rewriteClipboardBitmap\(e\)\):'
    r'\([A-Za-z_$][\w$]*\.zsymb\(21,"Kstrr8",\["rewrite-clipboard: app not ready, appState: \{\}, capture process: \{\}","jcWZYD"\],[A-Za-z_$][\w$]*,!![A-Za-z_$][\w$]*\),n\(new Error\("clipboard native not ready"\)\)\)\}\)\)\}'
)


def make_main_screencap_clipboard(restart_cap_clause: str) -> str:
    return (
        "startGetClipboard:function(e){"
        f"{MAIN_SCREENCAP_CLIPBOARD_MARKER}"
        "return new Promise((t=>{"
        'const r=String(null==e?"":e),'
        '_el=require("electron"),_fs=require("fs"),_os=require("os"),_path=require("path"),_cp=require("child_process"),_cr=require("crypto"),'
        "o=buf=>{"
        "if(!buf||!buf.length)return[];"
        'const out=[],seen=new Set(),lines=buf.toString("utf8").split(/\\r?\\n/);'
        "for(const raw of lines){"
        "const s=raw.trim();"
        'if(!s||s.startsWith("#")||"copy"===s||"cut"===s)continue;'
        'if(s.startsWith("file://")){'
        "try{"
        'let u=decodeURIComponent(s.replace(/^file:\\/\\/(?:localhost)?/i,""));'
        "if(u&&!seen.has(u)&&_fs.existsSync(u)){seen.add(u);out.push(u)}"
        "}catch(_){}"
        "}"
        "}"
        "return out"
        "},"
        "savePng=png=>{"
        "if(!png||!png.length)return null;"
        'const base=process.env.XDG_RUNTIME_DIR||_os.tmpdir(),'
        'uid=typeof process.getuid==="function"?process.getuid():"u",'
        'dir=process.env.XDG_RUNTIME_DIR?_path.join(base,"zalux-clipboard"):_path.join(base,`zalux-clipboard-${uid}`);'
        "_fs.mkdirSync(dir,{recursive:!0,mode:448});"
        "try{_fs.chmodSync(dir,448)}catch(_){}"
        "try{"
        "const now=Date.now();"
        "for(const f of _fs.readdirSync(dir)){"
        'if(!f.startsWith("clip-"))continue;'
        "const fp=_path.join(dir,f);"
        "try{if(now-_fs.statSync(fp).mtimeMs>18e5)_fs.unlinkSync(fp)}catch(_){}"
        "}"
        "}catch(_){}"
        'const h=_cr.createHash("sha1").update(png).digest("hex").slice(0,12),'
        "fp=_path.join(dir,`clip-${h}.png`);"
        "if(!_fs.existsSync(fp))_fs.writeFileSync(fp,png,{mode:384});"
        "return fp"
        "};"
        "try{"
        'for(const m of["text/uri-list","x-special/gnome-copied-files"]){'
        "const u=o(_el.clipboard.readBuffer(m));"
        'if(u.length>0)return void t({requestId:r,content:u.join("|")})'
        "}"
        "let img=_el.clipboard.readImage();"
        'if(!img||img.isEmpty())for(const m of["image/png","image/jpeg","image/bmp","image/webp"]){'
        "try{const b=_el.clipboard.readBuffer(m);if(b&&b.length>0){const ni=_el.nativeImage.createFromBuffer(b);if(ni&&!ni.isEmpty()){img=ni;break}}}catch(_){}"
        "}"
        "if(img&&!img.isEmpty()){"
        "const fp=savePng(img.toPNG());"
        "if(fp)return void t({requestId:r,content:fp})"
        "}"
        "}catch(_){}"
        "const run=(cmd,args)=>new Promise((res=>{"
        'try{_cp.execFile(cmd,args,{encoding:"buffer",timeout:800,maxBuffer:67108864},((err,stdout)=>res(!err&&stdout&&stdout.length?stdout:null)))}catch(_){res(null)}'
        "}));"
        "(async()=>{"
        "try{"
        "if(process.env.WAYLAND_DISPLAY){"
        'const tb=await run("wl-paste",["--list-types"]),types=tb?tb.toString("utf8"):"";'
        'for(const m of["x-special/gnome-copied-files","text/uri-list"])if(types.includes(m)){'
        'const u=o(await run("wl-paste",["--no-newline","--type",m]));'
        'if(u.length>0)return void t({requestId:r,content:u.join("|")})'
        "}"
        'for(const m of["image/png","image/jpeg","image/bmp","image/webp"])if(types.includes(m)){'
        'const b=await run("wl-paste",["--type",m]);'
        "if(b&&b.length>0){"
        'const png="image/png"===m?b:_el.nativeImage.createFromBuffer(b).toPNG(),'
        "fp=savePng(png);"
        "if(fp)return void t({requestId:r,content:fp})"
        "}"
        "}"
        "}else if(process.env.DISPLAY){"
        'const tb=await run("xclip",["-selection","clipboard","-t","TARGETS","-o"]),types=tb?tb.toString("utf8"):"";'
        'for(const m of["x-special/gnome-copied-files","text/uri-list"])if(types.includes(m)){'
        'const u=o(await run("xclip",["-selection","clipboard","-t",m,"-o"]));'
        'if(u.length>0)return void t({requestId:r,content:u.join("|")})'
        "}"
        'for(const m of["image/png","image/jpeg","image/bmp"])if(types.includes(m)){'
        'const b=await run("xclip",["-selection","clipboard","-t",m,"-o"]);'
        "if(b&&b.length>0){"
        'const png="image/png"===m?b:_el.nativeImage.createFromBuffer(b).toPNG(),'
        "fp=savePng(png);"
        "if(fp)return void t({requestId:r,content:fp})"
        "}"
        "}"
        "}"
        "}catch(_){}"
        't({requestId:r,content:""})'
        "})()"
        "}))},"
        f"{restart_cap_clause},"
        "startRewriteClipboard:function(e){"
        "return new Promise((t=>{"
        'const r=String(null==e?"":e),_el=require("electron"),_cp=require("child_process");'
        "try{"
        "let img=_el.clipboard.readImage();"
        'if(!img||img.isEmpty())for(const m of["image/png","image/jpeg","image/bmp","image/webp"]){'
        "try{const b=_el.clipboard.readBuffer(m);if(b&&b.length>0){const ni=_el.nativeImage.createFromBuffer(b);if(ni&&!ni.isEmpty()){img=ni;break}}}catch(_){}"
        "}"
        "if(img&&!img.isEmpty()){_el.clipboard.writeImage(img);return void t({requestId:r})}"
        "}catch(_){}"
        "const run=(cmd,args)=>new Promise((res=>{"
        'try{_cp.execFile(cmd,args,{encoding:"buffer",timeout:800,maxBuffer:67108864},((err,stdout)=>res(!err&&stdout&&stdout.length?stdout:null)))}catch(_){res(null)}'
        "}));"
        "(async()=>{"
        "try{"
        'const b=process.env.WAYLAND_DISPLAY?await run("wl-paste",["--type","image/png"]):process.env.DISPLAY?await run("xclip",["-selection","clipboard","-t","image/png","-o"]):null;'
        "if(b&&b.length>0){const ni=_el.nativeImage.createFromBuffer(b);if(ni&&!ni.isEmpty())_el.clipboard.writeImage(ni)}"
        "}catch(_){}"
        "t({requestId:r})"
        "})()"
        "}))}"
    )


PRELOAD_CLIPBOARD_MARKER = "/*ZFL_PRELOAD_CLIP_V2*/"
RE_PRELOAD_CLIPBOARD = re.compile(
    r"getClipboardImage:\(\)=>\{const e=r\.clipboard\.readImage\(\);return\{isEmpty:\(\)=>e\.isEmpty\(\),toJPEG:t=>e\.toJPEG\(t\),toPNG:t=>e\.toPNG\(t\)\}\},"
    r"(?:getClipboardImagePNG:.*?saveClipboardImageToTemp:\(\)=>\{.*?\},)?"
    r"getClipboardText:\(\)=>r\.clipboard\.readText\("
)
PRELOAD_CLIPBOARD_REPLACEMENT = (
    "getClipboardImage:()=>{"
    f"{PRELOAD_CLIPBOARD_MARKER}"
    "const _readExt=()=>{"
    'const _ex=require("child_process").execFileSync,_o={timeout:800,maxBuffer:67108864,stdio:["ignore","pipe","ignore"]};'
    'if(process.env.WAYLAND_DISPLAY){try{const b=_ex("wl-paste",["--type","image/png"],_o);if(b&&b.length>0)return b}catch(_){}}'
    'if(process.env.DISPLAY){try{const b=_ex("xclip",["-selection","clipboard","-t","image/png","-o"],_o);if(b&&b.length>0)return b}catch(_){}}'
    "return null"
    "};"
    "let e=r.clipboard.readImage();"
    'if(e.isEmpty())for(const m of["image/png","image/jpeg","image/bmp","image/webp"]){'
    "try{const buf=r.clipboard.readBuffer(m);if(buf&&buf.length>0){const ni=r.nativeImage.createFromBuffer(buf);if(!ni.isEmpty()){e=ni;break}}}catch(_){}"
    "}"
    "if(e.isEmpty()){const b=_readExt();if(b){try{const ni=r.nativeImage.createFromBuffer(b);if(!ni.isEmpty())e=ni}catch(_){}}}"
    "return{isEmpty:()=>e.isEmpty(),toJPEG:t=>e.toJPEG(t),toPNG:t=>e.toPNG(t)}"
    "},"
    'getClipboardImagePNG:()=>{let e=r.clipboard.readImage();if(e.isEmpty()){try{const buf=r.clipboard.readBuffer("image/png");if(buf&&buf.length>0){e=r.nativeImage.createFromBuffer(buf);}}catch(_){}}if(e.isEmpty())return null;return e.toPNG().toString("base64");},'
    'getClipboardFilePath:()=>{const _rc=(t)=>{const _ex=require("child_process").execFileSync;const _o={timeout:1e3,stdio:["ignore","pipe","ignore"]};try{const _b=_ex("wl-paste",["--type",t],_o);if(_b&&_b.length>0)return _b;}catch(_){}try{const _b=_ex("xclip",["-selection","clipboard","-t",t,"-o"],_o);if(_b&&_b.length>0)return _b;}catch(_){}return null;};try{const _b=_rc("text/uri-list");if(!_b)return null;const text=_b.toString().trim();if(!text)return null;const uri=text.split("\\n")[0].trim();if(!uri.startsWith("file://"))return null;return decodeURIComponent(uri.replace("file://",""));}catch(_){return null;}},'
    'deleteFile:(p)=>{try{require("fs").unlinkSync(p);}catch(_){}},'
    'saveClipboardImageToTemp:()=>{const _rc=(t)=>{const _ex=require("child_process").execFileSync;const _o={timeout:1e3,stdio:["ignore","pipe","ignore"]};try{const _b=_ex("wl-paste",["--type",t],_o);if(_b&&_b.length>0)return _b;}catch(_){}try{const _b=_ex("xclip",["-selection","clipboard","-t",t,"-o"],_o);if(_b&&_b.length>0)return _b;}catch(_){}return null;};try{const _fs=require("fs"),_os=require("os"),_path=require("path"),_base=process.env.XDG_RUNTIME_DIR||_os.tmpdir(),_uid=typeof process.getuid==="function"?process.getuid():"u",_dir=process.env.XDG_RUNTIME_DIR?_path.join(_base,"zalux-clipboard"):_path.join(_base,"zalux-clipboard-"+_uid);_fs.mkdirSync(_dir,{recursive:!0,mode:448});try{_fs.chmodSync(_dir,448)}catch(_){}let e=r.clipboard.readImage();if(e.isEmpty()){try{const buf=r.clipboard.readBuffer("image/png");if(buf&&buf.length>0)e=r.nativeImage.createFromBuffer(buf);}catch(_){}}if(e.isEmpty()){const _b=_rc("image/png");if(_b&&_b.length>0){const tmpPath=_path.join(_dir,"zalo_clip_"+Date.now()+".png");_fs.writeFileSync(tmpPath,_b,{mode:384});return tmpPath;}return null;}const tmpPath=_path.join(_dir,"zalo_clip_"+Date.now()+".png");_fs.writeFileSync(tmpPath,e.toPNG(),{mode:384});return tmpPath;}catch(err){return String(err);}},'
    "getClipboardText:()=>r.clipboard.readText("
)

RE_PASTE_V2 = re.compile(
    r'const t=h\.getAsFile\(\);([A-Za-z_$][\w$]*)\.indexOf\("image/"\)>=0\?\(([A-Za-z_$][\w$]*)=!0,u\.push\(t\)\):c\.push\(t\)\}'
    r'(else if\("string"===m&&"text/plain"===\1\)\{if\(l&&!l\.hasOwnProperty\("plain_text"\)\)\{[^}]+\}\}else"string"===m&&"text/rtf"===\1&&\(([A-Za-z_$][\w$]*)=!0\);)'
    r'if\(\(u\.length>0\|\|c\.length>0\)&&!a&&!\4\)return u\.length>0&&W\(u\),c\.length>0&&ut\.c\(e\.uploadFileForMac\)&&e\.uploadFileForMac\(c\),!0;'
    r'if\(\2\)\{if\(\4\)\{return"ERR_NULL_DATA"!=e\.sendExcel\(t\)\}return!1\}'
    r'(?=.*?return 0==A\.length&&\(([A-Za-z_$][\w$]*)\|\|\(\5=!0,\$zscreencap\.getClipboard)'
)

RE_PASTE_V1_FALLBACK = re.compile(
    r'\?V\(([A-Za-z_$][\w$]*),e\):e\.uploadPhoto&&a&&\(a\.name\|\|\(a\.name="clipboard\.png"\),e\.uploadPhoto\(\[a\],e\.currentUserId\)\)'
)

RE_BODY_PASTE = re.compile(
    r'(re|oe)(\._uploadDragFile\(e,\{isPasted:!0,isUploaded:!1,targetConv:[A-Za-z_$][\w$]*,clientId:[A-Za-z_$][\w$]*\}\)\);'
    r'else\{var [A-Za-z_$][\w$]*;if\(d\.default\.logCoreError\("chat-box-view: _pasteData: could not get file content\. Fallback to using Qt"\).*?)'
    r'h\.push\(a\)'
    r'(\}\}\}\}\)\)\}\}\}else if\("string"===n\.kind&&"text/html"===n\.type.*?\}\})'
    r'h\.length&&([A-Za-z_$][\w$]*)\(h\),'
)

RE_CLIPBOARD_WIN_SLASH = re.compile(
    r'(?<!"win32"===process\.platform&&\()([A-Za-z_$][\w$]*\[[A-Za-z_$][\w$]*\])=([A-Za-z_$][\w$]*)\.replaceAllForString\(\1,"/","\\\\"\)'
)

NOTI_WATCHDOG_BLOCK = """// ZALO LINUX NOTI THEME START
(function () {
  function apply() {
    try {
      const st = document.createElement('style');
      st.id = 'zalo-linux-noti-theme';
      st.textContent = ':root{--layer-background:#1b2430!important;--text-primary:#dbe6f4!important;--text-secondary:#b8c7d9!important;--icon-primary:#cfe0f5!important}#zbg{background-color:#1b2430!important;color:#dbe6f4!important}#zbody,#ztitle{color:#dbe6f4!important}';
      (document.head || document.documentElement).appendChild(st);
      setTimeout(() => {
        try {
          const b = document.getElementById('zbody');
          const n = document.getElementById('zname');
          if (!(b && b.textContent.trim()) && !(n && n.textContent.trim())) window.close();
        } catch (_) {}
      }, 1200);
    } catch (_) {}
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply);
  else apply();
})();
// ZALO LINUX NOTI THEME END

// ZALO LINUX NOTI WATCHDOG START
(function () {
  setTimeout(() => {
    try {
      const bg = document.getElementById('zbg');
      const txt = bg ? (bg.innerText || bg.textContent || '').trim() : '';
      if (!txt) window.close();
    } catch (_) {}
  }, 3000);
  setTimeout(() => { try { window.close(); } catch (_) {} }, 6000);
})();
// ZALO LINUX NOTI WATCHDOG END
"""

RE_DIR_STAT = re.compile(
    r"(Unable to retrieve file information for \$\{e\}`,t\),null\)\)\);if\(n\)\{)(if\(!n\.isDirectory\(\)\)\{)"
)

RE_AUTOLAUNCH_CFG = re.compile(
    r'("win32"===process\.platform\)\{let t=o\.join\(o\.dirname\(i\.getPath\("exe"\)\),\.\.,"Zalo\.exe"\);e\.path=t\})'
    r"([A-Za-z_$][\w$]*=new r\(e\)\})"
)

RE_AUTOLAUNCH_HANDLER = re.compile(
    r'const ([A-Za-z_$][\w$]*)=Object\(s\.a\)\("config-handler",\["preload"\]\),([A-Za-z_$][\w$]*)=\{'
    r'checkAutoLaunchEnable:e=>\{const\{getZaloLauncher:t\}=n\("Wsuc"\);return t\(\)\.isEnabled\(\)\},'
    r'toggleAutoLaunch:\(e,t\)=>\{const\{appConfig:r\}=n\("ZQzv"\),\{getZaloLauncher:i\}=n\("Wsuc"\),o=i\(\);'
    r't\?\(\1\.zsymb\(4,"6bBPdN",\["autolaunch to enable","QDXh5y"\]\),o\.enable\(\),r\.set\("autolaunch",!0\)\)'
    r':\(\1\.zsymb\(4,"V1n4ka",\["autolaunch to disable","G-APLN"\]\),o\.disable\(\),r\.set\("autolaunch",!1\)\)\},'
)


def patch_main_and_preloads() -> None:
    targets = [
        "main.js",
        "utility-process-sqlite.js",
        "preload-render.js",
        "preload-sqlite.js",
        "preload-shared-worker.js",
        "preload-noti.js",
        "compact-app.js",
        "compact-app-preload.js",
    ]
    preload_Targets = {
        "preload-render.js",
        "preload-sqlite.js",
        "preload-shared-worker.js",
        "preload-noti.js",
        "compact-app-preload.js",
    }

    for name in targets:
        p = MAIN_DIST / name
        if not p.is_file():
            fail(f"không thấy {p}")
        orig = p.read_text(encoding="utf-8", errors="surrogateescape")
        text = orig
        hits = 0

        # XDG paths
        text, n_xdg = apply_xdg_paths(text, name, is_pc_bundle=False)
        hits += n_xdg

        # Platform Type 25 -> 23 (macOS client ID)
        if name in ("main.js", "compact-app.js"):
            old_plat = 'case"DARWIN":return 23;case"WIN32":return 24;case"LINUX":return 25;'
            new_plat = 'case"DARWIN":return 23;case"WIN32":return 24;case"LINUX":return 23;'
            if old_plat in text:
                text = text.replace(old_plat, new_plat, 1)
                hits += 1
            elif new_plat not in text:
                fail(f"{name}: không tìm thấy switch platformType DARWIN/WIN32/LINUX")

        # Notification 5s close timer & Shared Worker (dbTask) protection in main.js
        if name == "main.js":
            old_noti = "onSuccessUpdate:function(){y.isVisible()||y.showInactive()}"
            new_noti = (
                "onSuccessUpdate:function(){y.isVisible()||y.showInactive();"
                "clearTimeout(y.__zaloLinuxNotiTimer);"
                "y.__zaloLinuxNotiTimer=setTimeout(function(){try{y.closeIfSafe&&y.closeIfSafe()}catch(_){}},5000)}"
            )
            if old_noti in text:
                text = text.replace(old_noti, new_noti, 1)
                hits += 1

            old_sw = (
                'title:"Shared Worker",show:false,alwaysOnTop:!1,skipTaskbar:!1,'
                'webPreferences:{webSecurity:!0,allowRunningInsecureContent:!1,webgl:!0,devTools:!1,'
                'partition:"persist:zalo",nodeIntegration:!1,backgroundThrottling:!1,contextIsolation:!0,'
                'nodeIntegrationInWorker:!1,sandbox:!1,preload:r.join(__dirname,"preload-shared-worker.js")},resizable:!0}),'
                'this.__zwindow.webContents.once("crashed",(()=>{this.restart()}))'
            )
            new_sw = (
                'title:"Shared Worker",show:false,alwaysOnTop:!1,skipTaskbar:!0,'
                'webPreferences:{webSecurity:!0,allowRunningInsecureContent:!1,webgl:!0,devTools:!1,'
                'partition:"persist:zalo",nodeIntegration:!1,backgroundThrottling:!1,contextIsolation:!0,'
                'nodeIntegrationInWorker:!1,sandbox:!1,preload:r.join(__dirname,"preload-shared-worker.js")},resizable:!0}),'
                'this._zaQuitBound||(this._zaQuitBound=!0,require("electron").app.on("before-quit",(()=>{this._zaQuitting=!0}))),'
                "this.__zwindow.__zaloSharedWorker=!0,"
                'this.__zwindow.on("close",(e=>{if(!this._zaQuitting){e.preventDefault();try{this.__zwindow.hide()}catch(_){}}})),'
                'this.__zwindow.webContents.once("render-process-gone",((e,t)=>{!this._zaQuitting&&t&&"clean-exit"!==t.reason&&this.restart()})),'
                'this.__zwindow.webContents.once("crashed",(()=>{!this._zaQuitting&&this.restart()}))'
            )
            if old_sw in text:
                text = text.replace(old_sw, new_sw, 1)
                hits += 1
            elif "this.__zwindow.__zaloSharedWorker=!0" not in text:
                fail("main.js: không tìm thấy Htpd.createWindow ('Shared Worker') để bảo vệ dbTask")

        # Directory check, Quit without show(), Safe AutoLaunch in main.js & compact-app.js
        if name in ("main.js", "compact-app.js"):
            text, n = RE_DIR_STAT.subn(r'\1if("linux"===process.platform&&n.isDirectory())return _(e);\2', text)
            hits += n

            old_quit = "if(this.signalBeforeQuitToRender(),e)return void this.quit();t||this.mainWindow.show()"
            new_quit = 'if(this.signalBeforeQuitToRender(),e)return void this.quit();t||"linux"===process.platform||this.mainWindow.show()'
            if old_quit in text:
                text = text.replace(old_quit, new_quit, 1)
                hits += 1

            old_al_path = 'if("win32"===process.platform){let t=o.join(o.dirname(i.getPath("exe")),"..","Zalo.exe");e.path=t}'
            new_al_path = (
                'if("win32"===process.platform){let t=o.join(o.dirname(i.getPath("exe")),"..","Zalo.exe");e.path=t}'
                'else if("linux"===process.platform)e.path=process.env.APPIMAGE||i.getPath("exe"),e.isHidden=!0;'
            )
            if old_al_path in text and 'process.env.APPIMAGE||i.getPath("exe")' not in text:
                text = text.replace(old_al_path, new_al_path, 1)
                hits += 1

            text, n = RE_AUTOLAUNCH_HANDLER.subn(
                r'const \1=Object(s.a)("config-handler",["preload"]),\2={'
                r'checkAutoLaunchEnable:async e=>{try{const{getZaloLauncher:t}=n("Wsuc"),r=t();return!!(r&&"function"==typeof r.isEnabled)&&!!await r.isEnabled()}catch(e){return!1}},'
                r'toggleAutoLaunch:async(e,t)=>{const{appConfig:r}=n("ZQzv"),{getZaloLauncher:i}=n("Wsuc");try{const o=i();if(!o)return r.set("autolaunch",!!t),!1;'
                r'return t?(\1.zsymb(4,"6bBPdN",["autolaunch to enable","QDXh5y"]),await o.enable(),r.set("autolaunch",!0),!0):(\1.zsymb(4,"V1n4ka",["autolaunch to disable","G-APLN"]),await o.disable(),r.set("autolaunch",!1),!0)}catch(e){return \1.zsymb(19,"linux_auto_launch_error",e),!1}},',
                text,
            )
            hits += n

            # Linux native clipboard handler for get-clipboard / rewrite-clipboard IPC
            if MAIN_SCREENCAP_CLIPBOARD_MARKER not in text:
                m_clip = RE_MAIN_SCREENCAP_CLIPBOARD.search(text)
                if not m_clip:
                    fail(f"{name}: không tìm thấy startGetClipboard/startRewriteClipboard để vá clipboard Linux")
                clip_repl = make_main_screencap_clipboard(m_clip.group(1))
                text = text[: m_clip.start()] + clip_repl + text[m_clip.end() :]
                hits += 1

            # Đồng bộ User-Agent sang macOS (khớp platformType=23) cho cửa sổ chính & popup OAuth/InAppBrowser
            ua_tpl_old = "ZaloPC-${process.platform}-"
            ua_tpl_new = 'ZaloPC-${"linux"===process.platform?"darwin":process.platform}-'
            if ua_tpl_old in text:
                text = text.replace(ua_tpl_old, ua_tpl_new)
                hits += 1

            ua_cat_old = '"ZaloPC-"+process.platform+"-"'
            ua_cat_new = '"ZaloPC-"+("linux"===process.platform?"darwin":process.platform)+"-"'
            if ua_cat_old in text:
                text = text.replace(ua_cat_old, ua_cat_new)
                hits += 1

            for ua_var in ("t", "e"):
                sub_ua_old = f'.setUserAgent({ua_var}.replace("Zalo","ZaloPC"))'
                sub_ua_new = f'.setUserAgent({ua_var}.replace(/\\(X11;[^)]+\\)/,"(Macintosh; Intel Mac OS X 10_15_7)").replace("Zalo","ZaloPC"))'
                if sub_ua_old in text:
                    text = text.replace(sub_ua_old, sub_ua_new)
                    hits += 1

            # Lưu vị trí cửa sổ chính khi di chuyển trên Linux (debounce 250ms)
            text, n_move = re.subn(
                r'\.on\("move",\(e=>\{"win32"===process\.platform&&([A-Za-z_$][\w$]*==[A-Za-z_$][\w$]*)&&([A-Za-z_$][\w$]*)&&([A-Za-z_$][\w$]*\("size",[A-Za-z_$][\w$]*,e\))\}\)\)',
                r'.on("move",(e=>{if("linux"===process.platform&&\1){clearTimeout(global.__zflMoveT);global.__zflMoveT=setTimeout((()=>\3),250)}else "win32"===process.platform&&\1&&\2&&\3}))',
                text,
            )
            hits += n_move

            # Kiki Assistant OAuth handler: mở rộng domain tin cậy (kilm.ai/zalo.ai), tắt sandbox con trên Linux,
            # kiểm tra đúng hostname trong checkOAuthCompleted (tránh đóng sớm trên id.zalo.me?continue=...kilm.ai) & xử lý redirect ERR_ABORTED
            kiki_sbx_win_old = (
                'sandbox:!0,webSecurity:!0,devTools:!1},useContentSize:!0,width:800,minWidth:600,height:700,minHeight:500,show:!1,title:"Kiki Assistant - Authorization"'
            )
            kiki_sbx_win_new = (
                'sandbox:!1,webSecurity:!0,devTools:!1},useContentSize:!0,width:800,minWidth:600,height:700,minHeight:500,show:!1,title:"Kiki Assistant - Authorization"'
            )
            if kiki_sbx_win_old in text:
                text = text.replace(kiki_sbx_win_old, kiki_sbx_win_new, 1)
                hits += 1

            kiki_wl_old = (
                "function ri(e){const t=function(e){try{return new URL(e)}catch(t){return}}(e);"
                "if(void 0===t)return!1;const{protocol:n,hostname:r}=t;"
                "return!(!n||!r)&&(!1!==ni.AllowedProtocols.has(n)&&!1!==ni.WhitelistDomains.has(r))}"
                'const ii=/kiki.*info/i,oi=["/login","/permission","/oauth"];'
            )
            kiki_wl_v1 = (
                "function ri(e){const t=function(e){try{return new URL(e)}catch(t){return}}(e);"
                "if(void 0===t)return!1;const{protocol:n,hostname:r}=t;if(!n||!r||!ni.AllowedProtocols.has(n))return!1;"
                "const h=r.toLowerCase();"
                'return ni.WhitelistDomains.has(h)||"zalo.me"===h||h.endsWith(".zalo.me")||"zaloapp.com"===h||h.endsWith(".zaloapp.com")||"kiki.vn"===h||h.endsWith(".kiki.vn")}'
                'const ii=/(?:kiki\\.(?:zalo\\.me|vn)|\\/kiki)/i,oi=["/login","/permission","/oauth"];'
            )
            kiki_wl_new = (
                "function ri(e){/*ZFL_KIKI_WL_V2*/const t=function(e){try{return new URL(e)}catch(t){return}}(e);"
                "if(void 0===t)return!1;const{protocol:n,hostname:r}=t;if(!n||!r||!ni.AllowedProtocols.has(n))return!1;"
                "const h=r.toLowerCase();"
                'return ni.WhitelistDomains.has(h)||"kilm.ai"===h||h.endsWith(".kilm.ai")||"zalo.ai"===h||h.endsWith(".zalo.ai")||"zalo.me"===h||h.endsWith(".zalo.me")||"zaloapp.com"===h||h.endsWith(".zaloapp.com")||"kiki.vn"===h||h.endsWith(".kiki.vn")}'
                'const ii=/kiki.*info/i,oi=["/login","/permission","/oauth","/callback","/account","/authen"];'
            )
            if kiki_wl_old in text:
                text = text.replace(kiki_wl_old, kiki_wl_new, 1)
                hits += 1
            elif kiki_wl_v1 in text:
                text = text.replace(kiki_wl_v1, kiki_wl_new, 1)
                hits += 1

            kiki_chk_old = (
                "checkOAuthCompleted(e,t){try{const n=new URL(e),r=n.pathname,i=ii.test(e),o=oi.some((e=>r.includes(e)));"
                'i&&!o?(this.sendOAuthCompleted(),this.close()):i&&o&&(403===t||n.searchParams.has("error"))&&(this.sendOAuthFailed(),this.close())}catch{}}'
            )
            kiki_chk_new = (
                "checkOAuthCompleted(e,t){/*ZFL_KIKI_CHK_V2*/try{const n=new URL(e),h=n.hostname.toLowerCase(),r=n.pathname.toLowerCase(),"
                'a="id.zalo.me"===h||"stg.id.zalo.me"===h||"oauth.zaloapp.com"===h||"id.zaloapp.com"===h,'
                'i=!a&&("kilm.ai"===h||h.endsWith(".kilm.ai")||"zalo.ai"===h||h.endsWith(".zalo.ai")||"kiki.vn"===h||h.endsWith(".kiki.vn")||"kiki.zalo.me"===h||ii.test(r)),'
                "o=oi.some((e=>r.includes(e)));"
                "a&&this.browserWindow&&!this.browserWindow.isDestroyed()&&this.browserWindow.show(),"
                'i&&!o?(this.sendOAuthCompleted(),this.close()):i&&o&&(403===t||n.searchParams.has("error"))&&(this.sendOAuthFailed(),this.close())}catch{}}'
            )
            if kiki_chk_old in text:
                text = text.replace(kiki_chk_old, kiki_chk_new, 1)
                hits += 1

            kiki_oauth_old = (
                "async openOAuthWindow(e,t){if(!1===r.isWhitelistedUrl(e))return!1;t&&(this.event=t);"
                "try{var n;if((!this.browserWindow||this.browserWindow.isDestroyed()||this.browserWindow.webContents.isDestroyed())&&this.initBrowserWindow(),"
                "null!==(n=this.browserWindow)&&void 0!==n&&n.webContents.isLoading())return!1;"
                "const t=o.BrowserWindow.fromWebContents(this.event.sender);"
                "if(t){const e=o.screen.getDisplayMatching(t.getBounds()),{x:n,y:r,width:i,height:a}=e.bounds,s=this.browserWindow.getBounds();"
                "this.browserWindow.setPosition(Math.round(n+(i-s.width)/2),Math.round(r+(a-s.height)/2))}"
                "return await this.browserWindow.loadURL(e),this.browserWindow.show(),!0}"
                "catch(i){return this.dispose(),this.removeBrowserWindow(),!1}}"
            )
            kiki_oauth_new = (
                "async openOAuthWindow(e,t){/*ZFL_KIKI_OAUTH_V1*/t&&(this.event=t);"
                "if(!1===r.isWhitelistedUrl(e))return this.sendOAuthFailed(),!1;"
                "try{var n;if((!this.browserWindow||this.browserWindow.isDestroyed()||this.browserWindow.webContents.isDestroyed())&&this.initBrowserWindow(),"
                "null!==(n=this.browserWindow)&&void 0!==n&&n.webContents.isLoading())return!0;"
                "if(this.event&&this.event.sender&&!this.event.sender.isDestroyed()){"
                "const t=o.BrowserWindow.fromWebContents(this.event.sender);"
                "if(t){const e=o.screen.getDisplayMatching(t.getBounds()),{x:n,y:r,width:i,height:a}=e.bounds,s=this.browserWindow.getBounds();"
                "this.browserWindow.setPosition(Math.round(n+(i-s.width)/2),Math.round(r+(a-s.height)/2))}}"
                'this.browserWindow.webContents.once("did-finish-load",(()=>{this.browserWindow&&!this.browserWindow.isDestroyed()&&this.browserWindow.show()}));'
                "try{await this.browserWindow.loadURL(e)}catch(err){"
                'if(!err||("ERR_ABORTED"!==err.code&&-3!==err.errno))throw err;'
                "if(!this.browserWindow||this.browserWindow.isDestroyed())return!0}"
                "return this.browserWindow&&!this.browserWindow.isDestroyed()&&this.browserWindow.show(),!0}"
                "catch(i){return this.sendOAuthFailed(),this.dispose(),this.removeBrowserWindow(),!1}}"
            )
            if kiki_oauth_old in text:
                text = text.replace(kiki_oauth_old, kiki_oauth_new, 1)
                hits += 1

        # Chặn spawn("codesign") & kích hoạt os-sys-info native/proc trên Linux trong main.js
        if name == "main.js":
            sc_old = "async checkAppSigned(){return null!=this.isAppSigned?this.isAppSigned:Ke.app.isPackaged?"
            sc_new = 'async checkAppSigned(){if("linux"===process.platform)return this.isAppSigned=!1,!1;return null!=this.isAppSigned?this.isAppSigned:Ke.app.isPackaged?'
            if sc_old in text:
                text = text.replace(sc_old, sc_new, 1)
                hits += 1

            osi_old = '"win32"!==process.platform&&"darwin"!==process.platform'
            osi_new = '"win32"!==process.platform&&"darwin"!==process.platform&&"linux"!==process.platform'
            text, n_osi_dedup = re.subn(
                r'"win32"!==process\.platform&&"darwin"!==process\.platform(?:&&"linux"!==process\.platform){2,}',
                osi_new,
                text,
            )
            hits += n_osi_dedup
            if osi_old in text and osi_new not in text:
                text = text.replace(osi_old, osi_new, 1)
                hits += 1

        # Wayland / X11 Clipboard Paste in preload bundles
        if name in preload_Targets and PRELOAD_CLIPBOARD_MARKER not in text:
            m_pre_clip = RE_PRELOAD_CLIPBOARD.search(text)
            if not m_pre_clip:
                fail(f"{name}: không tìm thấy getClipboardImage để vá clipboard preload")
            text = text[: m_pre_clip.start()] + PRELOAD_CLIPBOARD_REPLACEMENT + text[m_pre_clip.end() :]
            hits += 1

        # Notification theme + watchdog in preload-noti.js
        if name == "preload-noti.js":
            idx_noti = text.find("// ZALO LINUX NOTI THEME START")
            if idx_noti != -1:
                updated_noti = text[:idx_noti].rstrip("\n") + "\n" + NOTI_WATCHDOG_BLOCK
                if updated_noti != text:
                    text = updated_noti
                    hits += 1
            else:
                text = text.rstrip("\n") + "\n" + NOTI_WATCHDOG_BLOCK
                hits += 1

        if text != orig:
            atomic_write(p, text)
            print(f"    + {name}: đã vá {hits} hạng mục (XDG/Platform/Clipboard/Desktop)")
        else:
            print(f"    = {name}: đã được patch đầy đủ")

    # Đồng bộ platformType 25 -> 23 trong utility-process-media.js (nếu có)
    media_proc = MAIN_DIST / "utility-process-media.js"
    if media_proc.is_file():
        m_orig = media_proc.read_text(encoding="utf-8", errors="surrogateescape")
        old_plat = 'case"DARWIN":return 23;case"WIN32":return 24;case"LINUX":return 25;'
        new_plat = 'case"DARWIN":return 23;case"WIN32":return 24;case"LINUX":return 23;'
        if old_plat in m_orig:
            atomic_write(media_proc, m_orig.replace(old_plat, new_plat, 1))
            print("    + utility-process-media.js: đã đồng bộ platformType=23")
        else:
            print("    = utility-process-media.js: đã được patch đầy đủ")


# ---------------------------------------------------------------------------
# 3. PC-Dist Renderer & Worker Bundles (XDG + analyzeMainDisk)
# ---------------------------------------------------------------------------


def patch_pc_bundles() -> None:
    patterns = [
        "lazy/default-login-main-startup-shared-worker-znotification.*.js",
        "compact-app-pc.*.js",
        "search-worker.*.js",
        "sync-v2-sub-worker.*.js",
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

            # 1. XDG localized paths + checkDownloadDirectoryExists
            text, n_xdg = apply_xdg_paths(text, path.name, is_pc_bundle=True)
            hits += n_xdg

            # 2. analyzeMainDisk(): đổi e="/" sang Object(<pathMod>.getZaloDirSync)()
            disk_old = 'analyzeMainDisk(){let e="";e="/";const{error:t,result:n}='
            if disk_old in text:
                idx = text.find(disk_old)
                # Tìm biến import module path gần nhất trong cùng scope module nối
                window = text[max(0, idx - 35000) : min(len(text), idx + 35000)]
                cands = re.findall(r"Object\(([A-Za-z_$][\w$]*)\.get(?:Zalo|home|appData)Dir(?:Sync)?\)", window)
                if cands:
                    mod_var = cands[-1]
                else:
                    mod_var = "p" if path.name.startswith("default-login-") else "f"
                disk_new = f"analyzeMainDisk(){{let e=Object({mod_var}.getZaloDirSync)();const{{error:t,result:n}}="
                text = text.replace(disk_old, disk_new, 1)
                hits += 1

            # 3. Chống crash null render message widget trong default-login bundle
            if path.name.startswith("default-login-"):
                null_guard_old = "default:return p.default.log(S),null}}}this.isSendTimeOutside=this.isSendTimeOutside&&this.props.isLast;let Be=Q.props.children;"
                null_guard_new = "default:return p.default.log(S),null}}}if(!Q)return null;this.isSendTimeOutside=this.isSendTimeOutside&&this.props.isLast;let Be=Q.props.children;"
                if null_guard_old in text:
                    text = text.replace(null_guard_old, null_guard_new, 1)
                    hits += 1

                prop_old = '}}Ba.propTypes={replyMessage:d.a.func.isRequired,'
                prop_new = '}}Ba.defaultProps={focusId:[]};Ba.propTypes={replyMessage:d.a.func.isRequired,'
                if prop_old in text:
                    text = text.replace(prop_old, prop_new, 1)
                    hits += 1

            # 4. Clipboard screenshot & file paste fixes in UI renderer bundles
            if path.name.startswith("default-login-") or path.name.startswith("compact-app-pc."):
                rt_old = 'e&&e.requestId==this.props.currentUserId&&this._processPasteFilePath(e.content.split("|"))'
                rt_new = 'e&&e.requestId==this.props.currentUserId&&e.content&&this._processPasteFilePath(e.content.split("|"))'
                if rt_old in text:
                    text = text.replace(rt_old, rt_new, 1)
                    hits += 1

                text, n_v2 = RE_PASTE_V2.subn(
                    r'const t=h.getAsFile();\1.indexOf("image/")>=0?(\2=!0,t&&t.size>0&&(t.name||(t.name="clipboard.png"),u.push(t))):t&&c.push(t)}'
                    r'\3'
                    r'if((u.length>0||c.length>0)&&!\4)return u.length>0&&W(u,a||""),c.length>0&&ut.c(e.uploadFileForMac)&&e.uploadFileForMac(c),!0;'
                    r'if(\2){if(\4){return"ERR_NULL_DATA"!=e.sendExcel(t)}return \5||(\5=!0,$zscreencap.getClipboard(e.currentUserId).then((t=>{\5=!1,t&&t.requestId==e.currentUserId&&t.content&&V(t.content.split("|"),e)}))),!0}',
                    text,
                    count=1,
                )
                hits += n_v2

                text, n_v1 = RE_PASTE_V1_FALLBACK.subn(
                    r'?V(\1,e):e.uploadPhoto&&a?(a.name||(a.name="clipboard.png"),e.uploadPhoto([a],e.currentUserId)):\1.length>0&&V(\1,e)',
                    text,
                    count=1,
                )
                hits += n_v1

                text, n_body = RE_BODY_PASTE.subn(
                    r'\1\2\4([a])\3(h.length?\4(h):0===l.length&&window.$zscreencap&&$zscreencap.getClipboard(e.state.userId).then((t=>{t&&t.requestId==e.state.userId&&t.content&&\1._uploadFileFromPaths(t.content.split("|"),!1,!0)}))),',
                    text,
                    count=1,
                )
                hits += n_body

                text, n_slash = RE_CLIPBOARD_WIN_SLASH.subn(
                    r'("win32"===process.platform&&(\1=\2.replaceAllForString(\1,"/","\\\\")))',
                    text,
                )
                hits += n_slash

                # 5. Kiki Assistant renderer fixes (fallback h5_url, remount iframe after OAuth, await startCSPMonitor before src, check openOAuthWindow result & sandbox)
                kiki_h5_old = "async()=>await Object(Wn.c)(u.default.kiki_assistant.h5_url)"
                kiki_h5_new = 'async()=>(await Object(Wn.c)(u.default.kiki_assistant.h5_url))||u.default.kiki_assistant.h5_url||""'
                if kiki_h5_old in text:
                    text = text.replace(kiki_h5_old, kiki_h5_new, 1)
                    hits += 1

                text, n_kiki_remount = re.subn(
                    r"const t=async\(\)=>\{d\.current&&\(\$zFeatures\.kikiAssistant\.removeListenerOAuthCompleted\(d\.current\),d\.current=null\),A\.current=!1;try\{const e=await ([A-Za-z_$][\w$]*)\(\);",
                    r"const t=async()=>{/*ZFL_KIKI_REMOUNT*/d.current&&($zFeatures.kikiAssistant.removeListenerOAuthCompleted(d.current),d.current=null),A.current=!1,n(null);try{const e=await \1();",
                    text,
                    count=1,
                )
                hits += n_kiki_remount

                text, n_kiki_oauth = re.subn(
                    r"d\.current=t,\$zFeatures\.kikiAssistant\.onOAuthCompleted\(t\),"
                    r"await \$zFeatures\.kikiAssistant\.openOAuthWindow\(e\)\}"
                    r"catch\{A\.current=!1,([A-Za-z_$][\w$]*)\(([A-Za-z_$][\w$]*)\)\}",
                    r"d.current=t,$zFeatures.kikiAssistant.onOAuthCompleted(t);"
                    r"const _ok=await $zFeatures.kikiAssistant.openOAuthWindow(e);"
                    r"if(!_ok)return d.current&&($zFeatures.kikiAssistant.removeListenerOAuthCompleted(d.current),d.current=null),A.current=!1,void \1(\2);"
                    r"setTimeout((()=>{A.current&&d.current===t&&($zFeatures.kikiAssistant.removeListenerOAuthCompleted(t),d.current=null,A.current=!1,\1(\2))}),6e4)}"
                    r"catch{A.current=!1,\1(\2)}",
                    text,
                    count=1,
                )
                hits += n_kiki_oauth

                text, n_kiki_init = re.subn(
                    r"try\{([A-Za-z_$][\w$]*)\(([A-Za-z_$][\w$]*)\);const e=await ([A-Za-z_$][\w$]*)\(\);"
                    r"(?:if\(!e\)return void \1\([A-Za-z_$][\w$]*\);)?"
                    r"if\(n\(e\),([A-Za-z_$][\w$]*)\.current&&clearTimeout\(\4\.current\),\4\.current=setTimeout\(\(\(\)=>\{\1\(([A-Za-z_$][\w$]*)\)\}\),([A-Za-z_$][\w$]*)\),!ta\.m&&ea\.isOAuthBypassEnabled\(\)\)\{\$zFeatures\.kikiAssistant\.startCSPMonitor\(\),",
                    r"try{/*ZFL_KIKI_INIT_V2*/\1(\2),n(null);const e=await \3();if(!e)return void \1(\5);"
                    r"!ta.m&&ea.isOAuthBypassEnabled()&&(await $zFeatures.kikiAssistant.startCSPMonitor());"
                    r"if(n(e),\4.current&&clearTimeout(\4.current),\4.current=setTimeout((()=>{\1(\5)}),\6),!ta.m&&ea.isOAuthBypassEnabled()){",
                    text,
                    count=1,
                )
                hits += n_kiki_init

                kiki_sbx_old = 'additionalSandboxPolicy:"allow-presentation allow-forms"'
                kiki_sbx_new = 'additionalSandboxPolicy:"allow-presentation allow-forms allow-modals allow-downloads allow-popups-to-escape-sandbox"'
                if kiki_sbx_old in text:
                    text = text.replace(kiki_sbx_old, kiki_sbx_new, 1)
                    hits += 1

            if text != orig:
                atomic_write(path, text)
                print(f"    + {path.name}: đã vá {hits} hạng mục (XDG + analyzeMainDisk + guards)")
            else:
                print(f"    = {path.name}: đã được patch đầy đủ")


def main() -> None:
    print(">>> [linux-paths] Đang vá Platform ID, đường dẫn XDG, analyzeMainDisk & Clipboard...")
    patch_main_and_preloads()
    patch_pc_bundles()
    print("patch-linux-paths: hoàn thành.")


if __name__ == "__main__":
    main()

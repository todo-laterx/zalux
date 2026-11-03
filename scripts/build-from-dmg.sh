#!/usr/bin/env bash
# build-from-dmg.sh — Đóng gói Zalux trực tiếp từ DMG macOS chính thức bằng runtime Rust nội bộ.
#
# Không cần Node/npm, không cần trình biên dịch Rust/C++, không clone bất kỳ repo bên thứ ba nào.
# Chỉ cần: 7z (p7zip-full / 7zip), python3, curl, unzip.
#
# Cách dùng:
#   ./scripts/build-from-dmg.sh 26.10.20
#   ./scripts/build-from-dmg.sh /path/to/ZaloSetup-universal-26.10.20.dmg [26.10.20]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME="$ROOT/runtime"
BUILD="$ROOT/build"
CACHE="$BUILD/cache"
RAW="$BUILD/raw"
APP_OUT="$BUILD/app-extracted"
ASSETS_OUT="$BUILD/zcall-assets"
APPDIR="$BUILD/AppDir"
DIST="$ROOT/dist"

ELECTRON_VER="${ELECTRON_VER:-22.3.27}"
ELECTRON_URL="https://github.com/electron/electron/releases/download/v${ELECTRON_VER}/electron-v${ELECTRON_VER}-linux-x64.zip"

die() { echo "build-from-dmg: $*" >&2; exit 1; }

[ $# -ge 1 ] || die "cách dùng: $0 <version | /path/to/ZaloSetup-*.dmg> [version]"
for cmd in 7z python3 curl unzip; do
    command -v "$cmd" >/dev/null 2>&1 || die "thiếu công cụ bắt buộc: $cmd"
done
[ -x "$RUNTIME/bin/zcall-engine" ] || die "thiếu $RUNTIME/bin/zcall-engine"
[ -x "$RUNTIME/bin/zalo-asar" ] || die "thiếu $RUNTIME/bin/zalo-asar"

mkdir -p "$CACHE" "$RAW" "$DIST"

INPUT="$1"
if [ -f "$INPUT" ]; then
    DMG="$(cd "$(dirname "$INPUT")" && pwd)/$(basename "$INPUT")"
    VER="${2:-$(basename "$DMG" | sed -E 's/.*-([0-9]+\.[0-9]+\.[0-9]+)\.dmg$/\1/')}"
else
    VER="$INPUT"
    DMG="$CACHE/ZaloSetup-universal-${VER}.dmg"
    if [ ! -f "$DMG" ]; then
        UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124 Safari/537.36'
        echo ">>> Tải DMG Zalo macOS chính thức (${VER})..."
        DMG_URL="$(curl -sI -A "$UA" "https://zalo.me/download/zalo-pc?utm=90000" \
            | awk 'tolower($1)=="location:"{print $2}' | tr -d '\r' | head -n 1)"
        if [ -z "$DMG_URL" ]; then
            DMG_URL="https://res-download-pc.zadn.vn/mac/ZaloSetup-universal-${VER}.dmg"
        fi
        curl -L --fail --max-time 1800 -o "$DMG" "$DMG_URL"
    fi
fi
[ -f "$DMG" ] || die "không tìm thấy file DMG: $DMG"

echo "=============================================================="
echo " Zalux Clean-Room Builder"
echo " DMG     : $DMG"
echo " Version : $VER"
echo "=============================================================="

# ---------------------------------------------------------------- 1. Bóc DMG & ASAR
echo ">>> [1/6] Trích xuất app.asar và ZaloCall từ DMG..."
rm -rf "$RAW" "$APP_OUT" "$ASSETS_OUT"
mkdir -p "$RAW"

LIST="$(7z l -slt "$DMG")"
find_member() {
    printf '%s\n' "$LIST" | sed -n 's/^Path = //p' | grep -E "$1" | head -n 1
}

ASAR_PATH="$(find_member '(^|/)Zalo\.app/Contents/Resources/app\.asar$' || true)"
CALL_PATH="$(find_member '(^|/)ZaloHelper\.app/Contents/MacOS/ZaloCall$' || true)"
UNPACKED_PATH="$(find_member '(^|/)Zalo\.app/Contents/Resources/app\.asar\.unpacked$' || true)"
[ -n "$ASAR_PATH" ] || die "không thấy app.asar trong DMG"
[ -n "$CALL_PATH" ] || die "không thấy ZaloCall trong DMG"

7z e -y -o"$RAW" "$DMG" "$ASAR_PATH" >/dev/null
7z e -y -o"$RAW" "$DMG" "$CALL_PATH" >/dev/null
if [ -n "$UNPACKED_PATH" ]; then
    TMP_UNPACKED="$(mktemp -d)"
    7z x -y -o"$TMP_UNPACKED" "$DMG" "$UNPACKED_PATH" >/dev/null
    mv "$TMP_UNPACKED/$UNPACKED_PATH" "$RAW/app.asar.unpacked"
    rm -rf "$TMP_UNPACKED"
fi

"$RUNTIME/bin/zalo-asar" extract "$RAW/app.asar" "$APP_OUT"
python3 "$RUNTIME/toolchain/extract-zcall-assets.py" "$RAW/ZaloCall" "$ASSETS_OUT" >/dev/null

# Gỡ các binary Mach-O macOS / PE Windows dư thừa trong native/ trước khi cài bản Linux x86_64
find "$APP_OUT/native" -type f \( -name "*.dylib" -o -path "*darwin*/*.node" -o -path "*mac*/*.node" -o -name "*mac*.node" -o -path "*win32*/*.node" -o -path "*win64*/*.node" \) -delete 2>/dev/null || true

# ---------------------------------------------------------------- 2. Cài Rust N-API nativelibs
echo ">>> [2/6] Cài 9 Rust N-API native addons Linux x86_64..."
install_addon() {
    local src="$RUNTIME/nativelibs/$1"
    local dst="$APP_OUT/$2"
    mkdir -p "$(dirname "$dst")"
    install -m 0755 "$src" "$dst"
}
install_addon "node_sqlite3.node"       "native/nativelibs/sqlite3/binding/napi-v6-linux-x64/node_sqlite3.node"
install_addon "db-cross-v4-native.node" "native/nativelibs/db-cross-v4/prebuilt/linux/electron/x64/db-cross-v4-native.node"
install_addon "file-utilities.node"     "native/nativelibs/file-utilities/linux/file-utilities.node"
install_addon "file-utils.node"         "native/nativelibs/file-utils/linux/file-utils.node"
install_addon "mp4thumb.node"           "native/nativelibs/mp4thumb/linux/mp4thumb.node"
install_addon "zimage.node"             "native/nativelibs/zimage/linux_x64/zimage.node"
install_addon "zjxl.node"               "native/nativelibs/zjxl/build/linux/zjxl.node"
install_addon "zwalker.node"            "native/nativelibs/zwalker/zwalker.linux-x64-gnu.node"
install_addon "zlang.node"              "native/nativelibs/zlang/linux-x64/zlang.linux-x64.node"

python3 - "$APP_OUT/native/nativelibs" <<'PY'
import pathlib, re, sys

libs = pathlib.Path(sys.argv[1])

binding = libs / "db-cross-v4" / "dist" / "binding.js"
if binding.is_file():
    s = binding.read_text(encoding="utf-8")
    if "process.platform === 'linux'" not in s:
        old = "if (process.platform === 'darwin') {\n    addon = require(`../prebuilt/darwin/electron/${process.arch}/db-cross-v4-native.node`);\n}\nelse {"
        new = "if (process.platform === 'darwin') {\n    addon = require(`../prebuilt/darwin/electron/${process.arch}/db-cross-v4-native.node`);\n}\nelse if (process.platform === 'linux') {\n    addon = require('../prebuilt/linux/electron/x64/db-cross-v4-native.node');\n}\nelse {"
        if old not in s:
            raise SystemExit("db-cross-v4/dist/binding.js: không khớp anchor")
        binding.write_text(s.replace(old, new, 1), encoding="utf-8")

futil = libs / "file-utilities" / "index.js"
if futil.is_file():
    s = futil.read_text(encoding="utf-8")
    if "case 'linux':" not in s:
        futil.write_text(s.replace("switch (platform) {", "switch (platform) {\n    case 'linux':\n      return join(__dirname, 'linux', 'file-utilities.node')", 1), encoding="utf-8")

fu = libs / "file-utils" / "index.js"
if fu.is_file():
    s = fu.read_text(encoding="utf-8")
    if "process.platform === 'linux'" not in s:
        s = re.sub(r"\}\s*else\s*\{\s*return\s*\{error:\s*['\"]not support['\"]\};", '} else if (process.platform === "linux"){\n    return require("./linux/file-utils.node");\n  } else {\n    return {error: "not support"};', s, count=1)
        fu.write_text(s, encoding="utf-8")

mp4 = libs / "mp4thumb" / "index.js"
if mp4.is_file():
    s = mp4.read_text(encoding="utf-8")
    if "process.platform === 'linux'" not in s:
        old = "if(process.platform === 'win32') {\n            thumbModule = require(`./win32/${process.arch}/mp4thumb.node`);\n        }\n        else {"
        new = old.replace("else {", "else if(process.platform === 'linux') {\n            thumbModule = require(`./linux/mp4thumb.node`);\n        }\n        else {")
        mp4.write_text(s.replace(old, new, 1), encoding="utf-8")

zim = libs / "zimage" / "index.js"
if zim.is_file():
    s = zim.read_text(encoding="utf-8")
    if "process.platform === 'linux'" not in s:
        old = "} else {\n\t\t\tos = 'darwin_x64';\n\t\t}\n\t}\n}"
        new = "} else {\n\t\t\tos = 'darwin_x64';\n\t\t}\n\t} else if (process.platform === 'linux') {\n\t\tos = 'linux_x64';\n\t}\n}"
        zim.write_text(s.replace(old, new, 1), encoding="utf-8")

zjxl = libs / "zjxl" / "index.js"
if zjxl.is_file():
    s = zjxl.read_text(encoding="utf-8")
    if "process.platform === 'linux'" not in s:
        s = re.sub(
            r"(require\(['\"]\./build/darwin_x64/jxl\.node['\"]\);\s*\})\s*else\s*\{",
            r"\1 else if (process.platform === 'linux') {\n    nodeAddon = require('./build/linux/zjxl.node');\n  } else {",
            s,
            count=1,
        )
        zjxl.write_text(s, encoding="utf-8")

zlang = libs / "zlang" / "index.js"
if zlang.is_file():
    s = zlang.read_text(encoding="utf-8")
    if "LINUX_X64" not in s:
        s = s.replace(
            'SupportedPlatform["WIN32_X64"] = "win32-x64";',
            'SupportedPlatform["WIN32_X64"] = "win32-x64";\n    SupportedPlatform["LINUX_X64"] = "linux-x64";',
            1,
        )
        s = s.replace(
            "case SupportedPlatform.WIN32_X64:",
            "case SupportedPlatform.WIN32_X64:\n    case SupportedPlatform.LINUX_X64:",
            1,
        )
        s = s.replace(
            "if (process.platform !== 'darwin' && process.platform !== 'win32')",
            "if (process.platform !== 'darwin' && process.platform !== 'win32' && process.platform !== 'linux')",
            1,
        )
        zlang.write_text(s, encoding="utf-8")

osi = libs / "os-sys-info" / "index.js"
if osi.is_file():
    s = osi.read_text(encoding="utf-8")
    if "ZALUX_LINUX_PROC_SNAPSHOT" not in s:
        linux_osi = '''// ZALUX_LINUX_PROC_SNAPSHOT
'use strict';
const fs = require('fs');
const os = require('os');

let cachedBootSec = null;
function getBootTimeSec() {
    if (cachedBootSec !== null) return cachedBootSec;
    try {
        const stat = fs.readFileSync('/proc/stat', 'utf8');
        const m = /^btime\\s+(\\d+)/m.exec(stat);
        cachedBootSec = m ? Number(m[1]) : Math.floor(Date.now() / 1000 - os.uptime());
    } catch (_) {
        cachedBootSec = Math.floor(Date.now() / 1000 - os.uptime());
    }
    return cachedBootSec;
}

function readLinuxSnapshot(pids) {
    const samples = [];
    const errors = [];
    const btimeSec = BigInt(getBootTimeSec());
    const nowMs = Date.now();
    const pageSize = 4096;
    for (const rawPid of (Array.isArray(pids) ? pids : [])) {
        const pid = Math.floor(Number(rawPid));
        if (!Number.isFinite(pid) || pid <= 0) continue;
        try {
            const raw = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
            const rp = raw.lastIndexOf(')');
            if (rp < 0) continue;
            const f = raw.slice(rp + 2).trim().split(/\\s+/);
            if (f.length < 22) continue;
            const ppid = parseInt(f[1], 10) || 0;
            const utimeTicks = BigInt(f[11] || '0');
            const stimeTicks = BigInt(f[12] || '0');
            const startTicks = BigInt(f[19] || '0');
            const rssPages = Math.max(0, parseInt(f[21], 10) || 0);
            let privBytes = rssPages * pageSize;
            try {
                const sm = fs.readFileSync(`/proc/${pid}/statm`, 'utf8').trim().split(/\\s+/);
                if (sm.length >= 3) {
                    const res = parseInt(sm[1], 10) || 0;
                    const shr = parseInt(sm[2], 10) || 0;
                    if (res >= shr) privBytes = (res - shr) * pageSize;
                }
            } catch (_) {}
            samples.push({
                pid,
                ppid,
                userTime100ns: utimeTicks * 100000n,
                kernelTime100ns: stimeTicks * 100000n,
                creation100ns: (btimeSec * 1000n + (startTicks * 1000n) / 100n) * 10000n,
                workingSet: rssPages * pageSize,
                privateBytes: privBytes,
                wallUnixMs: nowMs,
            });
        } catch (err) {
            errors.push({ pid, op: 'stat', code: (err && err.code) || 'ESRCH' });
        }
    }
    return { samples, errors };
}

if (process.platform === 'linux') {
    module.exports = {
        isAvailable() { return true; },
        loadError() { return null; },
        async getProcessSnapshot(pids) { return readLinuxSnapshot(pids); },
        getOsArchitecture() { return process.arch; },
        getOsMachine() { return typeof os.machine === 'function' ? os.machine() : process.arch; },
    };
} else {
'''
        osi.write_text(linux_osi + s.replace("'use strict';", "", 1) + "\n}\n", encoding="utf-8")

zf = libs / "zfile" / "index.js"
if zf.is_file():
    s = zf.read_text(encoding="utf-8")
    if "ZALUX_ZFILE_FALLBACK" not in s:
        old_block = """    else {
        return {
            stat: () => {},
            diskInfo: () => {},
            statFolder: () => {},
        };
    }"""
        new_block = """    else {
        // ZALUX_ZFILE_FALLBACK
        const fs = require('fs');
        const checkPerm = (p, mode) => { try { fs.accessSync(p, mode); return true; } catch (_) { return false; } };
        return {
            stat: async (p) => { try { const st = await fs.promises.stat(p); return { size: st.size, isDirectory: st.isDirectory(), mtimeMs: st.mtimeMs }; } catch (_) { return null; } },
            diskInfo: async () => [],
            statFolder: async (p) => { try { const st = await fs.promises.stat(p); return { size: st.size, isDirectory: st.isDirectory(), mtimeMs: st.mtimeMs }; } catch (_) { return null; } },
            copyFolder: async (src, dest, cb) => { try { await fs.promises.cp(src, dest, { recursive: true }); if (cb) cb(null, true); return true; } catch (e) { if (cb) cb(e); throw e; } },
            cancelCopy: async () => true,
            canReadAndWrite: (p) => checkPerm(p, fs.constants.R_OK | fs.constants.W_OK),
            canRead: (p) => checkPerm(p, fs.constants.R_OK),
            canWrite: (p) => checkPerm(p, fs.constants.W_OK),
        };
    }"""
        if old_block in s:
            zf.write_text(s.replace(old_block, new_block, 1), encoding="utf-8")

v8p = libs / "v8-profiles" / "index.js"
if v8p.is_file():
    s = v8p.read_text(encoding="utf-8")
    if "ZALUX_V8_PROFILES_SAFE" not in s:
        old_req = "var binding = process.platform === 'win32' ? (process.arch === 'ia32' ? require('./profiler_electron1.8_win32_ia32.node') : require('./profiler_electron1.8_win32_x64.node')) : require('./profiler_electron1.8_mac.node')"
        new_req = """// ZALUX_V8_PROFILES_SAFE
var binding;
try {
  binding = process.platform === 'win32'
    ? (process.arch === 'ia32' ? require('./profiler_electron1.8_win32_ia32.node') : require('./profiler_electron1.8_win32_x64.node'))
    : (process.platform === 'darwin' ? require('./profiler_electron1.8_mac.node') : null);
} catch (_) { binding = null; }
if (!binding) {
  binding = { cpu: { profiles: {}, startProfiling: function() {}, stopProfiling: function(n) { return { typeId: 'CPU', uid: 1, title: n || '', head: { children: [] }, samples: [], timestamps: [] }; }, setSamplingInterval: function() {} } };
}"""
        if old_req in s:
            v8p.write_text(s.replace(old_req, new_req, 1), encoding="utf-8")
PY

# ---------------------------------------------------------------- 3. Cài plugins & zcall-engine
echo ">>> [3/6] Tích hợp zcall-engine, Call Window UI & Zalux Enhancements..."
rm -rf "$APP_OUT/plugins/zcall" "$APP_OUT/plugins/zalux" "$APP_OUT/zcall-assets"
mkdir -p "$APP_OUT/plugins" "$APP_OUT/zcall-assets"
cp -a "$RUNTIME/plugins/zcall" "$APP_OUT/plugins/zcall"
cp -a "$RUNTIME/plugins/zalux" "$APP_OUT/plugins/zalux"
cp -a "$ASSETS_OUT/." "$APP_OUT/zcall-assets/"
install -m 0755 "$RUNTIME/bin/zcall-engine" "$APP_OUT/zcall-engine"

HELPER_DIR="$APP_OUT/native/qt-call-cap-mac/ZaloHelper.app/Contents/MacOS"
mkdir -p "$HELPER_DIR"
cat > "$HELPER_DIR/ZaloCall" <<'SH'
#!/bin/sh
set -u
SELF_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd) || exit 127
APP_ROOT=$(CDPATH= cd -- "$SELF_DIR/../../../../.." && pwd) || exit 127
ENGINE="${ZCALL_ENGINE:-$APP_ROOT/zcall-engine}"
[ -x "$ENGINE" ] || exit 127
case "${1:-}" in
  --recv|--send|--token|--ui-port|--ui-token|--decode-pipe) exec "$ENGINE" "$@" ;;
esac
RECV="${1:-29631}"
SEND="${2:-29632}"
TOKEN="${3:-${ZALO_LINUX_CALL_IPC_TOKEN:-}}"
[ -n "$TOKEN" ] || exit 2
exec "$ENGINE" --recv "$RECV" --send "$SEND" --token "$TOKEN"
SH
chmod 0755 "$HELPER_DIR/ZaloCall"

# ---------------------------------------------------------------- 4. Áp dụng patchers Linux
echo ">>> [4/6] Áp dụng bộ patch tương thích Linux (IPC, Titlebar, Call UI, Sync, XDG)..."
export ZALO_APP_DIR="$APP_OUT"
python3 "$RUNTIME/toolchain/patch-main-ipc.py" >/dev/null
python3 "$RUNTIME/toolchain/patch-titlebar.py" >/dev/null
python3 "$RUNTIME/toolchain/patch-call-ui.py" >/dev/null
python3 "$RUNTIME/toolchain/patch-reaction-sync.py" >/dev/null
python3 "$RUNTIME/toolchain/patch-linux-paths.py" >/dev/null
if [ -f "$RUNTIME/toolchain/patch-feature-flags.py" ]; then
    python3 "$RUNTIME/toolchain/patch-feature-flags.py" --app "$APP_OUT" >/dev/null
fi

# Xoá các bản .orig tạm thời để giảm dung lượng gói
find "$APP_OUT" -name "*.zalo-linux.orig" -delete

# Trích danh sách API tĩnh từ bundle renderer ra dist/api-inventory/ (stdlib Python, không mạng)
if [ -f "$RUNTIME/toolchain/extract-api.py" ]; then
    python3 "$RUNTIME/toolchain/extract-api.py" \
        --app "$APP_OUT" \
        --out "$DIST/api-inventory" \
        --root "" >/dev/null || echo "build-from-dmg: cảnh báo: extract-api.py lỗi nhẹ" >&2
fi

# ---------------------------------------------------------------- 5. Lắp ráp AppDir với Electron v22
echo ">>> [5/6] Lắp ráp AppDir với Electron v${ELECTRON_VER}..."
ELECTRON_ZIP="${ELECTRON_CACHE_ZIP:-$HOME/.cache/electron/electron-v${ELECTRON_VER}-linux-x64.zip}"
if [ ! -f "$ELECTRON_ZIP" ]; then
    ELECTRON_ZIP="$CACHE/electron-v${ELECTRON_VER}-linux-x64.zip"
    if [ ! -f "$ELECTRON_ZIP" ]; then
        echo "    Tải Electron v${ELECTRON_VER}..."
        curl -L --fail --max-time 900 -o "$ELECTRON_ZIP" "$ELECTRON_URL"
    fi
fi

rm -rf "$APPDIR"
mkdir -p "$APPDIR"
unzip -q -o "$ELECTRON_ZIP" -d "$APPDIR"
mv "$APPDIR/electron" "$APPDIR/zalo"
chmod 0755 "$APPDIR/zalo"
rm -f "$APPDIR/resources/default_app.asar"
mv "$APP_OUT" "$APPDIR/resources/app"

install -m 0644 "$ROOT/assets/zalux.png" "$APPDIR/zalux.png"
ln -sf zalux.png "$APPDIR/.DirIcon"
mkdir -p "$APPDIR/usr/share/icons/hicolor/512x512/apps"
install -m 0644 "$ROOT/assets/zalux.png" "$APPDIR/usr/share/icons/hicolor/512x512/apps/zalux.png"

cat > "$APPDIR/zalux.desktop" <<'DESK'
[Desktop Entry]
Name=Zalux
Comment=Zalux - Zalo Desktop for Linux
Exec=AppRun
Icon=zalux
Terminal=false
Type=Application
StartupWMClass=Zalo
Categories=Network;InstantMessaging;Chat;
MimeType=x-scheme-handler/zalo;
DESK

cat > "$APPDIR/AppRun" <<'RUN'
#!/bin/sh
HERE="$(dirname "$(readlink -f "$0")")"
if [ -z "${GTK_THEME:-}" ] && command -v gsettings >/dev/null 2>&1; then
  case "$(gsettings get org.gnome.desktop.interface color-scheme 2>/dev/null || true)" in
    *dark*)
      _theme="$(gsettings get org.gnome.desktop.interface gtk-theme 2>/dev/null | tr -d "'" || true)"
      [ -n "$_theme" ] && export GTK_THEME="$_theme"
      ;;
  esac
fi
if [ -n "${DISPLAY:-}" ] && [ "${ZALUX_WAYLAND_NATIVE:-0}" != "1" ]; then
  set -- --ozone-platform=x11 --enable-features=JXL,WebRTCPipeWireCapturer "$@"
else
  set -- --ozone-platform=wayland --enable-features=JXL,WaylandWindowDecorations,WebRTCPipeWireCapturer "$@"
fi
exec /usr/bin/env \
  -u ELECTRON_RUN_AS_NODE \
  -u GIO_LAUNCHED_DESKTOP_FILE \
  -u GIO_LAUNCHED_DESKTOP_FILE_PID \
  -u SNAP \
  -u SNAP_NAME \
  -u SNAP_APP_DESKTOP_FILE \
  CHROME_DESKTOP=zalux.desktop \
  "$HERE/zalo" \
  --no-sandbox \
  --disable-crash-reporter \
  --disable-gpu-memory-buffer-video-frames \
  "$@"
RUN
chmod 0755 "$APPDIR/AppRun"

# ---------------------------------------------------------------- 6. Đóng gói AppImage (nếu có appimagetool)
echo ">>> [6/6] Đóng gói đầu ra..."
APPIMAGE_OUT="$DIST/Zalux-${VER}-x86_64.AppImage"
APPIMAGETOOL="${APPIMAGETOOL:-$(command -v appimagetool || true)}"
if [ -z "$APPIMAGETOOL" ] && [ -x "$CACHE/appimagetool-x86_64.AppImage" ]; then
    APPIMAGETOOL="$CACHE/appimagetool-x86_64.AppImage"
fi
if [ -z "$APPIMAGETOOL" ] && [ "${ZALUX_SKIP_APPIMAGE:-0}" != "1" ]; then
    echo "    Tải appimagetool-x86_64.AppImage..."
    if curl -fsSL --max-time 180 -o "$CACHE/appimagetool-x86_64.AppImage" \
        "https://github.com/AppImage/appimagetool/releases/download/continuous/appimagetool-x86_64.AppImage"; then
        chmod 0755 "$CACHE/appimagetool-x86_64.AppImage"
        APPIMAGETOOL="$CACHE/appimagetool-x86_64.AppImage"
    fi
fi

if [ -n "$APPIMAGETOOL" ] && [ -x "$APPIMAGETOOL" ]; then
    ARCH=x86_64 APPIMAGE_EXTRACT_AND_RUN=1 "$APPIMAGETOOL" "$APPDIR" "$APPIMAGE_OUT" >/dev/null
    chmod 0755 "$APPIMAGE_OUT"
    sha256sum "$APPIMAGE_OUT"
    echo "build-from-dmg: HOÀN TẤT -> $APPIMAGE_OUT"
else
    echo "build-from-dmg: HOÀN TẤT AppDir -> $APPDIR"
    echo "    Cài trực tiếp bằng: ./installer/install.sh \"$APPDIR\""
fi

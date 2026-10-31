#!/bin/bash
# Apply local patches to an extracted Zalo AppDir (macOS port).
# Usage: apply.sh /path/to/AppDir
set -e
DIR="${1:?usage: apply.sh <AppDir>}"
HERE="$(cd "$(dirname "$0")" && pwd)"

# 1) call UI patches (asar): notice center + IR camera filter + call-end cleanup
if [ -f "$DIR/resources/app.asar" ]; then
  "$HERE/patch-asar.sh" "$DIR" >/dev/null
else
  cp "$HERE/incoming.js" "$DIR/app/plugins/zcall/incoming.js"
  cp "$HERE/zcall-window.js" "$DIR/app/plugins/zcall/window.js"
fi

# 2) renderer: hide titlebar + remove account name from title
python3 - "$DIR" "$HERE/preload-hide-titlebar.js" <<'PY'
import glob, sys
d, blockf = sys.argv[1], sys.argv[2]
block = open(blockf).read()
p = d + '/app/main-dist/preload-render.js'
s = open(p, encoding='utf-8', errors='ignore').read()
if 'ZALO LINUX HIDE TITLEBAR START' not in s:
    open(p, 'a', encoding='utf-8').write('\n' + block + '\n')
for f in glob.glob(d + '/app/pc-dist/*.js') + glob.glob(d + '/app/pc-dist/lazy/*.js'):
    s = open(f, encoding='utf-8', errors='ignore').read()
    o = s.replace('`Zalo - ${i}`', '`Zalux`').replace('`Zalo - ${s}`', '`Zalux`').replace('`Zalo`', '`Zalux`').replace('document.title="Zalo"', 'document.title="Zalux"')
    if o != s:
        open(f, 'w', encoding='utf-8').write(o)
PY

# 3) privacy (hide typing/delivered/seen) main + preload
python3 - "$DIR" "$HERE" <<'PY'
import pathlib, sys
d, here = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
for name, block in [('main.js', 'privacy-main.js'), ('main.js', 'setup-main.js'), ('preload-render.js', 'privacy-preload.js'), ('preload-render.js', 'setup-preload.js'), ('preload-noti.js', 'preload-noti.js')]:
    p = d / 'app' / 'main-dist' / name
    s = p.read_text(errors='ignore')
    b = (here / block).read_text()
    marker = b.splitlines()[0]
    if marker not in s:
        p.write_text(s + '\n' + b)
PY

# 4) custom ringtone (if provided)
if [ -f "$HERE/ringtone.mp3" ]; then
  cp "$HERE/ringtone.mp3" "$DIR/app/zcall-assets/sound/zalo_ringtone.mp3"
fi
if [ -f "$HERE/ringtone.wav" ]; then
  cp "$HERE/ringtone.wav" "$DIR/app/zcall-assets/sound/zalo_ringtone.wav"
fi


# 5) notification window: auto-close after 5s (call-ended toast hay bị kẹt)
python3 - "$DIR" <<'PY2'
import pathlib, sys
p = pathlib.Path(sys.argv[1]) / 'app' / 'main-dist' / 'main.js'
s = p.read_text(errors='ignore')
old = "onSuccessUpdate:function(){y.isVisible()||y.showInactive()}"
new = "onSuccessUpdate:function(){y.isVisible()||y.showInactive();clearTimeout(y.__zaluxNotiTimer);y.__zaluxNotiTimer=setTimeout(function(){try{y.closeIfSafe&&y.closeIfSafe()}catch(_){}},5000)}"
if old in s:
    p.write_text(s.replace(old, new))
PY2

python3 "$HERE/install-userscripts.py" >/dev/null
# copy default sounds for a fresh install
mkdir -p "$HOME/.local/share/zalo-linux/sounds"
cp -n "$HERE/sounds/"*.mp3 "$HOME/.local/share/zalo-linux/sounds/" 2>/dev/null || true

echo "patched $DIR"

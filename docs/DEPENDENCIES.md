# Dependencies

## Runtime (bản AppImage extract / deb / rpm)
Electron 22 cần thư viện hệ thống; AppImage đã bundle Chromium nhưng vẫn dùng GTK/NSS/X11/ALSA của distro.

### Ubuntu / Debian
```
libgtk-3-0 libnss3 libx11-xcb1 libxcb-dri3-0 libxcomposite1 libxdamage1
libxrandr2 libgbm1 libasound2 libatk-bridge2.0-0 libatspi2.0-0
libcups2 libpango-1.0-0 libcairo2 libdrm2 libxss1 libxtst6
libsecret-1-0 python3 libopus0 pulseaudio-utils xdg-utils
```
Ubuntu 24.04+ có thể dùng gói `t64` (`libasound2t64`, `libgtk-3-0t64`); deb khai báo alternative.

### Fedora / RHEL
```
gtk3 nss libX11-xcb libxcb libXcomposite libXdamage libXrandr mesa-libgbm
alsa-lib atk at-spi2-atk cups-libs pango cairo libdrm libXScrnSaver libXtst
libsecret python3 opus pulseaudio-utils xdg-utils
```

### Cuộc gọi (zcall-native)
```
python3 libopus0 pulseaudio-utils   # parec/pacat/pactl; hoặc alsa-utils (arecord/aplay)
```
Đã kiểm tra trên máy hiện tại: `libopus.so.0`, `parec`, `pacat`, `pactl`, `arecord` đều có.

## Build từ DMG
```
git nodejs npm 7zip rustc cargo gcc g++ make pkg-config
libssl-dev liblzma-dev python3
```
(`npm run main` tải Electron 22 + DMG official; lần đầu cần internet.)

## Installer / deb / rpm
Chỉ cần `python3`, `curl`, `git`, `7z` (nếu tự extract), **không cần Node/npm**.
Patch `app.asar` dùng `patches/asar.py` (thuần Python).

## Ghi chú
- AppImage chạy trực tiếp cần FUSE (`libfuse2`/`fuse-libs`); bản cài bằng `installer/install.sh` hoặc deb/rpm **extract AppDir** nên không cần FUSE.
- `--no-sandbox` dùng vì `chrome-sandbox` không setuid trong AppImage; nếu muốn sandbox, `chown root:root chrome-sandbox && chmod 4755`.

# Phụ thuộc hệ thống (Dependencies)

## Runtime (AppImage extract / deb / rpm)
Zalux chạy trên Electron 22 kết hợp engine Rust `zcall-engine` và **9 thư viện N-API Linux `x86_64` tự viết** (`node_sqlite3`, `db-cross-v4-native`, `zjxl`, `zimage`, `mp4thumb`, `file-utils`, `file-utilities`, `zwalker`, `zlang` — trong đó SQLite3 FTS5, JPEG XL và giải mã ZDB4 được liên kết tĩnh bên trong `.node`).

### Ubuntu / Debian
```bash
sudo apt install libgtk-3-0t64 libnss3 libx11-xcb1 libxcb-dri3-0 libxcomposite1 \
  libxdamage1 libxrandr2 libgbm1 libasound2t64 libatk-bridge2.0-0 libatspi2.0-0 \
  libcups2t64 libpango-1.0-0 libcairo2 libdrm2 libxss1 libxtst6 libsecret-1-0 \
  libopus0 libpipewire-0.3-0t64 xdg-desktop-portal pulseaudio-utils ffmpeg xdg-utils
```
*(Trên Debian 12 hoặc Ubuntu 22.04, thay hậu tố `t64` bằng tên gói thường như `libgtk-3-0`, `libasound2`, `libcups2`, `libpipewire-0.3-0`.)*

### Fedora / RHEL
```bash
sudo dnf install gtk3 nss libX11-xcb libxcb libXcomposite libXdamage libXrandr \
  mesa-libgbm alsa-lib atk at-spi2-atk cups-libs pango cairo libdrm \
  libXScrnSaver libXtst libsecret opus pipewire-libs xdg-desktop-portal \
  pulseaudio-utils ffmpeg xdg-utils
```

### Arch Linux
```bash
sudo pacman -S opus libpulse libpipewire xdg-desktop-portal ffmpeg gtk3 nss \
  libx11 libxcb mesa alsa-lib libsecret xdg-utils
```

### Cuộc gọi thoại, video & chia sẻ màn hình (`zcall-engine`)
- `libopus0` + `pulseaudio-utils` (`pactl` / PipeWire Pulse) + `ffmpeg` (thu phát âm thanh 16 kHz độ trễ thấp và giải mã luồng video H.264/HEVC chiều nhận qua `libavcodec`).
- `libpipewire-0.3` + `xdg-desktop-portal` (cùng backend của môi trường desktop như `xdg-desktop-portal-gnome` / `kde` / `gtk` / `wlr`): phục vụ chia sẻ màn hình native qua Portal ScreenCast + PipeWire `MemFd` + OpenH264 ngay trong `zcall-engine`.

## Tự đóng gói từ DMG macOS chính thức (`scripts/build-from-dmg.sh`)
Không cần Node.js, npm hay trình biên dịch Rust/C++ (các binary Linux trong `runtime/` đã được biên dịch sẵn và strip gọn):
```bash
7zip (hoặc p7zip-full)  python3  curl  unzip
```

## Ghi chú
- Chạy trực tiếp file `.AppImage` cần FUSE (`libfuse2` / `fuse-libs`). Cài đặt qua `./installer/install.sh` hoặc gói `.deb` / `.rpm` giải nén sẵn `AppDir` nên **không cần FUSE**.

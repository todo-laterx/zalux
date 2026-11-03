# Hướng dẫn Đóng gói (Packaging)

## 1. Đóng gói từ DMG macOS chính thức
```bash
./scripts/build-from-dmg.sh 26.10.20
# hoặc truyền đường dẫn file DMG đã tải sẵn:
./scripts/build-from-dmg.sh /path/to/ZaloSetup-universal-26.10.20.dmg
```
Kết quả tạo ra thư mục `build/AppDir` và gói `dist/Zalux-26.10.20-x86_64.AppImage`.

## 2. Đóng gói `.deb` (Debian / Ubuntu)
```bash
packaging/deb/build.sh dist/Zalux-26.10.20-x86_64.AppImage 26.10.20
# hoặc đóng gói thẳng từ build/AppDir:
packaging/deb/build.sh build/AppDir 26.10.20
# -> dist/zalux_26.10.20_amd64.deb
```
Gói cài đặt vào `/opt/zalux`, tạo lệnh `/usr/bin/zalux`, biểu tượng hệ thống và `zalux.desktop`.

## 3. Đóng gói `.rpm` (Fedora / RHEL / openSUSE)
```bash
sudo dnf install rpm-build   # hoặc sudo apt install rpm
packaging/rpm/build.sh dist/Zalux-26.10.20-x86_64.AppImage 26.10.20
# -> dist/zalux-26.10.20-1.x86_64.rpm
```

## Tương thích
- **AppImage / AppDir**: mọi bản phân phối Linux `x86_64` có `glibc >= 2.31`.
- **Nguyên tắc phân phối mã nguồn**: Repo không lưu trữ `.dmg`, `.asar` hoặc tài sản độc quyền của Zalo; quá trình đóng gói kết hợp client chính thức với bộ runtime Rust trong `runtime/`.

# Packaging

## deb
```bash
packaging/deb/build.sh dist/Zalux-26.10.20.AppImage 26.10.20
# -> dist/zalux_26.10.20_amd64.deb
```
Gói cài `/opt/zalux` (AppDir đã extract + patch), `/usr/bin/zalux`, desktop entry.
Wrapper tự cài ZaSetup userscript + sounds vào `~/.config/ZaloData` / `~/.local/share/zalo-linux` lần đầu chạy.

## rpm
```bash
sudo apt install rpm        # hoặc dnf install rpm-build
packaging/rpm/build.sh dist/Zalux-26.10.20.AppImage 26.10.20
# -> ~/rpmbuild/RPMS/x86_64/zalux-26.10.20-1.x86_64.rpm
```

## Tương thích
- AppImage: mọi distro glibc ≥ 2.31 (Electron 22).
- deb: Debian/Ubuntu; khai báo dependency ở trên.
- rpm: Fedora/RHEL/openSUSE; spec khai báo tên gói RPM tương ứng.
- Không đóng gói kèm DMG/Zalo binary vào repo; build từ AppImage official/upstream tại máy người dùng.

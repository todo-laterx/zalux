# AUR

`zalux-bin` đóng gói AppImage Original của upstream, áp patch Zalux, cài vào `/opt/zalux`.
AUR yêu cầu tài khoản Arch/AUR để đẩy `PKGBUILD` + `.SRCINFO`.

```bash
makepkg --printsrcinfo > .SRCINFO
makepkg -si
```

Muốn cập nhật bản mới: đổi `pkgver`, URL AppImage, sha256, và commit hash trong `source`.

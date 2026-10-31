# Zalux patch kit

- `apply.sh <AppDir>` — áp toàn bộ patch (titlebar, call center, IR camera, privacy, ZaSetup UI) + copy samples.
- `set-zalo-ringtone <file>` — đổi nhạc chuông cuộc gọi (lưu vào `ringtone.mp3` để tự áp lại sau update).
- `set-zalo-noti-sound <file>` — đổi âm thanh thông báo (userscript `CustomNotiSound`).
- `sounds/` — mẫu mặc định (Mixkit free license): 7 nhạc chuông, 7 âm thông báo.
- `ZaSetup.user.js` — UI setup trong sidebar (icon Privacy), lưu ở `~/.config/ZaloData/userscripts.json`.
- Cấu hình: `za-privacy.json` (ẩn đang soạn/đã nhận/đã xem), `za-setup.json` (âm thanh đang dùng).

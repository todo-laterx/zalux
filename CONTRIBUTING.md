# Đóng góp cho Zalux

Cảm ơn bạn muốn giúp Zalux tốt hơn.

## Báo lỗi
Mở issue với:
- Distro + phiên bản (Ubuntu 26.04, Fedora 42, …), Wayland/X11.
- Phiên bản Zalo/Zalux (`cat VERSION`).
- Bước tái hiện, log liên quan (`~/.config/ZaloData/native-engine-*.log`, console app).
- Ảnh/video nếu là lỗi UI.

## Gửi patch
- Patch nhỏ, đúng một mục đích; giải thích lý do trong PR.
- Không commit binary Zalo, AppImage, DMG, hay dữ liệu tài khoản.
- Chạy `shellcheck` cho script và `python3 -m py_compile` cho Python trước khi gửi.
- Với patch asar/preload: ghi rõ áp dụng cho phiên bản Zalo nào; ưu tiên cách ít phụ thuộc bundle nhất.

## Cập nhật phiên bản Zalo
1. `./scripts/check-update.sh`
2. `./scripts/update.sh` (nếu upstream có bản mới)
3. Nếu upstream chưa có: `./scripts/build-from-dmg.sh <version>` rồi kiểm tra call/UI.
4. Cập nhật `VERSION`, `CHANGELOG.md`, build lại deb/rpm nếu cần.

## Nguyên tắc
- Tôn trọng người dùng: không telemetry, không gửi dữ liệu ra ngoài.
- Không hứa tính năng chưa kiểm chứng.
- Giữ attribution cho upstream và Mixkit.

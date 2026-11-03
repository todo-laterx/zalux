# Đóng góp cho Zalux

Cảm ơn bạn đã đóng góp cải thiện Zalux trên Linux.

## Báo lỗi
Mở issue kèm thông tin:
- Bản phân phối + phiên bản (Ubuntu 26.04, Debian 13, Fedora 42, …), môi trường hiển thị (Wayland / X11).
- Phiên bản Zalux (`cat VERSION`).
- Các bước tái hiện và log liên quan (đã xoá thông tin nhạy cảm / ID cá nhân).
- Ảnh chụp hoặc video minh hoạ nếu là lỗi giao diện / cuộc gọi.

## Gửi Pull Request
- Giữ phạm vi thay đổi gọn, tập trung vào một mục tiêu rõ ràng.
- Tuyệt đối không commit binary Zalo, file `.dmg`, `.asar`, `.AppImage`, âm thanh gốc của Zalo hay dữ liệu tài khoản.
- Kiểm tra cú pháp với `bash -n`, `node --check` và `python3 -m py_compile` trước khi gửi.

## Quy trình cập nhật khi Zalo ra phiên bản mới
1. `./scripts/check-update.sh`
2. `./scripts/build-from-dmg.sh <version>` để đóng gói từ DMG macOS chính thức và kiểm thử Chat / Voice / Video Call.
3. Cập nhật `VERSION`, `CHANGELOG.md` và tạo gói `.AppImage` / `.deb` / `.rpm`.

## Nguyên tắc
- Không telemetry, không gửi dữ liệu người dùng ra ngoài.
- Giữ ghi nhận bản quyền mẫu âm thanh Mixkit Free License trong `NOTICE`.

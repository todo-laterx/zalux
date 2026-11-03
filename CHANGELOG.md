# Changelog

## 26.10.20 — 2026-11-03
- Nền tảng clean-room 100% tự phát triển độc lập (không phụ thuộc bất kỳ bản vá MIT hay userscript cộng đồng bên thứ ba nào): `zcall-engine` (Rust ZRTC 1:1 & Zavi SFU Group Call), `zalo-asar` và **9 N-API native modules** biên dịch riêng cho Linux `x86_64` (~15.4 MB sau khi `strip`).
- Hiệu năng & bộ nhớ tối ưu sâu bằng Rust: tiến trình `zcall-engine` chỉ chiếm **~3.4 MB PSS** khi chờ và **~6.0 MB PSS** khi giải mã video trực tiếp (`< 1.2%` tổng RAM ứng dụng Electron), loại bỏ hoàn toàn helper C++/Qt5 nặng (~80–150 MB RSS) hay lớp giả lập Wine (+300–500 MB).
- Gọi 1:1 HD `1280×720 @ 24fps` (`1.2 Mbps`, ZRTC `PT 97/98`), giải mã độ trễ 0 khung hình cả **H.264** lẫn **HEVC (`PT 121/122`)** qua `libavcodec`, tự co giãn cửa sổ theo hướng camera dọc/ngang kèm nền mờ, nhận cuộc gọi tắt sẵn camera (`camStartOff`) và tự hồi phục luồng camera/encoder.
- **Gọi nhóm Zavi SFU kiểu Zoom**: hỗ trợ chế độ Lưới (`Gallery`) và Người nói (`Speaker View`), tự khớp tỉ lệ khung hình riêng từng thành viên (PC 16:9 đi cùng điện thoại dọc 9:16), viền xanh nổi bật người đang nói, phân trang tự động, danh sách thành viên trong phòng và mời thêm bạn trực tiếp.
- **Chia sẻ màn hình Linux chuẩn Native**: tích hợp `xdg-desktop-portal` ScreenCast + `PipeWire` + `OpenH264` ngay trong `zcall-engine` (không cần GPU encoder), kèm hộp chọn đa màn hình/cửa sổ có ảnh xem trước khi chạy qua đường trình duyệt.
- **Kiểm soát âm thanh & Desktop Linux**: thanh trượt chỉnh âm lượng micro trực tiếp, tự lọc bỏ thiết bị âm thanh ảo/camera hồng ngoại (IR), System Tray + Unread Badge thời gian thực, đồng bộ viền cửa sổ tối (`_GTK_THEME_VARIANT=dark`) và tự chọn XWayland/Wayland ổn định.
- Bảng cài đặt Zalux tích hợp sẵn trong thanh điều hướng trái: bật/tắt quyền riêng tư (“đang soạn tin”, “đã nhận”, “đã xem”) và nghe thử trực tiếp 12 nhạc chuông + 14 âm thông báo.
- Hỗ trợ đóng gói sạch trực tiếp từ DMG macOS chính thức (`scripts/build-from-dmg.sh`) xuất ra `AppImage`, `.deb`, `.rpm`, `PKGBUILD` và `Flatpak`.

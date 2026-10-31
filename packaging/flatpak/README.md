# Flatpak (experimental)

Build local:

```bash
flatpak-builder --user --install --force-clean build-dir packaging/flatpak/io.github.todo_laterx.Zalux.yml
flatpak run io.github.todo_laterx.Zalux
```

Lưu ý:
- Zalo client là phần mềm độc quyền; **không nộp Flathub** khi chưa có quyền phân phối.
- Sandbox cần `--device=all` cho camera/mic, `--socket=pulseaudio` cho call; screen share dùng portal.
- Đây là manifest tham khảo, chưa test trên máy Flatpak thật.

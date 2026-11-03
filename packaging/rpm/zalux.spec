Name:           zalux
Version:        @VERSION@
Release:        1%{?dist}
Summary:        Zalux - unofficial Zalo desktop for Linux
License:        MIT
URL:            https://github.com/todo-laterx/zalux
Source0:        zalux-payload.tar.gz
Requires:       gtk3 nss libX11-xcb libxcb libXcomposite libXdamage libXrandr mesa-libgbm
Requires:       alsa-lib atk at-spi2-atk cups-libs pango cairo libdrm libXScrnSaver libXtst
Requires:       libsecret opus pipewire-libs xdg-desktop-portal pulseaudio-utils ffmpeg xdg-utils
%description
Zalo desktop client on Linux powered by native Rust call engine and N-API modules.

%prep
%setup -q -c -T
tar -xzf %{SOURCE0}

%install
mkdir -p %{buildroot}/opt/zalux %{buildroot}/usr/bin %{buildroot}/usr/share/applications %{buildroot}/usr/share/icons/hicolor/512x512/apps %{buildroot}/usr/share/doc/zalux
cp %{_sourcedir}/NOTICE %{buildroot}/usr/share/doc/zalux/
cp -a app/. %{buildroot}/opt/zalux/
cat > %{buildroot}/usr/bin/zalux <<'WRAP'
#!/bin/sh
if [ -z "${GTK_THEME:-}" ] && command -v gsettings >/dev/null 2>&1; then
  case "$(gsettings get org.gnome.desktop.interface color-scheme 2>/dev/null || true)" in
    *dark*)
      _theme="$(gsettings get org.gnome.desktop.interface gtk-theme 2>/dev/null | tr -d "'" || true)"
      [ -n "$_theme" ] && export GTK_THEME="$_theme"
      ;;
  esac
fi
if [ -n "${DISPLAY:-}" ] && [ "${ZALUX_WAYLAND_NATIVE:-0}" != "1" ]; then
  set -- --ozone-platform=x11 --enable-features=JXL,WebRTCPipeWireCapturer "$@"
else
  set -- --ozone-platform=wayland --enable-features=JXL,WaylandWindowDecorations,WebRTCPipeWireCapturer "$@"
fi
exec /usr/bin/env -u ELECTRON_RUN_AS_NODE -u GIO_LAUNCHED_DESKTOP_FILE -u GIO_LAUNCHED_DESKTOP_FILE_PID -u SNAP -u SNAP_NAME -u SNAP_APP_DESKTOP_FILE CHROME_DESKTOP=zalux.desktop BAMF_DESKTOP_FILE_HINT=/usr/share/applications/zalux.desktop /opt/zalux/zalo --no-sandbox --disable-crash-reporter --disable-gpu-memory-buffer-video-frames "$@"
WRAP
chmod +x %{buildroot}/usr/bin/zalux
cp %{_sourcedir}/zalux.png %{buildroot}/usr/share/icons/hicolor/512x512/apps/zalux.png
cat > %{buildroot}/usr/share/applications/zalux.desktop <<'DESK'
[Desktop Entry]
Name=Zalux
Comment=Zalux - Zalo Desktop for Linux
Exec=/usr/bin/zalux %U
Icon=zalux
Terminal=false
Type=Application
StartupWMClass=Zalo
Categories=Network;InstantMessaging;Chat;
MimeType=x-scheme-handler/zalo;
DESK
%files
/opt/zalux
/usr/bin/zalux
/usr/share/applications/zalux.desktop
/usr/share/icons/hicolor/512x512/apps/zalux.png
/usr/share/doc/zalux/NOTICE

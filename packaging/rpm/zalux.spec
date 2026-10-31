Name:           zalux
Version:        @VERSION@
Release:        1%{?dist}
Summary:        Zalux - unofficial Zalo desktop for Linux
License:        MIT
URL:            https://github.com/your-org/zalux
Source0:        zalux-payload.tar.gz
Requires:       gtk3 nss libX11-xcb libxcb libXcomposite libXdamage libXrandr mesa-libgbm
Requires:       alsa-lib atk at-spi2-atk cups-libs pango cairo libdrm libXScrnSaver libXtst
Requires:       libsecret python3 opus pulseaudio-utils xdg-utils
%description
Zalo macOS client repackaged for Linux, with native call engine and local patches.

%prep
%setup -q -c -T
tar -xzf %{SOURCE0}

%install
mkdir -p %{buildroot}/opt/zalux %{buildroot}/usr/bin %{buildroot}/usr/share/applications %{buildroot}/usr/share/icons/hicolor/512x512/apps %{buildroot}/usr/share/doc/zalux
cp %{_sourcedir}/THIRD_PARTY_NOTICES.md %{buildroot}/usr/share/doc/zalux/
cp -a app/. %{buildroot}/opt/zalux/
cp -a patches %{buildroot}/opt/zalux/patches
cat > %{buildroot}/usr/bin/zalux <<'WRAP'
#!/bin/sh
P=/opt/zalux/patches
if [ -f "$P/install-userscripts.py" ]; then python3 "$P/install-userscripts.py" >/dev/null 2>&1 || true; fi
mkdir -p "$HOME/.local/share/zalo-linux/sounds"
cp -n "$P/sounds/"*.mp3 "$HOME/.local/share/zalo-linux/sounds/" 2>/dev/null || true
exec /usr/bin/env -u ELECTRON_RUN_AS_NODE /opt/zalux/zalo --no-sandbox --enable-gpu-rasterization --enable-zero-copy "$@"
WRAP
chmod +x %{buildroot}/usr/bin/zalux
cp %{_sourcedir}/zalux.png %{buildroot}/usr/share/icons/hicolor/512x512/apps/zalux.png
cat > %{buildroot}/usr/share/applications/zalux.desktop <<'DESK'
[Desktop Entry]
Name=Zalux
Comment=Zalux - Zalo Linux
Exec=/usr/bin/zalux
Icon=zalux
Terminal=false
Type=Application
StartupWMClass=zalo
Categories=Network;InstantMessaging;Chat;
DESK
%files
/opt/zalux
/usr/bin/zalux
/usr/share/applications/zalux.desktop

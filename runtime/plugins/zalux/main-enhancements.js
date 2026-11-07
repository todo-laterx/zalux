/*
 * plugins/zalux/main-enhancements.js — Clean-room Zalux main-process integration:
 *   1. Native Linux System Tray (Tray icon + context menu + show/hide toggle)
 *   2. Real-time Unread Badge Count (desktop dock `app.setBadgeCount` + dynamic red badge on Tray & Window icon)
 *   3. Chat Privacy Blocker (`za-privacy`: block typing / delivered / seen)
 *   4. Custom Ringtone & Notification Sound Server (`za-setup`: 12 ringtones + 14 notification sounds)
 *   5. Window polish (hide MenuBar, DevTools shortcut, auto-close stale notification popups)
 */
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const { execFile } = require('child_process');
const { app, BrowserWindow, ipcMain, Menu, nativeImage, nativeTheme, session, Tray } = require('electron');

let initialized = false;
let tray = null;
let lastBadgeCount = -1;
let lastBadgeLabel = null;
let baseIconImg = null;
const badgeIconCache = new Map();

function resolveAppRoot() {
  return path.resolve(__dirname, '..', '..');
}

function resolveBundledSoundsDir() {
  const candidates = [
    path.join(__dirname, 'sounds'),
    path.join(resolveAppRoot(), 'plugins', 'zalux', 'sounds'),
    process.resourcesPath ? path.join(process.resourcesPath, 'zalux-sounds') : '',
  ];
  for (const dir of candidates) {
    if (dir && fs.existsSync(dir)) return dir;
  }
  return path.join(__dirname, 'sounds');
}

function resolveOriginalZaloRingtone() {
  const appRoot = resolveAppRoot();
  const candidates = [
    path.join(appRoot, 'zcall-assets', 'sound', 'zalo_ringtone.mp3'),
    process.resourcesPath ? path.join(process.resourcesPath, 'app.asar.unpacked', 'zcall-assets', 'sound', 'zalo_ringtone.mp3') : '',
    process.resourcesPath ? path.join(process.resourcesPath, 'zcall-assets', 'sound', 'zalo_ringtone.mp3') : '',
  ];
  for (const f of candidates) {
    if (f && fs.existsSync(f)) return f;
  }
  return '';
}

function resolveBaseIconPath() {
  const appRoot = resolveAppRoot();
  const home = app.getPath('home');
  const candidates = [
    path.join(__dirname, 'zalux-logo.png'),
    path.join(home, '.local', 'share', 'icons', 'hicolor', '256x256', 'apps', 'zalux.png'),
    path.join('/usr/share/icons/hicolor/256x256/apps/zalux.png'),
    path.join(appRoot, 'assets', 'icon.png'),
    path.join(appRoot, 'zcall-assets', 'icon2', 'resources', 'offical-v2', 'zalo_logo.png'),
  ];
  for (const p of candidates) {
    if (p && fs.existsSync(p)) return p;
  }
  return '';
}

function getLogoDataUrl() {
  const candidates = [
    path.join(__dirname, 'zalux-logo.png'),
    resolveBaseIconPath(),
  ];
  for (const p of candidates) {
    if (!p || !fs.existsSync(p) || p.endsWith('zalo_logo.png')) continue;
    try {
      const b64 = fs.readFileSync(p).toString('base64');
      if (b64) return 'data:image/png;base64,' + b64;
    } catch (_) {}
  }
  return '';
}

function createFallbackBubbleIcon(size) {
  const buf = Buffer.alloc(size * size * 4, 0);
  const bgra = process.platform !== 'darwin';
  const cx = (size - 1) / 2;
  const cy = (size - 1) / 2;
  const rad = size * 0.44;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist <= rad + 0.8) {
        const alpha = dist <= rad - 0.5 ? 255 : Math.max(0, Math.min(255, Math.round((rad + 0.8 - dist) * 196)));
        const idx = (y * size + x) * 4;
        // Crisp Zalux blue (#0068ff)
        const r = 0;
        const g = 104;
        const b = 255;
        if (bgra) {
          buf[idx] = b; buf[idx + 1] = g; buf[idx + 2] = r; buf[idx + 3] = alpha;
        } else {
          buf[idx] = r; buf[idx + 1] = g; buf[idx + 2] = b; buf[idx + 3] = alpha;
        }
      }
    }
  }
  return nativeImage.createFromBitmap(buf, { width: size, height: size });
}

function getBaseIcon() {
  if (baseIconImg && !baseIconImg.isEmpty()) return baseIconImg;
  const p = resolveBaseIconPath();
  if (p) {
    try {
      const loaded = nativeImage.createFromPath(p);
      if (loaded && !loaded.isEmpty()) {
        baseIconImg = loaded;
        return baseIconImg;
      }
    } catch (_) {}
  }
  baseIconImg = createFallbackBubbleIcon(64);
  return baseIconImg;
}

// 3x5 pixel glyphs for crisp unread badge numbers on 32x32 / 64x64 icons
const PIXEL_FONT_3X5 = {
  '0': [0b111, 0b101, 0b101, 0b101, 0b111],
  '1': [0b010, 0b110, 0b010, 0b010, 0b111],
  '2': [0b111, 0b001, 0b111, 0b100, 0b111],
  '3': [0b111, 0b001, 0b111, 0b001, 0b111],
  '4': [0b101, 0b101, 0b111, 0b001, 0b001],
  '5': [0b111, 0b100, 0b111, 0b001, 0b111],
  '6': [0b111, 0b100, 0b111, 0b101, 0b111],
  '7': [0b111, 0b001, 0b010, 0b010, 0b010],
  '8': [0b111, 0b101, 0b111, 0b101, 0b111],
  '9': [0b111, 0b101, 0b111, 0b001, 0b111],
  '+': [0b000, 0b010, 0b111, 0b010, 0b000],
};

function blendPixel(buf, size, x, y, r, g, b, alpha) {
  if (x < 0 || y < 0 || x >= size || y >= size || alpha <= 0) return;
  const bgra = process.platform !== 'darwin';
  const idx = (y * size + x) * 4;
  const srcA = alpha / 255;
  const dstA = buf[idx + 3] / 255;
  const outA = srcA + dstA * (1 - srcA);
  if (outA <= 0) return;
  const c0 = bgra ? b : r;
  const c1 = g;
  const c2 = bgra ? r : b;
  buf[idx] = Math.round((c0 * srcA + buf[idx] * dstA * (1 - srcA)) / outA);
  buf[idx + 1] = Math.round((c1 * srcA + buf[idx + 1] * dstA * (1 - srcA)) / outA);
  buf[idx + 2] = Math.round((c2 * srcA + buf[idx + 2] * dstA * (1 - srcA)) / outA);
  buf[idx + 3] = Math.round(outA * 255);
}

function formatBadgeLabel(count, explicitLabel) {
  if (explicitLabel && typeof explicitLabel === 'string') {
    return explicitLabel;
  }
  if (!count || count <= 0) return '';
  return count > 99 ? '99+' : String(count);
}

function renderIconWithBadge(size, label) {
  const bucket = String(label || '');
  const cacheKey = `${size}:${bucket || '0'}`;
  if (badgeIconCache.has(cacheKey)) return badgeIconCache.get(cacheKey);

  const base = getBaseIcon().resize({ width: size, height: size, quality: 'best' });
  if (!bucket) {
    badgeIconCache.set(cacheKey, base);
    return base;
  }

  const bmp = Buffer.from(base.toBitmap());
  const scale = size >= 64 ? 2 : 1;
  const badgeRadius = 6.5 * scale;
  const halfSpan = bucket.length >= 3 ? 4.0 * scale : (bucket.length === 2 ? 2.0 * scale : 0);
  const borderWidth = 1.2 * scale;
  const cx = size - badgeRadius - halfSpan - Math.ceil(borderWidth);
  const cy = badgeRadius + Math.floor(borderWidth);

  const minY = Math.max(0, Math.floor(cy - badgeRadius - borderWidth - 1));
  const maxY = Math.min(size, Math.ceil(cy + badgeRadius + borderWidth + 2));
  const minX = Math.max(0, Math.floor(cx - halfSpan - badgeRadius - borderWidth - 1));
  const maxX = Math.min(size, Math.ceil(cx + halfSpan + badgeRadius + borderWidth + 2));

  for (let y = minY; y < maxY; y++) {
    for (let x = minX; x < maxX; x++) {
      const clampedX = Math.max(cx - halfSpan, Math.min(cx + halfSpan, x));
      const dist = Math.hypot(x - clampedX, y - cy);
      if (dist <= badgeRadius + borderWidth + 0.6) {
        if (dist <= badgeRadius - 0.5) {
          blendPixel(bmp, size, x, y, 239, 56, 56, 255);
        } else if (dist <= badgeRadius + 0.5) {
          const t = dist - (badgeRadius - 0.5);
          const r = Math.round(239 * (1 - t) + 255 * t);
          const g = Math.round(56 * (1 - t) + 255 * t);
          const b = Math.round(56 * (1 - t) + 255 * t);
          blendPixel(bmp, size, x, y, r, g, b, 255);
        } else {
          const edgeAlpha = Math.max(0, Math.min(255, Math.round((badgeRadius + borderWidth + 0.6 - dist) * 220)));
          blendPixel(bmp, size, x, y, 255, 255, 255, edgeAlpha);
        }
      }
    }
  }

  const chars = bucket.split('');
  const glyphW = 3 * scale;
  const glyphH = 5 * scale;
  const gap = 1 * scale;
  const totalW = chars.length * glyphW + (chars.length - 1) * gap;
  let startX = Math.round(cx - totalW / 2);
  const startY = Math.round(cy - glyphH / 2);

  for (const ch of chars) {
    const rows = PIXEL_FONT_3X5[ch];
    if (rows) {
      for (let ry = 0; ry < 5; ry++) {
        for (let rx = 0; rx < 3; rx++) {
          if ((rows[ry] >> (2 - rx)) & 1) {
            for (let sy = 0; sy < scale; sy++) {
              for (let sx = 0; sx < scale; sx++) {
                blendPixel(bmp, size, startX + rx * scale + sx, startY + ry * scale + sy, 255, 255, 255, 255);
              }
            }
          }
        }
      }
    }
    startX += glyphW + gap;
  }

  const out = nativeImage.createFromBitmap(bmp, { width: size, height: size });
  badgeIconCache.set(cacheKey, out);
  return out;
}

function findMainAppWindow() {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win || win.isDestroyed() || !win.webContents || win.webContents.isDestroyed()) continue;
    if (win.__zaloSharedWorker) continue;
    const url = win.webContents.getURL() || '';
    const title = (typeof win.getTitle === 'function' && win.getTitle()) || '';
    if (title === 'Shared Worker') continue;
    if (url.includes('/plugins/zcall/ui/') || url.includes('notification')) continue;
    if (url.includes('/pc-dist/index.html') || url.includes('login') || title.startsWith('Zalux') || title.startsWith('Zalo')) {
      return win;
    }
  }
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win || win.isDestroyed() || win.__zaloSharedWorker) continue;
    const url = (win.webContents && !win.webContents.isDestroyed() && win.webContents.getURL()) || '';
    if (!url.includes('/plugins/zcall/ui/') && !url.includes('notification')) return win;
  }
  return null;
}

/**
 * Electron 22 (Chromium 108) chạy Wayland-native + `WaylandWindowDecorations`:
 *  - `hide()` rồi `show()` làm compositor kill cả app:
 *    `gtk_shell::get_gtk_surface already requested`.
 *  - Client không điều khiển được z-order/raise; bấm icon dock khi cửa sổ đã ẩn
 *    chỉ tạo second-instance rồi chết, không hiện lại được GUI.
 * Vì vậy mặc định chạy XWayland (launcher `Zalux/installer/zalux-run`).
 * Hàm dưới chỉ dùng để nhận biết backend nhằm áp workaround khi buộc phải Wayland.
 */
function isWaylandNative() {
  try {
    const platform = app.commandLine.getSwitchValue('ozone-platform');
    if (platform) return platform === 'wayland';
    const hint = app.commandLine.getSwitchValue('ozone-platform-hint');
    return hint === 'auto' && Boolean(process.env.WAYLAND_DISPLAY || process.env.XDG_SESSION_TYPE === 'wayland');
  } catch (_) {}
  return false;
}

function isMainAppWindow(win) {
  if (!win || win.isDestroyed() || !win.webContents || win.webContents.isDestroyed()) return false;
  if (win.__zaloSharedWorker) return false;
  const url = win.webContents.getURL() || '';
  if (url.includes('/plugins/zcall/ui/') || url.includes('notification')) return false;
  return url.includes('/pc-dist/index.html') || url.includes('login');
}

/**
 * Wayland-native: thay `hide()` của cửa sổ chính bằng `minimize()`.
 * Cửa sổ vẫn được map nên không phải tạo lại surface khi mở lên (tránh crash
 * `gtk_shell::get_gtk_surface already requested`), đồng thời GNOME Shell có thể
 * restore khi bấm icon dock. `hide()` thật chỉ dùng khi app đang thoát.
 */
function patchHideToMinimize(win) {
  if (!win || win.isDestroyed() || win.__zaluxHidePatched) return;
  win.__zaluxHidePatched = true;
  const origHide = win.hide.bind(win);
  win.hide = function () {
    try {
      if (!win.isDestroyed() && !global.__zaluxQuitting) {
        if (win.isMinimized()) return;
        if (win.isVisible()) {
          win.minimize();
          return;
        }
      }
    } catch (_) {}
    return origHide();
  };
}

function showMainWindow() {
  const win = findMainAppWindow();
  if (!win) return null;
  const wasTop = (() => { try { return win.isAlwaysOnTop(); } catch (_) { return false; } })();
  try {
    if (win.isMinimized()) win.restore();
    if (!win.isVisible()) win.show();
    // X11/XWayland: `moveTop()` raise thật (không phụ thuộc focus). GNOME có thể
    // từ chối `focus()` từ tiến trình nền, nên bật always-on-top trong tích tắc
    // để chắc chắn cửa sổ nổi lên rồi trả trạng thái cũ.
    try { win.moveTop(); } catch (_) {}
    if (!wasTop) {
      try { win.setAlwaysOnTop(true, 'floating'); } catch (_) {}
      setTimeout(() => {
        try { if (!win.isDestroyed() && !wasTop) win.setAlwaysOnTop(false); } catch (_) {}
      }, 400);
    }
    win.focus();
  } catch (_) {}
  return win;
}

function toggleMainWindow() {
  const win = findMainAppWindow();
  if (!win) return;
  if (win.isVisible() && !win.isMinimized() && win.isFocused()) {
    win.hide();
  } else {
    showMainWindow();
  }
}

function openZaSetupInMainWindow() {
  const win = showMainWindow();
  if (win && win.webContents && !win.webContents.isDestroyed()) {
    try { win.webContents.send('za-setup:open'); } catch (_) {}
  }
}

function rebuildTrayMenu() {
  if (!tray || tray.isDestroyed()) return;
  const menu = Menu.buildFromTemplate([
    { label: 'Mở Zalux', click: () => showMainWindow() },
    { label: 'Cài đặt', click: () => openZaSetupInMainWindow() },
    { type: 'separator' },
    {
      label: 'Thoát',
      click: () => {
        global.__zaluxQuitting = true;
        app.quit();
        setTimeout(() => {
          try { app.exit(0); } catch (_) {}
        }, 1800).unref();
      },
    },
  ]);
  tray.setContextMenu(menu);
  tray.setToolTip('Zalux');
}

function applyUnreadBadge(rawInput, origSetBadgeCount, fromDom) {
  let count = 0;
  let plus = false;
  let explicitLabel = '';

  if (rawInput && typeof rawInput === 'object') {
    count = Math.max(0, Math.floor(Number(rawInput.count) || 0));
    plus = Boolean(rawInput.plus);
    explicitLabel = typeof rawInput.label === 'string' ? rawInput.label : '';
  } else {
    count = Math.max(0, Math.floor(Number(rawInput) || 0));
  }

  // Nếu icon message ngoài cùng hiển thị "5+" (plus = true) trong khi Zalo Main
  // đã báo con số chính xác >= 6 qua app.setBadgeCount, giữ nguyên con số chính xác đó
  // để App icon trên Dock và Tray icon đồng bộ tuyệt đối 100%.
  if (fromDom && plus && lastBadgeCount > count) {
    count = lastBadgeCount;
    explicitLabel = '';
  }

  const label = count <= 0 ? '' : formatBadgeLabel(count, plus && count <= 5 ? explicitLabel : '');

  if (typeof origSetBadgeCount === 'function') {
    try { origSetBadgeCount(count); } catch (_) {}
  }

  if (count === lastBadgeCount && label === lastBadgeLabel && tray && !tray.isDestroyed()) return;
  lastBadgeCount = count;
  lastBadgeLabel = label;

  if (tray && !tray.isDestroyed()) {
    try {
      tray.setImage(renderIconWithBadge(32, label));
    } catch (_) {}
  }

  const mainWin = findMainAppWindow();
  if (mainWin && typeof mainWin.setIcon === 'function') {
    try {
      mainWin.setIcon(renderIconWithBadge(64, label));
    } catch (_) {}
  }
}

function setupTray(origSetBadgeCount) {
  if (tray && !tray.isDestroyed()) return;
  try {
    const initialLabel = lastBadgeCount > 0 ? formatBadgeLabel(lastBadgeCount, lastBadgeLabel || '') : '';
    tray = new Tray(renderIconWithBadge(32, initialLabel));
    tray.on('click', () => toggleMainWindow());
    rebuildTrayMenu();
  } catch (err) {
    console.warn('[Zalux] Tray init skipped:', err && err.message ? err.message : err);
  }
  if (lastBadgeCount > 0) {
    applyUnreadBadge(lastBadgeCount, origSetBadgeCount, false);
  }
}

function setupPrivacy() {
  const cfgPath = path.join(app.getPath('userData'), 'za-privacy.json');
  const cfg = { blockTyping: false, blockDelivered: false, blockSeen: false };
  try {
    Object.assign(cfg, JSON.parse(fs.readFileSync(cfgPath, 'utf8')));
  } catch (_) {}

  const save = () => {
    try { fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2)); } catch (_) {}
  };

  ipcMain.handle('za-privacy:get', () => ({ ...cfg }));
  ipcMain.handle('za-privacy:set', (_e, patch) => {
    Object.assign(cfg, patch || {});
    save();
    return { ...cfg };
  });

  app.whenReady().then(() => {
    try {
      const ses = session.fromPartition('persist:zalo');
      const filters = {
        urls: [
          '*://*.zalo.me/api/message/typing*',
          '*://*.zalo.me/api/group/typing*',
          '*://*.zalo.me/api/message/deliveredv2*',
          '*://*.zalo.me/api/group/deliveredv2*',
          '*://*.zalo.me/api/e2ee/pc/t/message/delivered*',
          '*://*.zalo.me/api/message/seenv2*',
          '*://*.zalo.me/api/group/seenv2*',
          '*://*.zaloapp.com/api/message/typing*',
          '*://*.zaloapp.com/api/group/typing*',
          '*://*.zaloapp.com/api/message/deliveredv2*',
          '*://*.zaloapp.com/api/group/deliveredv2*',
          '*://*.zaloapp.com/api/e2ee/pc/t/message/delivered*',
          '*://*.zaloapp.com/api/message/seenv2*',
          '*://*.zaloapp.com/api/group/seenv2*',
        ],
      };
      ses.webRequest.onBeforeRequest(filters, (details, cb) => {
        const u = details.url || '';
        if (cfg.blockTyping && /\/api\/(message|group)\/typing/.test(u)) return cb({ cancel: true });
        if (cfg.blockDelivered && /deliveredv2|\/api\/e2ee\/pc\/t\/message\/delivered/.test(u)) return cb({ cancel: true });
        if (cfg.blockSeen && /seenv2/.test(u)) return cb({ cancel: true });
        cb({ cancel: false });
      });

      setupSessionHeaders(ses);
    } catch (_) {}
  });
}

function isTrustedZaloHost(rawHost) {
  const h = String(rawHost || '').replace(/^\.+/, '').toLowerCase();
  if (!h) return false;
  return (
    h === 'kilm.ai' ||
    h.endsWith('.kilm.ai') ||
    h === 'zalo.ai' ||
    h.endsWith('.zalo.ai') ||
    h === 'kiki.vn' ||
    h.endsWith('.kiki.vn') ||
    h === 'zalo.me' ||
    h.endsWith('.zalo.me') ||
    h === 'zaloapp.com' ||
    h.endsWith('.zaloapp.com') ||
    h === 'zing.vn' ||
    h.endsWith('.zing.vn') ||
    h === 'zadn.vn' ||
    h.endsWith('.zadn.vn') ||
    h === 'zdn.vn' ||
    h.endsWith('.zdn.vn')
  );
}

function isTrustedZaloUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return isTrustedZaloHost(u.hostname) ? u : null;
  } catch (_) {
    return null;
  }
}

function isInteractiveAuthHost(host) {
  return (
    host === 'id.zalo.me' ||
    host === 'stg.id.zalo.me' ||
    host === 'oauth.zaloapp.com' ||
    host === 'id.zaloapp.com'
  );
}

function patchResponseHeaders(details) {
  const parsed = isTrustedZaloUrl(details.url || '');
  const orig = details.responseHeaders;
  if (!parsed || !orig || typeof orig !== 'object') return orig;

  const host = parsed.hostname.toLowerCase();
  const status = Number(details.statusCode) || 200;
  const isSubFrame = details.resourceType === 'subFrame';
  // Khi id.zalo.me hoặc oauth.zaloapp.com trả trang HTML tương tác (200 /permission, /login)
  // thay vì 3xx SSO redirect, giữ nguyên frame-ancestors để CSPMonitor kích hoạt openOAuthWindow.
  const isInteractiveAuthPage =
    isInteractiveAuthHost(host) && (status < 300 || status >= 400);

  const out = { ...orig };
  let hasBlockingXfo = false;
  let hasFrameAncestors = false;
  let cspKey = null;

  for (const key of Object.keys(out)) {
    const lower = key.toLowerCase();
    if (lower === 'x-frame-options') {
      const xfoVal = Array.isArray(out[key]) ? out[key].join(',') : String(out[key] || '');
      if (/\b(deny|sameorigin)\b/i.test(xfoVal)) hasBlockingXfo = true;
      if (isSubFrame && !isInteractiveAuthPage) {
        delete out[key];
      }
    } else if (
      lower === 'content-security-policy' ||
      lower === 'content-security-policy-report-only'
    ) {
      if (lower === 'content-security-policy' && !cspKey) cspKey = key;
      const vals = Array.isArray(out[key]) ? out[key] : [String(out[key])];
      if (vals.some((p) => /(^|;)\s*frame-ancestors(\s|$)/i.test(String(p)))) {
        hasFrameAncestors = true;
      }
      if (isSubFrame && !isInteractiveAuthPage) {
        const cleaned = vals
          .map((policy) =>
            String(policy)
              .split(';')
              .map((d) => d.trim())
              .filter((d) => d && !/^frame-ancestors(\s|$)/i.test(d))
              .join('; ')
          )
          .filter(Boolean);
        if (cleaned.length > 0) {
          out[key] = cleaned;
        } else {
          delete out[key];
        }
      }
    } else if (parsed.protocol === 'https:' && lower === 'set-cookie') {
      // Cho phép cookie phiên SSO/Kiki (cả từ openOAuthWindow mainFrame lẫn subFrame)
      // được đính kèm vào <iframe> cross-site khởi phát từ file://.../pc-dist/index.html.
      const cookies = Array.isArray(out[key]) ? out[key] : [String(out[key])];
      out[key] = cookies.map((rawCookie) => {
        let c = String(rawCookie);
        if (/;\s*samesite\s*=/i.test(c)) {
          c = c.replace(/;\s*samesite\s*=\s*(lax|strict)/gi, '; SameSite=None');
        } else {
          c += '; SameSite=None';
        }
        if (/samesite\s*=\s*none/i.test(c) && !/;\s*secure\b/i.test(c)) {
          c += '; Secure';
        }
        return c;
      });
    }
  }

  // Nếu trang xác thực trả X-Frame-Options: DENY/SAMEORIGIN mà không có frame-ancestors trong CSP
  // khi nhúng từ file://, bổ sung frame-ancestors 'self' để setupCSPMonitor bắt được ngay lập tức.
  const initiator = String(details.initiator || '');
  const fromFileOrNull = !initiator || initiator === 'null' || initiator.startsWith('file:');
  if (isSubFrame && isInteractiveAuthPage && hasBlockingXfo && !hasFrameAncestors && fromFileOrNull) {
    const targetKey = cspKey || 'content-security-policy';
    const cur = out[targetKey];
    if (Array.isArray(cur) && cur.length > 0) {
      out[targetKey] = [`${cur[0]}; frame-ancestors 'self'`, ...cur.slice(1)];
    } else if (typeof cur === 'string' && cur.trim()) {
      out[targetKey] = [`${cur}; frame-ancestors 'self'`];
    } else {
      out[targetKey] = ["frame-ancestors 'self'"];
    }
  }

  return out;
}

function upgradeCookiesForCrossSiteIframe(ses) {
  if (!ses || !ses.cookies || ses.__zaluxCookiesMuxInstalled) return;
  ses.__zaluxCookiesMuxInstalled = true;

  const inFlight = new Set();
  const upgradeOne = (cookie) => {
    if (!cookie || !cookie.name || !cookie.domain) return;
    if (!isTrustedZaloHost(cookie.domain)) return;
    if (cookie.sameSite === 'no_restriction' && cookie.secure) return;

    const cleanDomain = String(cookie.domain).replace(/^\.+/, '');
    const cookiePath = cookie.path || '/';
    const key = `${cookie.domain}|${cookiePath}|${cookie.name}`;
    if (inFlight.has(key)) return;
    inFlight.add(key);

    const details = {
      url: `https://${cleanDomain}${cookiePath.startsWith('/') ? cookiePath : '/' + cookiePath}`,
      name: cookie.name,
      value: cookie.value || '',
      path: cookiePath,
      secure: true,
      httpOnly: Boolean(cookie.httpOnly),
      sameSite: 'no_restriction',
    };
    if (!cookie.hostOnly && !String(cookie.name).startsWith('__Host-')) {
      details.domain = cookie.domain;
    }
    if (!cookie.session && typeof cookie.expirationDate === 'number') {
      details.expirationDate = cookie.expirationDate;
    }
    Promise.resolve(ses.cookies.set(details))
      .catch(() => {})
      .finally(() => {
        inFlight.delete(key);
      });
  };

  try {
    Promise.resolve(ses.cookies.get({}))
      .then((list) => {
        if (Array.isArray(list)) {
          for (const c of list) upgradeOne(c);
        }
      })
      .catch(() => {});
  } catch (_) {}

  try {
    if (typeof ses.cookies.on === 'function') {
      ses.cookies.on('changed', (_event, cookie, _cause, removed) => {
        if (!removed) upgradeOne(cookie);
      });
    }
  } catch (_) {}
}

function setupSessionHeaders(ses) {
  if (!ses || !ses.webRequest || ses.__zaluxHeadersMuxInstalled) return;
  ses.__zaluxHeadersMuxInstalled = true;

  upgradeCookiesForCrossSiteIframe(ses);

  const origOnHeadersReceived = ses.webRequest.onHeadersReceived.bind(ses.webRequest);
  let externalListener = null;

  origOnHeadersReceived((details, callback) => {
    let responseHeaders = details.responseHeaders;
    try {
      responseHeaders = patchResponseHeaders(details);
    } catch (_) {}

    const ext = externalListener;
    if (typeof ext === 'function') {
      try {
        return ext({ ...details, responseHeaders }, (extRes) => {
          if (extRes && typeof extRes === 'object' && extRes.responseHeaders) {
            callback(extRes);
          } else {
            callback({ ...(extRes || {}), responseHeaders });
          }
        });
      } catch (_) {}
    }
    callback({ responseHeaders });
  });

  // Bọc đa hợp để Kiki setupCSPMonitor / stopCSPMonitor(null) không xoá mất hook của Zalux
  ses.webRequest.onHeadersReceived = function (_filterOrListener, maybeListener) {
    const fn = typeof _filterOrListener === 'function'
      ? _filterOrListener
      : (typeof maybeListener === 'function' ? maybeListener : null);
    externalListener = fn;
  };
}

function ensureUserSoundsDir() {
  const home = app.getPath('home');
  const userDir = path.join(home, '.local', 'share', 'zalux', 'sounds');
  const legacyDir = path.join(home, '.local', 'share', 'zalo-linux', 'sounds');
  try { fs.mkdirSync(userDir, { recursive: true }); } catch (_) {}

  const seedFrom = (srcDir) => {
    if (!srcDir || !fs.existsSync(srcDir)) return;
    try {
      for (const name of fs.readdirSync(srcDir)) {
        if (!name.endsWith('.mp3') || name === 'ringtone-zalo.mp3') continue;
        const dst = path.join(userDir, name);
        if (!fs.existsSync(dst)) {
          try { fs.copyFileSync(path.join(srcDir, name), dst); } catch (_) {}
        }
      }
    } catch (_) {}
  };

  seedFrom(resolveBundledSoundsDir());
  seedFrom(legacyDir);
  return userDir;
}

function updateAdvancedSettingsRingtone(ringtoneAbsPath) {
  const advPath = path.join(app.getPath('userData'), 'advanced-settings.json');
  let obj = {};
  try {
    obj = JSON.parse(fs.readFileSync(advPath, 'utf8'));
    if (!obj || typeof obj !== 'object') obj = {};
  } catch (_) {
    obj = {};
  }
  if (!obj.sounds || typeof obj.sounds !== 'object') obj.sounds = {};
  if (ringtoneAbsPath) {
    obj.sounds.ringtone = ringtoneAbsPath;
  } else {
    delete obj.sounds.ringtone;
  }
  try { fs.writeFileSync(advPath, JSON.stringify(obj, null, 2)); } catch (_) {}
}

const DEFAULT_QUICK_REPLIES = [
  'Anh/em đang bận chút, lát gọi lại nhé!',
  'Đang trong cuộc họp, nhắn tin giúp mình nhé.',
  'Hiện không tiện nghe máy, có việc gì gấp không ạ?',
  'Đang ngoài đường ồn quá, lát về mình gọi lại nha.',
];

function normalizeQuickReply(raw) {
  if (!raw || typeof raw !== 'object') {
    return { enabled: true, items: [...DEFAULT_QUICK_REPLIES] };
  }
  const enabled = raw.enabled !== undefined ? Boolean(raw.enabled) : true;
  let items = [];
  if (Array.isArray(raw.items)) {
    items = raw.items
      .map((s) => String(s || '').trim().slice(0, 160))
      .filter(Boolean)
      .slice(0, 5);
  } else {
    items = [...DEFAULT_QUICK_REPLIES];
  }
  return { enabled, items };
}

function setupSoundService() {
  const soundsDir = ensureUserSoundsDir();
  const cfgPath = path.join(app.getPath('userData'), 'za-setup.json');
  const cfg = {
    ringtone: '',
    noti: '',
    quickReply: { enabled: true, items: [...DEFAULT_QUICK_REPLIES] },
  };
  try {
    const loaded = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    if (loaded && typeof loaded === 'object') {
      Object.assign(cfg, loaded);
      cfg.quickReply = normalizeQuickReply(loaded.quickReply);
    }
  } catch (_) {}

  const save = () => {
    try { fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2)); } catch (_) {}
  };

  // Sync saved ringtone into advanced-settings.json on startup for zcall-engine
  if (cfg.ringtone && cfg.ringtone !== 'ringtone-zalo.mp3') {
    const savedRing = path.join(soundsDir, path.basename(cfg.ringtone));
    if (fs.existsSync(savedRing)) updateAdvancedSettingsRingtone(savedRing);
  }

  const safeMp3 = (f) => /^[a-z0-9._-]+\.mp3$/i.test(String(f || ''));
  const listByPrefix = (prefix) => {
    const items = [];
    try {
      for (const f of fs.readdirSync(soundsDir)) {
        if (f.startsWith(prefix) && safeMp3(f)) {
          items.push({
            file: f,
            name: f.replace(prefix, '').replace(/\.mp3$/i, '').replace(/-/g, ' '),
          });
        }
      }
    } catch (_) {}
    if (prefix === 'ringtone-' && resolveOriginalZaloRingtone()) {
      if (!items.some((x) => x.file === 'ringtone-zalo.mp3')) {
        items.push({ file: 'ringtone-zalo.mp3', name: 'zalo' });
      }
    }
    return items;
  };

  let port = 0;
  let readyResolve;
  const ready = new Promise((r) => { readyResolve = r; });

  const server = http.createServer((req, res) => {
    try {
      const name = path.basename(decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname));
      let file = '';
      if (name === 'ringtone-zalo.mp3') {
        file = resolveOriginalZaloRingtone();
      } else if (safeMp3(name)) {
        const candidate = path.join(soundsDir, name);
        if (candidate.startsWith(soundsDir) && fs.existsSync(candidate)) {
          file = candidate;
        }
      }
      if (!file || !fs.existsSync(file)) {
        res.writeHead(404);
        return res.end();
      }
      res.writeHead(200, {
        'content-type': 'audio/mpeg',
        'cache-control': 'no-store',
        'access-control-allow-origin': '*',
      });
      fs.createReadStream(file).pipe(res);
    } catch (_) {
      res.writeHead(500);
      res.end();
    }
  });

  server.on('error', () => { if (readyResolve) readyResolve(); });
  server.listen(0, '127.0.0.1', () => {
    const addr = server.address();
    port = addr && typeof addr === 'object' ? addr.port : 0;
    if (readyResolve) readyResolve();
  });

  const syncQuickReplyFromDisk = () => {
    try {
      if (fs.existsSync(cfgPath)) {
        const disk = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
        if (disk && typeof disk === 'object' && disk.quickReply) {
          cfg.quickReply = normalizeQuickReply(disk.quickReply);
          return;
        }
      }
    } catch (_) {}
    cfg.quickReply = normalizeQuickReply(cfg.quickReply);
  };

  ipcMain.handle('za-setup:get', async () => {
    await ready;
    syncQuickReplyFromDisk();
    return {
      sounds: {
        ringtone: listByPrefix('ringtone-'),
        noti: listByPrefix('noti-'),
      },
      current: { ...cfg },
      quickReply: cfg.quickReply,
      defaultQuickReplies: [...DEFAULT_QUICK_REPLIES],
      base: port ? `http://127.0.0.1:${port}/` : '',
      logo: getLogoDataUrl(),
    };
  });

  ipcMain.handle('za-setup:set-quick-reply', (_e, patch) => {
    syncQuickReplyFromDisk();
    const merged = Object.assign({}, cfg.quickReply, patch || {});
    cfg.quickReply = normalizeQuickReply(merged);
    save();
    return { ...cfg, quickReply: cfg.quickReply };
  });

  ipcMain.handle('za-setup:set-ringtone', (_e, file) => {
    if (!safeMp3(file)) throw new Error('Tên file không hợp lệ');
    if (file === 'ringtone-zalo.mp3') {
      cfg.ringtone = 'ringtone-zalo.mp3';
      save();
      updateAdvancedSettingsRingtone('');
      return { ...cfg };
    }
    const src = path.join(soundsDir, path.basename(file));
    if (!fs.existsSync(src)) throw new Error('Không tìm thấy file âm thanh');
    cfg.ringtone = path.basename(file);
    save();
    updateAdvancedSettingsRingtone(src);
    return { ...cfg };
  });

  ipcMain.handle('za-setup:set-noti', (_e, file) => {
    if (!safeMp3(file)) throw new Error('Tên file không hợp lệ');
    const src = path.join(soundsDir, path.basename(file));
    if (!fs.existsSync(src)) throw new Error('Không tìm thấy file âm thanh');
    fs.copyFileSync(src, path.join(soundsDir, 'custom-noti.mp3'));
    cfg.noti = path.basename(file);
    save();
    return { ...cfg };
  });
}

/**
 * GNOME vẽ thanh tiêu đề + nút close/minimize cho app X11 (XWayland) bằng
 * `mutter-x11-frames` và chọn biến thể sáng/tối theo property `_GTK_THEME_VARIANT`
 * trên cửa sổ client. Chromium/Electron không tự set property này, nên GNOME luôn
 * vẽ khung màu sáng dù hệ thống đang dark (`color-scheme: prefer-dark`, theme Yaru dark).
 * Set property theo `nativeTheme.shouldUseDarkColors` để khung theo theme hệ thống.
 */
function applyGtkThemeVariant(win) {
  if (!win || win.isDestroyed() || process.platform !== 'linux' || !process.env.DISPLAY) return;
  try {
    const handle = win.getNativeWindowHandle();
    if (!handle || !handle.length) return;
    const id = handle.length >= 8
      ? handle.readBigUInt64LE(0).toString()
      : String(handle.readUInt32LE(0));
    const variant = nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
    execFile('xprop', ['-id', id, '-f', '_GTK_THEME_VARIANT', '8u', '-set', '_GTK_THEME_VARIANT', variant], () => {});
  } catch (_) {}
}

function setupWindowEnhancements(origSetBadgeCount) {
  app.on('browser-window-created', (_evt, win) => {
    try {
      win.setMenu(null);
      win.autoHideMenuBar = true;
      // Khung X11 (GNOME/mutter-x11-frames) theo theme hệ thống.
      applyGtkThemeVariant(win);
      win.once('ready-to-show', () => applyGtkThemeVariant(win));
      win.once('show', () => applyGtkThemeVariant(win));
      try {
        nativeTheme.on('updated', () => applyGtkThemeVariant(win));
      } catch (_) {}

      win.webContents.on('before-input-event', (_e, input) => {
        if ((input.control && input.shift && input.key.toLowerCase() === 'i') || input.key === 'F12') {
          if (win.webContents.isDevToolsOpened()) {
            win.webContents.closeDevTools();
          } else {
            win.webContents.openDevTools({ mode: 'detach' });
          }
        }
      });

      win.webContents.on('did-finish-load', () => {
        try {
          const url = win.webContents.getURL() || '';
          if (url.includes('/pc-dist/index.html') && typeof win.setIcon === 'function') {
            const label = lastBadgeCount > 0 ? formatBadgeLabel(lastBadgeCount, lastBadgeLabel || '') : '';
            win.setIcon(renderIconWithBadge(64, label));
          }
          if (process.env.ZALO_DEVTOOLS === '1' && !url.includes('notification')) {
            win.webContents.openDevTools({ mode: 'detach' });
          }
        } catch (_) {}
        // Wayland-native: chặn hide→show làm chết compositor (xem patchHideToMinimize).
        try {
          if (isWaylandNative() && isMainAppWindow(win)) patchHideToMinimize(win);
        } catch (_) {}
      });
    } catch (_) {}
  });

  app.whenReady().then(() => {
    setupTray(origSetBadgeCount);
  });
}

function init() {
  if (initialized || process.platform !== 'linux') return;
  initialized = true;

  try {
    app.commandLine.appendSwitch('disable-gpu-memory-buffer-video-frames');
  } catch (_) {}

  // Backend cửa sổ: mặc định XWayland (X11) — xem chú thích `isWaylandNative`.
  // Không ép `ozone-platform-hint=auto` ở đây: cờ này phải có từ lúc khởi chạy
  // (launcher `zalux-run` / `run-zalo.sh`), appendSwitch trong main quá muộn.
  // Nếu vì lý do nào đó vẫn chạy Wayland-native, `patchHideToMinimize` xử lý
  // riêng ở `setupWindowEnhancements`.

  try {
    if (!process.env.ZALO_USER_DATA) {
      process.env.ZALO_USER_DATA = app.getPath('userData');
    }
  } catch (_) {}

  try {
    if (typeof app.setDesktopName === 'function') {
      app.setDesktopName('zalux.desktop');
    }
  } catch (_) {}

  const origSetBadgeCount = typeof app.setBadgeCount === 'function'
    ? app.setBadgeCount.bind(app)
    : null;

  if (origSetBadgeCount) {
    app.setBadgeCount = function (count) {
      applyUnreadBadge(count, origSetBadgeCount, false);
      return true;
    };
  }

  ipcMain.on('za-badge:update', (_e, payload) => {
    applyUnreadBadge(payload, origSetBadgeCount, true);
  });

  // Bấm icon dock/taskbar khi app đang chạy: Zalo gốc chỉ gọi `win.show()` (no-op nếu
  // cửa sổ đã hiện nhưng nằm sau) nên cửa sổ không lên trước.
  // Thay hẳn handler của Zalo: `receiveArguments` của nó làm GTK CSD trên Wayland
  // chết với `gtk_shell::get_gtk_surface already requested` → cả app bị kill.
  try {
    app.removeAllListeners('second-instance');
    app.on('second-instance', () => showMainWindow());
    app.on('activate', () => showMainWindow());
    // Khi thoát thật thì cho phép `hide()` (không biến thành minimize).
    app.on('before-quit', () => { global.__zaluxQuitting = true; });
  } catch (_) {}

  setupPrivacy();
  setupSoundService();
  setupWindowEnhancements(origSetBadgeCount);
  if (process.env.ZALUX_DEV === '1') {
    try {
      require('./dev-inspector').initMainDevInspector({ app, BrowserWindow, ipcMain });
    } catch (err) {
      console.error('[zalux-dev] Failed to init dev-inspector:', err);
    }
  }
}

module.exports = {
  init,
  _test: {
    isTrustedZaloHost,
    isTrustedZaloUrl,
    patchResponseHeaders,
    upgradeCookiesForCrossSiteIframe,
    setupSessionHeaders,
  },
};

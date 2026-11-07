/*
 * plugins/zalux/za-setup-ui.js — Clean-room Zalux settings UI (Privacy + Custom Ringtones/Notification Sounds)
 * + DOM unread-count synchronization with Linux System Tray / Dock badge.
 */
(function () {
  if (!location.pathname.endsWith('/pc-dist/index.html')) return;
  if (window.__zaluxUiMounted) return;
  window.__zaluxUiMounted = true;

  const setup = window.zaSetup;
  const privacy = window.zaPrivacy;
  if (!setup) return;

  try {
    const OrigAudio = window.Audio;
    function PatchedAudio(src) {
      if (window.__zaNotiUrl && typeof src === 'string' && src.indexOf('/sound/noti.mp3') >= 0) {
        src = window.__zaNotiUrl;
      }
      return new OrigAudio(src);
    }
    PatchedAudio.prototype = OrigAudio.prototype;
    window.Audio = PatchedAudio;
  } catch (_) {}

  let cachedLogoUrl = '';
  setup.get().then((cfg) => {
    if (cfg && cfg.logo) cachedLogoUrl = cfg.logo;
    if (cfg && cfg.current && cfg.current.noti && cfg.base) {
      window.__zaNotiUrl = cfg.base + 'custom-noti.mp3?t=' + Date.now();
    }
  }).catch(() => {});

  const NAMES = {
    classic: 'Điện thoại văn phòng', vintage: 'Điện thoại cổ điển', marimba: 'Marimba',
    'marimba-waiting': 'Marimba chờ', waiting: 'Chờ máy', hold: 'Nhạc chờ', urgent: 'Khẩn cấp',
    old: 'Điện thoại cũ', toy: 'Điện thoại đồ chơi', futuristic: 'Dial tương lai',
    spell: 'Chuông phép thuật', zalo: 'Zalo gốc',
    pop: 'Pop tin nhắn', longpop: 'Pop dài', chime: 'Chuông', bells: 'Chuông vui',
    bubble: 'Bong bóng', positive: 'Tích cực', magic: 'Phép thuật', scifi: 'Sci-fi',
    interface: 'Giao diện', elevator: 'Thang máy', doorbell: 'Chuông cửa',
    digital: 'Kỹ thuật số', flute: 'Sáo', confirm: 'Xác nhận',
  };
  const ORDER = {
    ringtone: ['classic', 'vintage', 'marimba', 'marimba-waiting', 'waiting', 'hold', 'urgent', 'old', 'toy', 'futuristic', 'spell', 'zalo'],
    noti: ['pop', 'longpop', 'chime', 'bells', 'bubble', 'positive', 'magic', 'scifi', 'interface', 'elevator', 'doorbell', 'digital', 'flute', 'confirm'],
  };
  const PLAY = '<svg class="za-ico-play" width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true"><path d="M3.4 2.1l6.4 3.9-6.4 3.9z"/></svg>';
  const PAUSE = '<svg class="za-ico-pause" width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true"><rect x="2.6" y="2" width="2.4" height="8" rx=".6"/><rect x="7" y="2" width="2.4" height="8" rx=".6"/></svg>';
  const CHECK = '<svg class="za-check" width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 7.2l3 3 6-6.4"/></svg>';
  // Icon tab Zalux: chỉ lấy bubble phía trong của logo, vẽ đơn sắc (currentColor)
  // để đồng style với các icon line trắng của Zalo. Không dùng nền xanh.
  const TAB_ICON = '<svg width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 1.8C5.8 1.8 1.5 5.6 1.5 10.2c0 2.4 1.2 4.4 3.1 5.8l-1.8 4.7 5.4-1.3c.9.2 1.8.3 2.8.3 6.3 0 10.7-3.8 10.7-8.5S18.2 1.8 12 1.8z"/><path d="M7.4 8.2h4.8l-4.4 4.6h4.6"/><path d="M13.8 8.6l2.7 3.1M16.5 8.6l-2.7 3.1"/></svg>';
  const ZALUX_FALLBACK_LOGO = 'data:image/svg+xml;utf8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
      '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#0b7cff"/><stop offset="100%" stop-color="#0057e7"/></linearGradient></defs>' +
      '<rect x="2" y="2" width="60" height="60" rx="15" fill="url(#g)"/>' +
      '<path d="M32 14c-11.2 0-20 7.6-20 17.1 0 4.5 2 8.6 5.4 11.7L14 50.5c5.1-.8 9.2-2.4 12.1-4.5 1.9.4 3.9.6 5.9.6 11.2 0 20-7.6 20-17.2S43.2 14 32 14z" fill="#fff"/>' +
      '<path d="M22.5 25.5h10.8L23 36.8h10.8M37.5 28.2l7.6 8.6M45.1 28.2l-7.6 8.6" fill="none" stroke="#0068ff" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/>' +
    '</svg>'
  );

  const DEFAULT_QUICK_REPLIES = [
    'Anh/em đang bận chút, lát gọi lại nhé!',
    'Đang trong cuộc họp, nhắn tin giúp mình nhé.',
    'Hiện không tiện nghe máy, có việc gì gấp không ạ?',
    'Đang ngoài đường ồn quá, lát về mình gọi lại nha.',
  ];

  if (!document.getElementById('za-setup-style')) {
    const st = document.createElement('style');
    st.id = 'za-setup-style';
    st.textContent = `
      :root {
        --za-bg: #141c26;
        --za-bg-elev: #1b2533;
        --za-surface: #1e2a3a;
        --za-surface-hover: #243347;
        --za-border: rgba(255, 255, 255, .085);
        --za-border-strong: rgba(255, 255, 255, .15);
        --za-text: #eef4fc;
        --za-muted: #8ea3bc;
        --za-accent: #0b7cff;
        --za-accent-soft: rgba(11, 124, 255, .16);
        --za-emerald: #22c55e;
        --za-ease: cubic-bezier(.22, 1, .36, 1);
        --za-spring: cubic-bezier(.34, 1.56, .64, 1);
      }
      #za-setup-tab.selected { color: var(--za-accent); }
      #za-setup-tab .mmi-icon-wr svg { display: block; width: 25px; height: 25px; }
      #za-setup-overlay[hidden] { display: none !important; }
      #za-setup-overlay {
        position: fixed;
        inset: 0;
        background: rgba(6, 10, 16, .62);
        backdrop-filter: blur(6px);
        -webkit-backdrop-filter: blur(6px);
        z-index: 2147483600;
        display: flex;
        align-items: center;
        justify-content: center;
        opacity: 0;
        transition: opacity 170ms var(--za-ease);
      }
      #za-setup-overlay.za-open { opacity: 1; }
      #za-setup-modal, #za-setup-modal * { box-sizing: border-box; }
      #za-setup-modal {
        color-scheme: dark;
        width: min(484px, 94vw);
        height: 468px;
        max-height: 90vh;
        display: flex;
        flex-direction: column;
        background: linear-gradient(180deg, #192331 0%, #131b25 100%);
        color: var(--za-text);
        border: 1px solid var(--za-border-strong);
        border-radius: 16px;
        box-shadow:
          0 28px 70px rgba(0, 0, 0, .62),
          inset 0 1px 0 rgba(255, 255, 255, .09);
        font: 13px/1.45 "Segoe UI", Inter, system-ui, -apple-system, sans-serif;
        transform: translateY(6px) scale(.975);
        opacity: 0;
        overflow: hidden;
        transition: transform 210ms var(--za-ease), opacity 170ms var(--za-ease);
      }
      #za-setup-overlay.za-open #za-setup-modal {
        transform: translateY(0) scale(1);
        opacity: 1;
      }
      .za-head {
        flex: 0 0 54px;
        height: 54px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0 14px 0 18px;
        border-bottom: 1px solid var(--za-border);
        background: rgba(255, 255, 255, .015);
      }
      .za-brand {
        display: flex;
        align-items: center;
        gap: 10px;
        min-width: 0;
      }
      .za-brand-logo {
        width: 28px;
        height: 28px;
        flex: 0 0 28px;
        display: block;
        object-fit: contain;
        border-radius: 7px;
        user-select: none;
        -webkit-user-drag: none;
      }
      .za-brand strong {
        font-size: 15.5px;
        font-weight: 700;
        line-height: 1;
        letter-spacing: -.01em;
        color: #f4f8ff;
      }
      .za-brand-badge {
        font-size: 10.5px;
        font-weight: 600;
        color: var(--za-muted);
        background: rgba(255, 255, 255, .055);
        border: 1px solid rgba(255, 255, 255, .07);
        padding: 2px 7px;
        border-radius: 999px;
        margin-left: 2px;
      }
      .za-x {
        width: 30px;
        height: 30px;
        display: flex;
        align-items: center;
        justify-content: center;
        border: 0;
        border-radius: 8px;
        background: transparent;
        color: var(--za-muted);
        cursor: pointer;
        transition: background 130ms var(--za-ease), color 130ms var(--za-ease), transform 90ms var(--za-ease);
      }
      .za-x:hover { background: rgba(255, 255, 255, .07); color: var(--za-text); }
      .za-x:active { transform: scale(.93); }

      /* Segmented Top Tabs */
      .za-tabs-wrap {
        flex: 0 0 auto;
        padding: 12px 18px 4px;
      }
      .za-tabs {
        position: relative;
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        padding: 3px;
        border-radius: 11px;
        background: #0f161f;
        border: 1px solid rgba(255, 255, 255, .06);
      }
      .za-tab-pill {
        position: absolute;
        top: 3px;
        bottom: 3px;
        left: 3px;
        width: calc((100% - 6px) / 3);
        border-radius: 8px;
        background: linear-gradient(180deg, #273649 0%, #1f2c3c 100%);
        box-shadow: 0 2px 8px rgba(0, 0, 0, .35), inset 0 1px 0 rgba(255, 255, 255, .1);
        transform: translateX(calc(var(--tab-idx, 0) * 100%));
        transition: transform 220ms var(--za-ease);
        pointer-events: none;
      }
      .za-tab {
        position: relative;
        z-index: 1;
        height: 32px;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        padding: 0 10px;
        border: 0;
        border-radius: 8px;
        background: transparent;
        color: var(--za-muted);
        font: inherit;
        font-size: 12.5px;
        font-weight: 500;
        cursor: pointer;
        transition: color 150ms var(--za-ease);
      }
      .za-tab:hover { color: var(--za-text); }
      .za-tab.active { color: #ffffff; font-weight: 600; }

      /* Fixed-Height Single-Cell Grid Body (Zero Layout Jump) */
      .za-body {
        flex: 1 1 auto;
        min-height: 0;
        display: grid;
        grid-template-areas: "stack";
        padding: 10px 18px 16px;
        overflow: hidden;
      }
      .za-panel {
        grid-area: stack;
        height: 100%;
        min-height: 0;
        display: flex;
        flex-direction: column;
        gap: 10px;
        opacity: 0;
        visibility: hidden;
        pointer-events: none;
        transform: translateY(4px);
        transition: opacity 160ms var(--za-ease), transform 180ms var(--za-ease), visibility 160ms;
      }
      .za-panel.is-active {
        opacity: 1;
        visibility: visible;
        pointer-events: auto;
        transform: translateY(0);
      }

      /* Tactile Cards & Switches */
      .za-card-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .za-row-card {
        flex: 0 0 auto;
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 12px 14px;
        border-radius: 12px;
        background: var(--za-surface);
        border: 1px solid var(--za-border);
        transition: border-color 140ms var(--za-ease), background 140ms var(--za-ease);
      }
      .za-row-card:hover {
        background: var(--za-surface-hover);
        border-color: rgba(255, 255, 255, .13);
      }
      .za-row-ico {
        width: 34px;
        height: 34px;
        flex: 0 0 34px;
        display: grid;
        place-items: center;
        border-radius: 9px;
        background: rgba(11, 124, 255, .13);
        color: #5ca8ff;
        border: 1px solid rgba(11, 124, 255, .22);
      }
      .za-row-text {
        flex: 1;
        min-width: 0;
      }
      .za-row-title {
        font-size: 13px;
        font-weight: 600;
        color: var(--za-text);
        line-height: 1.3;
      }
      .za-row-sub {
        margin-top: 2px;
        font-size: 11.5px;
        color: var(--za-muted);
        line-height: 1.35;
      }
      .za-switch {
        position: relative;
        width: 38px;
        height: 21px;
        flex: 0 0 auto;
      }
      .za-switch input {
        position: absolute;
        opacity: 0;
        width: 100%;
        height: 100%;
        margin: 0;
        cursor: pointer;
        z-index: 1;
      }
      .za-switch .track {
        position: absolute;
        inset: 0;
        border-radius: 999px;
        background: #2f3e52;
        border: 1px solid rgba(255, 255, 255, .08);
        transition: background 160ms var(--za-ease), border-color 160ms var(--za-ease);
      }
      .za-switch .track:after {
        content: "";
        position: absolute;
        top: 2px;
        left: 2px;
        width: 15px;
        height: 15px;
        border-radius: 50%;
        background: #dce8f7;
        box-shadow: 0 1px 3px rgba(0, 0, 0, .4);
        transition: transform 190ms var(--za-spring), background 160ms var(--za-ease);
      }
      .za-switch input:checked + .track {
        background: var(--za-accent);
        border-color: rgba(255, 255, 255, .18);
      }
      .za-switch input:checked + .track:after {
        transform: translateX(17px);
        background: #ffffff;
      }
      .za-switch input:focus-visible + .track {
        box-shadow: 0 0 0 2px rgba(11, 124, 255, .45);
      }

      /* Privacy Footer Status */
      .za-status-strip {
        margin-top: auto;
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px 13px;
        border-radius: 11px;
        background: rgba(15, 22, 31, .75);
        border: 1px solid var(--za-border);
        font-size: 12px;
        color: var(--za-muted);
      }
      .za-status-dot {
        width: 8px;
        height: 8px;
        flex: 0 0 8px;
        border-radius: 50%;
        background: #52657c;
        transition: background 180ms var(--za-ease), box-shadow 180ms var(--za-ease);
      }
      .za-status-strip.is-protected .za-status-dot {
        background: var(--za-emerald);
        box-shadow: 0 0 10px rgba(34, 197, 94, .65);
      }
      .za-status-strip.is-protected {
        color: #d6e6f9;
        border-color: rgba(34, 197, 94, .24);
      }

      /* Sound Tab: Sub-switcher + Inline Sound Cards + Live Equalizer + Progress Ring */
      .za-subtabs {
        flex: 0 0 auto;
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 6px;
      }
      .za-subtab {
        height: 34px;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 7px;
        padding: 0 10px;
        border-radius: 9px;
        border: 1px solid var(--za-border);
        background: rgba(15, 22, 31, .6);
        color: var(--za-muted);
        font: inherit;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        transition: all 140ms var(--za-ease);
      }
      .za-subtab:hover {
        color: var(--za-text);
        border-color: rgba(255, 255, 255, .14);
      }
      .za-subtab.active {
        background: var(--za-accent-soft);
        color: #72b8ff;
        border-color: rgba(11, 124, 255, .42);
      }
      .za-subtab-cnt {
        font-size: 10.5px;
        padding: 1px 6px;
        border-radius: 999px;
        background: rgba(255, 255, 255, .07);
        color: inherit;
      }

      /* Scroll-Under Infinity List (Nhìn xuyên qua vùng đệm trên & đáy) */
      .za-sound-list {
        flex: 1 1 auto;
        min-height: 0;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 6px;
        margin-top: -10px;
        margin-bottom: -16px;
        padding: 12px 4px 20px 0;
        mask-image: linear-gradient(
          180deg,
          rgba(0, 0, 0, .06) 0px,
          rgba(0, 0, 0, .55) 7px,
          #000 14px,
          #000 calc(100% - 24px),
          rgba(0, 0, 0, .5) calc(100% - 9px),
          rgba(0, 0, 0, .06) 100%
        );
        -webkit-mask-image: linear-gradient(
          180deg,
          rgba(0, 0, 0, .06) 0px,
          rgba(0, 0, 0, .55) 7px,
          #000 14px,
          #000 calc(100% - 24px),
          rgba(0, 0, 0, .5) calc(100% - 9px),
          rgba(0, 0, 0, .06) 100%
        );
      }
      .za-sound-list::-webkit-scrollbar,
      .za-qr-list::-webkit-scrollbar {
        width: 5px;
      }
      .za-sound-list::-webkit-scrollbar-thumb,
      .za-qr-list::-webkit-scrollbar-thumb {
        background: rgba(255, 255, 255, .15);
        border-radius: 999px;
      }

      .za-sound-card {
        position: relative;
        flex: 0 0 auto;
        min-height: 44px;
        display: flex;
        align-items: center;
        gap: 11px;
        padding: 6px 11px;
        border-radius: 10px;
        background: var(--za-surface);
        border: 1px solid var(--za-border);
        cursor: pointer;
        overflow: hidden;
        transition: background 140ms var(--za-ease), border-color 140ms var(--za-ease), box-shadow 160ms var(--za-ease);
      }
      .za-sound-card:hover {
        background: var(--za-surface-hover);
        border-color: rgba(255, 255, 255, .14);
      }
      .za-sound-card.is-selected {
        background: linear-gradient(90deg, rgba(11, 124, 255, .15) 0%, rgba(30, 42, 58, .95) 100%);
        border-color: rgba(11, 124, 255, .42);
      }
      .za-sound-card.is-playing {
        border-color: #3b9eff;
        box-shadow: 0 0 0 1px rgba(59, 158, 255, .28), 0 8px 22px rgba(0, 104, 255, .18);
      }

      .za-play-btn {
        position: relative;
        width: 30px;
        height: 30px;
        flex: 0 0 30px;
        display: grid;
        place-items: center;
        border: 0;
        border-radius: 50%;
        background: rgba(15, 22, 31, .75);
        color: #cfe2f9;
        cursor: pointer;
        padding: 0;
        transition: background 130ms var(--za-ease), color 130ms var(--za-ease), transform 90ms var(--za-ease);
      }
      .za-play-btn:hover {
        background: rgba(11, 124, 255, .24);
        color: #ffffff;
      }
      .za-play-btn:active {
        transform: scale(.92);
      }
      .za-sound-card.is-playing .za-play-btn {
        background: rgba(11, 124, 255, .28);
        color: #6cc0ff;
      }
      .za-ring-svg {
        position: absolute;
        inset: 0;
        width: 30px;
        height: 30px;
        transform: rotate(-90deg);
        pointer-events: none;
      }
      .za-ring-bg {
        fill: none;
        stroke: rgba(255, 255, 255, .1);
        stroke-width: 2;
      }
      .za-ring-fg {
        fill: none;
        stroke: #38bdf8;
        stroke-width: 2.2;
        stroke-linecap: round;
        stroke-dasharray: 88;
        stroke-dashoffset: calc(88 - (88 * var(--play-pct, 0)));
        opacity: 0;
        transition: opacity 120ms var(--za-ease);
      }
      .za-sound-card.is-playing .za-ring-fg {
        opacity: 1;
      }

      .za-sound-meta {
        flex: 1;
        min-width: 0;
        display: flex;
        align-items: center;
      }
      .za-sound-name {
        font-size: 13px;
        font-weight: 600;
        color: var(--za-text);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      /* 4-Bar Live Equalizer */
      .za-eq {
        display: flex;
        align-items: flex-end;
        gap: 2.5px;
        height: 16px;
        padding: 0 4px;
        opacity: 0;
        transform: scale(.9);
        transition: opacity 140ms var(--za-ease), transform 140ms var(--za-ease);
      }
      .za-sound-card.is-playing .za-eq {
        opacity: 1;
        transform: scale(1);
      }
      .za-eq span {
        width: 3px;
        border-radius: 2px;
        background: linear-gradient(180deg, #38bdf8 0%, #0b7cff 100%);
        height: 4px;
        transition: height 65ms linear;
      }
      .za-eq span:nth-child(1) { height: calc(3px + var(--b1, .25) * 13px); }
      .za-eq span:nth-child(2) { height: calc(3px + var(--b2, .6) * 13px); }
      .za-eq span:nth-child(3) { height: calc(3px + var(--b3, .4) * 13px); }
      .za-eq span:nth-child(4) { height: calc(3px + var(--b4, .3) * 13px); }

      .za-sound-badge {
        flex: 0 0 auto;
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 3px 8px;
        border-radius: 999px;
        font-size: 11px;
        font-weight: 600;
        color: var(--za-muted);
        background: rgba(255, 255, 255, .05);
      }
      .za-sound-card.is-selected .za-sound-badge {
        color: #7fd1a6;
        background: rgba(28, 51, 39, .9);
        border: 1px solid rgba(127, 209, 166, .28);
      }

      /* Quick Reply Tab */
      .za-row-card.za-row-compact {
        padding: 9px 12px;
        gap: 10px;
      }
      .za-row-card.za-row-compact .za-row-ico {
        width: 30px;
        height: 30px;
        flex: 0 0 30px;
        border-radius: 8px;
      }
      .za-row-card.za-row-compact .za-row-sub {
        margin-top: 1px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .za-qr-bar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0 2px;
      }
      .za-qr-bar-lbl {
        font-size: 11.5px;
        font-weight: 600;
        color: var(--za-muted);
      }
      .za-qr-reset {
        border: 0;
        background: transparent;
        color: #63a8ff;
        font: inherit;
        font-size: 11.5px;
        font-weight: 600;
        cursor: pointer;
        padding: 2px 6px;
        border-radius: 6px;
        transition: background 120ms var(--za-ease), color 120ms var(--za-ease);
      }
      .za-qr-reset:hover {
        background: rgba(11, 124, 255, .14);
        color: #93c5fd;
      }
      .za-qr-list {
        flex: 1 1 auto;
        min-height: 0;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 6px;
        margin-top: -8px;
        margin-bottom: -6px;
        padding: 10px 2px 10px 0;
        mask-image: linear-gradient(
          180deg,
          rgba(0, 0, 0, .08) 0px,
          #000 10px,
          #000 calc(100% - 10px),
          rgba(0, 0, 0, .08) 100%
        );
        -webkit-mask-image: linear-gradient(
          180deg,
          rgba(0, 0, 0, .08) 0px,
          #000 10px,
          #000 calc(100% - 10px),
          rgba(0, 0, 0, .08) 100%
        );
      }
      .za-qr-item {
        flex: 0 0 auto;
        min-height: 38px;
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 4px 8px 4px 10px;
        border-radius: 9px;
        background: var(--za-surface);
        border: 1px solid var(--za-border);
        transition: border-color 130ms var(--za-ease), background 130ms var(--za-ease);
      }
      .za-qr-item:focus-within {
        border-color: rgba(11, 124, 255, .55);
        background: #223144;
      }
      .za-qr-idx {
        width: 18px;
        height: 18px;
        flex: 0 0 18px;
        display: grid;
        place-items: center;
        border-radius: 5px;
        background: rgba(255, 255, 255, .07);
        color: var(--za-muted);
        font-size: 10.5px;
        font-weight: 700;
        font-variant-numeric: tabular-nums;
      }
      .za-qr-input {
        flex: 1;
        min-width: 0;
        border: 0;
        background: transparent;
        color: var(--za-text);
        font: inherit;
        font-size: 12.5px;
        padding: 3px 2px;
        outline: none;
      }
      .za-qr-del {
        width: 26px;
        height: 26px;
        flex: 0 0 26px;
        display: grid;
        place-items: center;
        border: 0;
        border-radius: 7px;
        background: transparent;
        color: var(--za-muted);
        cursor: pointer;
        transition: background 120ms var(--za-ease), color 120ms var(--za-ease);
      }
      .za-qr-del:hover {
        background: rgba(255, 77, 94, .18);
        color: #ff7b88;
      }
      .za-qr-add {
        flex: 0 0 auto;
        display: flex;
        gap: 8px;
      }
      .za-qr-add[hidden] {
        display: none !important;
      }
      .za-qr-add-input {
        flex: 1;
        min-width: 0;
        height: 34px;
        padding: 0 11px;
        border-radius: 9px;
        border: 1px solid var(--za-border);
        background: rgba(15, 22, 31, .75);
        color: var(--za-text);
        font: inherit;
        font-size: 12.5px;
        outline: none;
        transition: border-color 140ms var(--za-ease);
      }
      .za-qr-add-input:focus {
        border-color: var(--za-accent);
      }
      .za-qr-add-btn {
        height: 34px;
        padding: 0 14px;
        border: 0;
        border-radius: 9px;
        background: var(--za-accent);
        color: #ffffff;
        font: inherit;
        font-size: 12.5px;
        font-weight: 600;
        cursor: pointer;
        white-space: nowrap;
        transition: filter 130ms var(--za-ease), transform 90ms var(--za-ease), opacity 130ms var(--za-ease);
      }
      .za-qr-add-btn:hover:not(:disabled) { filter: brightness(1.1); }
      .za-qr-add-btn:active:not(:disabled) { transform: scale(.97); }
      .za-qr-add-btn:disabled { opacity: .45; cursor: not-allowed; }

      .za-toast {
        position: fixed;
        left: 50%;
        bottom: 28px;
        transform: translate(-50%, 8px);
        background: #172231;
        color: var(--za-text);
        border: 1px solid var(--za-border-strong);
        border-radius: 10px;
        box-shadow: 0 12px 32px rgba(0, 0, 0, .5);
        padding: 8px 14px;
        font-size: 12.5px;
        font-weight: 500;
        z-index: 2147483601;
        opacity: 0;
        transition: opacity 160ms var(--za-ease), transform 160ms var(--za-ease);
      }
      .za-toast.show { opacity: 1; transform: translate(-50%, 0); }
      @media (prefers-reduced-motion: reduce) {
        #za-setup-overlay, #za-setup-modal, .za-tab-pill, .za-panel, .za-switch .track, .za-switch .track:after, .za-toast {
          transition: none;
        }
      }
    `;
    (document.head || document.documentElement).appendChild(st);
  }

  function toast(text) {
    const t = document.createElement('div');
    t.className = 'za-toast';
    t.textContent = text;
    document.body.appendChild(t);
    requestAnimationFrame(() => t.classList.add('show'));
    setTimeout(() => {
      t.classList.remove('show');
      setTimeout(() => t.remove(), 180);
    }, 1800);
  }

  function el(html) {
    const d = document.createElement('div');
    d.innerHTML = html.trim();
    return d.firstElementChild;
  }

  function soundName(_kind, file) {
    const id = String(file || '').replace(/^ringtone-|^noti-/, '').replace(/\.mp3$/i, '');
    return NAMES[id] || id;
  }

  const QR_STORAGE_KEY = 'zalux.quickReply.v1';
  function readLocalQuickReply() {
    try {
      const raw = localStorage.getItem(QR_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && Array.isArray(parsed.items)) {
        return {
          enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : true,
          items: parsed.items.map((s) => String(s || '').trim().slice(0, 160)).filter(Boolean).slice(0, 5),
        };
      }
    } catch (_) {}
    return null;
  }
  function writeLocalQuickReply(qr) {
    try {
      localStorage.setItem(QR_STORAGE_KEY, JSON.stringify(qr));
    } catch (_) {}
  }

  let overlay = null;
  let tabEl = null;
  let state = {
    sounds: { ringtone: [], noti: [] },
    current: { ringtone: '', noti: '' },
    quickReply: readLocalQuickReply() || { enabled: true, items: [...DEFAULT_QUICK_REPLIES] },
    defaultQuickReplies: [...DEFAULT_QUICK_REPLIES],
    base: '',
  };
  const selected = { ringtone: '', noti: '' };
  let activeSoundKind = 'ringtone';
  let audio = null;
  let audioCtx = null;
  let analyser = null;
  let freqData = null;
  let playState = null;
  let playRaf = 0;

  function isPlaying(kind, file) {
    return !!(audio && playState && playState.kind === kind && playState.file === file && !audio.paused);
  }

  function stopProgressLoop() {
    if (playRaf) {
      cancelAnimationFrame(playRaf);
      playRaf = 0;
    }
  }

  function tickAudioVisuals() {
    if (!audio || !playState || audio.paused) {
      stopProgressLoop();
      return;
    }
    const card = overlay && overlay.querySelector(`.za-sound-card[data-kind="${playState.kind}"][data-file="${playState.file}"]`);
    if (card) {
      const dur = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 3.5;
      const cur = Math.min(dur, Math.max(0, audio.currentTime || 0));
      const pct = Math.min(1, Math.max(0, cur / dur));
      card.style.setProperty('--play-pct', pct.toFixed(3));
      let b1 = 0.25, b2 = 0.55, b3 = 0.4, b4 = 0.3;
      if (analyser && freqData) {
        try {
          analyser.getByteFrequencyData(freqData);
          const avg = (start, end) => {
            let sum = 0;
            for (let i = start; i < end; i++) sum += freqData[i] || 0;
            return Math.min(1, (sum / ((end - start) * 255)) * 1.45);
          };
          b1 = Math.max(0.18, avg(1, 5));
          b2 = Math.max(0.22, avg(5, 12));
          b3 = Math.max(0.18, avg(12, 22));
          b4 = Math.max(0.15, avg(22, 32));
        } catch (_) {}
      } else {
        const t = performance.now() / 135;
        b1 = 0.3 + 0.55 * Math.abs(Math.sin(t));
        b2 = 0.35 + 0.62 * Math.abs(Math.cos(t * 1.3));
        b3 = 0.25 + 0.58 * Math.abs(Math.sin(t * 1.7 + 1));
        b4 = 0.2 + 0.5 * Math.abs(Math.cos(t * 0.9 + 2));
      }
      card.style.setProperty('--b1', b1.toFixed(2));
      card.style.setProperty('--b2', b2.toFixed(2));
      card.style.setProperty('--b3', b3.toFixed(2));
      card.style.setProperty('--b4', b4.toFixed(2));
    }
    playRaf = requestAnimationFrame(tickAudioVisuals);
  }

  function updateSoundCardsUI() {
    if (!overlay) return;
    overlay.querySelectorAll('.za-sound-card').forEach((card) => {
      const kind = card.dataset.kind;
      const file = card.dataset.file;
      const playing = isPlaying(kind, file);
      const isSel = selected[kind] === file;
      card.classList.toggle('is-playing', playing);
      card.classList.toggle('is-selected', isSel);
      if (!playing) {
        card.style.setProperty('--play-pct', '0');
      }
      const btn = card.querySelector('.za-play-btn');
      if (btn) {
        const icoSlot = btn.querySelector('.za-play-ico');
        if (icoSlot) icoSlot.innerHTML = playing ? PAUSE : PLAY;
        btn.setAttribute('aria-label', playing ? 'Tạm dừng' : 'Nghe thử');
        btn.setAttribute('aria-pressed', playing ? 'true' : 'false');
      }
      const badge = card.querySelector('.za-sound-badge');
      if (badge) {
        badge.innerHTML = isSel ? `${CHECK}<span>Đang dùng</span>` : '<span>Chọn</span>';
      }
    });
  }

  function stopAudio() {
    stopProgressLoop();
    if (audio) {
      try { audio.pause(); audio.src = ''; } catch (_) {}
    }
    audio = null;
    playState = null;
    analyser = null;
    freqData = null;
    updateSoundCardsUI();
  }

  function toggleAudio(kind, file) {
    if (playState && playState.kind === kind && playState.file === file && audio) {
      if (audio.paused) {
        audio.play().then(() => {
          updateSoundCardsUI();
          stopProgressLoop();
          playRaf = requestAnimationFrame(tickAudioVisuals);
        }).catch(() => {});
      } else {
        audio.pause();
        stopProgressLoop();
        updateSoundCardsUI();
      }
      return;
    }
    stopAudio();
    if (!state.base || !file) return;
    const a = new Audio();
    a.crossOrigin = 'anonymous';
    a.src = state.base + file;
    audio = a;
    playState = { kind, file };
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) {
        if (!audioCtx) audioCtx = new Ctx();
        if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
        const srcNode = audioCtx.createMediaElementSource(a);
        const an = audioCtx.createAnalyser();
        an.fftSize = 64;
        srcNode.connect(an);
        an.connect(audioCtx.destination);
        analyser = an;
        freqData = new Uint8Array(an.frequencyBinCount);
      }
    } catch (_) {
      analyser = null;
      freqData = null;
    }
    a.onended = () => {
      if (audio === a) stopAudio();
    };
    a.play().then(() => {
      if (audio !== a) return;
      updateSoundCardsUI();
      stopProgressLoop();
      playRaf = requestAnimationFrame(tickAudioVisuals);
    }).catch(() => {
      if (audio === a) stopAudio();
    });
    updateSoundCardsUI();
  }

  function renderSoundList() {
    if (!overlay) return;
    const listEl = overlay.querySelector('[data-sound-list]');
    if (!listEl) return;
    const kind = activeSoundKind;
    overlay.querySelectorAll('[data-subtab]').forEach((b) => {
      const on = b.dataset.subtab === kind;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    const ringCnt = overlay.querySelector('[data-cnt="ringtone"]');
    const notiCnt = overlay.querySelector('[data-cnt="noti"]');
    if (ringCnt) ringCnt.textContent = String((state.sounds.ringtone || []).length || 12);
    if (notiCnt) notiCnt.textContent = String((state.sounds.noti || []).length || 14);

    const list = [...(state.sounds[kind] || [])].sort((a, b) => {
      const id = (f) => f.replace(/^ringtone-|^noti-/, '').replace(/\.mp3$/i, '');
      const ia = ORDER[kind].indexOf(id(a.file));
      const ib = ORDER[kind].indexOf(id(b.file));
      return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
    });

    listEl.innerHTML = '';
    for (const s of list) {
      const isSel = selected[kind] === s.file;
      const playing = isPlaying(kind, s.file);
      const card = el(`<div class="za-sound-card${isSel ? ' is-selected' : ''}${playing ? ' is-playing' : ''}" role="option" aria-selected="${isSel ? 'true' : 'false'}" data-kind="${kind}" data-file="${s.file}">
        <button type="button" class="za-play-btn" data-row-play="${kind}" aria-label="Nghe thử">
          <svg class="za-ring-svg" viewBox="0 0 32 32" aria-hidden="true">
            <circle class="za-ring-bg" cx="16" cy="16" r="14"></circle>
            <circle class="za-ring-fg" cx="16" cy="16" r="14"></circle>
          </svg>
          <span class="za-play-ico">${playing ? PAUSE : PLAY}</span>
        </button>
        <div class="za-sound-meta">
          <div class="za-sound-name"></div>
        </div>
        <div class="za-eq" aria-hidden="true"><span></span><span></span><span></span><span></span></div>
        <div class="za-sound-badge">${isSel ? `${CHECK}<span>Đang dùng</span>` : '<span>Chọn</span>'}</div>
      </div>`);
      card.querySelector('.za-sound-name').textContent = soundName(kind, s.file);
      const playBtn = card.querySelector('.za-play-btn');
      playBtn.dataset.file = s.file;
      playBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleAudio(kind, s.file);
      });
      card.addEventListener('click', (e) => {
        if (e.target.closest('.za-play-btn')) return;
        selected[kind] = s.file;
        updateSoundCardsUI();
        void applySound(kind, s.file);
      });
      listEl.appendChild(card);
    }
  }

  async function applySound(kind, file) {
    try {
      if (kind === 'ringtone') {
        state.current = await setup.setRingtone(file);
        toast(`Đã chọn nhạc chuông “${soundName(kind, file)}”`);
      } else {
        state.current = await setup.setNoti(file);
        window.__zaNotiUrl = state.base + 'custom-noti.mp3?t=' + Date.now();
        toast(`Đã chọn âm báo “${soundName(kind, file)}”`);
      }
      updateSoundCardsUI();
    } catch (err) {
      toast('Lỗi: ' + (err?.message || err));
    }
  }

  function updatePrivacySummary() {
    if (!overlay) return;
    const inputs = Array.from(overlay.querySelectorAll('input[data-p]'));
    const activeCount = inputs.filter((i) => i.checked).length;
    const strip = overlay.querySelector('[data-privacy-strip]');
    const label = overlay.querySelector('[data-privacy-summary]');
    if (strip) strip.classList.toggle('is-protected', activeCount > 0);
    if (label) {
      label.textContent = activeCount > 0
        ? `Đang bật ${activeCount}/3 lớp bảo vệ riêng tư trên toàn bộ cuộc trò chuyện`
        : 'Tất cả trạng thái soạn tin, đã nhận và đã xem đang hiển thị mặc định';
    }
  }

  async function persistQuickReply(nextQr, msgToast) {
    state.quickReply = {
      enabled: Boolean(nextQr.enabled),
      items: (nextQr.items || []).map((s) => String(s || '').trim().slice(0, 160)).filter(Boolean).slice(0, 5),
    };
    writeLocalQuickReply(state.quickReply);
    renderQuickReplyPanel();
    if (typeof setup.setQuickReply === 'function') {
      try {
        const res = await setup.setQuickReply(state.quickReply);
        if (res && res.quickReply) {
          state.quickReply = res.quickReply;
          writeLocalQuickReply(state.quickReply);
          renderQuickReplyPanel();
        }
        if (msgToast) toast(msgToast);
      } catch (err) {
        toast('Lỗi lưu phản hồi nhanh: ' + (err?.message || err));
      }
    } else if (msgToast) {
      toast(msgToast);
    }
  }

  function renderQuickReplyPanel() {
    if (!overlay) return;
    const qr = state.quickReply || { enabled: true, items: [...DEFAULT_QUICK_REPLIES] };
    const toggle = overlay.querySelector('[data-qr-enable]');
    if (toggle) toggle.checked = Boolean(qr.enabled);

    const cntEl = overlay.querySelector('[data-qr-count]');
    const items = Array.isArray(qr.items) ? qr.items : [];
    if (cntEl) cntEl.textContent = `Câu trả lời mẫu (${items.length}/5)`;

    const listEl = overlay.querySelector('[data-qr-list]');
    if (listEl) {
      listEl.innerHTML = '';
      items.forEach((text, idx) => {
        const row = el(`<div class="za-qr-item">
          <span class="za-qr-idx">${idx + 1}</span>
          <input type="text" class="za-qr-input" maxlength="160" aria-label="Câu phản hồi nhanh ${idx + 1}" />
          <button type="button" class="za-qr-del" title="Xoá câu này" aria-label="Xoá câu này">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          </button>
        </div>`);
        const inp = row.querySelector('.za-qr-input');
        inp.value = text;
        const commitEdit = () => {
          const val = inp.value.trim();
          if (!val) {
            inp.value = text;
            return;
          }
          if (val !== text) {
            const nextItems = [...items];
            nextItems[idx] = val;
            void persistQuickReply({ enabled: qr.enabled, items: nextItems }, 'Đã cập nhật câu phản hồi');
          }
        };
        inp.addEventListener('blur', commitEdit);
        inp.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            inp.blur();
          }
        });
        row.querySelector('.za-qr-del').addEventListener('click', () => {
          const nextItems = items.filter((_, i) => i !== idx);
          void persistQuickReply({ enabled: qr.enabled, items: nextItems }, 'Đã xoá câu phản hồi');
        });
        listEl.appendChild(row);
      });
    }

    const addWrap = overlay.querySelector('[data-qr-add-wrap]');
    const addInput = overlay.querySelector('[data-qr-add-input]');
    const addBtn = overlay.querySelector('[data-qr-add-btn]');
    const full = items.length >= 5;
    if (addWrap) addWrap.hidden = full;
    if (addInput) addInput.disabled = full;
    if (addBtn) addBtn.disabled = full;
  }

  function build() {
    overlay = el(`<div id="za-setup-overlay" hidden>
      <div id="za-setup-modal" role="dialog" aria-modal="true" aria-label="Zalux">
        <div class="za-head">
          <div class="za-brand">
            <img class="za-brand-logo" alt="Zalux" draggable="false" />
            <strong>Zalux</strong>
            <span class="za-brand-badge">Studio</span>
          </div>
          <button type="button" class="za-x" aria-label="Đóng">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M2 2l10 10M12 2L2 12"/></svg>
          </button>
        </div>

        <div class="za-tabs-wrap">
          <div class="za-tabs" role="tablist" style="--tab-idx:0">
            <div class="za-tab-pill" aria-hidden="true"></div>
            <button type="button" class="za-tab active" role="tab" aria-selected="true" data-tab="privacy" data-idx="0">Riêng tư</button>
            <button type="button" class="za-tab" role="tab" aria-selected="false" data-tab="sound" data-idx="1">Âm thanh</button>
            <button type="button" class="za-tab" role="tab" aria-selected="false" data-tab="quickreply" data-idx="2">Phản hồi nhanh</button>
          </div>
        </div>

        <div class="za-body">
          <div class="za-panel is-active" data-panel="privacy" role="tabpanel">
            <div class="za-card-list">
              <div class="za-row-card">
                <div class="za-row-ico">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
                </div>
                <div class="za-row-text">
                  <div class="za-row-title">Ẩn trạng thái đang soạn tin</div>
                  <div class="za-row-sub">Người bên kia sẽ không thấy hiệu ứng "Đang nhập..." khi bạn gõ phím</div>
                </div>
                <label class="za-switch"><input type="checkbox" data-p="blockTyping"><span class="track"></span></label>
              </div>

              <div class="za-row-card">
                <div class="za-row-ico">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>
                </div>
                <div class="za-row-text">
                  <div class="za-row-title">Ẩn trạng thái đã nhận tin</div>
                  <div class="za-row-sub">Chặn gửi tín hiệu "Đã nhận" tự động về máy của người gửi</div>
                </div>
                <label class="za-switch"><input type="checkbox" data-p="blockDelivered"><span class="track"></span></label>
              </div>

              <div class="za-row-card">
                <div class="za-row-ico">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
                </div>
                <div class="za-row-text">
                  <div class="za-row-title">Ẩn trạng thái đã xem</div>
                  <div class="za-row-sub">Đọc tin nhắn thoải mái mà không hiển thị "Đã xem" cho đối phương</div>
                </div>
                <label class="za-switch"><input type="checkbox" data-p="blockSeen"><span class="track"></span></label>
              </div>
            </div>

            <div class="za-status-strip" data-privacy-strip>
              <span class="za-status-dot"></span>
              <span data-privacy-summary>Tất cả trạng thái soạn tin, đã nhận và đã xem đang hiển thị mặc định</span>
            </div>
          </div>

          <div class="za-panel" data-panel="sound" role="tabpanel">
            <div class="za-subtabs" role="tablist">
              <button type="button" class="za-subtab active" data-subtab="ringtone" aria-selected="true">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.12.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.58 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
                <span>Nhạc chuông gọi</span>
                <span class="za-subtab-cnt" data-cnt="ringtone">12</span>
              </button>
              <button type="button" class="za-subtab" data-subtab="noti" aria-selected="false">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
                <span>Âm báo tin nhắn</span>
                <span class="za-subtab-cnt" data-cnt="noti">14</span>
              </button>
            </div>
            <div class="za-sound-list" role="listbox" data-sound-list></div>
          </div>

          <div class="za-panel" data-panel="quickreply" role="tabpanel">
            <div class="za-row-card za-row-compact">
              <div class="za-row-ico">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
              </div>
              <div class="za-row-text">
                <div class="za-row-title">Phản hồi nhanh khi từ chối cuộc gọi</div>
                <div class="za-row-sub">Hiện menu nhắn nhanh khi rê chuột vào nút Từ chối (1-1)</div>
              </div>
              <label class="za-switch"><input type="checkbox" data-qr-enable checked><span class="track"></span></label>
            </div>

            <div class="za-qr-bar">
              <span class="za-qr-bar-lbl" data-qr-count>Câu trả lời mẫu (4/5)</span>
              <button type="button" class="za-qr-reset" data-qr-reset>↺ Khôi phục mẫu</button>
            </div>

            <div class="za-qr-list" data-qr-list></div>

            <div class="za-qr-add" data-qr-add-wrap>
              <input type="text" class="za-qr-add-input" data-qr-add-input maxlength="160" placeholder="Thêm câu phản hồi nhanh mới (tối đa 5 câu)..." />
              <button type="button" class="za-qr-add-btn" data-qr-add-btn>Thêm</button>
            </div>
          </div>
        </div>
      </div>
    </div>`);

    overlay.querySelector('.za-brand-logo').src = cachedLogoUrl || ZALUX_FALLBACK_LOGO;
    overlay.querySelector('.za-x').onclick = close;
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    const tabsContainer = overlay.querySelector('.za-tabs');
    overlay.querySelectorAll('.za-tab').forEach((b) => {
      b.onclick = () => {
        stopAudio();
        if (tabsContainer) tabsContainer.style.setProperty('--tab-idx', b.dataset.idx || '0');
        overlay.querySelectorAll('.za-tab').forEach((x) => {
          x.classList.toggle('active', x === b);
          x.setAttribute('aria-selected', x === b ? 'true' : 'false');
        });
        overlay.querySelectorAll('[data-panel]').forEach((p) => {
          p.classList.toggle('is-active', p.dataset.panel === b.dataset.tab);
        });
      };
    });

    overlay.querySelectorAll('[data-subtab]').forEach((b) => {
      b.onclick = () => {
        stopAudio();
        activeSoundKind = b.dataset.subtab || 'ringtone';
        renderSoundList();
      };
    });

    const qrEnable = overlay.querySelector('[data-qr-enable]');
    if (qrEnable) {
      qrEnable.addEventListener('change', () => {
        const cur = state.quickReply || { enabled: true, items: [...DEFAULT_QUICK_REPLIES] };
        void persistQuickReply(
          { enabled: qrEnable.checked, items: cur.items },
          qrEnable.checked ? 'Đã bật phản hồi nhanh cuộc gọi' : 'Đã tắt phản hồi nhanh cuộc gọi'
        );
      });
    }

    const qrReset = overlay.querySelector('[data-qr-reset]');
    if (qrReset) {
      qrReset.addEventListener('click', () => {
        const defaults = Array.isArray(state.defaultQuickReplies) && state.defaultQuickReplies.length
          ? state.defaultQuickReplies
          : DEFAULT_QUICK_REPLIES;
        void persistQuickReply({ enabled: true, items: [...defaults] }, 'Đã khôi phục câu trả lời mặc định');
      });
    }

    const qrAddInput = overlay.querySelector('[data-qr-add-input]');
    const qrAddBtn = overlay.querySelector('[data-qr-add-btn]');
    const handleAddQr = () => {
      if (!qrAddInput) return;
      const val = qrAddInput.value.trim();
      if (!val) return;
      const cur = state.quickReply || { enabled: true, items: [...DEFAULT_QUICK_REPLIES] };
      if ((cur.items || []).length >= 5) return;
      qrAddInput.value = '';
      void persistQuickReply({ enabled: cur.enabled, items: [...(cur.items || []), val] }, 'Đã thêm câu phản hồi nhanh');
    };
    if (qrAddBtn) qrAddBtn.addEventListener('click', handleAddQr);
    if (qrAddInput) {
      qrAddInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          handleAddQr();
        }
      });
    }

    document.body.appendChild(overlay);
  }

  function open() {
    if (!overlay) build();
    overlay.hidden = false;
    requestAnimationFrame(() => overlay.classList.add('za-open'));
    if (tabEl) tabEl.classList.add('selected');
    privacy?.get?.().then((cfg) => {
      overlay.querySelectorAll('input[data-p]').forEach((node) => {
        node.checked = !!cfg?.[node.dataset.p];
      });
      updatePrivacySummary();
    }).catch(() => {});
    setup.get().then((cfg) => {
      const localQr = readLocalQuickReply();
      const resolvedQr = (cfg && cfg.quickReply && Array.isArray(cfg.quickReply.items))
        ? cfg.quickReply
        : (localQr || state.quickReply || { enabled: true, items: [...DEFAULT_QUICK_REPLIES] });
      writeLocalQuickReply(resolvedQr);
      state = Object.assign(
        {
          sounds: { ringtone: [], noti: [] },
          current: { ringtone: '', noti: '' },
          defaultQuickReplies: [...DEFAULT_QUICK_REPLIES],
          base: '',
        },
        cfg || {},
        { quickReply: resolvedQr }
      );
      if (cfg && cfg.logo) {
        cachedLogoUrl = cfg.logo;
        const logoImg = overlay && overlay.querySelector('.za-brand-logo');
        if (logoImg && logoImg.src !== cfg.logo) logoImg.src = cfg.logo;
      }
      if (state.current && state.current.noti && state.base) {
        window.__zaNotiUrl = state.base + 'custom-noti.mp3?t=' + Date.now();
      }
      selected.ringtone = state.current?.ringtone || state.sounds?.ringtone?.[0]?.file || '';
      selected.noti = state.current?.noti || state.sounds?.noti?.[0]?.file || '';
      renderSoundList();
      renderQuickReplyPanel();
    }).catch(() => toast('Không tải được cấu hình'));
  }

  function close() {
    if (!overlay) return;
    stopAudio();
    overlay.classList.remove('za-open');
    if (tabEl) tabEl.classList.remove('selected');
    setTimeout(() => { if (overlay) overlay.hidden = true; }, 170);
  }

  function installTab() {
    if (document.getElementById('za-setup-tab')) {
      tabEl = document.getElementById('za-setup-tab');
      return true;
    }
    const bottom = document.querySelector('#main-tab .nav__tabs__bottom');
    if (!bottom) return false;
    tabEl = el(`<div id="za-setup-tab" class="clickable leftbar-tab flx flx-col flx-al-c flx-center rel" title="Zalux">
      <div class="mmi-icon-wr"><div class="z-noti-badge-container">${TAB_ICON}</div></div>
      <div class="lb-tab-title truncate">Zalux</div>
    </div>`);
    tabEl.addEventListener('click', open);
    bottom.insertBefore(tabEl, bottom.firstChild);
    return true;
  }

  let lastDomBadgeKey = '';
  let badgeObserver = null;
  let badgeObservedRoot = null;
  let badgeRaf = 0;

  function readOutermostMessageBadge() {
    const navTop = document.querySelector('#main-tab .nav__tabs__top') || document.getElementById('main-tab');
    if (!navTop) return null;
    const msgTab = navTop.querySelector('[data-id="div_Main_TabMsg"]') || navTop.querySelector('.leftbar-tab:not(#za-setup-tab)');
    if (!msgTab) return null;
    // Chỉ lấy phần tử `.z-noti-badge` thực sự (loại trừ hoàn toàn `.z-noti-badge-container` luôn hiển thị).
    const badgeNode = msgTab.querySelector('.z-noti-badge:not(.z-noti-badge-container)');
    if (!badgeNode) {
      return { count: 0, plus: false, label: '' };
    }
    const style = window.getComputedStyle(badgeNode);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
      return { count: 0, plus: false, label: '' };
    }

    // Zalo PC vẽ số trên icon Message ngoài cùng bằng icon font `fa-{N}_24_Line` hoặc `fa-{N}_Plus_24_Line`.
    const iconNode = badgeNode.querySelector('.z-noti-badge__content, i[class*="fa-"]');
    if (iconNode) {
      const cls = String(iconNode.className || '');
      const mPlus = cls.match(/\bfa-(\d+)_Plus_/i);
      if (mPlus) {
        const n = parseInt(mPlus[1], 10) || 5;
        return { count: n, plus: true, label: n + '+' };
      }
      const mNum = cls.match(/\bfa-(\d+)_/i);
      if (mNum) {
        const n = parseInt(mNum[1], 10) || 0;
        return { count: n, plus: false, label: n > 0 ? String(n) : '' };
      }
    }

    const raw = (badgeNode.textContent || '').trim();
    if (raw) {
      const plus = raw.indexOf('+') >= 0;
      const num = parseInt(raw.replace(/[^0-9]/g, ''), 10);
      if (Number.isFinite(num) && num > 0) {
        return { count: num, plus, label: num + (plus ? '+' : '') };
      }
    }

    if (badgeNode.classList.contains('--dot')) {
      return { count: 1, plus: false, label: '1' };
    }
    return { count: 0, plus: false, label: '' };
  }

  function syncUnreadBadgeFromDom() {
    if (typeof setup.updateBadge !== 'function') return;
    const info = readOutermostMessageBadge();
    if (!info) return;
    const key = `${info.count}:${info.plus ? 1 : 0}:${info.label}`;
    if (key === lastDomBadgeKey) return;
    lastDomBadgeKey = key;
    setup.updateBadge(info);
  }

  function ensureBadgeObserver() {
    const root = document.getElementById('main-tab');
    if (!root || root === badgeObservedRoot) return;
    if (badgeObserver) badgeObserver.disconnect();
    badgeObservedRoot = root;
    badgeObserver = new MutationObserver(() => {
      if (badgeRaf) return;
      badgeRaf = requestAnimationFrame(() => {
        badgeRaf = 0;
        syncUnreadBadgeFromDom();
      });
    });
    badgeObserver.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    });
  }

  installTab();
  ensureBadgeObserver();
  syncUnreadBadgeFromDom();
  setInterval(() => {
    if (!document.getElementById('za-setup-tab')) installTab();
    ensureBadgeObserver();
    syncUnreadBadgeFromDom();
  }, 1500);

  window.addEventListener('zalux:open-setup', open);
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'p') {
      e.preventDefault();
      open();
    } else if (e.key === 'Escape' && overlay && !overlay.hidden) {
      close();
    }
  });

  document.addEventListener('change', async (e) => {
    const node = e.target;
    if (node instanceof HTMLInputElement && node.dataset.p && privacy) {
      updatePrivacySummary();
      try { await privacy.set({ [node.dataset.p]: node.checked }); } catch (_) {}
    }
  });
})();

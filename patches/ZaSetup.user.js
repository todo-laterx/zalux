// ==UserScript==
// @name        ZaSetup
// @description Zalux setup: quyền riêng tư + âm thanh
// @version     1.3.4
// @match       *
// @run-at      document-idle
// ==/UserScript==
// ==UserScript==
// @name        ZaSetup
// @description Zalux setup: quyền riêng tư + âm thanh
// @version     1.3.2
// @match       *
// @run-at      document-idle
// ==/UserScript==
// ==UserScript==
// @name        ZaSetup
// @description Zalux setup: quyền riêng tư + âm thanh
// @version     1.3.0
// @match       *
// @run-at      document-idle
// ==/UserScript==

(function () {
  if (!location.pathname.endsWith('/pc-dist/index.html')) return;
  if (document.getElementById('za-setup-tab')) return;
  const setup = window.zaSetup;
  const privacy = window.zaPrivacy;
  if (!setup) { console.warn('[Zalux] missing API'); return; }

  try {
    const OrigAudio = window.Audio;
    function PatchedAudio(src) {
      if (window.__zaNotiUrl && typeof src === 'string' && src.indexOf('/sound/noti.mp3') >= 0) src = window.__zaNotiUrl;
      return new OrigAudio(src);
    }
    PatchedAudio.prototype = OrigAudio.prototype;
    window.Audio = PatchedAudio;
  } catch (_) {}

  setup.get().then((cfg) => { if (cfg.current.noti) window.__zaNotiUrl = cfg.base + 'custom-noti.mp3'; }).catch(() => {});

  const NAMES = {
    classic: 'Điện thoại văn phòng', vintage: 'Điện thoại cổ điển', marimba: 'Marimba',
    'marimba-waiting': 'Marimba chờ', waiting: 'Chờ máy', hold: 'Nhạc chờ', urgent: 'Khẩn cấp',
    old: 'Điện thoại cũ', toy: 'Điện thoại đồ chơi', futuristic: 'Dial tương lai',
    spell: 'Chuông phép thuật', zalo: 'Zalo gốc',
    pop: 'Pop tin nhắn', longpop: 'Pop dài', chime: 'Chuông', bells: 'Chuông vui',
    bubble: 'Bong bóng', positive: 'Tích cực', magic: 'Phép thuật', scifi: 'Sci-fi',
    interface: 'Giao diện', elevator: 'Thang máy', doorbell: 'Chuông cửa',
    digital: 'Kỹ thuật số', flute: 'Sáo', confirm: 'Xác nhận'
  };
  const ORDER = { ringtone: ['classic','vintage','marimba','marimba-waiting','waiting','hold','urgent','old','toy','futuristic','spell','zalo'], noti: ['pop','longpop','chime','bells','bubble','positive','magic','scifi','interface','elevator','doorbell','digital','flute','confirm'] };
  const PLAY = '<svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true"><path d="M3 1.5l7 4.5-7 4.5z"/></svg>';
  const PAUSE = '<svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true"><rect x="2.5" y="1.5" width="2.6" height="9" rx=".6"/><rect x="6.9" y="1.5" width="2.6" height="9" rx=".6"/></svg>';
  const CHECK = '<svg class="za-check" width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M2.5 7.2l3 3 6-6.4"/></svg>';

  GM_addStyle(`
    :root{--za-bg:#1b2430;--za-surface:#223041;--za-border:#314052;--za-text:#dbe6f4;--za-muted:#8fa3b8;--za-accent:#0068ff;--za-ease:cubic-bezier(.23,1,.32,1);--za-spring:cubic-bezier(.34,1.56,.64,1)}
    #za-setup-tab.selected{color:var(--za-accent)}
    #za-setup-overlay[hidden]{display:none!important}
    #za-setup-overlay{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:2147483600;display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity 160ms var(--za-ease)}
    #za-setup-overlay.za-open{opacity:1}
    #za-setup-modal{color-scheme:dark;width:min(460px,92vw);max-height:76vh;display:flex;flex-direction:column;background:var(--za-bg);color:var(--za-text);border:1px solid var(--za-border);border-radius:12px;box-shadow:0 24px 60px rgba(0,0,0,.55);font:13px/1.45 inherit;transform:scale(.97);opacity:0;transition:transform 200ms var(--za-ease),opacity 160ms var(--za-ease)}
    #za-setup-overlay.za-open #za-setup-modal{transform:scale(1);opacity:1}
    .za-head{display:flex;align-items:center;justify-content:space-between;height:48px;padding:0 12px 0 16px;border-bottom:1px solid #2a3646}
    .za-brand{display:flex;align-items:baseline;gap:7px}
    .za-brand strong{font-size:14px;font-weight:650;letter-spacing:.1px}
    .za-brand span{font-size:10.5px;color:var(--za-muted)}
    .za-x{width:28px;height:28px;display:flex;align-items:center;justify-content:center;border:0;border-radius:6px;background:transparent;color:var(--za-muted);cursor:pointer;transition:background 120ms var(--za-ease),color 120ms var(--za-ease)}
    .za-x:hover{background:#263243;color:var(--za-text)}
    .za-x:active{transform:scale(.94)}
    .za-tabs{display:flex;gap:4px;padding:10px 12px 0}
    .za-tab{height:30px;padding:0 12px;border:0;border-radius:8px;background:transparent;color:var(--za-muted);font:inherit;font-size:12.5px;cursor:pointer;transition:background 140ms var(--za-ease),color 140ms var(--za-ease)}
    .za-tab:hover{color:var(--za-text)}
    .za-tab.active{background:#263243;color:var(--za-text);font-weight:600}
    .za-body{padding:10px 16px 16px;overflow:auto}
    .za-row{display:flex;align-items:center;gap:10px;height:42px}
    .za-row .lbl{flex:1;min-width:0}
    .za-switch{position:relative;width:36px;height:20px;flex:0 0 auto}
    .za-switch input{position:absolute;opacity:0;width:100%;height:100%;margin:0;cursor:pointer;z-index:1}
    .za-switch .track{position:absolute;inset:0;border-radius:10px;background:#334255;transition:background 160ms var(--za-ease)}
    .za-switch .track:after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#cfe0f5;transition:transform 190ms var(--za-spring)}
    .za-switch input:checked + .track{background:var(--za-accent)}
    .za-switch input:checked + .track:after{transform:translateX(16px)}
    .za-switch input:focus-visible + .track{box-shadow:0 0 0 2px rgba(0,104,255,.45)}
    .za-section{margin-top:6px}
    .za-section h5{display:flex;align-items:center;gap:8px;margin:14px 0 6px;font-size:11px;font-weight:600;letter-spacing:.3px;text-transform:uppercase;color:var(--za-muted)}
    .za-cur{font-size:10px;font-weight:500;color:#7fd1a6;background:#1c3327;border-radius:8px;padding:1px 6px;text-transform:none;letter-spacing:0}
    .za-sound{display:flex}
    .za-combo{flex:1;min-width:0;height:34px;display:flex;align-items:center;gap:8px;padding:0 10px;border-radius:8px;border:1px solid var(--za-border);background:var(--za-surface);color:var(--za-text);font:inherit;font-size:12.5px;cursor:pointer;text-align:left;transition:border-color 140ms var(--za-ease),background 140ms var(--za-ease)}
    .za-combo:hover{border-color:#3c4d63;background:#263546}
    .za-combo:focus-visible{outline:none;box-shadow:0 0 0 2px rgba(0,104,255,.45)}
    .za-combo .nm{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .za-combo .chev{flex:0 0 auto;color:var(--za-muted);transition:transform 160ms var(--za-ease)}
    .za-combo[aria-expanded=true] .chev{transform:rotate(180deg)}
    .za-note{margin-top:14px;color:var(--za-muted);font-size:11px}
    .za-menu{position:fixed;z-index:2147483700;padding:4px;background:var(--za-bg);border:1px solid var(--za-border);border-radius:10px;box-shadow:0 18px 40px rgba(0,0,0,.55);overflow:auto;color-scheme:dark;opacity:0;transform:translateY(-3px) scale(.985);transition:opacity 120ms var(--za-ease),transform 150ms var(--za-ease)}
    .za-menu.open{opacity:1;transform:none}
    .za-opt{display:grid;grid-template-columns:minmax(0,1fr) 26px 16px;align-items:center;gap:8px;height:32px;padding:0 6px 0 9px;border-radius:6px;cursor:pointer;transition:background 120ms var(--za-ease),box-shadow 120ms var(--za-ease)}
    .za-opt:hover{background:#263243}
    .za-opt[aria-selected=true]{background:#22334a;box-shadow:inset 2px 0 0 var(--za-accent)}
    .za-opt[aria-selected=true] .nm{font-weight:600;color:#fff}
    .za-opt .nm{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12.5px}
    .za-opt .za-check{justify-self:center;color:var(--za-accent)}
    .za-opt-play{justify-self:center;width:24px;height:24px;display:flex;align-items:center;justify-content:center;border:0;border-radius:6px;background:transparent;color:var(--za-muted);cursor:pointer;transition:background 120ms var(--za-ease),color 120ms var(--za-ease)}
    .za-opt-play:hover{background:#314052;color:var(--za-text)}
    .za-opt-play svg{animation:za-pop 150ms var(--za-ease)}
    @keyframes za-pop{from{transform:scale(.8);opacity:.5}to{transform:scale(1);opacity:1}}
    .za-toast{position:fixed;left:50%;bottom:28px;transform:translate(-50%,8px);background:var(--za-bg);color:var(--za-text);border:1px solid var(--za-border);border-radius:8px;padding:8px 14px;font-size:12.5px;z-index:2147483601;opacity:0;transition:opacity 160ms var(--za-ease),transform 160ms var(--za-ease)}
    .za-toast.show{opacity:1;transform:translate(-50%,0)}
    @media (prefers-reduced-motion: reduce){#za-setup-overlay,#za-setup-modal,.za-switch .track,.za-switch .track:after,.za-toast,.za-combo .chev,.za-menu,.za-opt-play svg{transition:none;animation:none}}
  `);

  function toast(text) {
    const t = document.createElement('div');
    t.className = 'za-toast'; t.textContent = text;
    document.body.appendChild(t);
    requestAnimationFrame(() => t.classList.add('show'));
    setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 180); }, 1800);
  }
  function el(html) { const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstElementChild; }
  function soundName(kind, file) {
    const id = file.replace(/^ringtone-|^noti-/, '').replace(/\.mp3$/, '');
    return NAMES[id] || id;
  }

  let overlay = null;
  let tabEl = null;
  let state = { sounds: { ringtone: [], noti: [] }, current: { ringtone: '', noti: '' }, base: '' };
  let selected = { ringtone: '', noti: '' };
  let audio = null;
  let playState = null;
  let menuEl = null;
  let menuKind = null;
  let menuCleanup = null;

  function isPlaying(kind, file) {
    return !!(audio && playState && playState.kind === kind && playState.file === file && !audio.paused);
  }
  function updatePlayIcons() {
    if (!menuEl) return;
    menuEl.querySelectorAll('[data-row-play]').forEach((b) => {
      const on = isPlaying(b.dataset.rowPlay, b.dataset.file);
      b.innerHTML = on ? PAUSE : PLAY;
      b.setAttribute('aria-label', on ? 'Tạm dừng' : 'Nghe thử');
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }
  function stopAudio() {
    if (audio) { try { audio.pause(); audio.src = ''; } catch (_) {} }
    audio = null; playState = null; updatePlayIcons();
  }
  function toggleAudio(kind, file) {
    if (playState && playState.kind === kind && playState.file === file && audio) {
      if (audio.paused) audio.play().catch(() => {});
      else audio.pause();
      updatePlayIcons();
      return;
    }
    stopAudio();
    const a = new Audio(state.base + file);
    audio = a; playState = { kind, file };
    a.onended = () => { if (audio === a) { audio = null; playState = null; updatePlayIcons(); } };
    a.play().catch(() => { if (audio === a) { audio = null; playState = null; updatePlayIcons(); } });
    updatePlayIcons();
  }

  function closeMenu() {
    if (menuCleanup) { menuCleanup(); menuCleanup = null; }
    if (menuEl) { menuEl.remove(); menuEl = null; }
    menuKind = null;
    if (overlay) overlay.querySelectorAll('.za-combo').forEach((b) => b.setAttribute('aria-expanded', 'false'));
  }
  function openMenu(kind) {
    if (menuKind === kind) { closeMenu(); return; }
    closeMenu();
    const combo = overlay.querySelector(`[data-combo="${kind}"]`);
    if (!combo) return;
    const list = [...(state.sounds[kind] || [])].sort((a, b) => {
      const id = (f) => f.replace(/^ringtone-|^noti-/, '').replace(/\.mp3$/, '');
      return ORDER[kind].indexOf(id(a.file)) - ORDER[kind].indexOf(id(b.file));
    });
    const menu = el(`<div class="za-menu" role="listbox" aria-label="${kind === 'ringtone' ? 'Nhạc chuông' : 'Âm thanh thông báo'}"></div>`);
    for (const s of list) {
      const active = selected[kind] === s.file;
      const row = el(`<div class="za-opt" role="option" data-file="${s.file}" aria-selected="${active ? 'true' : 'false'}">
        <span class="nm"></span>
        <button type="button" class="za-opt-play" data-row-play="${kind}" data-file="${s.file}" aria-label="Nghe thử">${PLAY}</button>
        ${active ? CHECK : '<span class="za-check"></span>'}
      </div>`);
      row.querySelector('.nm').textContent = soundName(kind, s.file);
      row.addEventListener('click', (e) => {
        if (e.target.closest('[data-row-play]')) return;
        selected[kind] = s.file;
        stopAudio();
        closeMenu();
        updateCombo(kind);
        void applySound(kind, s.file);
      });
      row.querySelector('[data-row-play]').addEventListener('click', (e) => {
        e.stopPropagation();
        toggleAudio(kind, s.file);
      });
      menu.appendChild(row);
    }
    document.body.appendChild(menu);
    menuEl = menu; menuKind = kind;
    combo.setAttribute('aria-expanded', 'true');
    const r = combo.getBoundingClientRect();
    const h = Math.min(menu.scrollHeight + 8, 480);
    menu.style.width = `${r.width}px`;
    menu.style.maxHeight = '480px';
    menu.style.left = `${Math.max(8, Math.min(r.left, innerWidth - r.width - 8))}px`;
    const up = r.bottom + 6 + h > innerHeight - 8;
    menu.style.top = `${up ? Math.max(8, r.top - h - 6) : r.bottom + 6}px`;
    menu.style.transformOrigin = up ? 'bottom left' : 'top left';
    requestAnimationFrame(() => menu.classList.add('open'));
    updatePlayIcons();
    const onDoc = (e) => { if (!menu.contains(e.target) && e.target !== combo && !combo.contains(e.target)) closeMenu(); };
    const onKey = (e) => { if (e.key === 'Escape') { closeMenu(); combo.focus(); } };
    const onScroll = () => closeMenu();
    setTimeout(() => document.addEventListener('click', onDoc), 0);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onScroll);
    window.addEventListener('scroll', onScroll, true);
    menuCleanup = () => {
      document.removeEventListener('click', onDoc);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onScroll);
      window.removeEventListener('scroll', onScroll, true);
    };
  }

  function updateCombo(kind) {
    const combo = overlay.querySelector(`[data-combo="${kind}"]`);
    if (!combo) return;
    const f = selected[kind] || state.current[kind] || state.sounds[kind]?.[0]?.file || '';
    combo.querySelector('.nm').textContent = f ? soundName(kind, f) : 'Chọn';
    combo.dataset.file = f;
    const cur = overlay.querySelector(`[data-cur="${kind}"]`);
    if (cur) cur.hidden = !state.current[kind];
  }

  async function applySound(kind, file) {
    try {
      if (kind === 'ringtone') { state.current = await setup.setRingtone(file); toast(`Đã dùng “${soundName(kind, file)}”`); }
      else { state.current = await setup.setNoti(file); window.__zaNotiUrl = state.base + 'custom-noti.mp3'; toast(`Đã dùng “${soundName(kind, file)}”`); }
      updateCombo(kind);
    } catch (err) { toast('Lỗi: ' + (err?.message || err)); }
  }

  function build() {
    overlay = el(`<div id="za-setup-overlay" hidden>
      <div id="za-setup-modal" role="dialog" aria-modal="true" aria-label="Zalux">
        <div class="za-head"><div class="za-brand"><strong>Zalux</strong><span>Zalo Linux</span></div><button type="button" class="za-x" aria-label="Đóng"><svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 2l10 10M12 2L2 12"/></svg></button></div>
        <div class="za-tabs" role="tablist">
          <button type="button" class="za-tab active" role="tab" aria-selected="true" data-tab="privacy">Quyền riêng tư</button>
          <button type="button" class="za-tab" role="tab" aria-selected="false" data-tab="sound">Âm thanh</button>
        </div>
        <div class="za-body">
          <div data-panel="privacy">
            <div class="za-row"><span class="lbl">Ẩn “đang soạn tin”</span><label class="za-switch"><input type="checkbox" data-p="blockTyping"><span class="track"></span></label></div>
            <div class="za-row"><span class="lbl">Ẩn “đã nhận”</span><label class="za-switch"><input type="checkbox" data-p="blockDelivered"><span class="track"></span></label></div>
            <div class="za-row"><span class="lbl">Ẩn “đã xem”</span><label class="za-switch"><input type="checkbox" data-p="blockSeen"><span class="track"></span></label></div>
            <p class="za-note">Chặn ngay trên máy, không gửi trạng thái lên Zalo.</p>
          </div>
          <div data-panel="sound" hidden>
            <div class="za-section">
              <h5>Nhạc chuông cuộc gọi <span class="za-cur" data-cur="ringtone" hidden>Đang dùng</span></h5>
              <div class="za-sound">
                <button type="button" class="za-combo" data-combo="ringtone" aria-haspopup="listbox" aria-expanded="false"><span class="nm"></span><svg class="chev" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M2.5 4.5L6 8l3.5-3.5"/></svg></button>
              </div>
            </div>
            <div class="za-section">
              <h5>Âm thanh thông báo <span class="za-cur" data-cur="noti" hidden>Đang dùng</span></h5>
              <div class="za-sound">
                <button type="button" class="za-combo" data-combo="noti" aria-haspopup="listbox" aria-expanded="false"><span class="nm"></span><svg class="chev" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M2.5 4.5L6 8l3.5-3.5"/></svg></button>
              </div>
            </div>
            <p class="za-note">Chọn để áp dụng ngay.</p>
          </div>
        </div>
      </div>
    </div>`);
    overlay.querySelector('.za-x').onclick = close;
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    overlay.querySelectorAll('.za-tab').forEach((b) => {
      b.onclick = () => {
        closeMenu(); stopAudio();
        overlay.querySelectorAll('.za-tab').forEach((x) => { x.classList.toggle('active', x === b); x.setAttribute('aria-selected', x === b ? 'true' : 'false'); });
        overlay.querySelectorAll('[data-panel]').forEach((p) => { p.hidden = p.dataset.panel !== b.dataset.tab; });
      };
    });
    overlay.querySelectorAll('[data-combo]').forEach((b) => { b.onclick = () => openMenu(b.dataset.combo); });
    document.body.appendChild(overlay);
  }

  function open() {
    if (!overlay) build();
    overlay.hidden = false;
    requestAnimationFrame(() => overlay.classList.add('za-open'));
    if (tabEl) tabEl.classList.add('selected');
    privacy?.get?.().then((cfg) => {
      overlay.querySelectorAll('input[data-p]').forEach((el) => { el.checked = !!cfg?.[el.dataset.p]; });
    }).catch(() => {});
    setup.get().then((cfg) => {
      state = cfg;
      if (cfg.current.noti) window.__zaNotiUrl = cfg.base + 'custom-noti.mp3';
      selected.ringtone = cfg.current.ringtone || cfg.sounds.ringtone[0]?.file || '';
      selected.noti = cfg.current.noti || cfg.sounds.noti[0]?.file || '';
      updateCombo('ringtone'); updateCombo('noti');
    }).catch(() => toast('Không tải được cấu hình'));
  }
  function close() {
    if (!overlay) return;
    closeMenu(); stopAudio();
    overlay.classList.remove('za-open');
    if (tabEl) tabEl.classList.remove('selected');
    setTimeout(() => { if (overlay) overlay.hidden = true; }, 170);
  }

  function installTab() {
    if (document.getElementById('za-setup-tab')) { tabEl = document.getElementById('za-setup-tab'); return true; }
    const bottom = document.querySelector('#main-tab .nav__tabs__bottom');
    if (!bottom) return false;
    tabEl = el(`<div id="za-setup-tab" class="clickable leftbar-tab flx flx-col flx-al-c flx-center rel" title="Zalux">
      <div class="mmi-icon-wr"><div class="z-noti-badge-container"><i class="fa fa-Privacy_24_Line internal-icon"></i></div></div>
      <div class="lb-tab-title truncate">Zalux</div>
    </div>`);
    tabEl.addEventListener('click', open);
    bottom.insertBefore(tabEl, bottom.firstChild);
    return true;
  }

  installTab();
  setInterval(() => { if (!document.getElementById('za-setup-tab')) installTab(); }, 2000);

  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'p') { e.preventDefault(); open(); }
  });
  document.addEventListener('change', async (e) => {
    const el = e.target;
    if (el instanceof HTMLInputElement && el.dataset.p && privacy) {
      try { await privacy.set({ [el.dataset.p]: el.checked }); } catch (_) {}
    }
  });
})();

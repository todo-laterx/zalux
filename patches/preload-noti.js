// ZALO LINUX NOTI THEME START
(function () {
  function apply() {
    try {
      const st = document.createElement('style');
      st.id = 'zalux-noti-theme';
      st.textContent = ':root{--layer-background:#1b2430!important;--text-primary:#dbe6f4!important;--text-secondary:#b8c7d9!important;--icon-primary:#cfe0f5!important}#zbg{background-color:#1b2430!important;color:#dbe6f4!important}#zbody,#ztitle{color:#dbe6f4!important}';
      (document.head || document.documentElement).appendChild(st);
      setTimeout(() => {
        try {
          const b = document.getElementById('zbody');
          const n = document.getElementById('zname');
          if (!(b && b.textContent.trim()) && !(n && n.textContent.trim())) window.close();
        } catch (_) {}
      }, 1200);
    } catch (_) {}
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply);
  else apply();
})();
// ZALO LINUX NOTI THEME END

// ZALO LINUX NOTI WATCHDOG START
(function () {
  // Không để notification rỗng/kẹt trên màn hình sau cuộc gọi.
  setTimeout(() => {
    try {
      const bg = document.getElementById('zbg');
      const txt = bg ? (bg.innerText || bg.textContent || '').trim() : '';
      if (!txt) window.close();
    } catch (_) {}
  }, 3000);
  setTimeout(() => { try { window.close(); } catch (_) {} }, 6000);
})();
// ZALO LINUX NOTI WATCHDOG END

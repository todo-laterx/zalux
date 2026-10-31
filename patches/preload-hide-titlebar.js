// ZALO LINUX HIDE TITLEBAR START
(function () {
  if (process.platform !== 'linux') return;
  const CSS = [
    '#titleBar{display:none!important;}',
    '#zalo-drag-strip{position:fixed;top:0;left:0;right:120px;height:8px;',
    '-webkit-app-region:drag;z-index:2147483646;background:transparent;}'
  ].join('');
  function inject() {
    if (!document.body || document.getElementById('zalo-hide-titlebar')) return;
    const st = document.createElement('style');
    st.id = 'zalo-hide-titlebar';
    st.textContent = CSS;
    document.head.appendChild(st);
    const d = document.createElement('div');
    d.id = 'zalo-drag-strip';
    document.body.appendChild(d);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', inject);
  else inject();
})();
// ZALO LINUX HIDE TITLEBAR END

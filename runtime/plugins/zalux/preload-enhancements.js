/*
 * plugins/zalux/preload-enhancements.js — Clean-room Zalux preload integration:
 *   1. Hide leftover macOS traffic-light titlebar padding on Linux
 *   2. Expose `window.zaPrivacy` and `window.zaSetup` safely
 *   3. Inject `za-setup-ui.js` into main world on `/pc-dist/index.html`
 *   4. Relay tray `za-setup:open` and renderer unread badge count (`za-badge:update`)
 */
'use strict';

(function () {
  if (typeof process === 'undefined' || process.platform !== 'linux') return;

  const fs = require('fs');
  const path = require('path');
  const { contextBridge, ipcRenderer, webFrame } = require('electron');

  const CSS = [
    '#titleBar{display:none!important;}',
    '.header-action-zone-mac{display:none!important;}',
    '.traffic-light,[class*="traffic-light"],[class*="trafficLight"]{display:none!important;}',
  ].join('');

  function injectMacTitlebarHide() {
    const root = document.head || document.documentElement;
    if (!root || document.getElementById('zalux-hide-mac-titlebar')) return;
    const style = document.createElement('style');
    style.id = 'zalux-hide-mac-titlebar';
    style.textContent = CSS;
    root.appendChild(style);
  }

  injectMacTitlebarHide();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectMacTitlebarHide);
  }

  const setupApi = {
    get: () => ipcRenderer.invoke('za-setup:get'),
    setRingtone: (file) => ipcRenderer.invoke('za-setup:set-ringtone', file),
    setNoti: (file) => ipcRenderer.invoke('za-setup:set-noti', file),
    setQuickReply: (patch) => ipcRenderer.invoke('za-setup:set-quick-reply', patch),
    updateBadge: (count) => ipcRenderer.send('za-badge:update', count),
  };

  const privacyApi = {
    get: () => ipcRenderer.invoke('za-privacy:get'),
    set: (patch) => ipcRenderer.invoke('za-privacy:set', patch),
  };

  try {
    contextBridge.exposeInMainWorld('zaSetup', setupApi);
  } catch (_) {
    window.zaSetup = setupApi;
  }

  try {
    contextBridge.exposeInMainWorld('zaPrivacy', privacyApi);
  } catch (_) {
    window.zaPrivacy = privacyApi;
  }

  if (process.env.ZALUX_DEV === '1') {
    const devEmit = (evt) => {
      try { ipcRenderer.send('zalux-dev:event', evt); } catch (_) {}
    };
    try {
      contextBridge.exposeInMainWorld('__zaluxDevEmit', devEmit);
    } catch (_) {
      window.__zaluxDevEmit = devEmit;
    }
  }

  ipcRenderer.on('za-setup:open', () => {
    try {
      if (webFrame && typeof webFrame.executeJavaScript === 'function') {
        webFrame.executeJavaScript('window.dispatchEvent(new CustomEvent("zalux:open-setup"));').catch(() => {});
      } else {
        window.dispatchEvent(new CustomEvent('zalux:open-setup'));
      }
    } catch (_) {}
  });

  function mountSetupUi() {
    try {
      if (!location.pathname.endsWith('/pc-dist/index.html')) return;
      const uiPath = path.join(__dirname, 'za-setup-ui.js');
      if (!fs.existsSync(uiPath)) return;
      const code = fs.readFileSync(uiPath, 'utf8');
      if (webFrame && typeof webFrame.executeJavaScript === 'function') {
        webFrame.executeJavaScript(code).catch(() => {});
      } else {
        const s = document.createElement('script');
        s.textContent = code;
        (document.head || document.documentElement).appendChild(s);
        s.remove();
      }
    } catch (_) {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountSetupUi);
  } else {
    mountSetupUi();
  }
})();

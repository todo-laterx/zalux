// ZALO LINUX PRIVACY API START
(function () {
  try {
    const { contextBridge, ipcRenderer } = require('electron');
    const api = {
      get: () => ipcRenderer.invoke('za-privacy:get'),
      set: (patch) => ipcRenderer.invoke('za-privacy:set', patch)
    };
    try { contextBridge.exposeInMainWorld('zaPrivacy', api); }
    catch (_) { window.zaPrivacy = api; }
  } catch (_) {}
})();
// ZALO LINUX PRIVACY API END

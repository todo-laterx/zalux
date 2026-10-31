// ZALO LINUX SETUP API START
(function () {
  try {
    const { contextBridge, ipcRenderer } = require('electron');
    const api = {
      get: () => ipcRenderer.invoke('za-setup:get'),
      setRingtone: (file) => ipcRenderer.invoke('za-setup:set-ringtone', file),
      setNoti: (file) => ipcRenderer.invoke('za-setup:set-noti', file)
    };
    try { contextBridge.exposeInMainWorld('zaSetup', api); }
    catch (_) { window.zaSetup = api; }
  } catch (_) {}
})();
// ZALO LINUX SETUP API END

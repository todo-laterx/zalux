// ZALO LINUX PRIVACY START
(function () {
  try {
    const { app, session, ipcMain } = require('electron');
    const fs = require('fs');
    const path = require('path');
    const cfgPath = path.join(app.getPath('userData'), 'za-privacy.json');
    let cfg = { blockTyping: false, blockDelivered: false, blockSeen: false };
    const load = () => { try { Object.assign(cfg, JSON.parse(fs.readFileSync(cfgPath, 'utf8'))); } catch (_) {} };
    const save = () => { try { fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2)); } catch (_) {} };
    load();
    ipcMain.handle('za-privacy:get', () => ({ ...cfg }));
    ipcMain.handle('za-privacy:set', (_e, patch) => { Object.assign(cfg, patch || {}); save(); return { ...cfg }; });
    app.whenReady().then(() => {
      const ses = session.fromPartition('persist:zalo');
      // Chỉ đăng ký đúng các endpoint trạng thái (không bắt toàn bộ request).
      const filters = { urls: [
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
        '*://*.zaloapp.com/api/group/seenv2*'
      ] };
      ses.webRequest.onBeforeRequest(filters, (d, cb) => {
        const u = d.url || '';
        if (cfg.blockTyping && /\/api\/(message|group)\/typing/.test(u)) return cb({ cancel: true });
        if (cfg.blockDelivered && /deliveredv2|\/api\/e2ee\/pc\/t\/message\/delivered/.test(u)) return cb({ cancel: true });
        if (cfg.blockSeen && /seenv2/.test(u)) return cb({ cancel: true });
        cb({ cancel: false });
      });
    });
  } catch (_) {}
})();
// ZALO LINUX PRIVACY END

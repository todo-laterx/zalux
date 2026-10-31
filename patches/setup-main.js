// ZALO LINUX SETUP START
(function () {
  try {
    const { app, ipcMain } = require('electron');
    const fs = require('fs');
    const path = require('path');
    const http = require('http');
    const soundsDir = path.join(app.getPath('home'), '.local', 'share', 'zalo-linux', 'sounds');
    const cfgPath = path.join(app.getPath('userData'), 'za-setup.json');
    let cfg = { ringtone: '', noti: '' };
    try { Object.assign(cfg, JSON.parse(fs.readFileSync(cfgPath, 'utf8'))); } catch (_) {}
    const save = () => { try { fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2)); } catch (_) {} };
    const list = (prefix) => {
      try {
        return fs.readdirSync(soundsDir)
          .filter((f) => f.startsWith(prefix) && f.endsWith('.mp3'))
          .map((f) => ({ file: f, name: f.replace(prefix, '').replace('.mp3', '').replace(/-/g, ' ') }));
      } catch (_) { return []; }
    };
    const appDir = () => path.dirname(app.getPath('exe'));
    const safe = (f) => /^[a-z0-9._-]+\.mp3$/i.test(String(f || ''));
    let port = 0;
    let readyResolve;
    const ready = new Promise((r) => { readyResolve = r; });
    const server = http.createServer((req, res) => {
      try {
        const name = path.basename(decodeURIComponent(new URL(req.url, 'http://x').pathname));
        const file = path.join(soundsDir, name);
        if (!file.startsWith(soundsDir) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
        res.writeHead(200, { 'content-type': 'audio/mpeg', 'cache-control': 'no-store' });
        fs.createReadStream(file).pipe(res);
      } catch (_) { res.writeHead(500); res.end(); }
    });
    server.listen(0, '127.0.0.1', () => { port = server.address().port; readyResolve(); });
    ipcMain.handle('za-setup:get', async () => {
      await ready;
      return { sounds: { ringtone: list('ringtone-'), noti: list('noti-') }, current: { ...cfg }, base: `http://127.0.0.1:${port}/` };
    });
    ipcMain.handle('za-setup:set-ringtone', (_e, file) => {
      if (!safe(file)) throw new Error('Tên file không hợp lệ');
      const src = path.join(soundsDir, file);
      if (!fs.existsSync(src)) throw new Error('Không tìm thấy file');
      fs.copyFileSync(src, path.join(appDir(), 'app', 'zcall-assets', 'sound', 'zalo_ringtone.mp3'));
      try { fs.copyFileSync(src, path.join(app.getPath('home'), '.local', 'share', 'zalo-linux', 'patches', 'ringtone.mp3')); } catch (_) {}
      cfg.ringtone = file; save();
      return { ...cfg };
    });
    ipcMain.handle('za-setup:set-noti', (_e, file) => {
      if (!safe(file)) throw new Error('Tên file không hợp lệ');
      const src = path.join(soundsDir, file);
      if (!fs.existsSync(src)) throw new Error('Không tìm thấy file');
      fs.copyFileSync(src, path.join(soundsDir, 'custom-noti.mp3'));
      cfg.noti = file; save();
      return { ...cfg };
    });
  } catch (_) {}
})();
// ZALO LINUX SETUP END

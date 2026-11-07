/*
 * plugins/zcall/bridge.js — Clean-room minimal Electron BrowserWindow bridge for zcall-engine.
 *
 * Responsibilities (strictly UI hosting & IPC routing):
 *   1. Listen on 127.0.0.1:0 (NDJSON + binary video frames) and export
 *      ZCALL_UI_PORT, ZCALL_UI_TOKEN, and ZALO_USER_DATA for zcall-engine.
 *   2. Host BrowserWindows for ui/incoming.html and ui/call.html.
 *   3. Forward UI actions, audio/sound queries, and video frames to/from Rust zcall-engine.
 *
 * Audio device enumeration, zcall-devices.json persistence, and sound URL resolution
 * live inside crates/zcall-engine/src/devices.rs.
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const path = require('path');
const { app, BrowserWindow, desktopCapturer, ipcMain, screen, session } = require('electron');

const UI_DIR = path.join(__dirname, 'ui');
const CALL_HTML = path.join(UI_DIR, 'call.html');
const INCOMING_HTML = path.join(UI_DIR, 'incoming.html');

function resolveAssetsDir() {
  const rawBase = path.resolve(__dirname, '..', '..');
  const candidates = [
    process.resourcesPath ? path.join(process.resourcesPath, 'app.asar.unpacked', 'zcall-assets') : '',
    rawBase.includes('app.asar') && !rawBase.includes('app.asar.unpacked')
      ? path.join(rawBase.replace('app.asar', 'app.asar.unpacked'), 'zcall-assets')
      : '',
    path.join(rawBase, 'zcall-assets'),
    process.resourcesPath ? path.join(process.resourcesPath, 'zcall-assets') : '',
  ];
  for (const dir of candidates) {
    if (dir && fs.existsSync(dir)) return dir;
  }
  return path.join(rawBase, 'zcall-assets');
}

function findMainAppWindow() {
  try {
    let fallbackWin = null;
    for (const win of BrowserWindow.getAllWindows()) {
      if (!isAlive(win) || win === callWin || win === incomingWin || win.__zaluxCallWindow) continue;
      if (win.__zaloSharedWorker) continue;
      const title = (typeof win.getTitle === 'function' && win.getTitle()) || '';
      if (title === 'Shared Worker') continue;
      const url = (win.webContents && typeof win.webContents.getURL === 'function' && win.webContents.getURL()) || '';
      if (url.includes('shared-worker.html') || url.includes('/plugins/zcall/ui/')) continue;
      if (url.includes('index.html')) return win;
      if (!fallbackWin) fallbackWin = win;
    }
    return fallbackWin;
  } catch (_) {}
  return null;
}

function focusMainAppWindow() {
  try {
    const win = findMainAppWindow();
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  } catch (_) {}
}

function getTargetWorkArea() {
  try {
    const mainWin = findMainAppWindow();
    if (mainWin && !mainWin.isMinimized()) {
      const disp = screen.getDisplayMatching(mainWin.getBounds());
      if (disp && disp.workArea) return disp.workArea;
    }
  } catch (_) {}
  try {
    const cursor = screen.getCursorScreenPoint();
    const disp = screen.getDisplayNearestPoint(cursor);
    if (disp && disp.workArea) return disp.workArea;
  } catch (_) {}
  try {
    const prim = screen.getPrimaryDisplay();
    if (prim && prim.workArea) return prim.workArea;
  } catch (_) {}
  return null;
}

function centeredBounds(width, height) {
  const w = Math.round(Number(width) || 420);
  const h = Math.round(Number(height) || 580);
  const area = getTargetWorkArea();
  if (!area || !area.width || !area.height) {
    return { width: w, height: h };
  }
  return {
    width: w,
    height: h,
    x: Math.round(area.x + Math.max(0, (area.width - w) / 2)),
    y: Math.round(area.y + Math.max(0, (area.height - h) / 2)),
  };
}

function centerWindowOnTarget(win, width, height) {
  if (!isAlive(win)) return;
  try {
    const b = centeredBounds(width, height);
    if (typeof b.x === 'number' && typeof b.y === 'number') {
      win.setBounds(b, false);
    } else {
      win.center();
    }
  } catch (_) {
    try { win.center(); } catch (__) {}
  }
}

const GROUP_LAYOUT = (() => {
  try {
    return require(path.join(__dirname, 'ui', 'group-layout.js'));
  } catch (_) {
    return null;
  }
})();
let callUserResized = false;
let callProgrammaticUntil = 0;

// ---- Co giãn cửa sổ theo hướng video đối phương (mobile dọc ↔ ngang), có transition mượt ----
const FIT_ANIM_MS = 340;
const FIT_LANDSCAPE = { width: 860, height: 560 };
const FIT_TALL_MIN_W = 420; // đủ chỗ cho thanh 6 nút điều khiển
const FIT_TALL_MAX_H = 780;
const FIT_CHROME_H = 70; // titlebar + khung hệ thống (ước lượng) trừ khỏi chiều cao để tính tỷ lệ stage
let callFitTimer = null;

function fitSizeForVideo(w, h) {
  const vw = Number(w);
  const vh = Number(h);
  if (!(vw > 0 && vh > 0)) return null;
  const area = getTargetWorkArea();
  const maxW = Math.floor((area && area.width ? area.width : 1366) * 0.94);
  const maxH = Math.floor((area && area.height ? area.height : 768) * 0.94);
  const aspect = vw / vh;
  if (aspect >= 1.15) {
    return {
      width: Math.min(FIT_LANDSCAPE.width, maxW),
      height: Math.min(FIT_LANDSCAPE.height, maxH),
    };
  }
  const height = Math.max(480, Math.min(FIT_TALL_MAX_H, maxH));
  const width = Math.max(
    FIT_TALL_MIN_W,
    Math.min(FIT_LANDSCAPE.width, maxW, Math.round((height - FIT_CHROME_H) * aspect))
  );
  return { width, height };
}

function cancelFitAnimation() {
  if (callFitTimer) {
    clearInterval(callFitTimer);
    callFitTimer = null;
  }
}

function animateCallWindowTo(win, size, ms) {
  if (!isAlive(win) || !size) return;
  cancelFitAnimation();
  const from = win.getBounds();
  const area = getTargetWorkArea();
  const cx = from.x + from.width / 2;
  const cy = from.y + from.height / 2;
  let tx = Math.round(cx - size.width / 2);
  let ty = Math.round(cy - size.height / 2);
  if (area && area.width && area.height) {
    tx = Math.max(area.x, Math.min(tx, area.x + area.width - size.width));
    ty = Math.max(area.y, Math.min(ty, area.y + area.height - size.height));
  }
  const to = { x: tx, y: ty, width: size.width, height: size.height };
  if (from.x === to.x && from.y === to.y && from.width === to.width && from.height === to.height) return;

  const duration = Math.max(0, Number(ms) || FIT_ANIM_MS);
  callProgrammaticUntil = Date.now() + duration + 250;
  const t0 = Date.now();
  // easeOutQuint ≈ cubic-bezier(0.23, 1, 0.32, 1) dùng trong call.css
  const ease = (p) => 1 - Math.pow(1 - p, 5);
  const lerp = (a, b, e) => Math.round(a + (b - a) * e);
  const step = () => {
    if (!isAlive(win) || win.isFullScreen() || win.isMaximized() || callWinCompact) {
      cancelFitAnimation();
      return;
    }
    const p = duration === 0 ? 1 : Math.min(1, (Date.now() - t0) / duration);
    const e = ease(p);
    try {
      win.setBounds(
        {
          x: lerp(from.x, to.x, e),
          y: lerp(from.y, to.y, e),
          width: lerp(from.width, to.width, e),
          height: lerp(from.height, to.height, e),
        },
        false
      );
    } catch (_) {
      cancelFitAnimation();
      return;
    }
    if (p >= 1) cancelFitAnimation();
  };
  step();
  if (duration > 0 && callFitTimer === null && Date.now() - t0 < duration) {
    callFitTimer = setInterval(step, 16);
  }
}

let started = false;
let tcpServer = null;
let engineSocket = null;
let uiToken = '';
let lastDevicesPayload = null;

let callWin = null;
let callWinReady = false;
// Callback chờ của getDisplayMedia: main giữ, renderer (call.html) hiện hộp chọn
// màn hình rồi trả sourceId qua 'zcall-ui-pick-screen-done'. Hủy khi đóng cửa sổ.
let pendingDisplayMediaCallback = null;

function denyPendingDisplayMedia() {
  const cb = pendingDisplayMediaCallback;
  pendingDisplayMediaCallback = null;
  if (typeof cb === 'function') {
    try { cb({}); } catch (_) {}
  }
}
let callWinPendingState = null;
let callWinVideoMode = false;
let callWinCompact = false;
let pendingVideoFrames = [];
let callSavedBounds = null;
let callWasMaximized = false;
let programmaticCloseCall = false;

let incomingWin = null;
let incomingWinReady = false;
let incomingPendingState = null;
let programmaticCloseIncoming = false;

let currentState = null;
let lastClosedCallId = '';
let localCloseCooldownUntil = 0;
let closeTimer = null;
let reqCounter = 1;
const pendingQueries = new Map();

function clearCloseTimer() {
  if (closeTimer) {
    clearTimeout(closeTimer);
    closeTimer = null;
  }
}

function closeLocalCallNow() {
  if (currentState && currentState.callId) {
    lastClosedCallId = String(currentState.callId);
  }
  localCloseCooldownUntil = Date.now() + 800;
  currentState = null;
  destroyIncomingWindow();
  destroyCallWindow();
}

function sendToEngine(obj) {
  if (!engineSocket || engineSocket.destroyed) return false;
  try {
    engineSocket.write(JSON.stringify(obj) + '\n');
    return true;
  } catch (_) {
    return false;
  }
}

function queryEngine(actionName, fallbackValue, timeoutMs = 900) {
  return new Promise((resolve) => {
    const reqId = reqCounter++;
    const timer = setTimeout(() => {
      pendingQueries.delete(reqId);
      resolve(fallbackValue);
    }, timeoutMs);
    pendingQueries.set(reqId, { resolve, timer });
    if (!sendToEngine({ action: actionName, reqId })) {
      clearTimeout(timer);
      pendingQueries.delete(reqId);
      resolve(fallbackValue);
    }
  });
}

function resolveEngineReply(reqId, data) {
  const entry = pendingQueries.get(reqId);
  if (!entry) return;
  clearTimeout(entry.timer);
  pendingQueries.delete(reqId);
  entry.resolve(data);
}

function flushPendingQueries() {
  for (const [, entry] of pendingQueries) {
    clearTimeout(entry.timer);
    entry.resolve(null);
  }
  pendingQueries.clear();
}

function isAlive(win) {
  return Boolean(win && !win.isDestroyed() && win.webContents && !win.webContents.isDestroyed());
}

function destroyIncomingWindow() {
  incomingPendingState = null;
  incomingWinReady = false;
  if (!incomingWin) return;
  const win = incomingWin;
  incomingWin = null;
  if (!win.isDestroyed()) {
    win.__programmaticClose = true;
    try { win.hide(); } catch (_) {}
    try { win.webContents.send('zcall-incoming-stop'); } catch (_) {}
    setImmediate(() => {
      if (!win.isDestroyed()) {
        programmaticCloseIncoming = true;
        try { win.destroy(); } catch (_) {}
        programmaticCloseIncoming = false;
      }
    });
  }
}

function destroyCallWindow() {
  denyPendingDisplayMedia();
  clearCloseTimer();
  callWinPendingState = null;
  callWinReady = false;
  callWinVideoMode = false;
  callWinCompact = false;
  pendingVideoFrames = [];
  callSavedBounds = null;
  if (!callWin) return;
  const win = callWin;
  callWin = null;
  if (!win.isDestroyed()) {
    win.__programmaticClose = true;
    try {
      if (win.isFullScreen()) win.setFullScreen(false);
      win.setAlwaysOnTop(false);
      win.hide();
    } catch (_) {}
    setImmediate(() => {
      if (!win.isDestroyed()) {
        programmaticCloseCall = true;
        try { win.destroy(); } catch (_) {}
        programmaticCloseCall = false;
      }
    });
  }
}

function scheduleCallWindowClose(delayMs) {
  clearCloseTimer();
  closeTimer = setTimeout(() => {
    closeTimer = null;
    destroyIncomingWindow();
    destroyCallWindow();
    currentState = null;
  }, delayMs);
}

function ensureIncomingWindow(stateObj) {
  incomingPendingState = stateObj;
  if (isAlive(incomingWin)) {
    if (incomingWinReady) {
      incomingWin.webContents.send('zcall-incoming-state', stateObj);
    }
    return;
  }

  const initBounds = centeredBounds(368, 276);

  incomingWinReady = false;
  const createdIncoming = new BrowserWindow({
    width: initBounds.width,
    height: initBounds.height,
    x: initBounds.x,
    y: initBounds.y,
    center: true,
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: false,
    show: false,
    backgroundColor: '#151c26',
    title: 'Zalux — Cuộc gọi đến',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      backgroundThrottling: false,
    },
  });
  incomingWin = createdIncoming;
  createdIncoming.__zaluxCallWindow = true;
  createdIncoming.setMenu(null);
  createdIncoming.webContents.on('will-navigate', (e) => e.preventDefault());
  createdIncoming.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  createdIncoming.webContents.once('did-finish-load', () => {
    if (incomingWin !== createdIncoming || !isAlive(createdIncoming)) return;
    incomingWinReady = true;
    if (incomingPendingState) {
      createdIncoming.webContents.send('zcall-incoming-state', incomingPendingState);
    }
    centerWindowOnTarget(createdIncoming, 368, 276);
    createdIncoming.show();
  });

  createdIncoming.on('close', function () {
    if (!this.__programmaticClose && !programmaticCloseIncoming && incomingWin === createdIncoming && currentState && currentState.phase === 'incoming') {
      if (currentState.callId) lastClosedCallId = String(currentState.callId);
      localCloseCooldownUntil = Date.now() + 800;
      sendToEngine({ action: 'reject' });
      currentState = null;
    }
  });

  createdIncoming.on('closed', () => {
    if (incomingWin === createdIncoming) {
      incomingWin = null;
      incomingWinReady = false;
    }
  });

  const assetsDir = resolveAssetsDir();
  createdIncoming.loadFile(INCOMING_HTML, assetsDir ? { query: { assets: assetsDir } } : undefined).catch((err) => {
    console.error('[zcall] failed to load incoming.html:', err);
  });
}

function upgradeCallWindowToVideo() {
  if (!isAlive(callWin) || callWinVideoMode) return;
  callWinVideoMode = true;
  if (!callWinCompact && !callWin.isFullScreen() && !callWin.isMaximized()) {
    centerWindowOnTarget(callWin, 860, 560);
  }
}

function ensureCallWindow(stateObj) {
  clearCloseTimer();
  callWinPendingState = stateObj;
  const isVideo = Boolean(stateObj && (stateObj.video || stateObj.group));
  if (isAlive(callWin)) {
    if (isVideo) upgradeCallWindowToVideo();
    if (callWinReady) {
      callWin.webContents.send('zcall-ui-state', stateObj);
    }
    return;
  }

  const targetW = isVideo ? 860 : 420;
  const targetH = isVideo ? 560 : 580;
  const initBounds = centeredBounds(targetW, targetH);

  callWinVideoMode = isVideo;
  callWinCompact = false;
  callWinReady = false;
  callSavedBounds = null;
  const createdCall = new BrowserWindow({
    width: initBounds.width,
    height: initBounds.height,
    x: initBounds.x,
    y: initBounds.y,
    center: true,
    minWidth: 320,
    minHeight: 220,
    frame: true,
    autoHideMenuBar: true,
    show: false,
    backgroundColor: '#11161d',
    title: 'Zalux Call',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      backgroundThrottling: false,
    },
  });
  callWin = createdCall;
  createdCall.__zaluxCallWindow = true;
  createdCall.setMenu(null);
  createdCall.webContents.on('will-navigate', (e) => e.preventDefault());
  createdCall.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  callUserResized = false;
  callProgrammaticUntil = Date.now() + 2500; // WM có thể bắn 'resize' khi hiện cửa sổ — không tính là người dùng kéo
  createdCall.on('resize', () => {
    if (callWin === createdCall && Date.now() > callProgrammaticUntil) callUserResized = true;
  });

  createdCall.on('enter-full-screen', () => {
    if (callWin === createdCall && isAlive(createdCall)) createdCall.webContents.send('zcall-ui-fullscreen', true);
  });
  createdCall.on('leave-full-screen', () => {
    if (callWin === createdCall && isAlive(createdCall)) createdCall.webContents.send('zcall-ui-fullscreen', false);
  });
  createdCall.on('maximize', () => {
    if (callWin === createdCall && isAlive(createdCall)) createdCall.webContents.send('zcall-ui-maximized', true);
  });
  createdCall.on('unmaximize', () => {
    if (callWin === createdCall && isAlive(createdCall)) createdCall.webContents.send('zcall-ui-maximized', false);
  });

  createdCall.webContents.once('did-finish-load', () => {
    if (callWin !== createdCall || !isAlive(createdCall)) return;
    callWinReady = true;
    if (callWinPendingState) {
      createdCall.webContents.send('zcall-ui-state', callWinPendingState);
    }
    if (pendingVideoFrames.length > 0) {
      const queued = pendingVideoFrames;
      pendingVideoFrames = [];
      for (const frame of queued) {
        createdCall.webContents.send('zcall-ui-video', frame);
      }
    } else if (callWinPendingState && (callWinPendingState.video || callWinPendingState.group)) {
      sendToEngine({ action: 'needkey', why: 'window-ready' });
    }
    if (!callWinCompact && !createdCall.isFullScreen() && !createdCall.isMaximized()) {
      centerWindowOnTarget(createdCall, callWinVideoMode ? 860 : 420, callWinVideoMode ? 560 : 580);
    }
    createdCall.show();
    createdCall.focus();
  });

  createdCall.on('close', function () {
    if (!this.__programmaticClose && !programmaticCloseCall && callWin === createdCall && currentState && currentState.phase !== 'ended') {
      if (currentState.callId) lastClosedCallId = String(currentState.callId);
      localCloseCooldownUntil = Date.now() + 800;
      sendToEngine({ action: 'hangup' });
      currentState = null;
    }
  });

  createdCall.on('closed', () => {
    if (callWin === createdCall) {
      cancelFitAnimation();
      callWin = null;
      callWinReady = false;
      callWinVideoMode = false;
      callWinCompact = false;
      pendingVideoFrames = [];
      callSavedBounds = null;
    }
  });

  const assetsDir = resolveAssetsDir();
  createdCall.loadFile(CALL_HTML, assetsDir ? { query: { assets: assetsDir } } : undefined).catch((err) => {
    console.error('[zcall] failed to load call.html:', err);
  });
}

function handleEngineMessage(msg, binaryPayload) {
  if (!msg || typeof msg !== 'object') return;

  switch (msg.type) {
    case 'devices':
      resolveEngineReply(msg.reqId, msg.data || {});
      return;

    case 'sounds':
      resolveEngineReply(msg.reqId, msg.data || {});
      return;

    case 'video':
      if (!currentState || currentState.phase === 'ended') return;
      if (binaryPayload) {
        const frameMsg = {
          codec: msg.codec || 'avc1.42E01F',
          key: Boolean(msg.key || msg.keyframe),
          w: Number(msg.w) || 0,
          h: Number(msg.h) || 0,
          src: msg.src || '',
          data: binaryPayload,
        };
        upgradeCallWindowToVideo();
        if (isAlive(callWin) && callWinReady) {
          callWin.webContents.send('zcall-ui-video', frameMsg);
        } else if (frameMsg.codec === 'rgba' || frameMsg.key) {
          pendingVideoFrames = [frameMsg];
        } else if (pendingVideoFrames.length > 0 && pendingVideoFrames.length < 24) {
          pendingVideoFrames.push(frameMsg);
        }
      }
      return;

    case 'keyframe':
      if (isAlive(callWin) && callWinReady) {
        callWin.webContents.send('zcall-ui-keyframe');
      }
      return;

    case 'speaking':
      if (isAlive(callWin) && callWinReady) {
        callWin.webContents.send('zcall-ui-speaking', msg);
      }
      return;

    case 'micLevel':
      if (isAlive(callWin) && callWinReady) {
        callWin.webContents.send('zcall-ui-mic-level', msg.level || 0);
      }
      return;

    case 'state': {
      const msgCallId = msg.callId ? String(msg.callId) : '';
      if (msg.phase === 'ended') {
        destroyIncomingWindow();
        if (isAlive(callWin) && callWinReady) {
          const mergedEnd = Object.assign({}, currentState || {}, msg);
          currentState = mergedEnd;
          callWin.webContents.send('zcall-ui-state', mergedEnd);
          scheduleCallWindowClose(350);
        } else {
          destroyCallWindow();
          currentState = null;
        }
        return;
      }
      if (msgCallId && lastClosedCallId && msgCallId === lastClosedCallId) {
        return;
      }
      if (!msgCallId && !currentState && Date.now() < localCloseCooldownUntil && msg.phase !== 'incoming' && msg.phase !== 'outgoing') {
        return;
      }
      if (msgCallId && msgCallId !== lastClosedCallId) {
        localCloseCooldownUntil = 0;
      }
      const normalizedMsg = Object.assign({}, msg, {
        text: typeof msg.text === 'string' ? msg.text : '',
      });
      const merged = Object.assign({}, currentState || {}, normalizedMsg);
      if (currentState && currentState.camStartOff && msg.phase !== 'outgoing') {
        merged.camStartOff = true;
      }
      currentState = merged;
      if (merged.phase === 'incoming') {
        ensureIncomingWindow(merged);
      } else {
        destroyIncomingWindow();
        ensureCallWindow(merged);
      }
      return;
    }

    case 'close': {
      destroyIncomingWindow();
      const text = msg.text || 'Cuộc gọi đã kết thúc';
      const holdRaw = Number(msg.holdMs);
      const hold = holdRaw > 0 ? Math.min(holdRaw, 10000) : 0;
      if (isAlive(callWin) && callWinReady) {
        const endState = Object.assign({}, currentState || {}, {
          phase: 'ended',
          text,
        });
        currentState = endState;
        callWin.webContents.send('zcall-ui-state', endState);
        scheduleCallWindowClose(hold > 0 ? hold : 350);
      } else if (hold > 0) {
        // Thông báo cần giữ lại (vd. "chưa hỗ trợ tham gia nhóm") nhưng cửa sổ chưa sẵn sàng
        // (hoặc chưa có): dựng/giữ cửa sổ, state ended sẽ được gửi ngay khi trang load xong.
        const endState = Object.assign({}, currentState || {}, {
          phase: 'ended',
          text,
        });
        currentState = endState;
        ensureCallWindow(endState);
        scheduleCallWindowClose(hold + 700);
      } else {
        destroyCallWindow();
        currentState = null;
      }
      return;
    }

    case 'screenNative':
      if (isAlive(callWin) && callWinReady) {
        callWin.webContents.send('zcall-ui-screen-native', {
          ok: Boolean(msg.ok),
          error: typeof msg.error === 'string' ? msg.error.slice(0, 200) : '',
        });
      }
      return;

    default:
      return;
  }
}

function createChunkQueue() {
  const chunks = [];
  let headOff = 0;
  let totalLen = 0;

  return {
    get length() {
      return totalLen;
    },
    push(buf) {
      if (!buf || buf.length === 0) return;
      chunks.push(buf);
      totalLen += buf.length;
    },
    indexOfByte(byteVal, maxScan) {
      const limit = maxScan > 0 ? Math.min(totalLen, maxScan) : totalLen;
      let scanned = 0;
      for (let i = 0; i < chunks.length; i++) {
        const c = chunks[i];
        const start = i === 0 ? headOff : 0;
        const avail = c.length - start;
        const toScan = Math.min(avail, limit - scanned);
        if (toScan <= 0) break;
        const idx = c.indexOf(byteVal, start);
        if (idx >= start && idx < start + toScan) {
          return scanned + (idx - start);
        }
        scanned += toScan;
        if (scanned >= limit) break;
      }
      return -1;
    },
    readBytes(n) {
      if (n <= 0) return Buffer.alloc(0);
      if (totalLen < n) return null;
      const first = chunks[0];
      if (first.length - headOff >= n) {
        const sub = first.subarray(headOff, headOff + n);
        headOff += n;
        totalLen -= n;
        if (headOff >= first.length) {
          chunks.shift();
          headOff = 0;
        }
        return sub;
      }
      const out = Buffer.allocUnsafe(n);
      let written = 0;
      while (written < n && chunks.length > 0) {
        const c = chunks[0];
        const avail = c.length - headOff;
        const take = Math.min(avail, n - written);
        c.copy(out, written, headOff, headOff + take);
        written += take;
        headOff += take;
        totalLen -= take;
        if (headOff >= c.length) {
          chunks.shift();
          headOff = 0;
        }
      }
      return out;
    },
  };
}

function toStandaloneUint8(buf) {
  if (buf.byteOffset === 0 && buf.byteLength === buf.buffer.byteLength) {
    return new Uint8Array(buf.buffer, 0, buf.byteLength);
  }
  const copy = new Uint8Array(buf.byteLength);
  copy.set(buf);
  return copy;
}

function handleSocket(sock) {
  sock.setNoDelay(true);
  let authed = false;
  const rxQ = createChunkQueue();
  let pendingBinMsg = null;

  sock.on('data', (chunk) => {
    rxQ.push(chunk);

    while (rxQ.length > 0) {
      if (!authed) {
        const nl = rxQ.indexOfByte(10, 4096);
        if (nl < 0) {
          if (rxQ.length > 4096) sock.destroy();
          return;
        }
        const tokenBuf = rxQ.readBytes(nl);
        rxQ.readBytes(1);
        const tokenLine = tokenBuf.toString('utf8').replace(/\r$/, '');
        if (tokenLine !== uiToken) {
          sock.destroy();
          return;
        }
        authed = true;
        engineSocket = sock;
        continue;
      }

      if (pendingBinMsg) {
        const needed = pendingBinMsg.bin;
        if (rxQ.length < needed) return;
        const rawFrame = rxQ.readBytes(needed);
        const frameBytes = toStandaloneUint8(rawFrame);
        const hdr = pendingBinMsg;
        pendingBinMsg = null;
        handleEngineMessage(hdr, frameBytes);
        continue;
      }

      const nl = rxQ.indexOfByte(10, 8 * 1024 * 1024);
      if (nl < 0) {
        if (rxQ.length > 8 * 1024 * 1024) sock.destroy();
        return;
      }
      const lineBuf = rxQ.readBytes(nl);
      rxQ.readBytes(1);
      const lineStr = lineBuf.toString('utf8').trim();
      if (!lineStr) continue;

      let parsed;
      try {
        parsed = JSON.parse(lineStr);
      } catch (_) {
        continue;
      }

      const binLen = Number(parsed && parsed.bin) || 0;
      if (binLen > 0 && binLen <= 8 * 1024 * 1024) {
        pendingBinMsg = parsed;
        continue;
      }
      handleEngineMessage(parsed, null);
    }
  });

  sock.on('close', () => {
    if (engineSocket === sock) {
      engineSocket = null;
      flushPendingQueries();
      if (currentState && currentState.phase !== 'ended') {
        handleEngineMessage({ type: 'close', text: 'Đã kết thúc' }, null);
      }
    }
  });

  sock.on('error', () => {});
}

function registerIpcHandlers() {
  ipcMain.on('zcall-incoming-answer', (_event, payload) => {
    const camStartOff = Boolean(payload && payload.camStartOff);
    destroyIncomingWindow();
    const nextState = Object.assign({}, currentState || {}, {
      phase: 'connecting',
      text: 'Đang kết nối…',
      camStartOff,
    });
    currentState = nextState;
    ensureCallWindow(nextState);
    sendToEngine({ action: 'accept', camStartOff });
  });

  // Lấy webpack require chỉ đọc từ window.webpackJsonp (không phụ thuộc dev-inspector).
  const GET_WEBPACK_REQ_EXPR = `(() => {
    if (window.__zaluxWebpackRequire && window.__zaluxWebpackRequire.c) return window.__zaluxWebpackRequire;
    const wp = window.webpackJsonp;
    if (!Array.isArray(wp) || typeof wp.push !== 'function') return null;
    let req = null;
    try {
      const modId = '__zalux_wp_' + Date.now();
      wp.push([[999998], { [modId]: function (_e, _t, r) { req = r; } }, [[modId]]]);
    } catch (_) {}
    if (req && req.c) window.__zaluxWebpackRequire = req;
    return (req && req.c) ? req : null;
  })()`;

  const DEFAULT_QUICK_REPLIES = [
    'Anh/em đang bận chút, lát gọi lại nhé!',
    'Đang trong cuộc họp, nhắn tin giúp mình nhé.',
    'Hiện không tiện nghe máy, có việc gì gấp không ạ?',
    'Đang ngoài đường ồn quá, lát về mình gọi lại nha.',
  ];

  function readQuickReplyConfig() {
    try {
      const cfgPath = path.join(app.getPath('userData'), 'za-setup.json');
      if (fs.existsSync(cfgPath)) {
        const parsed = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
        const qr = parsed && parsed.quickReply;
        if (qr && typeof qr === 'object') {
          const enabled = qr.enabled !== undefined ? Boolean(qr.enabled) : true;
          const items = Array.isArray(qr.items)
            ? qr.items.map((s) => String(s || '').trim().slice(0, 160)).filter(Boolean).slice(0, 5)
            : [...DEFAULT_QUICK_REPLIES];
          return { enabled, items };
        }
      }
    } catch (_) {}
    return { enabled: true, items: [...DEFAULT_QUICK_REPLIES] };
  }

  function sendQuickReplyToCaller(peerId, peerName, replyText) {
    const cleanText = String(replyText || '').trim();
    if (!cleanText) return;
    const mainWin = findMainAppWindow();
    if (!mainWin || !isAlive(mainWin)) return;
    const code = `(async () => {
      try {
        const req = ${GET_WEBPACK_REQ_EXPR};
        if (!req) return { error: 'no-webpack' };
        let targetId = ${JSON.stringify(String(peerId || '').trim())};
        const targetName = ${JSON.stringify(String(peerName || '').trim())};
        const msgText = ${JSON.stringify(cleanText)};

        if (!targetId && targetName) {
          const matchName = (s) => typeof s === 'string' && s.trim() === targetName;
          try {
            const jwy6Mod = req.c['JWY6'] && req.c['JWY6'].exports;
            const jwy6 = jwy6Mod && (jwy6Mod.a || jwy6Mod.default || jwy6Mod);
            if (jwy6) {
              if (!targetId && jwy6._aliasName && typeof jwy6._aliasName === 'object') {
                for (const uid of Object.keys(jwy6._aliasName)) {
                  const al = jwy6._aliasName[uid];
                  if (matchName(al) || (al && matchName(al.alias || al.aliasName))) {
                    targetId = String(uid);
                    break;
                  }
                }
              }
              if (!targetId && jwy6._cacheProfileInfo && typeof jwy6._cacheProfileInfo === 'object') {
                for (const uid of Object.keys(jwy6._cacheProfileInfo)) {
                  const info = jwy6._cacheProfileInfo[uid];
                  if (info && (matchName(info.displayName) || matchName(info.zaloName) || matchName(info.dName) || matchName(info.zName))) {
                    targetId = String(info.userId || uid);
                    break;
                  }
                }
              }
            }
          } catch (_) {}

          if (!targetId) {
            try {
              const kibvMod = req.c['kibv'] && req.c['kibv'].exports;
              const kibv = kibvMod && (kibvMod.a || kibvMod.default || kibvMod);
              const convs = kibv && kibv.convsList;
              if (Array.isArray(convs)) {
                for (const c of convs) {
                  if (c && !c.isGroup && (matchName(c.displayName) || matchName(c.dName) || matchName(c.zName))) {
                    targetId = String(c.convId || c.userId || '');
                    if (targetId) break;
                  }
                }
              }
            } catch (_) {}
          }

          if (!targetId) {
            try {
              for (const modKey of Object.keys(req.c || {})) {
                const m = req.c[modKey] && req.c[modKey].exports;
                if (!m) continue;
                for (const cand of [m, m.a, m.default]) {
                  if (!cand || typeof cand !== 'object') continue;
                  const profMap = cand._cacheProfileInfo || cand._cacheMiniInfo || cand._cacheProfile || cand.cacheInfoSearch;
                  if (profMap && typeof profMap === 'object') {
                    for (const k of Object.keys(profMap)) {
                      const info = profMap[k];
                      if (info && (matchName(info.displayName) || matchName(info.zaloName) || matchName(info.dName) || matchName(info.zName) || matchName(info.name))) {
                        targetId = String(info.userId || info.id || k);
                        break;
                      }
                    }
                  }
                  if (targetId) break;
                }
                if (targetId) break;
              }
            } catch (_) {}
          }
        }

        if (!targetId) return { error: 'no-target-id', targetName };

        // Tìm root component (#app-page) để gửi ngầm tin nhắn mà KHÔNG chuyển đổi hay đụng vào hội thoại đang mở trên UI
        let rootComp = null;
        try {
          const appPage = document.getElementById('app-page');
          if (appPage) {
            for (const k of Object.keys(appPage)) {
              if (k.startsWith('__reactInternalInstance') || k.startsWith('__reactFiber')) {
                let cur = appPage[k];
                while (cur) {
                  if (cur.stateNode && cur.stateNode.mainChatboxController) {
                    rootComp = cur.stateNode;
                    break;
                  }
                  cur = cur.return;
                }
                break;
              }
            }
          }
        } catch (_) {}

        if (rootComp && rootComp.mainChatboxController) {
          const ctrl = rootComp.mainChatboxController;
          try {
            const weMod = req('UiPd');
            const we = weMod && (weMod.default || weMod.a || weMod);
            let convObj = we && typeof we.getProfileFriendSync === 'function' ? we.getProfileFriendSync(String(targetId)) : null;
            if (!convObj && rootComp.storage && typeof rootComp.storage.getConversation === 'function') {
              try {
                convObj = await rootComp.storage.getConversation(String(targetId));
              } catch (_) {}
            }
            if (!convObj || typeof convObj !== 'object') {
              convObj = { userId: String(targetId), displayName: targetName || String(targetId), isGroup: false };
            } else if (!convObj.userId) {
              convObj = Object.assign({}, convObj, { userId: String(targetId) });
            }

            // Ưu tiên 1: Khởi tạo trực tiếp MessageObject + _showLocalMessage + sendMsgObject + _sentMessage
            // Giúp gửi hoàn toàn ngầm qua API/WS, lưu SQLite/IndexedDB + cập nhật Sidebar mà không đóng popup/menu hay đụng tới khung chat đang mở
            if (typeof ctrl._showLocalMessage === 'function' && typeof ctrl._sentMessage === 'function') {
              const B = req('4HQc');
              const L = req('1pet');
              const pMod = req('z0WU');
              const p = pMod && (pMod.default || pMod.a || pMod);
              const idGenMod = req('NMlV');
              const idGen = idGenMod && (idGenMod.a || idGenMod.default || idGenMod);
              const hMod = req('dThN');
              const h = hMod && (hMod.default || hMod.a || hMod);
              const AMod = req('GpwQ');
              const e2eeInst = AMod && AMod.a && typeof AMod.a.instance === 'function' ? AMod.a.instance() : null;
              const myUid = (ctrl.user && ctrl.user.userId) || (rootComp.props && rootComp.props.user && rootComp.props.user.userId) || '';

              if (B && typeof B.c === 'function' && B.a && p && typeof p.getMsgIdSendingFromCliMsgId === 'function' && idGen && typeof idGen.next === 'function' && h && typeof h.sendMsgObject === 'function' && myUid) {
                const cliMsgId = idGen.next();
                const msgId = p.getMsgIdSendingFromCliMsgId(cliMsgId);
                const msgTextType = (L && L.MSG_TEXT) || 1;
                const msgObj = new B.c(String(myUid), String(targetId), msgId, cliMsgId, msgTextType, false);
                const isE2ee = Boolean(e2eeInst && typeof e2eeInst.isOnE2ee === 'function' && e2eeInst.isOnE2ee(String(targetId)));
                if (isE2ee && L && L.MSG_E2EE) {
                  msgObj.e2eeStatus = L.MSG_E2EE;
                }
                msgObj.updateMessageContentProp(B.a.TEXT, msgText);
                try {
                  const kt = req('NWd+');
                  if (kt && typeof kt.a === 'function') {
                    kt.a().addJustAddedMessage(String(targetId), { fromUid: '0', toUid: String(targetId), cliMsgId, src: 'just-sent' });
                  }
                } catch (_) {}
                try {
                  const Yt = req('HvYi');
                  if (Yt && Yt.a && typeof Yt.a.getInstance === 'function') {
                    Yt.a.getInstance().cacheFromLocalMessageObjectIfNeeded(msgObj);
                  }
                } catch (_) {}

                ctrl._showLocalMessage(msgObj, convObj);
                const doSend = () => h.sendMsgObject(
                  msgObj,
                  null,
                  null,
                  (L && L.RETRY_MSG_TIMEOUT_DEFAULT) || undefined,
                  false,
                  { shouldParseLinkOrContact: false }
                ).then((resp) => {
                  ctrl._sentMessage(msgObj, resp);
                  return resp;
                });

                if (isE2ee && e2eeInst && typeof e2eeInst.sendMessageE2ee === 'function') {
                  await e2eeInst.sendMessageE2ee(String(targetId), msgObj.msgId, doSend);
                } else {
                  await doSend();
                }
                return { ok: true, via: 'bg-sendMsgObject', targetId, cliMsgId };
              }
            }

            // Ưu tiên 2: Gọi _sendMessage với shouldOpenConv=false, clearBox=false, clearSuggest=false, shouldFocus=false
            if (typeof ctrl._sendMessage === 'function') {
              const L = req('1pet');
              const msgTextType = (L && L.MSG_TEXT) || 1;
              await ctrl._sendMessage(convObj, msgTextType, msgText, false, null, null, false, null, false, false, false);
              return { ok: true, via: 'bg-_sendMessage', targetId };
            }
          } catch (_) {}
        }

        try {
          const fbup = req('fBUP');
          const nmlv = req('NMlV');
          const api = fbup && (fbup.default || fbup.a || fbup);
          const idGen = nmlv && (nmlv.a || nmlv.default || nmlv);
          if (api && typeof api.sendZText === 'function' && idGen && typeof idGen.next === 'function') {
            api.sendZText(targetId, msgText, false, idGen.next());
            return { ok: true, via: 'sendZText', targetId };
          }
        } catch (_) {}

        return { error: 'no-sender', targetId };
      } catch (e) {
        return { error: String((e && e.message) || e) };
      }
    })()`;
    mainWin.webContents.executeJavaScript(code, true).catch(() => {});
  }

  ipcMain.on('zcall-ui-action', (_event, payload) => {
    if (!payload || typeof payload !== 'object') return;
    const isGroupCall = Boolean(currentState && currentState.group);
    const peerId = String(
      payload.peerId ||
      (!isGroupCall && currentState && (currentState.peerId || currentState.uidN || currentState.fromId)) ||
      ''
    );
    const peerName = String(
      payload.peerName ||
      (!isGroupCall && currentState && currentState.name) ||
      ''
    );
    const quickReply = payload.action === 'reject' && typeof payload.quickReply === 'string'
      ? payload.quickReply.trim()
      : '';
    sendToEngine(payload);
    if (payload.action === 'reject' || payload.action === 'hangup') {
      closeLocalCallNow();
      if (quickReply && !isGroupCall) {
        sendQuickReplyToCaller(peerId, peerName, quickReply);
      }
    }
  });

  // Cuộc gọi nhóm: co giãn cửa sổ theo số người (mượt), trừ khi người dùng đã tự kéo cỡ cửa sổ.
  ipcMain.on('zcall-ui-fit-group', (event, payload) => {
    if (!isAlive(callWin) || !payload || typeof payload !== 'object' || !GROUP_LAYOUT) return;
    if (event && event.sender && event.sender !== callWin.webContents) return;
    if (callWinCompact || callWin.isFullScreen() || callWin.isMaximized() || callUserResized) return;
    const count = Math.floor(Number(payload.count));
    if (!(count >= 1 && count <= 200)) return;
    const size = GROUP_LAYOUT.windowSizeForCount(count, getTargetWorkArea());
    animateCallWindowTo(callWin, size, FIT_ANIM_MS);
  });

  ipcMain.on('zcall-ui-fit', (event, dims) => {
    if (!isAlive(callWin) || !dims || typeof dims !== 'object') return;
    if (event && event.sender && event.sender !== callWin.webContents) return;
    if (callWinCompact || callWin.isFullScreen() || callWin.isMaximized()) return;
    const size = fitSizeForVideo(dims.w, dims.h);
    if (size) animateCallWindowTo(callWin, size, FIT_ANIM_MS);
  });

  // Mở/đưa cửa sổ Zalo chính lên để dùng luồng thêm thành viên nhóm của Zalo.
  ipcMain.on('zcall-ui-show-group', (event) => {
    if (!isAlive(callWin) || event.sender !== callWin.webContents) return;
    focusMainAppWindow();
  });

  // Lấy danh sách **thành viên nhóm** (kèm avatar) từ cửa sổ Zalo chính
  // để mời thêm vào cuộc gọi nhóm đang diễn ra.
  ipcMain.handle('zcall-ui-group-friends', async (event, payload) => {
    if (!isAlive(callWin) || event.sender !== callWin.webContents) return { error: 'forbidden' };
    const mainWin = findMainAppWindow();
    if (!mainWin || !isAlive(mainWin)) return { error: 'no-main-window' };
    const convId = String((payload && payload.convId) || '');
    if (!convId) return { error: 'bad-request' };
    const code = `(async () => {
      try {
        const req = ${GET_WEBPACK_REQ_EXPR};
        if (!req) return { error: 'no-webpack', members: [] };
        let store = window.__zaluxGroupStore;
        let users = window.__zaluxUserStore;
        if (!users || typeof users.getMiniInfo !== 'function') {
          for (const id of ['UiPd']) {
            try {
              const m = req.c[id] && req.c[id].exports;
              const c = m && (m.a || m.default || m);
              if (c && typeof c.getMiniInfo === 'function') { users = c; break; }
            } catch (e) {}
          }
        }
        if (!store || !store._cacheGroupInfo || !users || typeof users.getMiniInfo !== 'function') {
          const keys = Object.keys(req.c || {});
          const started = Date.now();
          for (let i = 0; i < keys.length; i++) {
            let m = null;
            try { m = req.c[keys[i]] && req.c[keys[i]].exports; } catch (e) {}
            if (m) {
              const cands = [m, m.a, m.default];
              for (let j = 0; j < cands.length; j++) {
                const c = cands[j];
                if (!c || typeof c !== 'object') continue;
                if (!store && c._cacheGroupInfo) store = c;
                if (!users && typeof c.getMiniInfo === 'function') users = c;
              }
            }
            if (store && users) break;
            if (Date.now() - started > 2500) break;
          }
        }
        if (!store || !store._cacheGroupInfo) return { error: 'no-group-cache', members: [] };
        window.__zaluxGroupStore = store;
        if (users && typeof users.getMiniInfo === 'function') window.__zaluxUserStore = users;
        const conv = ${JSON.stringify(convId.replace(/^g/, ''))};
        const g = store._cacheGroupInfo[${JSON.stringify(convId)}]
          || store._cacheGroupInfo['g' + conv]
          || store._cacheGroupInfo[conv];
        if (!g) return { error: 'group-not-cached', members: [] };
        const ids = g.memberIds || g.memberIdsCache || (g.member && g.member.ids) || [];
        const out = [];
        const mini = (users && typeof users.getMiniInfo === 'function') ? users.getMiniInfo.bind(users) : null;
        for (const rawId of ids) {
          const id = String(rawId);
          let info = null;
          try { info = mini ? mini(id) : null; } catch (e) {}
          out.push({
            id,
            name: (info && (info.zName || info.dName || info.displayName)) || '',
            avatar: (info && info.avatar) || '',
          });
        }
        return { members: out, total: ids.length };
      } catch (e) { return { error: String(e && e.message || e), members: [] }; }
    })()`;
    try {
      const res = await mainWin.webContents.executeJavaScript(code, true);
      return res || { error: 'empty', members: [] };
    } catch (err) {
      return { error: String(err && err.message || err), members: [] };
    }
  });

  // Phân giải uid ngắn -> uid dài + tên/avatar cho thành viên mới vào cuộc gọi nhóm.
  ipcMain.handle('zcall-ui-resolve-users', async (event, payload) => {
    if (!isAlive(callWin) || event.sender !== callWin.webContents) return { error: 'forbidden', users: [] };
    const mainWin = findMainAppWindow();
    if (!mainWin || !isAlive(mainWin)) return { error: 'no-main-window', users: [] };
    const convId = String((payload && payload.convId) || '').replace(/^g/, '');
    const shortIds = Array.isArray(payload && payload.shortIds) ? payload.shortIds.map(String) : [];
    if (!convId || !shortIds.length) return { error: 'bad-request', users: [] };
    const code = `(async () => {
      try {
        const req = ${GET_WEBPACK_REQ_EXPR};
        if (!req) return { error: 'no-webpack', users: [] };
        let api = null, users = null;
        const tryMod = (id) => {
          try {
            const m = req.c[id] && req.c[id].exports;
            const c = m && (m.a || m.default || m);
            if (!api && c && typeof c.getNoisedUids === 'function') api = c;
            if (!users && c && typeof c.getMiniInfo === 'function') users = c;
          } catch (e) {}
        };
        tryMod('dThN'); tryMod('UiPd');
        if (!api || !users) {
          const keys = Object.keys(req.c || {});
          for (let i = 0; i < keys.length; i++) {
            tryMod(keys[i]);
            if (api && users) break;
          }
        }
        if (!api || typeof api.getNoisedUids !== 'function') return { error: 'no-noised-api', users: [] };
        const res = await api.getNoisedUids(${JSON.stringify(shortIds)}, [${JSON.stringify(convId)}]);
        const longs = (res && res.fids) || [];
        const out = [];
        for (let i = 0; i < ${JSON.stringify(shortIds)}.length; i++) {
          const short = ${JSON.stringify(shortIds)}[i];
          const long = longs[i] ? String(longs[i]) : '';
          let info = null;
          try { info = (users && typeof users.getMiniInfo === 'function') ? users.getMiniInfo(long) : null; } catch (e) {}
          out.push({
            short: short,
            long: long,
            name: (info && (info.zName || info.dName || info.displayName)) || '',
            avatar: (info && info.avatar) || '',
          });
        }
        return { users: out };
      } catch (e) { return { error: String(e && e.message || e), users: [] }; }
    })()`;
    try {
      const res = await mainWin.webContents.executeJavaScript(code, true);
      return res || { error: 'empty', users: [] };
    } catch (err) {
      return { error: String(err && err.message || err), users: [] };
    }
  });

  // Mời thành viên vào nhóm qua API nội bộ Zalo (đúng luồng Zalo PC dùng).
  ipcMain.handle('zcall-ui-group-invite', async (event, payload) => {
    if (!isAlive(callWin) || event.sender !== callWin.webContents) return { error: 'forbidden' };
    const mainWin = findMainAppWindow();
    if (!mainWin || !isAlive(mainWin)) return { error: 'no-main-window' };
    const convId = String((payload && payload.convId) || '');
    const members = Array.isArray(payload && payload.members) ? payload.members.map(String) : [];
    if (!convId || !members.length) return { error: 'bad-request' };
    const code = `(async () => {
      try {
        const req = ${GET_WEBPACK_REQ_EXPR};
        if (!req) return { error: 'no-webpack' };
        const keys = Object.keys(req.c || {});
        for (let i = 0; i < keys.length; i++) {
          let m = null;
          try { m = req.c[keys[i]] && req.c[keys[i]].exports; } catch (e) {}
          if (!m) continue;
          try {
            if (typeof m.inviteMember === 'function') {
              const res = await m.inviteMember(${JSON.stringify(convId)}, ${JSON.stringify(members)});
              return { ok: true, result: res || null };
            }
            if (m.default && typeof m.default.inviteMember === 'function') {
              const res = await m.default.inviteMember(${JSON.stringify(convId)}, ${JSON.stringify(members)});
              return { ok: true, result: res || null };
            }
          } catch (e) {
            return { error: String(e && e.message || e) };
          }
        }
        return { error: 'no-invite-api' };
      } catch (e) { return { error: String(e && e.message || e) }; }
    })()`;
    try {
      const res = await mainWin.webContents.executeJavaScript(code, true);
      return res || { error: 'empty' };
    } catch (err) {
      return { error: String(err && err.message || err) };
    }
  });

  ipcMain.on('zcall-ui-window', (_event, op) => {
    if (!isAlive(callWin)) return;
    switch (op) {
      case 'minimize':
        callWin.minimize();
        break;
      case 'compact':
        callWinCompact = true;
        if (callWin.isFullScreen()) callWin.setFullScreen(false);
        callWasMaximized = callWin.isMaximized();
        if (callWasMaximized) {
          callWin.unmaximize();
        } else if (!callSavedBounds) {
          callSavedBounds = callWin.getBounds();
        }
        callWin.setAlwaysOnTop(true);
        callWin.setSize(320, 220, true);
        callWin.webContents.send('zcall-ui-compact', true);
        break;
      case 'expand':
        callWinCompact = false;
        callWin.setAlwaysOnTop(false);
        if (callWasMaximized) {
          callWasMaximized = false;
          callWin.maximize();
        } else if (callSavedBounds) {
          callWin.setBounds(callSavedBounds, true);
          callSavedBounds = null;
        } else {
          centerWindowOnTarget(callWin, callWinVideoMode ? 860 : 420, callWinVideoMode ? 560 : 580);
        }
        callWin.webContents.send('zcall-ui-compact', false);
        break;
      case 'maximize':
        callWinCompact = false;
        if (callWin.isFullScreen()) callWin.setFullScreen(false);
        callWin.setAlwaysOnTop(false);
        callWin.webContents.send('zcall-ui-compact', false);
        callWin.maximize();
        break;
      case 'unmaximize':
        if (callWin.isFullScreen()) callWin.setFullScreen(false);
        callWin.unmaximize();
        break;
      case 'toggle-maximize':
        if (callWin.isFullScreen()) {
          callWin.setFullScreen(false);
        } else if (callWin.isMaximized()) {
          callWin.unmaximize();
        } else {
          callWin.setAlwaysOnTop(false);
          callWin.webContents.send('zcall-ui-compact', false);
          callWin.maximize();
        }
        break;
      case 'fullscreen':
        callWin.setAlwaysOnTop(false);
        callWin.webContents.send('zcall-ui-compact', false);
        callWin.setFullScreen(true);
        break;
      case 'leave-fullscreen':
        callWin.setFullScreen(false);
        break;
      case 'focus-main':
        focusMainAppWindow();
        break;
      case 'close':
        if (currentState && currentState.phase !== 'ended') {
          sendToEngine({ action: 'hangup' });
        }
        closeLocalCallNow();
        break;
      default:
        break;
    }
  });

  ipcMain.handle('zcall-ui-devices', async () => {
    const res = await queryEngine('queryDevices', null, 900);
    if (res) lastDevicesPayload = res;
    // Engine chưa trả lời kịp: dùng bản cache gần nhất để menu không bị trống/treo.
    return res || lastDevicesPayload || { mics: [], speakers: [], defaultMic: '', defaultSpeaker: '', prefs: {}, micVolume: 100 };
  });

  ipcMain.handle('zcall-ui-sounds', async () => {
    const res = await queryEngine('querySounds', null);
    return res || {};
  });

  try { ipcMain.removeHandler('zcall-ui-quick-replies'); } catch (_) {}
  ipcMain.handle('zcall-ui-quick-replies', async () => {
    return readQuickReplyConfig();
  });

  ipcMain.handle('zcall-ui-screen-source', async () => {
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 1, height: 1 },
    });
    if (!sources || sources.length === 0) {
      throw new Error('Không tìm thấy màn hình để chia sẻ');
    }
    const screenSrc = sources.find((s) => String(s.id).startsWith('screen:')) || sources[0];
    return screenSrc.id;
  });

  // Danh sách màn hình/cửa sổ kèm thumbnail cho hộp chọn trong call.html.
  ipcMain.handle('zcall-ui-screen-sources', async () => {
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 320, height: 200 },
      fetchWindowIcons: false,
    });
    return (sources || []).map((s) => {
      const id = String(s.id || '');
      return {
        id,
        name: s.name || id,
        screen: id.startsWith('screen:'),
        thumb: (s.thumbnail && !s.thumbnail.isEmpty())
          ? s.thumbnail.toDataURL()
          : '',
      };
    });
  });

  // Renderer đã chọn xong màn hình cho getDisplayMedia đang chờ.
  ipcMain.on('zcall-ui-pick-screen-done', (_event, sourceId) => {
    const cb = pendingDisplayMediaCallback;
    pendingDisplayMediaCallback = null;
    if (typeof cb !== 'function') return;
    try {
      if (sourceId) cb({ video: String(sourceId) });
      else cb({});
    } catch (_) {}
  });
}

function setupMediaPermissions() {
  const LOCAL_PERMS = new Set([
    'media',
    'audioCapture',
    'videoCapture',
    'display-capture',
    'desktopCapture',
    'speaker-selection',
    'notifications',
    'clipboard-read',
    'clipboard-sanitized-write',
    'fullscreen',
  ]);
  const SAFE_WEB_PERMS = new Set(['notifications', 'clipboard-sanitized-write', 'fullscreen']);
  const checkAllowed = (webContents, permission, reqUrl) => {
    const url = String(reqUrl || (webContents && webContents.getURL && webContents.getURL()) || '');
    if (url.startsWith('file://')) return LOCAL_PERMS.has(permission);
    if (/^https:\/\/([a-z0-9-]+\.)*(zalo\.me|zadn\.vn|zdn\.vn)(\/|$)/i.test(url)) {
      return SAFE_WEB_PERMS.has(permission);
    }
    return false;
  };
  try {
    const ses = session.defaultSession;
    if (!ses) return;
    ses.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
      return checkAllowed(webContents, permission, requestingOrigin);
    });
    ses.setPermissionRequestHandler((webContents, permission, callback, details) => {
      const reqUrl = details && details.requestingUrl;
      callback(checkAllowed(webContents, permission, reqUrl));
    });
    // Electron không tự hiện hộp chọn cho getDisplayMedia: main phải giữ callback
    // và nhờ call.html hiện hộp chọn (kèm thumbnail nhiều màn), rồi hoàn tất.
    // NOTE Electron 22: chỉ truyền handler (không kèm opts); request có thể không
    // có webContents nên không ép khớp — call.html là nơi duy nhất gọi API này.
    try {
      ses.setDisplayMediaRequestHandler((request, callback) => {
        try {
          if (!isAlive(callWin) || !callWinReady) return callback({});
          pendingDisplayMediaCallback = callback;
          callWin.webContents.send('zcall-ui-pick-screen');
        } catch (_) {
          try { callback({}); } catch (_) {}
        }
      });
    } catch (_) {}
  } catch (_) {}
}

function start() {
  if (started) {
    return Promise.resolve(Number(process.env.ZCALL_UI_PORT || 0));
  }
  started = true;

  try {
    process.env.ZALO_USER_DATA = app.getPath('userData');
  } catch (_) {}

  uiToken = crypto.randomBytes(16).toString('hex');
  process.env.ZCALL_UI_TOKEN = uiToken;

  setupMediaPermissions();
  registerIpcHandlers();

  return new Promise((resolve) => {
    tcpServer = net.createServer(handleSocket);
    tcpServer.on('error', (err) => {
      console.error('[zcall] UI bridge TCP error:', err);
      resolve(0);
    });
    tcpServer.listen(0, '127.0.0.1', () => {
      const addr = tcpServer.address();
      const port = addr && typeof addr === 'object' ? addr.port : 0;
      if (port) {
        process.env.ZCALL_UI_PORT = String(port);
      }
      resolve(port);
    });
  });
}

module.exports = {
  start,
  _test: {
    centeredBounds,
    fitSizeForVideo,
    fitSizeForGroup: (n) => (GROUP_LAYOUT ? GROUP_LAYOUT.windowSizeForCount(n, getTargetWorkArea()) : null),
    isUserResized: () => callUserResized,
    animateCallWindowTo,
    FIT_ANIM_MS,
    getTargetWorkArea,
    getWindows: () => ({ incomingWin, callWin }),
    getCurrentState: () => currentState,
  },
};

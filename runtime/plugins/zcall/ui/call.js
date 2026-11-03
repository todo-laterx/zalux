/*
 * plugins/zcall/ui/call.js
 *
 * Call window page. Receives the call state from ../bridge.js over IPC,
 * renders it and sends the user's actions back. Also captures the camera or
 * the screen with getUserMedia and encodes H.264 with WebCodecs (Annex-B
 * frames, as the engine expects); peer H.264 frames are decoded with
 * WebCodecs and drawn on #peerVideo.
 *
 * IPC (bridge.js):
 *   main -> ui  zcall-ui-state, zcall-ui-keyframe, zcall-ui-speaking,
 *               zcall-ui-mic-level, zcall-ui-video, zcall-ui-fullscreen,
 *               zcall-ui-compact
 *   ui -> main  zcall-ui-action, zcall-ui-window, zcall-ui-devices (invoke),
 *               zcall-ui-sounds (invoke), zcall-ui-screen-source (invoke)
 */
'use strict';

(function () {
  var ipc = null;
  try { ipc = require('electron').ipcRenderer; } catch (_) { /* not Electron */ }

  var A = window.ZCallAssets || {
    iconUrl: function () { return ''; },
    avatar: function (src) { return src || ''; },
    sound: function () { return ''; },
  };

  function $(id) { return document.getElementById(id); }

  var el = {
    app: $('app'),
    brandIcon: $('brandIcon'),
    windowTitle: $('windowTitle'),
    titleStatus: $('titleStatus'),
    peerVideo: $('peerVideo'),
    peerBackdrop: $('peerBackdrop'),
    peerFallback: $('peerFallback'),
    peerAvatar: $('peerAvatar'),
    peerCamOff: $('peerCamOff'),
    peerMicOff: $('peerMicOff'),
    peerMicOffText: $('peerMicOffText'),
    selfPip: $('selfPip'),
    selfVideo: $('selfVideo'),
    groupGrid: $('groupGrid'),
    btnGroupView: $('btnGroupView'),
    groupPager: $('groupPager'),
    btnPagePrev: $('btnPagePrev'),
    btnPageNext: $('btnPageNext'),
    pageLabel: $('pageLabel'),
    speakingBadge: $('speakingBadge'),
    btnMembers: $('btnMembers'),
    membersPop: $('membersPop'),
    membersList: $('membersList'),
    membersCount: $('membersCount'),
    membersClose: $('membersClose'),
    membersAdd: $('membersAdd'),
    membersAddView: $('membersAddView'),
    membersAddLabel: $('membersAddLabel'),
    friendsList: $('friendsList'),
    membersPicked: $('membersPicked'),
    membersBack: $('membersBack'),
    membersSearch: $('membersSearch'),
    membersInvite: $('membersInvite'),
    peerName: $('peerName'),
    phaseText: $('phaseText'),
    timer: $('timer'),
    btnMic: $('btnMic'),
    btnSpeaker: $('btnSpeaker'),
    btnCamera: $('btnCamera'),
    btnScreen: $('btnScreen'),
    btnDevices: $('btnDevices'),
    btnHangup: $('btnHangup'),
    btnCompact: $('btnCompact'),
    btnFullscreen: $('btnFullscreen'),
    btnMenuClose: $('btnMenuClose'),
    deviceMenu: $('deviceMenu'),
    micList: $('micList'),
    speakerList: $('speakerList'),
    cameraList: $('cameraList'),
    micVolume: $('micVolume'),
    micVolumeValue: $('micVolumeValue'),
    micMeter: $('micMeter'),
    toast: $('toast'),
    screenPicker: $('screenPicker'),
    screenPickerList: $('screenPickerList'),
    btnScreenPickerClose: $('btnScreenPickerClose'),
  };

  var state = {};
  var phase = 'idle';
  var prevPhase = 'idle';
  var connectedAt = 0;
  var endedAt = 0;
  var timerId = null;

  var local = {
    micOn: true,
    speakerOn: true,
    cameraOn: false,
    screenOn: false,
    screenNative: false,
    screenAwaitNative: false,
    compact: false,
    maximized: false,
    fullscreen: false,
    callInit: false,
    cameraWasOn: false,
    micId: '',
    speakerId: '',
    cameraId: '',
    devices: null,
    cameras: [],
    speaking: {},
  };

  var sounds = {};
  var soundEls = {};
  var toastTimer = null;
  var micVolumeTimer = null;
  var micVolumeLast = -1;

  function icon(url) { return A.iconUrl(url); }

  var SVG_ICONS = {
    mic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="2" width="6" height="11" rx="3"/><path d="M5 10a7 7 0 0 0 14 0"/><line x1="12" y1="17" x2="12" y2="21"/><line x1="8" y1="21" x2="16" y2="21"/></svg>',
    mic_off: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="2" y1="2" x2="22" y2="22"/><path d="M18.89 13.23A7.12 7.12 0 0 0 19 10"/><path d="M5 10a7 7 0 0 0 12 5"/><path d="M15 9.34V5a3 3 0 0 0-5.68-1.33"/><path d="M9 9v1a3 3 0 0 0 5.12 2.12"/><line x1="12" y1="17" x2="12" y2="21"/><line x1="8" y1="21" x2="16" y2="21"/></svg>',
    speaker: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>',
    speaker_off: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="22" y1="9" x2="16" y2="15"/><line x1="16" y1="9" x2="22" y2="15"/></svg>',
    camera: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="6" width="14" height="12" rx="2.5"/><path d="M16 10.5l6-3.5v10l-6-3.5v-3z"/></svg>',
    camera_off: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="2" y1="2" x2="22" y2="22"/><path d="M10.66 6H14a2 2 0 0 1 2 2v2.34l1 .58L22 8v8"/><path d="M16 16a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h2"/></svg>',
    screen: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/><polyline points="9 10 12 7 15 10"/><line x1="12" y1="7" x2="12" y2="13"/></svg>',
    settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.08a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.08a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
    hangup: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 9c-3.9 0-7.43 1.44-10.14 3.81-.38.33-.42.9-.08 1.28l2.14 2.4c.31.35.84.4 1.21.12.88-.67 1.86-1.2 2.91-1.57.42-.15.7-.54.7-.99V11.6c1.05-.35 2.17-.54 3.26-.54s2.21.19 3.26.54v2.45c0 .45.28.84.7.99 1.05.37 2.03.9 2.91 1.57.37.28.9.23 1.21-.12l2.14-2.4c.34-.38.3-.95-.08-1.28C19.43 10.44 15.9 9 12 9z"/></svg>',
    minimize: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12"/></svg>',
    compact: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/></svg>',
    expand: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>',
    maximize: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>',
    restore: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="8" width="12" height="12" rx="1.8"/><path d="M8 8V5.8A1.8 1.8 0 0 1 9.8 4h8.4A1.8 1.8 0 0 1 20 5.8v8.4a1.8 1.8 0 0 1-1.8 1.8H16"/></svg>',
    fullscreen: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>',
    fullscreen_exit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3v3a2 2 0 0 1-2 2H3"/><path d="M21 8h-3a2 2 0 0 1-2-2V3"/><path d="M3 16h3a2 2 0 0 1 2 2v3"/><path d="M16 21v-3a2 2 0 0 1 2-2h3"/></svg>',
  };

  function setIcon(button, name) {
    if (!button) return;
    var holder = button.hasAttribute('data-svg') ? button : button.querySelector('[data-svg]');
    if (!holder) return;
    if (holder.getAttribute('data-svg') === name && holder.firstChild) return;
    holder.setAttribute('data-svg', name);
    holder.innerHTML = SVG_ICONS[name] || '';
  }

  function send(msg) {
    if (!ipc) return;
    try { ipc.send('zcall-ui-action', msg); } catch (_) { /* main gone */ }
  }

  function sendWindow(op) {
    if (!ipc) return;
    try { ipc.send('zcall-ui-window', op); } catch (_) { /* main gone */ }
  }

  // Hướng video đối phương (mobile dọc / ngang): đổi hướng → class body + yêu cầu main co giãn cửa sổ mượt.
  var orient = '';
  var orientCand = '';
  var orientCandN = 0;
  var orientSwitchTimer = null;
  var ORIENT_COMMIT_FRAMES = 3;
  var backdropCtx = null;
  var backdropLastAt = 0;

  function orientOf(w, h) {
    return (w / h) < 1.15 ? 'tall' : 'wide';
  }

  function noteVideoOrientation(w, h) {
    if (!(w > 0 && h > 0)) return;
    var o = orientOf(w, h);
    if (o === orient) { orientCand = ''; orientCandN = 0; return; }
    if (o !== orientCand) { orientCand = o; orientCandN = 0; }
    orientCandN += 1;
    if (orient && orientCandN < ORIENT_COMMIT_FRAMES) return;
    var changed = Boolean(orient);
    orient = o;
    orientCand = '';
    orientCandN = 0;
    document.body.classList.toggle('vid-tall', o === 'tall');
    document.body.classList.toggle('vid-wide', o === 'wide');
    if (changed) {
      document.body.classList.add('orient-switching');
      if (orientSwitchTimer) clearTimeout(orientSwitchTimer);
      orientSwitchTimer = setTimeout(function () {
        document.body.classList.remove('orient-switching');
      }, 360);
    }
    // Cuộc gọi nhóm: cỡ cửa sổ do số người quyết định (`zcall-ui-fit-group`),
    // không co giãn theo hướng camera của một người — nếu không cửa sổ sẽ bị
    // kéo thành dọc đúng bằng tỉ lệ điện thoại và lưới thừa đệm trên/dưới.
    if (!ipc || state.group) return;
    try { ipc.send('zcall-ui-fit', { w: w, h: h, orient: o }); } catch (_) { /* main gone */ }
  }

  function resetVideoOrientation() {
    orient = '';
    orientCand = '';
    orientCandN = 0;
    if (orientSwitchTimer) { clearTimeout(orientSwitchTimer); orientSwitchTimer = null; }
    document.body.classList.remove('vid-tall', 'vid-wide', 'orient-switching');
  }

  function paintBackdrop(src, sw, sh) {
    var bd = el.peerBackdrop;
    if (!bd) return;
    var now = Date.now();
    if (now - backdropLastAt < 90) return; // ~11 fps là đủ cho nền mờ
    backdropLastAt = now;
    var bw = sw >= sh ? 48 : Math.max(8, Math.round(48 * sw / sh));
    var bh = sw >= sh ? Math.max(8, Math.round(48 * sh / sw)) : 48;
    if (bd.width !== bw || bd.height !== bh) {
      bd.width = bw;
      bd.height = bh;
      backdropCtx = null;
    }
    if (!backdropCtx) backdropCtx = bd.getContext('2d', { alpha: false });
    if (!backdropCtx) return;
    try { backdropCtx.drawImage(src, 0, 0, bw, bh); } catch (_) { /* ignore */ }
  }

  function invoke(channel, payload) {
    if (!ipc) return Promise.reject(new Error('no ipc'));
    return payload === undefined ? ipc.invoke(channel) : ipc.invoke(channel, payload);
  }

  function toast(text) {
    if (!el.toast) return;
    el.toast.textContent = text;
    el.toast.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.toast.classList.add('hidden');
    }, 2600);
  }

  function errorText(err) {
    return err && err.message ? err.message : String(err);
  }

  /* ------------------------------------------------------------- state */

  function defaultText(p) {
    switch (p) {
      case 'outgoing': return 'Đang gọi…';
      case 'incoming': return 'Cuộc gọi đến';
      case 'connecting': return 'Đang kết nối…';
      case 'connected': return state.group ? 'Cuộc gọi nhóm' : '';
      case 'ended': return 'Đã kết thúc';
      default: return 'Đang chờ cuộc gọi…';
    }
  }

  function sinceMs(s) {
    var v = s && s.since;
    if (v == null) return 0;
    if (typeof v === 'number') {
      if (v > 1e12) return v;               // epoch ms
      if (v > 1e9) return v * 1000;         // epoch seconds
      if (v > 0) return Date.now() - v;     // duration already elapsed
      return 0;
    }
    var t = Date.parse(v);
    return isNaN(t) ? 0 : t;
  }

  function formatTime(ms) {
    var sec = Math.max(0, Math.floor(ms / 1000));
    var h = Math.floor(sec / 3600);
    var m = Math.floor((sec % 3600) / 60);
    var s = sec % 60;
    function two(n) { return (n < 10 ? '0' : '') + n; }
    return h > 0 ? h + ':' + two(m) + ':' + two(s) : two(m) + ':' + two(s);
  }

  function renderTimer() {
    if (!el.timer) return;
    var p = phase;
    if (p !== 'connected' && p !== 'ended') {
      el.timer.classList.add('hidden');
      renderTitleStatus('');
      return;
    }
    var end = p === 'ended' ? (endedAt || Date.now()) : Date.now();
    var start = connectedAt || sinceMs(state);
    if (!start) start = end;
    var text = formatTime(end - start);
    el.timer.textContent = text;
    el.timer.classList.remove('hidden');
    renderTitleStatus(text);
    refreshPeerTiles();
  }

  /// Peer tắt cam: sau 1,2 s không còn frame thì trả ô về avatar + trạng thái
  /// (không để khung hình cuối đứng im). Chạy theo nhịp đồng hồ cuộc gọi.
  function refreshPeerTiles() {
    if (!state.group || !el.groupGrid || !group.members.length) return;
    var now = Date.now();
    for (var i = 0; i < group.members.length; i++) {
      var m = group.members[i];
      if (isSelfMember(m)) continue;
      var tile = group.tiles[String(m.id)];
      if (!tile || !tile.classList.contains('has-peer-video')) continue;
      var seen = group.peerVideoAtById[String(m.id)];
      if (m.video === false && (!seen || now - seen > 1200)) {
        var r = { x: tile.offsetLeft, y: tile.offsetTop, w: tile.offsetWidth, h: tile.offsetHeight };
        placeTile(m, r, { focus: tile.classList.contains('focus') });
      }
    }
  }

  function renderTitleStatus(timeText) {
    var holder = el.titleStatus;
    if (!holder) return;
    holder.textContent = '';
    // Badge xanh: chấm + trạng thái ngắn + đồng hồ (không lặp sau tên).
    var label = shortPhaseLabel();
    if (!label && !timeText) return;
    var dot = document.createElement('span');
    dot.className = 'ts-dot';
    if (phase !== 'connected') dot.style.background = 'var(--muted)';
    holder.appendChild(dot);
    if (label) {
      var t = document.createElement('span');
      t.className = 'ts-label';
      t.textContent = label;
      holder.appendChild(t);
    }
    if (timeText) {
      var tm = document.createElement('span');
      tm.className = 'ts-time';
      tm.textContent = timeText;
      holder.appendChild(tm);
    }
  }

  function shortPhaseLabel() {
    switch (phase) {
      case 'incoming': return 'Đang gọi đến';
      case 'outgoing': return 'Đang gọi';
      case 'connecting': return 'Đang kết nối';
      case 'connected': return state.group ? 'Cuộc gọi nhóm' : 'Đang gọi';
      case 'ended': return 'Đã kết thúc';
      default: return '';
    }
  }

  function renderWindowTitle() {
    if (!el.windowTitle) return;
    var name = String(state.name || '').trim() || 'Zalux';
    el.windowTitle.textContent = name;
  }

  function startTimer() {
    if (!timerId) timerId = setInterval(renderTimer, 1000);
    renderTimer();
  }

  function stopTimer() {
    if (timerId) clearInterval(timerId);
    timerId = null;
    renderTitleStatus('');
  }

  function avatarUrl(src) {
    return A.avatar(src) || icon('zalo_logo.png');
  }

  function applyState(s) {
    if (!s || typeof s !== 'object') return;
    prevPhase = phase;
    state = s;
    phase = s.phase || phase;

    if (prevPhase !== phase) {
      document.body.classList.remove('phase-' + prevPhase);
      document.body.classList.add('phase-' + phase);
    } else if (!document.body.classList.contains('phase-' + phase)) {
      document.body.classList.add('phase-' + phase);
    }

    var videoMode = !!(s.video || s.group);
    document.body.classList.toggle('video', videoMode || local.screenOn);
    document.body.classList.toggle('group', !!s.group);

    if (el.peerName) el.peerName.textContent = s.name || 'Zalux';
    if (el.phaseText) {
      var statusTxt = s.text || defaultText(phase);
      el.phaseText.textContent = statusTxt;
      el.phaseText.classList.toggle('hidden', !statusTxt);
    }
    if (el.peerAvatar) el.peerAvatar.src = avatarUrl(s.avatar);
    renderWindowTitle();

    document.title = s.name ? ('Zalux Call - ' + s.name) : 'Zalux Call';

    local.micOn = !s.muted;
    local.speakerOn = !s.speakerOff;
    if (phase === 'incoming' || phase === 'ended') {
      local.callInit = false;
      if (phase === 'ended') {
        local.cameraOn = false;
        local.screenOn = false;
        local.cameraWasOn = false;
        gotFrame = false;
        hasRxKey = false;
        closeDecoder();
        resetVideoOrientation();
        group.view = 'gallery';
        group.page = 0;
        group.pinned = null;
        group.lastSpeaker = null;
        document.body.classList.remove('has-video');
      }
    }
    if (!local.callInit && (phase === 'outgoing' || phase === 'connecting' || phase === 'connected')) {
      local.cameraOn = videoMode && !s.camStartOff;
      local.callInit = true;
    }
    if (prevPhase !== 'connected' && phase === 'connected') {
      forceKey = true;
    }

    if (phase === 'connected') {
      if (!connectedAt) connectedAt = sinceMs(s) || Date.now();
      startTimer();
    } else if (phase === 'ended') {
      endedAt = Date.now();
      if (!connectedAt) connectedAt = sinceMs(s) || 0;
      renderTimer();
      stopTimer();
    } else {
      connectedAt = 0;
      stopTimer();
    }

    if (s.peerCamOff) document.body.classList.remove('has-video');
    updatePeerFallback();
    updateButtons();
    manageMedia();
    updateSounds(prevPhase, phase);
    updateBadge();

    if (s.group) renderGroup();
    else if (group.members.length) clearGroup();
  }

  function updatePeerFallback() {
    if (el.peerCamOff) el.peerCamOff.classList.toggle('hidden', !state.peerCamOff);
    if (!state.peerCamOff && gotFrame) document.body.classList.add('has-video');
  }

  function updateBadge() {
    if (el.peerMicOff) {
      var showPeerMuted = Boolean(state.peerMuted) && phase !== 'ended' && phase !== 'idle';
      el.peerMicOff.classList.toggle('hidden', !showPeerMuted);
      if (el.peerMicOffText) {
        var who = String(state.name || '').trim() || 'Đối phương';
        el.peerMicOffText.textContent = who + ' đang tắt mic';
      }
    }
    if (!el.speakingBadge) return;
    var text = '';
    if (state.peerSharing) text = 'Đang chia sẻ màn hình';
    else if (!state.group && !state.peerMuted && local.speaking.__one) text = 'Đang nói';
    if (!text) { el.speakingBadge.classList.add('hidden'); return; }
    el.speakingBadge.textContent = text;
    el.speakingBadge.classList.remove('hidden');
  }

  /* ------------------------------------------------------------ buttons */

  function currentSpeakerLabel() {
    var d = local.devices || {};
    var speakers = Array.isArray(d.speakers) ? d.speakers : [];
    var activeId = local.speakerId || d.defaultSpeaker || '';
    for (var i = 0; i < speakers.length; i++) {
      if (speakers[i] && speakers[i].id === activeId) {
        return speakers[i].label || speakers[i].id;
      }
    }
    return activeId;
  }

  function updateButtons() {
    if (el.btnMic) {
      el.btnMic.classList.toggle('off', !local.micOn);
      setIcon(el.btnMic, local.micOn ? 'mic' : 'mic_off');
    }
    if (el.btnSpeaker) {
      el.btnSpeaker.classList.toggle('off', !local.speakerOn);
      setIcon(el.btnSpeaker, local.speakerOn ? 'speaker' : 'speaker_off');
      var spkName = currentSpeakerLabel();
      var spkTitle = spkName ? ('Đổi thiết bị loa (đang dùng: ' + spkName + ')') : 'Đổi thiết bị loa';
      el.btnSpeaker.title = spkTitle;
      el.btnSpeaker.setAttribute('aria-label', spkTitle);
    }
    if (el.btnCamera) {
      var videoMode = !!(state.video || state.group);
      el.btnCamera.disabled = !videoMode;
      el.btnCamera.classList.toggle('off', videoMode && !local.cameraOn);
      setIcon(el.btnCamera, local.cameraOn ? 'camera' : 'camera_off');
    }
    if (el.btnScreen) {
      el.btnScreen.disabled = !(state.video || state.group);
      el.btnScreen.classList.toggle('active', local.screenOn);
      setIcon(el.btnScreen, 'screen');
    }
    // Gọi 1:1 không có danh sách thành viên/không mời thêm → ẩn nút.
    if (el.btnMembers) {
      el.btnMembers.classList.toggle('hidden', !state.group);
      if (!state.group && membersOpen) setMembersOpen(false);
    }
    if (el.btnCompact) {
      setIcon(el.btnCompact, local.compact ? 'expand' : 'compact');
      var compactTitle = local.compact ? 'Mở rộng lại cửa sổ' : 'Thu gọn cửa sổ nổi';
      el.btnCompact.title = compactTitle;
      el.btnCompact.setAttribute('aria-label', compactTitle);
    }
    if (el.btnFullscreen) {
      setIcon(el.btnFullscreen, local.fullscreen ? 'fullscreen_exit' : 'fullscreen');
      var fsTitle = local.fullscreen ? 'Thoát toàn màn hình' : 'Toàn màn hình';
      el.btnFullscreen.title = fsTitle;
      el.btnFullscreen.setAttribute('aria-label', fsTitle);
    }
    if (el.btnHangup) el.btnHangup.disabled = phase === 'ended';
  }

  /* ------------------------------------------------------------- group */

  /* ------------------------------------------------------- group (kiểu Zoom) */

  var GL = window.ZCallGroupLayout;
  var group = {
    tiles: {},          // id -> element (tái sử dụng để có transition khi xếp lại)
    members: [],        // thành viên còn hiển thị trong lưới
    allMembers: [],     // toàn bộ roster (kể cả người đã rời/không trả lời)
    view: 'gallery',    // 'gallery' | 'speaker' (chỉ có ý nghĩa từ 3 người)
    page: 0,
    pinned: null,       // id người được ghim làm ô chính
    lastSpeaker: null,  // src người vừa nói gần nhất
    lastCount: -1,
    fitTimer: null,
    resizeTimer: null,
    layoutRaf: 0,
    observer: null,
    lastTileClickAt: 0,
    view_pages: 1,
    aspect: {},         // id -> tỉ lệ w/h thật của khung hình người đó
    peerVideoAtById: {},// id -> lần cuối thực sự vẽ được frame video của người đó
  };

  function memberKey(m) { return String(m.src == null ? m.id : m.src); }
  function isSelfMember(m) {
    return Boolean(m.self) || (state.selfId != null && String(m.id) === String(state.selfId));
  }

  /**
   * Thành viên còn hiển thị trong lưới. `callState` server: 0 = đã rời, 4 = không trả lời.
   * Yêu cầu UX: người đã rời / không trả lời phải tắt hẳn khung, không giữ tile trống.
   */
  function isVisibleGroupMember(m) {
    if (isSelfMember(m)) return true;
    if (m.callState == null || m.callState === '') return true;
    var cs = Number(m.callState);
    return cs !== 0 && cs !== 4;
  }

  var membersOpen = false;
  var friendsMode = false;
  var friends = [];
  var friendsPicked = {};

  function memberFlags(m, self) {
    var out = [];
    var muted = Boolean(m.muted) || (self && state.muted);
    // Ưu tiên trạng thái thật: có frame video đang về thì chắc chắn camera đang mở.
    var seen = group.peerVideoAtById[String(m.id)];
    var peerLive = !self && seen && (Date.now() - seen < 1200);
    var camOn = self ? local.cameraOn : (peerLive || m.video === true);
    out.push(muted
      ? '<span class="off" title="Tắt micro">' + (SVG_ICONS.mic_off || '') + '</span>'
      : '<span title="Micro đang bật">' + (SVG_ICONS.mic || '') + '</span>');
    out.push(camOn
      ? '<span title="Camera đang bật">' + (SVG_ICONS.camera || '') + '</span>'
      : '<span class="off" title="Camera đang tắt">' + (SVG_ICONS.camera_off || '') + '</span>');
    return '<span class="member-flags">' + out.join('') + '</span>';
  }

  function renderMembers() {
    if (!el.membersList) return;
    // Danh sách thành viên vẫn hiện cả người đã rời / không trả lời (có trạng thái),
    // chỉ lưới video mới ẩn khung của họ.
    var all = group.allMembers && group.allMembers.length
      ? group.allMembers
      : (group.members && group.members.length ? group.members : (state.members || []));
    // Người đã rời / không trả lời không còn liên lạc được → bỏ khỏi danh sách.
    var members = all.filter(isVisibleGroupMember);
    el.membersList.textContent = '';
    if (el.membersCount) el.membersCount.textContent = String(members.length);
    for (var i = 0; i < members.length; i++) {
      var m = members[i];
      var self = isSelfMember(m);
      var row = document.createElement('div');
      row.className = 'member-row' + (isSpeaking(memberKey(m)) ? ' speaking' : '');
      var av;
      if (m.avatar) {
        av = document.createElement('img');
        av.className = 'member-avatar';
        av.alt = '';
        av.src = avatarUrl(m.avatar);
      } else {
        av = document.createElement('div');
        av.className = 'member-avatar';
        av.textContent = GL.initials(String(m.name || m.id));
        av.style.background = GL.colorFor(String(m.name || m.id));
      }
      var meta = document.createElement('div');
      meta.className = 'member-meta';
      var nm = document.createElement('span');
      nm.className = 'member-name';
      nm.textContent = m.name || String(m.id);
      var sub = document.createElement('span');
      sub.className = 'member-sub';
      var isHost = state.members && state.members.length && String(m.id) === String(state.hostId || '');
      var cs = m.callState == null || m.callState === '' ? null : Number(m.callState);
      sub.textContent = self
        ? 'Bạn'
        : (cs === 1 ? 'Đang gọi…' : cs === 2 ? 'Đã vào phòng' : m.speaking ? 'Đang nói…' : 'Trong cuộc gọi');
      meta.appendChild(nm);
      meta.appendChild(sub);
      row.appendChild(av);
      row.appendChild(meta);
      if (isHost) {
        var badge = document.createElement('span');
        badge.className = 'member-host';
        badge.textContent = 'Chủ phòng';
        row.appendChild(badge);
      }
      row.insertAdjacentHTML('beforeend', memberFlags(m, self));
      // Chủ phòng kick thành viên (native: zaviKickPartner/RequestKickPartner).
      // Engine hiện chỉ ghi probe, chưa gửi ZRTC vì chưa có layout gói kick.
      try {
        var selfId = String(state.selfId || '');
        var amHost = selfId && String(state.hostId || '') === selfId;
        if (amHost && !self && cs !== 0 && cs !== 4) {
          var kick = document.createElement('button');
          kick.className = 'member-kick';
          kick.type = 'button';
          kick.title = 'Mời ra khỏi phòng (chủ phòng)';
          kick.textContent = 'Mời ra';
          kick.dataset.id = String(m.id);
          kick.addEventListener('click', function (ev) {
            ev.stopPropagation();
            try { send({ action: 'kick', userId: String(m.id) }); } catch (e) {}
            toast('Đã gửi yêu cầu mời ra — chờ bản cập nhật ZRTC');
          });
          row.appendChild(kick);
        }
      } catch (e) {}
      el.membersList.appendChild(row);
    }
  }

  function groupConvId() {
    var id = String(state.convId || '');
    if (!id) return '';
    return id.charAt(0) === 'g' ? id : 'g' + id;
  }

  function pickedIds() {
    var rows = document.querySelectorAll('#friendsList .member-row.picked');
    var ids = [];
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].dataset.id) ids.push(rows[i].dataset.id);
    }
    return ids;
  }

  function renderFriends() {
    if (!el.friendsList) return;
    var query = String((el.membersSearch && el.membersSearch.value) || '').trim().toLowerCase();
    el.friendsList.textContent = '';
    var shown = 0;
    for (var i = 0; i < friends.length; i++) {
      var f = friends[i];
      if (query) {
        var hay = (String(f.name || '') + ' ' + String(f.id || '')).toLowerCase();
        if (hay.indexOf(query) < 0) continue;
      }
      shown++;
      var row = document.createElement('div');
      row.className = 'member-row pickable';
      row.dataset.id = String(f.id);
      row.dataset.name = String(f.name || '');
      var av = document.createElement('img');
      av.className = 'member-avatar';
      av.alt = '';
      av.src = avatarUrl(f.avatar);
      var meta = document.createElement('div');
      meta.className = 'member-meta';
      var nm = document.createElement('span');
      nm.className = 'member-name';
      nm.textContent = f.name || f.id;
      meta.appendChild(nm);
      var check = document.createElement('span');
      check.className = 'member-check';
      row.appendChild(av);
      row.appendChild(meta);
      row.appendChild(check);
      row.addEventListener('click', function () {
        this.classList.toggle('picked');
        var isPicked = this.classList.contains('picked');
        var chk = this.querySelector('.member-check');
        if (chk) chk.textContent = isPicked ? '✓' : '';
        updatePickedCount();
      });
      el.friendsList.appendChild(row);
    }
    updatePickedCount();
    if (!shown && el.friendsList) {
      var empty = document.createElement('div');
      empty.className = 'members-empty';
      empty.textContent = friends.length ? 'Không tìm thấy thành viên' : 'Không còn thành viên để mời';
      el.friendsList.appendChild(empty);
    }
  }

  function updatePickedCount() {
    var n = pickedIds().length;
    if (el.membersPicked) el.membersPicked.textContent = String(n);
    if (el.membersInvite) el.membersInvite.disabled = n === 0;
    if (el.membersInvite) el.membersInvite.textContent = n ? ('Mời ' + n + ' người vào cuộc gọi') : 'Mời vào cuộc gọi';
  }

  async function openFriendsPicker() {
    var convId = groupConvId();
    if (!convId) { toast('Chưa xác định được nhóm'); return; }
    if (el.membersAdd) el.membersAdd.classList.add('busy');
    try {
      var res = await invoke('zcall-ui-group-friends', { convId: convId });
      if (!res || res.error) {
        toast('Không lấy được thành viên nhóm: ' + ((res && res.error) || 'lỗi'));
        return;
      }
      // Lọc đúng người **đang trong cuộc gọi**: dùng map long→short rồi so với member list.
      var map = state.noiseMap || {};
      var inCall = {};
      (state.members || []).forEach(function (m) { inCall[String(m.id)] = true; });
      friends = (res.members || res.friends || []).filter(function (f) {
        var short = map[String(f.id)];
        return !(short && inCall[String(short)]);
      });
      friendsPicked = {};
      friendsMode = true;
      if (el.membersAddView) el.membersAddView.hidden = false;
      if (el.membersList) el.membersList.hidden = true;
      renderFriends();
    } catch (e) {
      toast('Không lấy được thành viên nhóm');
    } finally {
      if (el.membersAdd) el.membersAdd.classList.remove('busy');
    }
  }

  async function submitInvite() {
    var ids = pickedIds();
    if (!ids.length) { toast('Chọn ít nhất một thành viên'); return; }
    try {
      send({ action: 'invite', userIds: ids });
      toast('Đang mời ' + ids.length + ' thành viên vào cuộc gọi');
      friendsMode = false;
      if (el.membersAddView) el.membersAddView.hidden = true;
      if (el.membersList) el.membersList.hidden = false;
      if (el.membersAddLabel) el.membersAddLabel.textContent = 'Thêm thành viên';
    } catch (e) {
      toast('Không mời được thành viên');
    }
  }

  function setMembersOpen(open) {
    membersOpen = Boolean(open);
    if (!el.membersPop) return;
    if (membersOpen) {
      renderMembers();
      el.membersPop.hidden = false;
    } else {
      el.membersPop.hidden = true;
      friendsMode = false;
      if (el.membersAddView) el.membersAddView.hidden = true;
      if (el.membersList) el.membersList.hidden = false;
    }
  }

  function clearGroup() {
    if (!el.groupGrid) return;
    el.groupGrid.classList.add('hidden');
    el.groupGrid.textContent = '';
    group.tiles = {};
    group.members = [];
    group.allMembers = [];
    group.peerVideoAtById = {};
    group.lastCount = -1;
    document.body.classList.remove('has-members');
    if (el.btnGroupView) el.btnGroupView.classList.add('hidden');
    if (el.groupPager) el.groupPager.classList.add('hidden');
  }

  var enrichedOnce = {};
  async function enrichGroupMembers(members) {
    if (!state.convId || !members || !members.length) return;
    var need = [];
    for (var i = 0; i < members.length; i++) {
      var m = members[i];
      if (isSelfMember(m)) continue;
      var missing = !m.name || String(m.name) === String(m.id) || !m.avatar;
      if (missing && !enrichedOnce[String(m.id)]) need.push(String(m.id));
    }
    if (!need.length) return;
    window.__zaluxEnrichLog = window.__zaluxEnrichLog || [];
    window.__zaluxEnrichLog.push({ at: Date.now(), need: need.slice(0) });
    try {
      var convId = groupConvId();
      // 1) Danh sách thành viên nhóm (uid dài + tên + avatar).
      var listRes = await invoke('zcall-ui-group-friends', { convId: convId });
      var byLong = {};
      ((listRes && listRes.members) || []).forEach(function (u) { byLong[String(u.id)] = u; });
      // 2) uid ngắn -> uid dài (getNoisedUids); id dài thì dùng trực tiếp.
      var shorts = need.filter(function (id) { return id.length < 15; });
      var shortToLong = {};
      if (shorts.length) {
        var res = await invoke('zcall-ui-resolve-users', { convId: convId, shortIds: shorts });
        ((res && res.users) || []).forEach(function (u) { shortToLong[String(u.short)] = String(u.long || ''); });
      }
      var changed = false;
      (state.members || []).forEach(function (m) {
        var id = String(m.id);
        var long = id.length >= 15 ? id : (shortToLong[id] || '');
        var u = byLong[long];
        if (!u) return;
        if (u.name && (!m.name || String(m.name) === id)) { m.name = u.name; changed = true; }
        if (u.avatar && !m.avatar) { m.avatar = u.avatar; changed = true; }
      });
      if (changed) {
        group.members = state.members;
        renderGroup();
        if (membersOpen) renderMembers();
      }
      // Chỉ đánh dấu đã xử lý khi member đã có tên khác id; thất bại thì thử lại lần sau.
      need.forEach(function (id) {
        var ms = state.members || [];
        var found = null;
        for (var k = 0; k < ms.length; k++) {
          if (String(ms[k].id) === id) { found = ms[k]; break; }
        }
        if (found && found.name && String(found.name) !== id) enrichedOnce[id] = true;
        else delete enrichedOnce[id];
      });
    } catch (e) {
      need.forEach(function (id) { delete enrichedOnce[id]; });
      window.__zaluxEnrichLog.push({ at: Date.now(), error: String(e && e.message || e).slice(0,120) });
    }
  }

  function renderGroup() {
    if (!el.groupGrid) return;
    var all = Array.isArray(state.members) ? state.members : null;
    if (!state.group || !all || !all.length) {
      clearGroup();
      return;
    }
    group.allMembers = all;
    var members = all.filter(isVisibleGroupMember);
    if (!members.length) {
      clearGroup();
      return;
    }
    group.members = members;
    enrichGroupMembers(all);
    if (membersOpen) renderMembers();
    el.groupGrid.classList.remove('hidden');
    document.body.classList.add('has-members');
    ensureGroupObserver();
    scheduleGroupLayout();
    scheduleGroupFit(members.length);
  }

  function ensureGroupObserver() {
    if (group.observer || typeof ResizeObserver !== 'function') return;
    var host = el.groupGrid.parentElement || el.groupGrid;
    group.observer = new ResizeObserver(function () {
      // Trong lúc cửa sổ đang co giãn: ô bám theo ngay (không transition vị trí) để mượt, đồng bộ với cửa sổ.
      el.groupGrid.classList.add('resizing');
      if (group.resizeTimer) clearTimeout(group.resizeTimer);
      group.resizeTimer = setTimeout(function () { el.groupGrid.classList.remove('resizing'); }, 160);
      scheduleGroupLayout();
    });
    group.observer.observe(host);
    var info = document.querySelector('.info');
    var controls = document.getElementById('controls');
    if (info) group.observer.observe(info);
    if (controls) group.observer.observe(controls);
  }

  function scheduleGroupLayout() {
    if (group.layoutRaf) return;
    group.layoutRaf = requestAnimationFrame(function () {
      group.layoutRaf = 0;
      layoutGroup();
    });
  }

  /** Chừa chỗ phía dưới cho khối tên/giờ + thanh nút để ô không bị che. */
  function measureGroupInsets() {
    var host = el.groupGrid.parentElement;
    if (!host) return;
    var hostRect = host.getBoundingClientRect();
    var tops = [];
    var info = document.querySelector('.info');
    var controls = document.getElementById('controls');
    var infoOverlay = info && getComputedStyle(info).position === 'absolute';
    if (info && info.offsetParent !== null && !infoOverlay) tops.push(info.getBoundingClientRect().top);
    if (controls && controls.offsetParent !== null) tops.push(controls.getBoundingClientRect().top);
    var reserve = 130;
    if (tops.length) reserve = Math.round(hostRect.bottom - Math.min.apply(null, tops) + 10);
    reserve = Math.max(70, Math.min(reserve, Math.round(hostRect.height * 0.5)));
    el.groupGrid.style.setProperty('--group-bottom', reserve + 'px');
  }

  function pickFocus(members) {
    if (group.pinned != null) {
      var pinned = members.filter(function (m) { return String(m.id) === String(group.pinned); })[0];
      if (pinned) return pinned;
      group.pinned = null;
    }
    if (group.lastSpeaker != null) {
      var sp = members.filter(function (m) { return memberKey(m) === String(group.lastSpeaker); })[0];
      if (sp) return sp;
    }
    return members[0];
  }

  function placeTile(m, rect, opts) {
    var id = String(m.id);
    var tile = group.tiles[id];
    var fresh = false;
    if (!tile) {
      tile = createTile(m);
      group.tiles[id] = tile;
      fresh = true;
    }
    var isSelf = isSelfMember(m);
    tile.setAttribute('data-src', memberKey(m));
    tile.setAttribute('data-self', isSelf ? '1' : '0');
    tile.classList.toggle('muted', Boolean(m.muted));
    tile.classList.toggle('focus', Boolean(opts && opts.focus));
    tile.classList.toggle('small', rect.w < 200);
    tile.classList.toggle('speaking', isSpeaking(memberKey(m)));
    // `videoState` broadcast có thể sai/trễ, nên ưu tiên frame thật vừa vẽ.
    // Nhưng khi peer báo tắt cam thì chỉ giữ khung cuối thêm 1,2 s rồi về
    // avatar + trạng thái, không để hình đứng im mãi.
    var seenAt = group.peerVideoAtById[String(m.id)];
    var peerLive = seenAt && (Date.now() - seenAt < 1200);
    if (!isSelf && m.video === false && !peerLive) {
      tile.classList.remove('has-peer-video');
      var frozen = tile.querySelector('.peer-tile-video');
      if (frozen && frozen.getContext) {
        try { frozen.getContext('2d').clearRect(0, 0, frozen.width, frozen.height); } catch (_) {}
      }
    }
    var nameEl = tile.querySelector('.tile-name > span:first-child');
    if (nameEl) nameEl.textContent = m.name || '';
    var cs = (m.callState === 0 || m.callState === 1 || m.callState === 2 || m.callState === 3 || m.callState === 4)
      ? Number(m.callState) : null;
    var statusEl = tile.querySelector('.tile-status');
    var statusText = '';
    if (!isSelf && cs !== null) {
      if (cs === 0) statusText = 'Đã rời cuộc gọi';
      else if (cs === 4) statusText = 'Không trả lời';
      else if (cs === 1) statusText = 'Đang gọi…';
    }
    if (statusEl) {
      statusEl.textContent = statusText;
      statusEl.classList.toggle('hidden', !statusText);
    }
    tile.classList.toggle('member-left', !isSelf && cs === 0);
    tile.classList.toggle('member-noanswer', !isSelf && cs === 4);
    tile.classList.toggle('member-ringing', !isSelf && cs === 1);
    var av = Math.max(28, Math.min(112, Math.round(Math.min(rect.w, rect.h) * 0.4)));
    tile.style.setProperty('--avatar', av + 'px');
    tile.style.left = rect.x + 'px';
    tile.style.top = rect.y + 'px';
    tile.style.width = rect.w + 'px';
    tile.style.height = rect.h + 'px';
    if (fresh) {
      el.groupGrid.appendChild(tile);
      requestAnimationFrame(function () { tile.classList.remove('entering'); });
    }
    if (isSelf) {
      syncSelfTileVideo(tile);
    }
    return tile;
  }

  function syncSelfTileVideo(targetTile) {
    var tiles = targetTile ? [targetTile] : Object.keys(group.tiles).map(function (k) { return group.tiles[k]; });
    var activeStream = state.group && (local.cameraOn || local.screenOn) ? enc.stream : null;
    for (var i = 0; i < tiles.length; i++) {
      var t = tiles[i];
      if (!t || t.getAttribute('data-self') !== '1') continue;
      var v = t.querySelector('.self-tile-video');
      if (!v) continue;
      if (activeStream) {
        if (v.srcObject !== activeStream) {
          v.srcObject = activeStream;
        }
        try { v.play().catch(function () {}); } catch (_) {}
        var sw = enc.width || v.videoWidth || 0;
        var sh = enc.height || v.videoHeight || 0;
        if (sw > 0 && sh > 0) group.aspect[String(state.group ? state.selfId || 'self' : 'self')] = sw / sh;
        t.classList.add('has-self-video');
        t.classList.toggle('screen-video', !!enc.screen);
      } else {
        if (v.srcObject) {
          try { v.srcObject = null; } catch (_) {}
        }
        t.classList.remove('has-self-video', 'screen-video');
      }
    }
  }

  function createTile(m) {
    var tile = document.createElement('div');
    tile.className = 'tile entering';
    tile.setAttribute('data-id', String(m.id));
    var name = String(m.name || '');
    function initialsAvatar() {
      var d = document.createElement('div');
      d.className = 'avatar';
      d.textContent = GL.initials(name);
      d.style.background = GL.colorFor(name || String(m.id));
      return d;
    }
    if (m.avatar) {
      var img = document.createElement('img');
      img.className = 'avatar';
      img.alt = '';
      img.src = avatarUrl(m.avatar);
      img.addEventListener('error', function () {
        if (img.parentNode) img.parentNode.replaceChild(initialsAvatar(), img);
      });
      tile.appendChild(img);
    } else {
      tile.appendChild(initialsAvatar());
    }
    var selfVid = document.createElement('video');
    selfVid.className = 'tile-video self-tile-video';
    selfVid.muted = true;
    selfVid.autoplay = true;
    selfVid.playsInline = true;
    tile.appendChild(selfVid);

    var peerCanvas = document.createElement('canvas');
    peerCanvas.className = 'tile-video peer-tile-video';
    tile.appendChild(peerCanvas);

    var label = document.createElement('div');
    label.className = 'tile-name';
    var txt = document.createElement('span');
    var mic = document.createElement('span');
    mic.className = 'mic-off';
    mic.innerHTML = SVG_ICONS.mic_off || '';
    var status = document.createElement('span');
    status.className = 'tile-status';
    label.appendChild(txt);
    label.appendChild(mic);
    label.appendChild(status);
    tile.appendChild(label);

    tile.addEventListener('dblclick', function (e) { e.stopPropagation(); });
    tile.addEventListener('click', function (e) {
      e.stopPropagation();
      var now = Date.now();
      if (now - group.lastTileClickAt < 350) return; // chặn nhấp đúp làm lật 2 lần
      group.lastTileClickAt = now;
      onTileClick(String(m.id));
    });
    return tile;
  }

  function onTileClick(id) {
    if (!GL.isZoomMode(group.members.length)) return;
    if (group.view === 'gallery') {
      group.pinned = id;
      group.view = 'speaker';
      group.page = 0;
    } else if (group.pinned != null && String(group.pinned) === id) {
      group.pinned = null;
      group.view = 'gallery';
      group.page = 0;
    } else {
      var focus = pickFocus(group.members);
      if (focus && String(focus.id) === id) {
        group.view = 'gallery';
        group.pinned = null;
      } else {
        group.pinned = id;
      }
      group.page = 0;
    }
    scheduleGroupLayout();
  }

  function layoutGroup() {
    if (!el.groupGrid || !state.group || !group.members.length) return;
    measureGroupInsets();
    var W = el.groupGrid.clientWidth;
    var H = el.groupGrid.clientHeight;
    if (W < 40 || H < 40) return;

    var members = group.members;
    var n = members.length;
    // Ô nhóm phải theo tỉ lệ video thật: điện thoại gọi tới thường quay dọc (9:16),
    // nếu cứ ép 16:9 thì hình bị bóp/méo.
    var tileAspect = orient === 'tall' ? 9 / 16 : 16 / 9;
    var zoom = GL.isZoomMode(n);
    var view = zoom ? group.view : 'gallery';
    var placed = [];   // [{m, rect, focus}]
    var pages = 1;
    var stripOrient = null;

    if (view === 'gallery' && n <= 2) {
      // 1–2 người: mỗi ô theo đúng tỉ lệ khung hình của người đó (dọc/ngang),
      // tối đa hoá diện tích nhìn.
      var aspects = members.map(function (m) {
        var own = group.aspect[String(m.id)];
        if (own > 0.05) return own;
        if (isSelfMember(m)) {
          var aw = enc.width, ah = enc.height;
          if (aw > 0 && ah > 0) return aw / ah;
        }
        return tileAspect;
      });
      // Một mình: cho ô phủ kín cả vùng lưới (video crop bằng `object-fit:
      // cover`) thay vì canh giữa rồi để đệm hai bên.
      if (n === 1) {
        placed.push({ m: members[0], rect: { x: 0, y: 0, w: W, h: H }, focus: false });
      } else {
        // Giữ tỉ lệ riêng của từng người: ô ngang đi với ô dọc là bình thường.
        var gf = GL.fitAspects(aspects, W, H, { gap: 8 });
        members.forEach(function (m, i) {
          var r = gf.tiles[i];
          if (r) placed.push({ m: m, rect: r, focus: false });
        });
      }
    } else if (view === 'gallery') {
      var pp = GL.perPage(W, H);
      pages = Math.max(1, Math.ceil(n / pp));
      group.page = Math.max(0, Math.min(group.page, pages - 1));
      var slice = members.slice(group.page * pp, group.page * pp + pp);
      var g = GL.gallery(slice.length, W, H, { aspect: tileAspect });
      slice.forEach(function (m, i) { placed.push({ m: m, rect: g.tiles[i], focus: false }); });
    } else {
      var focus = pickFocus(members);
      var others = members.filter(function (m) { return m !== focus; });
      var sp = GL.speaker(others.length, W, H, { aspect: tileAspect });
      stripOrient = sp.orientation;
      var vis = Math.max(1, sp.visible);
      pages = Math.max(1, Math.ceil(others.length / vis));
      group.page = Math.max(0, Math.min(group.page, pages - 1));
      var strip = others.slice(group.page * vis, group.page * vis + sp.visible);
      placed.push({ m: focus, rect: sp.main, focus: true });
      strip.forEach(function (m, i) { placed.push({ m: m, rect: sp.strip[i], focus: false }); });
    }

    var keep = {};
    placed.forEach(function (it) {
      keep[String(it.m.id)] = true;
      placeTile(it.m, it.rect, { focus: it.focus });
    });
    Object.keys(group.tiles).forEach(function (id) {
      if (keep[id]) return;
      var t = group.tiles[id];
      if (t && t.parentNode) t.parentNode.removeChild(t);
      delete group.tiles[id];
    });

    // Nút chuyển chế độ (trái) + phân trang (phải) đặt ngay DƯỚI lưới, trong dải trống phía trên khối tên/giờ,
    // để không đè lên ô nào (chế độ họp Zoom từ 3 người).
    group.view_pages = pages;
    var gx = el.groupGrid.offsetLeft;
    var gy = el.groupGrid.offsetTop;
    var barTop = Math.max(0, gy + H + 6);
    if (el.btnGroupView) {
      el.btnGroupView.classList.toggle('hidden', !zoom);
      el.btnGroupView.textContent = view === 'gallery' ? 'Chế độ người nói' : 'Chế độ lưới';
      el.btnGroupView.style.left = gx + 'px';
      el.btnGroupView.style.top = barTop + 'px';
    }
    if (el.groupPager) {
      var showPager = zoom && pages > 1;
      el.groupPager.classList.toggle('hidden', !showPager);
      if (showPager) {
        el.pageLabel.textContent = (group.page + 1) + '/' + pages;
        el.btnPagePrev.disabled = group.page <= 0;
        el.btnPageNext.disabled = group.page >= pages - 1;
        var pw = el.groupPager.offsetWidth || 96;
        el.groupPager.style.left = Math.max(0, gx + W - pw) + 'px';
        el.groupPager.style.top = barTop + 'px';
      }
    }
  }

  function setGroupPage(delta) {
    group.page = Math.max(0, group.page + delta);
    scheduleGroupLayout();
  }

  function toggleGroupView() {
    group.view = group.view === 'gallery' ? 'speaker' : 'gallery';
    if (group.view === 'gallery') group.pinned = null;
    group.page = 0;
    scheduleGroupLayout();
  }

  /** Báo main co giãn cửa sổ theo số người (debounce để join/leave dồn dập chỉ co 1 lần). */
  function scheduleGroupFit(count) {
    if (count === group.lastCount) return;
    group.lastCount = count;
    if (group.fitTimer) clearTimeout(group.fitTimer);
    group.fitTimer = setTimeout(function () {
      group.fitTimer = null;
      if (!ipc) return;
      try { ipc.send('zcall-ui-fit-group', { count: count }); } catch (_) { /* main gone */ }
    }, 450);
  }

  function isSpeaking(src) {
    if (src == null) return false;
    return !!local.speaking[String(src)];
  }

  function onSpeaking(msg) {
    if (!msg) return;
    var src = msg.src == null ? '__one' : String(msg.src);
    local.speaking[src] = !!msg.on;
    if (state.group && el.groupGrid) {
      var tiles = el.groupGrid.querySelectorAll('.tile');
      for (var i = 0; i < tiles.length; i++) {
        var t = tiles[i];
        if (t.getAttribute('data-src') === src) t.classList.toggle('speaking', !!msg.on);
      }
      if (msg.on && src !== '__one') {
        var changed = group.lastSpeaker !== src;
        group.lastSpeaker = src;
        if (changed && group.view === 'speaker' && group.pinned == null) scheduleGroupLayout();
      }
    }
    updateBadge();
  }

  /* ------------------------------------------------------------- sounds */

  function loadSounds() {
    invoke('zcall-ui-sounds').then(function (map) {
      if (map && typeof map === 'object') sounds = map;
      if (phase === 'outgoing' || phase === 'connecting') updateSounds('', phase);
    }).catch(function () { /* defaults only */ });
  }

  function soundUrl(key) {
    if (sounds && sounds[key]) return sounds[key];
    var names = {
      ringtone: 'zalo_ringtone.mp3',
      ringback: 'zalo_ringback.mp3',
      connecting: 'connecting.mp3',
      endcall: 'endcall.mp3',
      busy: 'busy.mp3',
      disconnect: 'disconnect.mp3',
      oldendcall: 'oldendcall.mp3',
    };
    return names[key] ? A.sound(names[key]) : '';
  }

  function stopSound(key) {
    var a = soundEls[key];
    if (!a) return;
    try { a.pause(); a.currentTime = 0; } catch (_) { /* ignore */ }
    delete soundEls[key];
  }

  function playSound(key, loop) {
    stopSound(key);
    var url = soundUrl(key);
    if (!url) return;
    try {
      var a = new Audio(url);
      a.loop = !!loop;
      a.volume = 0.65;
      a.addEventListener('error', function () { stopSound(key); });
      a.play().catch(function () { /* autoplay policy */ });
      soundEls[key] = a;
    } catch (_) { /* ignore */ }
  }

  function stopAllSounds() {
    Object.keys(soundEls).forEach(stopSound);
  }

  function updateSounds(from, to) {
    if (from === to) return;
    stopAllSounds();
    if (to === 'outgoing') playSound('ringback', true);
    else if (to === 'connecting') playSound('connecting', true);
    else if (to === 'ended') playSound('endcall', false);
  }

  /* -------------------------------------------------------- peer video */

  var decoder = null;
  var decoderCodec = '';
  var decoderTs = 0;
  var decoderFailed = false;
  var swDecoderChecked = false;
  var swDecoderSupported = false;
  var gotFrame = false;
  var hasRxKey = false;
  var lastVideoSsrc = 0;
  var lastKeyBytes = null;
  var lastNeedKeyAt = 0;
  var pipeProc = null;
  var pipeCodec = '';
  var pipeFailed = false;
  var pipeBuf = null;
  var peerCtx = null;
  var rxDecodedFrames = 0;
  var txEncodedFrames = 0;
  var txKeyFrames = 0;

  function requestPeerKeyframe(why) {
    var now = Date.now();
    if (now - lastNeedKeyAt < 900) return;
    lastNeedKeyAt = now;
    send({ action: 'needkey', why: why || 'decoder' });
  }

  function toBytes(data) {
    if (!data) return null;
    if (data instanceof Uint8Array) return data;
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    if (typeof data === 'string') {
      try {
        var bin = atob(data);
        var out = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        return out;
      } catch (_) { return null; }
    }
    if (Array.isArray(data)) return new Uint8Array(data);
    return null;
  }

  function codecName(raw) {
    var c = String(raw || '').trim();
    if (!c || /^h\.?264$/i.test(c) || /^avc$/i.test(c)) return 'avc1.42E01F';
    if (/^avc1\.[0-9a-f]{6}$/i.test(c)) return 'avc1.' + c.slice(5).toUpperCase();
    if (/^vp0?8$/i.test(c)) return 'vp8';
    if (/^vp0?9$/i.test(c)) return 'vp09.00.10.08';
    if (/^(hev1|hvc1)\./i.test(c) || /^hevc$/i.test(c) || /^h\.?265$/i.test(c)) return 'hev1.1.6.L93.B0';
    return 'avc1.42E01F';
  }

  function isHevcCodec(raw) {
    return /^(hev1|hvc1|hevc|h\.?265)/i.test(String(raw || '').trim());
  }

  function ensurePeerContext(dw, dh) {
    var canvas = el.peerVideo;
    if (!canvas) return null;
    if (canvas.width !== dw || canvas.height !== dh) {
      canvas.width = dw;
      canvas.height = dh;
      peerCtx = null;
    }
    noteVideoOrientation(dw, dh);
    if (!peerCtx) {
      peerCtx = canvas.getContext('2d', { alpha: false, willReadFrequently: true })
        || canvas.getContext('2d', { alpha: false })
        || canvas.getContext('2d');
    }
    return peerCtx;
  }

  function markVideoRendered() {
    rxDecodedFrames += 1;
    gotFrame = true;
    if (el.peerVideo) paintBackdrop(el.peerVideo, el.peerVideo.width, el.peerVideo.height);
    if (state.group && el.peerVideo && el.peerVideo.width > 0 && el.peerVideo.height > 0) {
      paintGroupPeerTile(el.peerVideo, el.peerVideo.width, el.peerVideo.height, lastVideoSsrc);
    }
    if (!state.peerCamOff && !document.body.classList.contains('has-video')) {
      document.body.classList.add('has-video');
    }
  }

  function paintGroupPeerTile(srcCanvas, sw, sh, ssrc) {
    var members = group.members || [];
    var target = null;
    if (ssrc) {
      for (var k = 0; k < members.length; k++) {
        if (isSelfMember(members[k])) continue;
        if (String(members[k].src || '') === String(ssrc) || String(members[k].id) === String(ssrc)) {
          target = members[k];
          break;
        }
      }
    }
    for (var i = 0; !target && i < members.length; i++) {
      if (!isSelfMember(members[i]) && members[i].video) {
        target = members[i];
        break;
      }
    }
    if (!target) {
      var focus = pickFocus(members);
      if (focus && !isSelfMember(focus)) target = focus;
    }
    if (!target) {
      for (var j = 0; j < members.length; j++) {
        if (!isSelfMember(members[j])) {
          target = members[j];
          break;
        }
      }
    }
    if (!target) return;
    group.peerVideoAt = Date.now();
    group.peerVideoAtById[String(target.id)] = Date.now();
    var aspect = (sw && sh) ? (sw / sh) : 0;
    if (aspect > 0.05) {
      var prev = group.aspect[String(target.id)];
      group.aspect[String(target.id)] = aspect;
      if (!prev || Math.abs(prev - aspect) > 0.02) scheduleGroupLayout();
    }
    var tile = group.tiles[String(target.id)];
    if (!tile) return;
    var c = tile.querySelector('.peer-tile-video');
    if (!c) return;
    if (c.width !== sw || c.height !== sh) {
      c.width = sw;
      c.height = sh;
    }
    var ctx = c.getContext('2d', { alpha: false }) || c.getContext('2d');
    if (!ctx) return;
    try {
      ctx.drawImage(srcCanvas, 0, 0, sw, sh);
      tile.classList.add('has-peer-video');
    } catch (_) {}
  }

  function drawRgbaToPeer(bytes, w, h) {
    var dw = Number(w) || 0;
    var dh = Number(h) || 0;
    var needed = dw * dh * 4;
    if (dw <= 0 || dh <= 0 || !bytes || bytes.byteLength < needed) return;
    var ctx = ensurePeerContext(dw, dh);
    if (!ctx) return;
    try {
      var clamped = new Uint8ClampedArray(bytes.buffer, bytes.byteOffset, needed);
      ctx.putImageData(new ImageData(clamped, dw, dh), 0, 0);
      markVideoRendered();
    } catch (_) { /* ignore */ }
  }

  function drawFrame(frame) {
    var dw = frame.codedWidth || frame.displayWidth || 640;
    var dh = frame.codedHeight || frame.displayHeight || 360;
    if (typeof frame.copyTo === 'function') {
      var buf = new Uint8Array(dw * dh * 4);
      frame.copyTo(buf, { format: 'RGBA' }).then(function () {
        drawRgbaToPeer(buf, dw, dh);
      }).catch(function () {}).finally(function () {
        try { frame.close(); } catch (_) {}
      });
      return;
    }
    var ctx = ensurePeerContext(dw, dh);
    if (ctx) {
      try {
        ctx.drawImage(frame, 0, 0, dw, dh);
        markVideoRendered();
      } catch (_) {}
    }
    try { frame.close(); } catch (_) {}
  }

  function cleanHostEnv() {
    var out = {};
    var src = (typeof process !== 'undefined' && process && process.env) || {};
    var keys = Object.keys(src);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (/^(SNAP|LD_LIBRARY_PATH|LD_PRELOAD|GIO_MODULE_DIR|GTK_PATH|GTK_EXE_PREFIX|LOCPATH)/.test(k)) continue;
      out[k] = src[k];
    }
    return out;
  }

  function resolveDecodeEngineBin() {
    try {
      var fs = require('fs');
      var path = require('path');
      var base = typeof __dirname === 'string' ? __dirname : '';
      var candidates = [
        (typeof process !== 'undefined' && process.env && process.env.ZCALL_ENGINE_BIN) || '',
        base ? path.resolve(base, '..', '..', '..', 'zcall-engine') : '',
        (typeof process !== 'undefined' && process.resourcesPath)
          ? path.join(process.resourcesPath, 'app.asar.unpacked', 'zcall-engine')
          : '',
        (typeof process !== 'undefined' && process.resourcesPath)
          ? path.join(process.resourcesPath, 'app', 'zcall-engine')
          : '',
        base ? path.resolve(base, '..', '..', '..', 'target', 'release', 'zcall-engine') : '',
      ];
      for (var i = 0; i < candidates.length; i++) {
        var c = candidates[i];
        if (c && fs.existsSync(c)) return c;
      }
    } catch (_) {}
    return '';
  }

  var pipeChunks = [];
  var pipeHeadOff = 0;
  var pipeTotalLen = 0;

  function resetPipeQueue() {
    pipeChunks = [];
    pipeHeadOff = 0;
    pipeTotalLen = 0;
    pipeBuf = null;
  }

  function pushPipeChunk(chunk) {
    if (!chunk || chunk.length === 0) return;
    pipeChunks.push(chunk);
    pipeTotalLen += chunk.length;
  }

  function peekPipeBytes(n) {
    if (pipeTotalLen < n || pipeChunks.length === 0) return null;
    var first = pipeChunks[0];
    if (first.length - pipeHeadOff >= n) {
      return first.subarray(pipeHeadOff, pipeHeadOff + n);
    }
    var out = Buffer.allocUnsafe(n);
    var copied = 0;
    for (var i = 0; i < pipeChunks.length && copied < n; i++) {
      var c = pipeChunks[i];
      var s = i === 0 ? pipeHeadOff : 0;
      var take = Math.min(c.length - s, n - copied);
      c.copy(out, copied, s, s + take);
      copied += take;
    }
    return out;
  }

  function readPipeBytes(n) {
    if (pipeTotalLen < n || pipeChunks.length === 0) return null;
    var first = pipeChunks[0];
    if (first.length - pipeHeadOff >= n) {
      var sub = first.subarray(pipeHeadOff, pipeHeadOff + n);
      pipeHeadOff += n;
      pipeTotalLen -= n;
      if (pipeHeadOff >= first.length) {
        pipeChunks.shift();
        pipeHeadOff = 0;
      }
      return sub;
    }
    var out = Buffer.allocUnsafe(n);
    var written = 0;
    while (written < n && pipeChunks.length > 0) {
      var c = pipeChunks[0];
      var avail = c.length - pipeHeadOff;
      var take = Math.min(avail, n - written);
      c.copy(out, written, pipeHeadOff, pipeHeadOff + take);
      written += take;
      pipeHeadOff += take;
      pipeTotalLen -= take;
      if (pipeHeadOff >= c.length) {
        pipeChunks.shift();
        pipeHeadOff = 0;
      }
    }
    return out;
  }

  function stopPipeDecoder() {
    if (pipeProc) {
      try { pipeProc.stdin.end(); } catch (_) {}
      try { pipeProc.kill('SIGKILL'); } catch (_) {}
      pipeProc = null;
    }
    pipeCodec = '';
    resetPipeQueue();
  }

  function drainPipeFrames() {
    while (pipeTotalLen >= 8) {
      var hdr = peekPipeBytes(8);
      if (!hdr) return;
      var w = hdr.readUInt32LE(0);
      var h = hdr.readUInt32LE(4);
      if (w === 0 || h === 0 || w > 4096 || h > 4096) {
        resetPipeQueue();
        return;
      }
      var frameBytes = w * h * 4;
      if (pipeTotalLen < 8 + frameBytes) return;
      readPipeBytes(8);
      var rgba = readPipeBytes(frameBytes);
      drawRgbaToPeer(rgba, w, h);
    }
  }

  function ensurePipeDecoder(wantCodec) {
    var mode = wantCodec === 'hevc' ? 'hevc' : 'h264';
    if (pipeProc && pipeCodec === mode) return pipeProc;
    if (pipeProc && pipeCodec !== mode) stopPipeDecoder();
    if (pipeFailed) return null;
    var bin = resolveDecodeEngineBin();
    if (!bin) {
      pipeFailed = true;
      return null;
    }
    try {
      var cp = require('child_process');
      var p = cp.spawn(bin, ['--decode-pipe', mode], {
        stdio: ['pipe', 'pipe', 'ignore'],
        env: cleanHostEnv(),
      });
      resetPipeQueue();
      pipeCodec = mode;
      p.on('error', function () {
        pipeFailed = true;
        stopPipeDecoder();
      });
      p.on('close', function () {
        if (pipeProc === p) {
          pipeProc = null;
          pipeCodec = '';
        }
      });
      if (p.stdin) p.stdin.on('error', function () {});
      p.stdout.on('data', function (chunk) {
        pushPipeChunk(chunk);
        drainPipeFrames();
      });
      pipeProc = p;
      return p;
    } catch (_) {
      pipeFailed = true;
      return null;
    }
  }

  function feedPipeDecoder(bytes, hevc) {
    var p = ensurePipeDecoder(hevc ? 'hevc' : 'h264');
    if (!p || !p.stdin || p.stdin.destroyed) return false;
    try {
      var hdr = Buffer.allocUnsafe(4);
      hdr.writeUInt32LE(bytes.byteLength >>> 0, 0);
      p.stdin.write(hdr);
      p.stdin.write(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
      return true;
    } catch (_) {
      return false;
    }
  }

  function closeDecoder() {
    if (decoder) {
      try { decoder.close(); } catch (_) { /* ignore */ }
    }
    decoder = null;
    decoderCodec = '';
    stopPipeDecoder();
  }

  function probeSoftwareVideoDecoder() {
    if (swDecoderChecked) return;
    swDecoderChecked = true;
    if (typeof process !== 'undefined' && process && process.platform === 'linux') {
      // Stock Electron 22 on Linux has no software H.264 decoder; its VAAPI hardware path
      // fails asynchronously with SharedImageStub errors. Prefer zcall-engine decode-pipe.
      swDecoderSupported = false;
      decoderFailed = true;
      return;
    }
    if (typeof window.VideoDecoder !== 'function' || typeof VideoDecoder.isConfigSupported !== 'function') {
      decoderFailed = true;
      return;
    }
    VideoDecoder.isConfigSupported({
      codec: 'avc1.42E01F',
      hardwareAcceleration: 'prefer-software',
      optimizeForLatency: true,
    }).then(function (res) {
      swDecoderSupported = !!(res && res.supported);
      if (!swDecoderSupported) decoderFailed = true;
    }).catch(function () {
      decoderFailed = true;
    });
  }

  function makeDecoder(codec) {
    if (typeof window.VideoDecoder !== 'function' || decoderFailed || !swDecoderSupported) return null;
    var startFrames = rxDecodedFrames;
    try {
      var d = new VideoDecoder({
        output: drawFrame,
        error: function () {
          if (decoder === d) {
            decoder = null;
            decoderCodec = '';
          }
          try { d.close(); } catch (_) {}
          if (rxDecodedFrames === startFrames) {
            decoderFailed = true;
            if (lastKeyBytes) feedPipeDecoder(lastKeyBytes, isHevcCodec(codec));
            return;
          }
          hasRxKey = false;
          requestPeerKeyframe('decoder-recover');
        },
      });
      d.configure({ codec: codec, hardwareAcceleration: 'prefer-software', optimizeForLatency: true });
      decoderCodec = codec;
      return d;
    } catch (_) {
      decoderFailed = true;
      return null;
    }
  }

  function onVideoMessage(msg) {
    if (!msg) return;
    var bytes = toBytes(msg.data);
    if (!bytes || !bytes.length) return;
    var rawCodec = String(msg.codec || '');

    if (rawCodec.toLowerCase() === 'rgba') {
      document.body.classList.add('video');
      hasRxKey = true;
      lastVideoSsrc = Number(msg.ssrc) || 0;
      drawRgbaToPeer(bytes, msg.w || msg.width, msg.h || msg.height);
      return;
    }

    var isKey = !!(msg.key || msg.keyframe);
    var hevc = isHevcCodec(rawCodec);
    if (isKey) {
      hasRxKey = true;
      lastKeyBytes = bytes;
    } else if (!hasRxKey) {
      requestPeerKeyframe('no-key');
      return;
    }
    document.body.classList.add('video');

    probeSoftwareVideoDecoder();
    if (decoderFailed || hevc) {
      if (!feedPipeDecoder(bytes, hevc)) {
        requestPeerKeyframe('no-pipe-decoder');
      }
      return;
    }

    var codec = codecName(rawCodec);
    if (!decoder || decoderCodec !== codec || decoder.state === 'closed') {
      if (!isKey) {
        hasRxKey = false;
        requestPeerKeyframe('reconfig');
        return;
      }
      if (decoder) {
        try { decoder.close(); } catch (_) {}
        decoder = null;
      }
      decoder = makeDecoder(codec);
      if (!decoder) {
        feedPipeDecoder(bytes, hevc);
        return;
      }
    }
    try {
      decoder.decode(new EncodedVideoChunk({
        type: isKey ? 'key' : 'delta',
        timestamp: (decoderTs += 41667),
        data: bytes,
      }));
    } catch (_) {
      decoderFailed = true;
      if (decoder) {
        try { decoder.close(); } catch (_) {}
        decoder = null;
        decoderCodec = '';
      }
      if (lastKeyBytes && lastKeyBytes !== bytes) feedPipeDecoder(lastKeyBytes, hevc);
      feedPipeDecoder(bytes, hevc);
    }
  }

  /* ------------------------------------------------------ our encoder */

  var enc = {
    encoder: null,
    stream: null,
    video: null,
    canvas: null,
    ctx: null,
    timer: null,
    rvfcId: 0,
    lastTickAt: 0,
    lastRvfcAt: 0,
    width: 0,
    height: 0,
    fps: 24,
    bitrate: 1200000,
    keyMs: 8000,
    lastKey: 0,
    ts: 0,
    screen: false,
    annexb: true,
    paramSets: null,
  };

  var forceKey = false;

  function even(n) {
    n = Math.max(2, Math.round(n));
    return n % 2 ? n - 1 : n;
  }

  function fitSize(sw, sh, maxDim) {
    var scale = Math.min(1, maxDim / Math.max(sw, sh));
    return { width: even(sw * scale), height: even(sh * scale) };
  }

  function cropRect(sw, sh, tw, th) {
    var ta = tw / th;
    var sa = sw / sh;
    if (sa > ta) {
      var w = sh * ta;
      return { x: (sw - w) / 2, y: 0, w: w, h: sh };
    }
    var h = sw / ta;
    return { x: 0, y: (sh - h) / 2, w: sw, h: h };
  }

  function toBase64(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i += 0x8000) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(s);
  }

  function parseAvcC(desc) {
    var d = toBytes(desc);
    if (!d || d.length < 7) return null;
    var i = 5;
    var numSps = d[i++] & 0x1f;
    var parts = [];
    var start = new Uint8Array([0, 0, 0, 1]);
    for (var s = 0; s < numSps && i + 2 <= d.length; s++) {
      var sl = (d[i] << 8) | d[i + 1];
      i += 2;
      if (i + sl > d.length) break;
      parts.push(start, d.subarray(i, i + sl));
      i += sl;
    }
    if (i >= d.length) return parts.length ? concatBytes(parts) : null;
    var numPps = d[i++];
    for (var p = 0; p < numPps && i + 2 <= d.length; p++) {
      var pl = (d[i] << 8) | d[i + 1];
      i += 2;
      if (i + pl > d.length) break;
      parts.push(start, d.subarray(i, i + pl));
      i += pl;
    }
    return parts.length ? concatBytes(parts) : null;
  }

  function concatBytes(parts) {
    var len = 0;
    parts.forEach(function (p) { len += p.length; });
    var out = new Uint8Array(len);
    var off = 0;
    parts.forEach(function (p) { out.set(p, off); off += p.length; });
    return out;
  }

  function avccToAnnexB(data, key) {
    var parts = [];
    var start = new Uint8Array([0, 0, 0, 1]);
    if (key && enc.paramSets) parts.push(enc.paramSets);
    var i = 0;
    var found = false;
    while (i + 4 <= data.length) {
      var n = ((data[i] << 24) | (data[i + 1] << 16) | (data[i + 2] << 8) | data[i + 3]) >>> 0;
      i += 4;
      if (!n || i + n > data.length) break;
      found = true;
      parts.push(start, data.subarray(i, i + n));
      i += n;
    }
    if (!found) return data; // already Annex-B / unknown
    if (i < data.length) parts.push(data.subarray(i));
    return concatBytes(parts);
  }

  function findStartCode(bytes, from) {
    for (var i = from; i + 2 < bytes.length; i++) {
      if (bytes[i] === 0 && bytes[i + 1] === 0) {
        if (bytes[i + 2] === 1) return { pos: i, len: 3 };
        if (i + 3 < bytes.length && bytes[i + 2] === 0 && bytes[i + 3] === 1) {
          return { pos: i, len: 4 };
        }
      }
    }
    return null;
  }

  function extractAnnexbParamSets(bytes) {
    var parts = [];
    var start4 = new Uint8Array([0, 0, 0, 1]);
    var sc = findStartCode(bytes, 0);
    while (sc) {
      var nalStart = sc.pos + sc.len;
      var next = findStartCode(bytes, nalStart);
      var nalEnd = next ? next.pos : bytes.length;
      if (nalStart < nalEnd) {
        var nalType = bytes[nalStart] & 0x1f;
        if (nalType === 7 || nalType === 8) {
          parts.push(start4, bytes.subarray(nalStart, nalEnd));
        }
      }
      sc = next;
    }
    return parts.length ? concatBytes(parts) : null;
  }

  function hasSpsNal(bytes) {
    var sc = findStartCode(bytes, 0);
    while (sc) {
      var nalStart = sc.pos + sc.len;
      if (nalStart < bytes.length && (bytes[nalStart] & 0x1f) === 7) return true;
      sc = findStartCode(bytes, nalStart);
    }
    return false;
  }

  function sendFrame(chunk, data) {
    txEncodedFrames += 1;
    if (chunk.type === 'key') txKeyFrames += 1;
    var payload = {
      action: 'videoFrame',
      key: chunk.type === 'key',
      data: toBase64(data),
      screen: !!enc.screen,
      w: enc.width,
      h: enc.height,
      timestamp: chunk.timestamp,
    };
    if (typeof window.__zcallTestOnTxFrame === 'function') {
      try { window.__zcallTestOnTxFrame(payload, data); } catch (_) {}
    }
    send(payload);
  }

  function encoderOutput(chunk, metadata) {
    if (metadata && metadata.decoderConfig && metadata.decoderConfig.description) {
      var avccSets = parseAvcC(metadata.decoderConfig.description);
      if (avccSets) enc.paramSets = avccSets;
    }
    var data = new Uint8Array(chunk.byteLength);
    try { chunk.copyTo(data); } catch (_) { return; }
    if (!enc.annexb) {
      data = avccToAnnexB(data, chunk.type === 'key');
    } else {
      var inlineSets = extractAnnexbParamSets(data);
      if (inlineSets) enc.paramSets = inlineSets;
      else if (chunk.type === 'key' && !hasSpsNal(data) && enc.paramSets) {
        data = concatBytes([enc.paramSets, data]);
      }
    }
    if (phase !== 'connected') return;
    sendFrame(chunk, data);
  }

  var encRecoveryTimer = null;
  var encRecovering = false;
  var camRestartTimer = null;
  var cameraWatchdogId = null;

  function scheduleEncoderRecovery(reason, delayMs) {
    if (encRecoveryTimer || encRecovering) return;
    if (phase === 'ended' || phase === 'idle' || (!local.cameraOn && !local.screenOn)) return;
    encRecoveryTimer = setTimeout(function () {
      encRecoveryTimer = null;
      recoverEncoder(reason || 'auto');
    }, Math.max(250, Number(delayMs) || 450));
  }

  async function recoverEncoder(reason) {
    if (encRecovering || !enc.stream || (!local.cameraOn && !local.screenOn)) return;
    var track = enc.stream.getVideoTracks && enc.stream.getVideoTracks()[0];
    if (!track || track.readyState === 'ended') {
      scheduleCameraRestart(450);
      return;
    }
    encRecovering = true;
    try {
      if (enc.encoder) {
        try { enc.encoder.close(); } catch (_) {}
        enc.encoder = null;
      }
      enc.queueStallAt = 0;
      enc.encoder = await configureEncoder(
        enc.width || 960,
        enc.height || 540,
        enc.fps || 24,
        enc.bitrate || 1200000
      );
      forceKey = true;
      enc.lastKey = 0;
      console.info('[zcall-ui] video encoder recovered (' + reason + ')');
    } catch (err) {
      console.warn('[zcall-ui] encoder recovery retry:', errorText(err));
      scheduleEncoderRecovery('retry', 1200);
    } finally {
      encRecovering = false;
    }
  }

  function scheduleCameraRestart(delayMs) {
    if (camRestartTimer || local.screenOn || !local.cameraOn) return;
    if (phase === 'ended' || phase === 'idle') return;
    camRestartTimer = setTimeout(function () {
      camRestartTimer = null;
      if (!local.cameraOn || local.screenOn || phase === 'ended' || phase === 'idle') return;
      stopEncoder(true);
      startCamera().catch(function () {});
    }, Math.max(400, Number(delayMs) || 700));
  }

  function encoderError(e) {
    console.warn('[zcall-ui] video encoder error, recovering:', errorText(e));
    if (enc.encoder) {
      try { enc.encoder.close(); } catch (_) {}
      enc.encoder = null;
    }
    scheduleEncoderRecovery('encoder-error', 400);
  }

  async function configureEncoder(width, height, fps, bitrate) {
    if (typeof window.VideoEncoder !== 'function') throw new Error('VideoEncoder không khả dụng');
    var base = {
      width: width,
      height: height,
      bitrate: Math.max(100000, Math.round(bitrate)),
      framerate: fps,
      latencyMode: 'realtime',
      hardwareAcceleration: 'prefer-software',
    };
    var codecs = ['avc1.42E01F', 'avc1.42E01E', 'avc1.42001F'];
    var variants = [{ avc: { format: 'annexb' } }, {}];
    for (var c = 0; c < codecs.length; c++) {
      for (var v = 0; v < variants.length; v++) {
        var cfg = Object.assign({ codec: codecs[c] }, base, variants[v]);
        try {
          var support = await VideoEncoder.isConfigSupported(cfg);
          if (!support || !support.supported) continue;
          var videoEncoder = new VideoEncoder({ output: encoderOutput, error: encoderError });
          videoEncoder.configure(support.config || cfg);
          enc.annexb = !!variants[v].avc;
          enc.paramSets = null;
          return videoEncoder;
        } catch (_) { /* try the next one */ }
      }
    }
    throw new Error('Không có cấu hình H.264 phù hợp');
  }

  function encodeTarget(settings, isScreen) {
    var sw = settings.width || 1280;
    var sh = settings.height || 720;
    var ce = state.cameraEncode;
    if (isScreen) {
      var fit = fitSize(sw, sh, 1280);
      return { width: fit.width, height: fit.height, fps: 15, bitrate: 1500000, keyMs: 4000 };
    }
    if (ce && Number(ce.width) > 0 && Number(ce.height) > 0) {
      var maxDim = Math.max(even(ce.width), even(ce.height));
      var camFit = fitSize(sw, sh, maxDim);
      return {
        width: camFit.width,
        height: camFit.height,
        fps: Math.max(10, Math.min(30, Number(ce.fps) || 24)),
        bitrate: Number(ce.bitrate) || 1200000,
        keyMs: Number(ce.keyMs) || 8000,
      };
    }
    var scaled = fitSize(sw, sh, 1280);
    return { width: scaled.width, height: scaled.height, fps: 24, bitrate: 1200000, keyMs: 8000 };
  }

  function ensureVideoElement() {
    if (enc.video && document.body.contains(enc.video)) return enc.video;
    var v = document.createElement('video');
    v.muted = true;
    v.autoplay = true;
    v.playsInline = true;
    // Giữ kích thước nhỏ trong viewport với opacity gần 0 (KHÔNG dùng display:none hoặc toạ độ ngoài màn hình)
    // để Chromium không bao giờ ngắt giải mã khung hình khi cửa sổ thu gọn / PiP ẩn.
    v.style.position = 'fixed';
    v.style.left = '0';
    v.style.top = '0';
    v.style.width = '2px';
    v.style.height = '2px';
    v.style.opacity = '0.01';
    v.style.pointerEvents = 'none';
    v.style.zIndex = '-1';
    document.body.appendChild(v);
    enc.video = v;
    return v;
  }

  async function startCapture(stream, isScreen) {
    stopEncoder();
    var track = stream.getVideoTracks()[0];
    if (!track) throw new Error('Không có track video');
    track.addEventListener('ended', function () {
      if (!isScreen && local.cameraOn && phase !== 'ended' && phase !== 'idle') {
        scheduleCameraRestart(500);
      }
    });
    var settings = track.getSettings ? track.getSettings() : {};
    var target = encodeTarget(settings, isScreen);
    var video = ensureVideoElement();
    video.srcObject = stream;
    if (el.selfVideo && el.selfVideo !== video) {
      el.selfVideo.srcObject = stream;
      try { el.selfVideo.play().catch(function () {}); } catch (_) {}
    }
    if (el.selfPip) {
      el.selfPip.classList.toggle('screen', !!isScreen);
      el.selfPip.classList.remove('hidden');
    }
    try { await video.play(); } catch (_) { /* autoplay */ }

    enc.video = video;
    enc.stream = stream;
    enc.width = target.width;
    enc.height = target.height;
    enc.fps = target.fps;
    enc.bitrate = target.bitrate;
    enc.keyMs = target.keyMs;
    enc.screen = !!isScreen;
    syncSelfTileVideo();
    enc.canvas = document.createElement('canvas');
    enc.canvas.width = target.width;
    enc.canvas.height = target.height;
    enc.ctx = enc.canvas.getContext('2d', { alpha: false, willReadFrequently: true })
      || enc.canvas.getContext('2d', { alpha: false });
    enc.ts = 0;
    enc.lastKey = 0;
    enc.lastTickAt = 0;
    enc.lastRvfcAt = 0;
    enc.lastVideoTime = -1;
    enc.lastProgressAt = Date.now();
    enc.queueStallAt = 0;

    enc.encoder = await configureEncoder(target.width, target.height, target.fps, target.bitrate);

    var frameIntervalMs = Math.max(20, Math.round(1000 / target.fps));
    var minGapMs = Math.max(16, Math.round(880 / target.fps));
    if (typeof video.requestVideoFrameCallback === 'function') {
      var onRvfc = function () {
        if (enc.video !== video || !enc.stream) return;
        var now = Date.now();
        enc.lastRvfcAt = now;
        if (now - enc.lastTickAt >= minGapMs) {
          encodeTick();
        }
        try { enc.rvfcId = video.requestVideoFrameCallback(onRvfc); } catch (_) {}
      };
      try { enc.rvfcId = video.requestVideoFrameCallback(onRvfc); } catch (_) {}
    }
    enc.timer = setInterval(function () {
      var now = Date.now();
      var rvfcActive = enc.lastRvfcAt > 0 && (now - enc.lastRvfcAt) <= frameIntervalMs * 2;
      if (!rvfcActive || (now - enc.lastTickAt >= Math.round(frameIntervalMs * 1.35))) {
        encodeTick();
      }
    }, frameIntervalMs);
  }

  function encodeTick() {
    if (phase !== 'connected') return;
    var v = enc.video;
    if (v && v.paused) {
      try { v.play().catch(function () {}); } catch (_) {}
    }
    var e = enc.encoder;
    if (!e || e.state !== 'configured') {
      if (enc.stream && (local.cameraOn || local.screenOn)) {
        scheduleEncoderRecovery('tick-unconfigured', 350);
      }
      return;
    }
    if (!v || !enc.ctx) return;
    if (e.encodeQueueSize > 3) {
      if (!enc.queueStallAt) enc.queueStallAt = Date.now();
      else if (Date.now() - enc.queueStallAt > 1500) {
        enc.queueStallAt = 0;
        scheduleEncoderRecovery('queue-stall', 250);
      }
      return;
    }
    enc.queueStallAt = 0;
    if (v.readyState < 2 || !v.videoWidth || !v.videoHeight) return;
    var nowMs = Date.now();
    enc.lastTickAt = nowMs;
    var curT = Number(v.currentTime) || 0;
    if (curT !== enc.lastVideoTime) {
      enc.lastVideoTime = curT;
      enc.lastProgressAt = nowMs;
    }
    var rect = cropRect(v.videoWidth, v.videoHeight, enc.width, enc.height);
    var frame = null;
    try {
      enc.ctx.drawImage(v, rect.x, rect.y, rect.w, rect.h, 0, 0, enc.width, enc.height);
      var monoUs = Math.round((typeof performance !== 'undefined' ? performance.now() : nowMs) * 1000);
      enc.ts = Math.max(enc.ts + 1000, monoUs);
      frame = new VideoFrame(enc.canvas, { timestamp: enc.ts });
      var key = forceKey || (nowMs - enc.lastKey >= enc.keyMs);
      if (key) { forceKey = false; enc.lastKey = nowMs; }
      e.encode(frame, { keyFrame: key });
    } catch (err) {
      console.warn('[zcall-ui] encode tick error, recovering:', errorText(err));
      scheduleEncoderRecovery('tick-exception', 350);
    } finally {
      if (frame) {
        try { frame.close(); } catch (_) {}
      }
    }
  }

  function checkCameraHealth() {
    if (phase === 'ended' || phase === 'idle' || local.screenOn || !local.cameraOn) return;
    if (!(state.video || state.group)) return;
    if (cameraOpening || camRestartTimer) return;
    if (!enc.stream) {
      scheduleCameraRestart(500);
      return;
    }
    var track = enc.stream.getVideoTracks && enc.stream.getVideoTracks()[0];
    if (!track || track.readyState === 'ended') {
      scheduleCameraRestart(500);
      return;
    }
    if (enc.video && enc.video.paused) {
      try { enc.video.play().catch(function () {}); } catch (_) {}
    }
    if (phase === 'connected') {
      if (!enc.encoder || enc.encoder.state !== 'configured') {
        scheduleEncoderRecovery('watchdog-encoder', 350);
        return;
      }
      if (enc.lastProgressAt && Date.now() - enc.lastProgressAt > 3500) {
        enc.lastProgressAt = Date.now();
        scheduleCameraRestart(500);
      }
    }
  }

  function stopEncoder(stopStream) {
    if (enc.timer) clearInterval(enc.timer);
    enc.timer = null;
    if (enc.rvfcId && enc.video && typeof enc.video.cancelVideoFrameCallback === 'function') {
      try { enc.video.cancelVideoFrameCallback(enc.rvfcId); } catch (_) {}
    }
    enc.rvfcId = 0;
    if (encRecoveryTimer) {
      clearTimeout(encRecoveryTimer);
      encRecoveryTimer = null;
    }
    if (stopStream !== false && camRestartTimer) {
      clearTimeout(camRestartTimer);
      camRestartTimer = null;
    }
    if (enc.encoder) {
      try { enc.encoder.close(); } catch (_) { /* ignore */ }
    }
    enc.encoder = null;
    if (stopStream !== false && enc.stream) {
      enc.stream.getTracks().forEach(function (t) { try { t.stop(); } catch (_) {} });
      enc.stream = null;
    }
    if (stopStream !== false) {
      if (enc.video) {
        try { enc.video.srcObject = null; } catch (_) { /* ignore */ }
      }
      if (el.selfVideo && el.selfVideo !== enc.video) {
        try { el.selfVideo.srcObject = null; } catch (_) { /* ignore */ }
      }
      if (el.selfPip) {
        el.selfPip.classList.add('hidden');
        el.selfPip.classList.remove('screen');
      }
    }
    enc.canvas = null;
    enc.ctx = null;
    enc.paramSets = null;
    enc.screen = false;
    if (stopStream !== false) {
      syncSelfTileVideo();
    }
  }

  function isIrLabel(label) {
    return /\bIR\b|infra[-\s]?red|windows hello|depth/i.test(String(label || ''));
  }

  function cameraConstraints(id) {
    var video = {
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 30 },
    };
    if (id) video.deviceId = { exact: id };
    return { audio: false, video: video };
  }

  async function openCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      toast('Thiết bị không hỗ trợ camera');
      return null;
    }
    var preferredId = local.cameraId;
    if (!preferredId && Array.isArray(local.cameras) && local.cameras.length) {
      for (var ci = 0; ci < local.cameras.length; ci++) {
        var cam = local.cameras[ci];
        if (cam && cam.id && !isIrLabel(cam.label)) {
          preferredId = cam.id;
          break;
        }
      }
    }
    var stream = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia(cameraConstraints(preferredId));
    } catch (_) {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
      } catch (e) {
        toast('Không mở được camera: ' + errorText(e));
        return null;
      }
    }
    var track = stream && stream.getVideoTracks()[0];
    if (!local.cameraId && track && isIrLabel(track.label) && navigator.mediaDevices.enumerateDevices) {
      try {
        var list = await navigator.mediaDevices.enumerateDevices();
        var cams = list.filter(function (x) { return x.kind === 'videoinput'; });
        local.cameras = cams.map(function (x, i) {
          return { id: x.deviceId, label: x.label || ('Camera ' + (i + 1)) };
        });
        for (var k = 0; k < cams.length; k++) {
          if (cams[k].deviceId && !isIrLabel(cams[k].label)) {
            stream.getTracks().forEach(function (t) { try { t.stop(); } catch (_) {} });
            stream = await navigator.mediaDevices.getUserMedia(cameraConstraints(cams[k].deviceId));
            break;
          }
        }
      } catch (_) { /* keep current stream */ }
    }
    return stream;
  }

  var cameraOpening = false;

  async function startCamera() {
    if (!(state.video || state.group) || local.screenOn) return;
    if (cameraOpening || (enc.stream && !enc.screen)) return;
    cameraOpening = true;
    try {
      var stream = await openCamera();
      if (!stream) {
        if (local.cameraOn && phase !== 'ended' && phase !== 'idle') {
          scheduleCameraRestart(1800);
        }
        updateButtons();
        return;
      }
      if (!local.cameraOn || local.screenOn || phase === 'ended' || phase === 'idle') {
        stream.getTracks().forEach(function (t) { try { t.stop(); } catch (_) {} });
        updateButtons();
        return;
      }
      try {
        await startCapture(stream, false);
        local.cameraOn = true;
      } catch (e) {
        stream.getTracks().forEach(function (t) { try { t.stop(); } catch (_) {} });
        console.warn('[zcall-ui] startCapture retry scheduled:', errorText(e));
        scheduleCameraRestart(1500);
      }
      updateButtons();
    } finally {
      cameraOpening = false;
    }
  }

  function stopCamera(silent) {
    stopEncoder();
    local.cameraOn = false;
    if (!silent) updateButtons();
  }

  async function startScreen() {
    if (!ipc) return;
    local.cameraWasOn = local.cameraOn;
    stopCamera(true);
    // Mở rộng cửa sổ để hộp chọn màn hình hiện đầy đủ (hộp vẽ trong chính
    // cửa sổ gọi, thay cho portal hệ thống).
    sendWindow('expand');
    await new Promise(function (r) { setTimeout(r, 250); });
    // Cách 0 (native trong engine): portal hệ thống + PipeWire + OpenH264.
    // Hộp chọn chuẩn của Linux hiện bên ngoài; engine báo kết quả qua
    // 'zcall-ui-screen-native'. Thất bại/timeout thì rớt xuống cách trình duyệt.
    toast('Đang mở hộp chọn màn hình hệ thống…');
    local.screenAwaitNative = true;
    send({ action: 'screenNative', on: true });
    var nativeRes = await waitNativeResult(120000);
    local.screenAwaitNative = false;
    if (nativeRes && nativeRes.ok) {
      local.screenOn = true;
      local.screenNative = true;
      document.body.classList.add('video');
      send({ action: 'screen', on: true });
      toast('Đang chia sẻ màn hình');
      updateButtons();
      return;
    }
    if (nativeRes && nativeRes.error) toast('Share native lỗi, dùng cách trình duyệt…');
    var stream = null;
    // Cách 1 (chuẩn Linux): hộp chọn màn hình của hệ thống (xdg-desktop-portal).
    // Hiện đủ các màn hình để chọn khi có nhiều màn, ảnh thật qua PipeWire thay
    // vì đen thui như chromeMediaSource cũ trên Wayland/XWayland. Cần quyền
    // display-capture (bridge.js đã cho phép với call.html).
    if (navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia) {
      try {
        stream = await navigator.mediaDevices.getDisplayMedia({
          video: {
            width: { max: 1920 },
            height: { max: 1080 },
            frameRate: { max: 15 },
          },
          audio: false,
        });
      } catch (e) {
        stream = null;
        // Người dùng bấm Hủy trong hộp chọn: lặng lẽ về trạng thái cũ.
        if (e && (e.name === 'NotAllowedError' || e.name === 'AbortError' || e.name === 'NotFoundError')) {
          toast('Đã hủy chọn màn hình');
          send({ action: 'screen', on: false });
          sendWindow('expand');
          if (local.cameraWasOn) await startCamera();
          updateButtons();
          return;
        }
        toast('Không mở được hộp chọn (' + ((e && e.name) || 'lỗi') + '), dùng cách cũ…');
      }
    }
    // Cách 2 (fallback X11 cũ): desktopCapturer + chromeMediaSource.
    if (!stream) {
      try {
        var sourceId = await ipc.invoke('zcall-ui-screen-source');
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            mandatory: {
              chromeMediaSource: 'desktop',
              chromeMediaSourceId: sourceId,
              maxWidth: 1920,
              maxHeight: 1080,
              maxFrameRate: 15,
            },
          },
        });
      } catch (e) {
        send({ action: 'screen', on: false });
        sendWindow('expand');
        toast('Không chia sẻ được màn hình: ' + errorText(e));
        if (local.cameraWasOn) await startCamera();
        updateButtons();
        return;
      }
    }
    try {
      // Người dùng tắt share từ hộp hệ thống → tự dừng bên mình.
      try {
        var tracks = stream.getVideoTracks() || [];
        if (tracks.length && typeof tracks[0] !== 'undefined') {
          tracks[0].onended = function () {
            if (local.screenOn) stopScreen();
          };
        }
      } catch (_) {}
      await startCapture(stream, true);
      local.screenOn = true;
      document.body.classList.add('video');
      send({ action: 'screen', on: true });
      toast('Đang chia sẻ màn hình');
    } catch (e) {
      try { stream.getTracks().forEach(function (t) { try { t.stop(); } catch (_) {} }); } catch (_) {}
      send({ action: 'screen', on: false });
      sendWindow('expand');
      toast('Không chia sẻ được màn hình: ' + errorText(e));
      if (local.cameraWasOn) await startCamera();
    }
    updateButtons();
  }

  function stopScreen() {
    stopEncoder();
    local.screenOn = false;
    if (local.screenNative) {
      local.screenNative = false;
      try { send({ action: 'screenNative', on: false }); } catch (_) {}
    }
    if (!state.video && !state.group) document.body.classList.remove('video');
    send({ action: 'screen', on: false });
    sendWindow('expand');
    if (local.cameraWasOn) startCamera();
    else updateButtons();
  }

  // Hộp chọn màn hình cho getDisplayMedia (main giữ callback, renderer cho
  // người dùng chọn). Mỗi lần hiện là một request mới; đóng hộp luôn trả lời
  // main (sourceId hoặc null) để getDisplayMedia không treo.
  var screenPickOpen = false;
  // Kết quả share native từ engine ('zcall-ui-screen-native').
  var pendingNativeResolve = null;
  var nativeTimer = null;

  function waitNativeResult(timeoutMs) {
    return new Promise(function (resolve) {
      if (nativeTimer) clearTimeout(nativeTimer);
      pendingNativeResolve = resolve;
      nativeTimer = setTimeout(function () {
        pendingNativeResolve = null;
        nativeTimer = null;
        try { send({ action: 'screenNative', on: false }); } catch (_) {}
        resolve({ ok: false, error: 'hết giờ chờ hộp chọn hệ thống' });
      }, timeoutMs);
    });
  }

  function onNativeResult(m) {
    if (!pendingNativeResolve) return;
    var resolve = pendingNativeResolve;
    pendingNativeResolve = null;
    if (nativeTimer) { clearTimeout(nativeTimer); nativeTimer = null; }
    resolve({ ok: !!(m && m.ok), error: (m && m.error) || '' });
  }

  function finishScreenPick(sourceId) {
    if (!screenPickOpen) return;
    screenPickOpen = false;
    if (el.screenPicker) el.screenPicker.classList.add('hidden');
    if (ipc) {
      try { ipc.send('zcall-ui-pick-screen-done', sourceId || null); } catch (_) {}
    }
  }

  function showScreenPicker() {
    if (!el.screenPicker || !el.screenPickerList) {
      finishScreenPick(null);
      return;
    }
    screenPickOpen = true;
    el.screenPicker.classList.remove('hidden');
    el.screenPickerList.textContent = '';
    var loading = document.createElement('div');
    loading.className = 'screen-pick loading';
    loading.textContent = 'Đang tải danh sách màn hình…';
    el.screenPickerList.appendChild(loading);
    invoke('zcall-ui-screen-sources').then(function (list) {
      if (!screenPickOpen) return;
      el.screenPickerList.textContent = '';
      if (!list || !list.length) {
        var none = document.createElement('div');
        none.className = 'screen-pick loading';
        none.textContent = 'Không tìm thấy màn hình';
        el.screenPickerList.appendChild(none);
        return;
      }
      // Màn hình trước, cửa sổ sau — đúng nhu cầu nhiều màn.
      list.sort(function (a, b) { return (b.screen - a.screen); });
      list.forEach(function (s) {
        var b = document.createElement('button');
        b.className = 'screen-pick';
        b.type = 'button';
        var img = document.createElement('img');
        img.alt = '';
        if (s.thumb) img.src = s.thumb;
        var label = document.createElement('span');
        label.textContent = (s.screen ? 'Màn hình: ' : '') + (s.name || s.id);
        label.title = s.name || s.id;
        b.appendChild(img);
        b.appendChild(label);
        b.addEventListener('click', function () { finishScreenPick(s.id); });
        el.screenPickerList.appendChild(b);
      });
    }).catch(function () {
      if (!screenPickOpen) return;
      el.screenPickerList.textContent = '';
      var err = document.createElement('div');
      err.className = 'screen-pick loading';
      err.textContent = 'Không tải được danh sách';
      el.screenPickerList.appendChild(err);
    });
  }

  function manageMedia() {
    if (phase === 'ended' || phase === 'idle') {
      stopCamera(true);
      local.screenOn = false;
      updateButtons();
      return;
    }
    var canOpen = (state.video || state.group) &&
      (phase === 'outgoing' || phase === 'connecting' || phase === 'connected');
    if (canOpen && local.cameraOn && !local.screenOn && !enc.stream && !cameraOpening) {
      startCamera();
    } else if ((!canOpen || !local.cameraOn || local.screenOn) && enc.stream && !enc.screen) {
      stopCamera(false);
    }
  }

  /* ----------------------------------------------------------- devices */

  function row(labelText, active, onClick) {
    var d = document.createElement('div');
    d.className = 'dev-row' + (active ? ' active' : '');
    var dot = document.createElement('span');
    dot.className = 'dot';
    var span = document.createElement('span');
    span.textContent = labelText;
    d.appendChild(dot);
    d.appendChild(span);
    d.addEventListener('click', onClick);
    return d;
  }

  function emptyRow(text) {
    var d = document.createElement('div');
    d.className = 'dev-row empty';
    var span = document.createElement('span');
    span.textContent = text;
    d.appendChild(span);
    return d;
  }

  function renderDeviceLists() {
    var d = local.devices || {};
    var mics = Array.isArray(d.mics) ? d.mics : [];
    var speakers = Array.isArray(d.speakers) ? d.speakers : [];
    var micSel = local.micId || '';
    var spkSel = local.speakerId || '';
    // Nếu thiết bị đã chọn không còn trong danh sách (node ảo bị ẩn) → coi là "Mặc định".
    var micInList = mics.some(function (m) { return m && m.id === micSel; });
    var spkInList = speakers.some(function (s) { return s && s.id === spkSel; });
    var micDefaultActive = !micSel || !micInList;
    var spkDefaultActive = !spkSel || !spkInList;

    if (el.micList) {
      el.micList.textContent = '';
      el.micList.appendChild(row('Mặc định (tự động)', micDefaultActive, function () {
        chooseDevice('mic', '', '');
      }));
      mics.forEach(function (m) {
        el.micList.appendChild(row(m.label || m.id, micSel === m.id, function () {
          chooseDevice('mic', m.id, m.label);
        }));
      });
      if (!mics.length) el.micList.appendChild(emptyRow(local.devices ? 'Không có thiết bị' : 'Đang tải…'));
    }

    if (el.micVolume) {
      var pct = Number(d.micVolume);
      if (!isFinite(pct)) pct = 100;
      pct = Math.max(0, Math.min(100, Math.round(pct)));
      if (document.activeElement !== el.micVolume) el.micVolume.value = pct;
      if (el.micVolumeValue) el.micVolumeValue.textContent = pct + '%';
    }

    if (el.speakerList) {
      el.speakerList.textContent = '';
      el.speakerList.appendChild(row('Mặc định (tự động)', spkDefaultActive, function () {
        chooseDevice('speaker', '', '');
      }));
      speakers.forEach(function (s) {
        el.speakerList.appendChild(row(s.label || s.id, spkSel === s.id, function () {
          chooseDevice('speaker', s.id, s.label);
        }));
      });
      if (!speakers.length) el.speakerList.appendChild(emptyRow(local.devices ? 'Không có thiết bị' : 'Đang tải…'));
    }

    if (el.cameraList) {
      el.cameraList.textContent = '';
      el.cameraList.appendChild(row('Mặc định', !local.cameraId, function () {
        chooseDevice('camera', '', '');
      }));
      local.cameras.forEach(function (c) {
        el.cameraList.appendChild(row(c.label || c.id, local.cameraId === c.id, function () {
          chooseDevice('camera', c.id, c.label);
        }));
      });
      if (!local.cameras.length) el.cameraList.appendChild(emptyRow('Không có camera'));
    }
  }

  var refreshInFlight = null;

  async function refreshDevices() {
    if (refreshInFlight) return refreshInFlight;
    refreshInFlight = (async function () {
      // 1) mics/loa: hiện ngay khi engine trả lời (không chờ camera).
      try {
        var d = await invoke('zcall-ui-devices');
        local.devices = d || {};
        var p = (d && d.prefs) || {};
        local.micId = p.mic || '';
        local.speakerId = p.speaker || '';
        local.cameraId = p.camera && p.camera.id ? String(p.camera.id) : '';
        renderDeviceLists();
        updateButtons();
      } catch (_) { /* keep what we have */ }

      // 2) camera: liệt kê riêng, khử trùng tên; xong mới vẽ lại phần camera.
      try {
        if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
          var list = await navigator.mediaDevices.enumerateDevices();
          var seen = {};
          local.cameras = list
            .filter(function (x) { return x.kind === 'videoinput'; })
            .map(function (x, i) { return { id: x.deviceId, label: x.label || ('Camera ' + (i + 1)) }; })
            .filter(function (c) {
              var key = String(c.label || '').trim().toLowerCase();
              if (!key || seen[key]) return false;
              seen[key] = true;
              return true;
            });
        }
      } catch (_) { /* no permission yet */ }

      renderDeviceLists();
      updateButtons();
    })();
    try { await refreshInFlight; } finally { refreshInFlight = null; }
  }

  async function chooseDevice(kind, id, label) {
    if (kind === 'mic') {
      local.micId = id;
      send({ action: 'device', kind: 'mic', id: id, label: label || '' });
    } else if (kind === 'speaker') {
      local.speakerId = id;
      send({ action: 'device', kind: 'speaker', id: id, label: label || '' });
    } else if (kind === 'camera') {
      local.cameraId = id;
      send({ action: 'device', kind: 'camera', id: id, label: label || '' });
      if (local.cameraOn && !local.screenOn) {
        stopCamera(true);
        local.cameraOn = true;
        await startCamera();
      }
    }
    renderDeviceLists();
    updateButtons();
  }

  function toggleDeviceMenu(force) {
    if (!el.deviceMenu) return;
    var open = typeof force === 'boolean' ? force : el.deviceMenu.classList.contains('hidden');
    if (open) {
      el.deviceMenu.classList.remove('hidden');
      renderDeviceLists();
      refreshDevices();
    } else {
      el.deviceMenu.classList.add('hidden');
    }
  }

  /* ----------------------------------------------------------- actions */

  function toggleMic() {
    local.micOn = !local.micOn;
    send({ action: 'mute', on: !local.micOn });
    updateButtons();
  }

  async function cycleSpeakerDevice() {
    await refreshDevices();
    var d = local.devices || {};
    var speakers = Array.isArray(d.speakers)
      ? d.speakers.filter(function (s) { return s && s.id; })
      : [];
    if (!local.speakerOn) {
      local.speakerOn = true;
      send({ action: 'speaker', on: false });
    }
    if (speakers.length >= 2) {
      var activeId = local.speakerId || d.defaultSpeaker || '';
      var curIdx = -1;
      for (var i = 0; i < speakers.length; i++) {
        if (speakers[i].id === activeId) {
          curIdx = i;
          break;
        }
      }
      var next = speakers[(curIdx + 1) % speakers.length];
      await chooseDevice('speaker', next.id, next.label || next.id);
      toast('Loa: ' + (next.label || next.id));
      return;
    }
    if (speakers.length === 1) {
      var only = speakers[0];
      await chooseDevice('speaker', only.id, only.label || only.id);
      if (el.deviceMenu) el.deviceMenu.classList.remove('hidden');
      toast('Loa: ' + (only.label || only.id) + ' (1 thiết bị)');
      return;
    }
    if (el.deviceMenu) el.deviceMenu.classList.remove('hidden');
    toast('Không tìm thấy thiết bị loa khác');
  }

  function toggleCamera() {
    if (!(state.video || state.group)) { toast('Cuộc gọi thoại không có camera'); return; }
    if (local.screenOn) { toast('Đang chia sẻ màn hình'); return; }
    if (local.cameraOn) {
      stopCamera();
      send({ action: 'camera', on: false });
    } else {
      local.cameraOn = true;
      startCamera().then(function () {
        if (local.cameraOn) send({ action: 'camera', on: true });
      });
    }
    updateButtons();
  }

  function toggleScreen() {
    if (!(state.video || state.group)) { toast('Cuộc gọi thoại không chia sẻ màn hình'); return; }
    if (local.screenAwaitNative) {
      // Đang chờ hộp chọn hệ thống: bấm nữa là hủy.
      local.screenAwaitNative = false;
      try { send({ action: 'screenNative', on: false }); } catch (_) {}
      if (pendingNativeResolve) {
        var resolve = pendingNativeResolve;
        pendingNativeResolve = null;
        if (nativeTimer) { clearTimeout(nativeTimer); nativeTimer = null; }
        resolve({ ok: false, error: 'đã hủy' });
      }
      if (local.cameraWasOn) startCamera();
      updateButtons();
      return;
    }
    if (local.screenOn) stopScreen();
    else startScreen();
  }

  function hangup() {
    stopAllSounds();
    stopCamera(true);
    if (el.phaseText) {
      el.phaseText.textContent = 'Đang kết thúc…';
      el.phaseText.classList.remove('hidden');
    }
    if (el.btnHangup) el.btnHangup.disabled = true;
    send({ action: 'hangup' });
  }

  /* ------------------------------------------------------------ window */

  function setCompactUI(on) {
    local.compact = !!on;
    document.body.classList.toggle('compact', local.compact);
    updateButtons();
  }

  function setMaximizedUI(on) {
    local.maximized = !!on;
    document.body.classList.toggle('maximized', local.maximized);
    updateButtons();
  }

  function setFullscreenUI(on) {
    local.fullscreen = !!on;
    document.body.classList.toggle('fullscreen', local.fullscreen);
    updateButtons();
  }

  function toggleFullscreen() {
    sendWindow(local.fullscreen ? 'leave-fullscreen' : 'fullscreen');
  }

  /* ------------------------------------------------------------- wire */

  function bindPressRelease(btn) {
    if (!btn) return;
    btn.addEventListener('animationend', function () {
      btn.classList.remove('is-releasing');
    });
    btn.addEventListener('click', function (e) {
      if (btn.disabled) return;
      btn.classList.remove('is-releasing');
      void btn.offsetWidth;
      btn.classList.add('is-releasing');
      if (e && e.detail > 0 && typeof btn.blur === 'function') {
        btn.blur();
      }
    });
  }

  [
    el.btnMic,
    el.btnSpeaker,
    el.btnCamera,
    el.btnScreen,
    el.btnDevices,
    el.btnHangup,
    el.btnCompact,
    el.btnFullscreen,
    el.btnMenuClose,
  ].forEach(bindPressRelease);

  function on(id, event, fn) {
    var node = $(id);
    if (node) node.addEventListener(event, fn);
  }

  on('btnMic', 'click', function (e) { e.stopPropagation(); toggleMic(); });
  on('btnSpeaker', 'click', function (e) { e.stopPropagation(); cycleSpeakerDevice(); });
  on('btnCamera', 'click', function (e) { e.stopPropagation(); toggleCamera(); });
  on('btnScreen', 'click', function (e) { e.stopPropagation(); toggleScreen(); });
  on('btnHangup', 'click', function (e) { e.stopPropagation(); hangup(); });
  on('btnDevices', 'click', function (e) {
    e.stopPropagation();
    toggleDeviceMenu();
  });
  on('btnMenuClose', 'click', function (e) {
    e.stopPropagation();
    toggleDeviceMenu(false);
  });
  function sendMicVolume() {
    if (!el.micVolume) return;
    var v = Number(el.micVolume.value);
    if (!isFinite(v)) return;
    v = Math.max(0, Math.min(100, Math.round(v)));
    if (el.micVolumeValue) el.micVolumeValue.textContent = v + '%';
    if (v === micVolumeLast) return;
    micVolumeLast = v;
    send({ action: 'micVolume', value: v });
  }
  on('micVolume', 'input', function () {
    if (el.micVolumeValue && el.micVolume) el.micVolumeValue.textContent = el.micVolume.value + '%';
    if (micVolumeTimer) return;
    micVolumeTimer = setTimeout(function () {
      micVolumeTimer = null;
      sendMicVolume();
    }, 150);
  });
  on('micVolume', 'change', function () {
    if (micVolumeTimer) { clearTimeout(micVolumeTimer); micVolumeTimer = null; }
    sendMicVolume();
  });
  on('btnCompact', 'click', function (e) {
    e.stopPropagation();
    sendWindow(local.compact ? 'expand' : 'compact');
  });
  on('btnFullscreen', 'click', function (e) {
    e.stopPropagation();
    toggleFullscreen();
  });
  on('btnMembers', 'click', function (e) {
    e.stopPropagation();
    setMembersOpen(!membersOpen);
  });
  on('membersClose', 'click', function (e) {
    e.stopPropagation();
    setMembersOpen(false);
  });
  on('membersAdd', 'click', function (e) {
    e.stopPropagation();
    if (!friendsMode) openFriendsPicker();
  });
  on('membersInvite', 'click', function (e) {
    e.stopPropagation();
    submitInvite();
  });
  on('membersSearch', 'input', function () {
    renderFriends();
  });
  on('membersBack', 'click', function (e) {
    e.stopPropagation();
    friendsMode = false;
    if (el.membersAddView) el.membersAddView.hidden = true;
    if (el.membersList) el.membersList.hidden = false;
    if (el.membersAddLabel) el.membersAddLabel.textContent = 'Thêm thành viên';
  });
  on('btnGroupView', 'click', function (e) { e.stopPropagation(); toggleGroupView(); });
  on('btnPagePrev', 'click', function (e) { e.stopPropagation(); setGroupPage(-1); });
  on('btnPageNext', 'click', function (e) { e.stopPropagation(); setGroupPage(1); });

  var stage = document.querySelector('.stage');
  if (stage) {
    stage.addEventListener('dblclick', function () {
      if (document.body.classList.contains('video')) toggleFullscreen();
    });
  }

  document.addEventListener('click', function (e) {
    if (membersOpen && el.membersPop && !el.membersPop.contains(e.target)
      && !(el.btnMembers && el.btnMembers.contains(e.target))) {
      setMembersOpen(false);
    }
    if (!el.deviceMenu || el.deviceMenu.classList.contains('hidden')) return;
    if (el.deviceMenu.contains(e.target) || (el.btnDevices && el.btnDevices.contains(e.target))) return;
    toggleDeviceMenu(false);
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && screenPickOpen) { finishScreenPick(null); return; }
    if (e.key === 'Escape' && membersOpen) setMembersOpen(false);
    else if (e.key === 'Escape' && local.fullscreen) sendWindow('leave-fullscreen');
    else if (e.key === 'F11') { e.preventDefault(); toggleFullscreen(); }
    else if (e.key === 'm' || e.key === 'M') toggleMic();
  });

  if (ipc) {
    ipc.on('zcall-ui-state', function (_e, s) { applyState(s); });
    ipc.on('zcall-ui-keyframe', function () { forceKey = true; });
    ipc.on('zcall-ui-speaking', function (_e, m) { onSpeaking(m); });
    ipc.on('zcall-ui-mic-level', function (_e, level) {
      if (!el.micMeter) return;
      var v = Number(level) || 0;
      if (v > 1) v = v / 100;
      v = Math.max(0, Math.min(1, v));
      el.micMeter.style.width = Math.round(v * 100) + '%';
    });
    ipc.on('zcall-ui-video', function (_e, m) { onVideoMessage(m); });
    ipc.on('zcall-ui-fullscreen', function (_e, on) { setFullscreenUI(on); });
    ipc.on('zcall-ui-maximized', function (_e, on) { setMaximizedUI(on); });
    ipc.on('zcall-ui-compact', function (_e, on) { setCompactUI(on); });
    ipc.on('zcall-ui-pick-screen', function () { showScreenPicker(); });
    ipc.on('zcall-ui-screen-native', function (_e, m) { onNativeResult(m); });
  }
  on('btnScreenPickerClose', 'click', function (e) {
    e.stopPropagation();
    finishScreenPick(null);
  });
  if (el.screenPicker) {
    el.screenPicker.addEventListener('click', function (e) {
      if (e.target === el.screenPicker) finishScreenPick(null);
    });
  }

  /* ------------------------------------------------------------ start */

  if (el.brandIcon) el.brandIcon.src = 'zalux-logo.png';
  if (el.peerAvatar) el.peerAvatar.src = icon('zalo_logo.png');
  var svgNodes = document.querySelectorAll('[data-svg]');
  for (var si = 0; si < svgNodes.length; si++) {
    var sn = svgNodes[si];
    var sname = sn.getAttribute('data-svg');
    if (sname && SVG_ICONS[sname]) sn.innerHTML = SVG_ICONS[sname];
  }

  loadSounds();
  updateButtons();
  refreshDevices();
  startTimer();
  cameraWatchdogId = setInterval(checkCameraHealth, 1500);

  window.addEventListener('beforeunload', function () {
    if (cameraWatchdogId) clearInterval(cameraWatchdogId);
    if (encRecoveryTimer) clearTimeout(encRecoveryTimer);
    if (camRestartTimer) clearTimeout(camRestartTimer);
    stopAllSounds();
    stopTimer();
    stopEncoder();
    closeDecoder();
  });

  // Exposed for automated video pipeline verification and smoke testing.
  window.ZCallUI = {
    applyState: applyState,
    onVideoMessage: onVideoMessage,
    startSyntheticStream: function (stream) {
      local.cameraOn = true;
      return startCapture(stream, false);
    },
    stats: function () {
      return {
        txEncodedFrames: txEncodedFrames,
        txKeyFrames: txKeyFrames,
        rxDecodedFrames: rxDecodedFrames,
        gotFrame: gotFrame,
        hasVideoClass: document.body.classList.contains('has-video'),
        encWidth: enc.width,
        encHeight: enc.height,
        encFps: enc.fps,
        encBitrate: enc.bitrate,
        peerWidth: el.peerVideo ? el.peerVideo.width : 0,
        peerHeight: el.peerVideo ? el.peerVideo.height : 0,
        videoOrient: orient,
        groupView: group.view,
        groupTiles: Object.keys(group.tiles).length,
        groupPages: group.view_pages,
        hasTallClass: document.body.classList.contains('vid-tall'),
      };
    },
    /** Hình học các ô hiện tại (cho test layout): toạ độ tương đối #groupGrid. */
    groupSnapshot: function () {
      var g = el.groupGrid;
      var tiles = Array.prototype.map.call(g.querySelectorAll('.tile'), function (t) {
        return {
          id: t.getAttribute('data-id'),
          focus: t.classList.contains('focus'),
          speaking: t.classList.contains('speaking'),
          muted: t.classList.contains('muted'),
          name: (t.querySelector('.tile-name > span') || {}).textContent || '',
          initials: (t.querySelector('div.avatar') || {}).textContent || '',
          hasImg: !!t.querySelector('img.avatar'),
          x: parseFloat(t.style.left), y: parseFloat(t.style.top),
          w: parseFloat(t.style.width), h: parseFloat(t.style.height),
        };
      });
      return {
        W: g.clientWidth, H: g.clientHeight, view: group.view, page: group.page, pages: group.view_pages,
        toggleHidden: el.btnGroupView ? el.btnGroupView.classList.contains('hidden') : true,
        pagerHidden: el.groupPager ? el.groupPager.classList.contains('hidden') : true,
        tiles: tiles,
      };
    },
    demo: function (overrides) {
      applyState(Object.assign({
        phase: 'connected',
        name: 'Zalo',
        text: '',
        since: Date.now(),
        video: false,
        muted: false,
        speakerOff: false,
      }, overrides || {}));
    },
    state: function () { return state; },
  };
})();

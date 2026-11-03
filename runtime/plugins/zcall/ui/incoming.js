/*
 * plugins/zcall/ui/incoming.js
 *
 * Incoming call notice page. ../bridge.js shows it for
 * phase 'incoming' and sends zcall-incoming-state / zcall-incoming-stop.
 * Answering sends zcall-incoming-answer { camStartOff }; declining sends
 * zcall-ui-action { action:'reject' }.
 */
'use strict';

(function () {
  var ipc = null;
  try { ipc = require('electron').ipcRenderer; } catch (_) { /* not Electron */ }

  var A = window.ZCallAssets || {
    iconUrl: function () { return ''; },
    avatar: function (src) { return src || ''; },
    sound: function (name) { return ''; },
  };

  function $(id) { return document.getElementById(id); }

  var el = {
    peerAvatar: $('peerAvatar'),
    peerName: $('peerName'),
    peerText: $('peerText'),
    kindText: $('kindText'),
    btnAcceptAudio: $('btnAcceptAudio'),
    btnAcceptVideo: $('btnAcceptVideo'),
    labelAcceptAudio: $('labelAcceptAudio'),
    btnReject: $('btnReject'),
    btnRejectTop: $('btnRejectTop'),
    iconAcceptNoCam: $('iconAcceptNoCam'),
    svgAcceptPhone: $('svgAcceptPhone'),
    iconAcceptVideo: $('iconAcceptVideo'),
    svgAcceptVideo: $('svgAcceptVideo'),
  };

  var state = {};
  var ringtone = null;
  var ringing = false;
  var soundUrls = {};

  function icon(name) { return A.iconUrl(name); }

  function errorText(err) {
    return err && err.message ? err.message : String(err);
  }

  function loadSoundUrls() {
    if (!ipc) return;
    ipc.invoke('zcall-ui-sounds').then(function (map) {
      if (map && typeof map === 'object') soundUrls = map;
      // A custom ringtone replaces the bundled one once its URL is known.
      if (ringing) { stopRingtone(); startRingtone(); }
    }).catch(function () { /* use bundled sound */ });
  }

  function ringtoneUrl() {
    if (soundUrls && soundUrls.ringtone) return soundUrls.ringtone;
    return A.sound('zalo_ringtone.mp3');
  }

  function startRingtone() {
    if (ringing) return;
    var url = ringtoneUrl();
    if (!url) return;
    try {
      ringtone = new Audio(url);
      ringtone.loop = true;
      ringtone.volume = 0.8;
      ringtone.addEventListener('error', function () { stopRingtone(); });
      ringtone.play().catch(function () { /* autoplay policy */ });
      ringing = true;
    } catch (e) {
      console.error('[zcall-incoming] ringtone:', errorText(e));
    }
  }

  function stopRingtone() {
    if (!ringtone) return;
    try { ringtone.pause(); ringtone.currentTime = 0; } catch (_) { /* ignore */ }
    ringtone = null;
    ringing = false;
  }

  function answer(camStartOff) {
    stopRingtone();
    if (ipc) {
      try { ipc.send('zcall-incoming-answer', { camStartOff: !!camStartOff }); } catch (_) { /* main gone */ }
    }
  }

  function reject() {
    stopRingtone();
    if (ipc) {
      try { ipc.send('zcall-ui-action', { action: 'reject' }); } catch (_) { /* main gone */ }
    }
  }

  function render(s) {
    if (!s || typeof s !== 'object') return;
    state = s;

    var isVideo = !!s.video;
    if (el.kindText) {
      el.kindText.textContent = s.group
        ? 'Cuộc gọi nhóm đến'
        : (isVideo ? 'Cuộc gọi video đến' : 'Cuộc gọi thoại đến');
    }
    if (el.peerName) el.peerName.textContent = s.name || 'Zalux';
    if (el.peerAvatar) el.peerAvatar.src = A.avatar(s.avatar) || icon('zalo_logo.png');
    if (el.peerText) {
      el.peerText.textContent = s.text || (isVideo ? 'Trả lời để bật camera' : 'Nhấn để trả lời');
    }

    // A video call offers "answer with video" and "answer without camera" using official Zalo assets.
    if (el.btnAcceptVideo) {
      el.btnAcceptVideo.classList.toggle('hidden', !(isVideo && !s.noAnswer));
      var camOnAsset = A.exists && A.exists('icon/resources/svg/camon.svg') ? icon('camon.svg') : '';
      if (camOnAsset && el.iconAcceptVideo && el.svgAcceptVideo) {
        el.iconAcceptVideo.src = camOnAsset;
        el.iconAcceptVideo.classList.remove('hidden');
        el.svgAcceptVideo.classList.add('hidden');
      }
    }
    if (el.btnAcceptAudio) {
      el.btnAcceptAudio.title = isVideo ? 'Trả lời không mở camera' : 'Trả lời';
      el.btnAcceptAudio.classList.toggle('nocam', isVideo);
      el.btnAcceptAudio.classList.toggle('accept', !isVideo);
      var noCamAsset = '';
      if (A.exists) {
        if (A.exists('icon/resources/offical/icn-call-accept-videocall-no-camera@3x.png')) {
          noCamAsset = icon('icn-call-accept-videocall-no-camera@3x.png');
        } else if (A.exists('icon/resources/svg/camoff.svg')) {
          noCamAsset = icon('camoff.svg');
        } else if (A.exists('icon2/resources/offical-v2/cam_off_solid.png')) {
          noCamAsset = icon('cam_off_solid.png');
        }
      }
      if (isVideo && noCamAsset && el.iconAcceptNoCam && el.svgAcceptPhone) {
        el.iconAcceptNoCam.src = noCamAsset;
        el.iconAcceptNoCam.classList.remove('hidden');
        el.svgAcceptPhone.classList.add('hidden');
      } else if (el.iconAcceptNoCam && el.svgAcceptPhone) {
        el.iconAcceptNoCam.classList.add('hidden');
        el.svgAcceptPhone.classList.remove('hidden');
      }
    }
    if (el.labelAcceptAudio) el.labelAcceptAudio.textContent = isVideo ? 'Không mở camera' : 'Trả lời';

    document.title = 'Zalux: ' + (s.name || 'cuộc gọi đến');
    startRingtone();
  }

  if (ipc) {
    ipc.on('zcall-incoming-state', function (_e, s) { render(s); });
    ipc.on('zcall-incoming-stop', function () {
      stopRingtone();
    });
  }

  function bindPressRelease(btn) {
    if (!btn) return;
    var clearRelease = function () {
      btn.classList.remove('is-releasing');
    };
    btn.addEventListener('animationend', clearRelease);
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

  [el.btnAcceptVideo, el.btnAcceptAudio, el.btnReject, el.btnRejectTop].forEach(bindPressRelease);

  if (el.btnAcceptVideo) {
    el.btnAcceptVideo.addEventListener('click', function () { answer(false); });
  }
  if (el.btnAcceptAudio) {
    el.btnAcceptAudio.addEventListener('click', function () { answer(!!state.video); });
  }
  if (el.btnReject) el.btnReject.addEventListener('click', reject);
  if (el.btnRejectTop) el.btnRejectTop.addEventListener('click', reject);

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') reject();
    else if (e.key === 'Enter') answer(!!state.video);
  });

  window.addEventListener('beforeunload', stopRingtone);

  if (el.peerAvatar) el.peerAvatar.src = icon('zalo_logo.png');

  loadSoundUrls();

  // Exposed for a smoke test / screenshot without an engine.
  window.ZCallIncoming = {
    render: render,
    demo: function (overrides) {
      render(Object.assign({
        phase: 'incoming',
        name: 'Zalo',
        text: 'Cuộc gọi video đến',
        video: true,
      }, overrides || {}));
    },
  };
})();

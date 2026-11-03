/*
 * plugins/zcall/ui/assets.js
 *
 * Resolves Zalo's extracted call assets (build/zcall-assets) for the local
 * call/incoming pages. The pages are loaded with ?assets=<absolute dir> and
 * run with nodeIntegration (see ../bridge.js), so file:// URLs are built with
 * Node's path/url modules. In a plain browser the same helpers degrade to
 * relative paths.
 */
'use strict';

(function (global) {
  var params = new URLSearchParams(global.location.search || '');
  var root = params.get('assets') || '';

  var fs = null;
  var path = null;
  var pathToFileURL = null;
  try {
    fs = require('fs');
    path = require('path');
    pathToFileURL = require('url').pathToFileURL;
  } catch (_) {
    /* plain browser / no Node integration */
  }

  var ICON_DIRS = [
    'icon2/resources/offical-v2/',
    'icon/resources/offical/',
    'icon/resources/svg/'
  ];

  function join(rel) {
    if (!root) return rel;
    if (/^[a-z][a-z0-9+.-]*:/i.test(root)) {
      return root.replace(/\/+$/, '') + '/' + String(rel).replace(/^\/+/, '');
    }
    if (path) return path.join(root, rel);
    return root.replace(/\/+$/, '') + '/' + String(rel).replace(/^\/+/, '');
  }

  function toUrl(p) {
    if (!p) return '';
    if (/^[a-z][a-z0-9+.-]*:/i.test(p)) return p;
    try {
      return pathToFileURL ? pathToFileURL(p).href : p;
    } catch (_) {
      return p;
    }
  }

  function exists(rel) {
    if (!fs || !path || !root) return false;
    try {
      return fs.existsSync(path.join(root, rel));
    } catch (_) {
      return false;
    }
  }

  function iconUrl(name) {
    for (var i = 0; i < ICON_DIRS.length; i++) {
      var rel = ICON_DIRS[i] + name;
      if (exists(rel)) return toUrl(join(rel));
    }
    return toUrl(join(ICON_DIRS[0] + name));
  }

  global.ZCallAssets = {
    root: root,
    url: function (rel) { return toUrl(join(rel)); },
    iconUrl: iconUrl,
    sound: function (name) { return toUrl(join('sound/' + name)); },
    avatar: function (src) {
      if (!src) return iconUrl('zalo_logo.png');
      if (/^(https?:|data:|file:)/i.test(src)) return src;
      return toUrl(join(src));
    },
    exists: exists
  };
})(window);

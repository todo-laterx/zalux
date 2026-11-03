/*
 * plugins/zcall/ui/group-layout.js — Thuật toán xếp ô cuộc gọi nhóm kiểu Zoom (thuần, không DOM).
 *
 * Dùng chung: renderer (`call.js`, qua window.ZCallGroupLayout) và main (`bridge.js`, qua require) + test Node.
 *
 *   gallery(n, W, H, opts)      -> { cols, rows, w, h, tiles:[{x,y,w,h}] }   lưới tự chọn cột×hàng để ô LỚN nhất
 *   perPage(W, H, opts)         -> số ô tối đa mỗi trang mà ô vẫn >= minTileW (kẹp 1..max)
 *   speaker(count, W, H, opts)  -> { main:{x,y,w,h}, strip:[{x,y,w,h}], orientation, visible }  người nói to + dải thumbnail
 *   windowSizeForCount(n, area) -> { width, height }  cỡ cửa sổ hợp lý theo số người (đã kẹp theo màn hình)
 *   isZoomMode(n)               -> n >= ZOOM_MIN (3): bật gallery/speaker, phân trang, tự co giãn cửa sổ
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ZCallGroupLayout = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  var ZOOM_MIN = 3;
  var DEFAULTS = { gap: 8, aspect: 16 / 9, minTileW: 170, max: 25 };

  function opt(o, k) { return o && o[k] != null ? o[k] : DEFAULTS[k]; }

  function isZoomMode(n) { return n >= ZOOM_MIN; }

  /** Lưới: chọn số cột để ô (đúng tỉ lệ `aspect`) có diện tích lớn nhất; hàng cuối thiếu ô thì căn giữa. */
  function gallery(n, W, H, o) {
    n = Math.max(0, Math.floor(n));
    var gap = opt(o, 'gap');
    var aspect = opt(o, 'aspect');
    var out = { cols: 0, rows: 0, w: 0, h: 0, tiles: [] };
    if (n === 0 || W <= 0 || H <= 0) return out;

    var best = null;
    for (var c = 1; c <= n; c++) {
      var r = Math.ceil(n / c);
      var cellW = (W - (c - 1) * gap) / c;
      var cellH = (H - (r - 1) * gap) / r;
      if (cellW <= 0 || cellH <= 0) continue;
      var w = Math.min(cellW, cellH * aspect);
      var h = w / aspect;
      var area = w * h;
      // ưu tiên diện tích lớn; hoà thì ít hàng trống hơn (r*c - n nhỏ), rồi ít cột hơn
      var waste = r * c - n;
      if (!best || area > best.area + 0.5 || (Math.abs(area - best.area) <= 0.5 && waste < best.waste)) {
        best = { c: c, r: r, w: w, h: h, area: area, waste: waste };
      }
    }
    if (!best) return out;

    var cols = best.c;
    var rows = best.r;
    var tw = Math.floor(best.w);
    var th = Math.floor(best.h);
    var totalH = rows * th + (rows - 1) * gap;
    var y0 = Math.max(0, Math.floor((H - totalH) / 2));
    for (var i = 0; i < n; i++) {
      var row = Math.floor(i / cols);
      var col = i % cols;
      var inRow = row === rows - 1 ? n - cols * (rows - 1) : cols;
      var rowW = inRow * tw + (inRow - 1) * gap;
      var x0 = Math.max(0, Math.floor((W - rowW) / 2));
      out.tiles.push({ x: x0 + col * (tw + gap), y: y0 + row * (th + gap), w: tw, h: th });
    }
    out.cols = cols;
    out.rows = rows;
    out.w = tw;
    out.h = th;
    return out;
  }

  /**
   * Xếp ô theo **tỉ lệ riêng của từng khung hình** (1–2 người): mỗi ô giữ đúng
   * aspect của stream (điện thoại dọc 9:16, PC ngang 16:9) và phóng to nhất có thể.
   * Trả `{tiles:[{x,y,w,h}], cols, rows, w, h}`.
   */
  function fitAspects(aspects, W, H, o) {
    var gap = opt(o, 'gap');
    var as = (aspects || []).map(function (a) { return Number(a) > 0.05 ? Number(a) : 16 / 9; });
    var out = { cols: 0, rows: 0, w: 0, h: 0, tiles: [] };
    if (!as.length || W <= 0 || H <= 0) return out;

    if (as.length === 1) {
      var a = as[0];
      var w = Math.min(W, H * a);
      var h = w / a;
      if (h > H) { h = H; w = h * a; }
      out.tiles.push({ x: Math.floor((W - w) / 2), y: Math.floor((H - h) / 2), w: Math.floor(w), h: Math.floor(h) });
      out.cols = out.rows = 1; out.w = Math.floor(w); out.h = Math.floor(h);
      return out;
    }

    if (as.length === 2) {
      var a0 = as[0], a1 = as[1];
      // 1) cạnh nhau, cùng cao H
      if (H * (a0 + a1) + gap <= W) {
        var w0 = Math.floor(H * a0), w1 = Math.floor(H * a1);
        var totalW = w0 + w1 + gap;
        var x0 = Math.floor((W - totalW) / 2);
        out.tiles.push({ x: x0, y: 0, w: w0, h: H });
        out.tiles.push({ x: x0 + w0 + gap, y: 0, w: w1, h: H });
        out.cols = 2; out.rows = 1; out.w = Math.min(w0, w1); out.h = H;
        return out;
      }
      // 2) xếp dọc, cùng rộng W
      if (W / a0 + W / a1 + gap <= H) {
        var h0 = Math.floor(W / a0), h1 = Math.floor(W / a1);
        var totalH = h0 + h1 + gap;
        var y0 = Math.floor((H - totalH) / 2);
        out.tiles.push({ x: 0, y: y0, w: W, h: h0 });
        out.tiles.push({ x: 0, y: y0 + h0 + gap, w: W, h: h1 });
        out.cols = 1; out.rows = 2; out.w = W; out.h = Math.min(h0, h1);
        return out;
      }
      // 3) không vừa: co đều theo chiều rộng
      var sumA = a0 + a1;
      var hh = Math.floor((W - gap) / sumA);
      var ww0 = Math.floor(hh * a0), ww1 = Math.floor(hh * a1);
      var tw = ww0 + ww1 + gap;
      var xx = Math.max(0, Math.floor((W - tw) / 2));
      var yy = Math.max(0, Math.floor((H - hh) / 2));
      out.tiles.push({ x: xx, y: yy, w: ww0, h: hh });
      out.tiles.push({ x: xx + ww0 + gap, y: yy, w: ww1, h: hh });
      out.cols = 2; out.rows = 1; out.w = Math.min(ww0, ww1); out.h = hh;
      return out;
    }

    // >=3: lưới đều theo aspect trung bình (giữ hành vi cũ).
    var avg = as.reduce(function (x, y) { return x + y; }, 0) / as.length;
    return gallery(as.length, W, H, { gap: gap, aspect: avg });
  }

  /** Số ô tối đa/trang để mỗi ô vẫn >= minTileW. Luôn >= 1 và <= max. */
  function perPage(W, H, o) {
    var minW = opt(o, 'minTileW');
    var max = opt(o, 'max');
    var best = 1;
    for (var n = 1; n <= max; n++) {
      if (gallery(n, W, H, o).w >= minW) best = n;
      else break;
    }
    return best;
  }

  /** Speaker view: ô chính + dải thumbnail (phải nếu cửa sổ ngang, dưới nếu cửa sổ cao). */
  function speaker(count, W, H, o) {
    var gap = opt(o, 'gap');
    var aspect = opt(o, 'aspect');
    var wide = W >= H * 1.15;
    var res = { main: { x: 0, y: 0, w: W, h: H }, strip: [], orientation: wide ? 'right' : 'bottom', visible: 0 };
    count = Math.max(0, Math.floor(count));
    if (count === 0) return res;

    if (wide) {
      var stripW = Math.max(150, Math.min(220, Math.floor(W * 0.22)));
      var tileW = stripW;
      var tileH = Math.floor(tileW / aspect);
      var fit = Math.max(1, Math.floor((H + gap) / (tileH + gap)));
      res.visible = Math.min(count, fit);
      var totalH = res.visible * tileH + (res.visible - 1) * gap;
      var y0 = Math.max(0, Math.floor((H - totalH) / 2));
      for (var i = 0; i < res.visible; i++) {
        res.strip.push({ x: W - stripW, y: y0 + i * (tileH + gap), w: tileW, h: tileH });
      }
      res.main = { x: 0, y: 0, w: W - stripW - gap, h: H };
    } else {
      var stripH = Math.max(86, Math.min(130, Math.floor(H * 0.2)));
      var tH = stripH;
      var tW = Math.floor(tH * aspect);
      var fitN = Math.max(1, Math.floor((W + gap) / (tW + gap)));
      res.visible = Math.min(count, fitN);
      var totalW = res.visible * tW + (res.visible - 1) * gap;
      var x0 = Math.max(0, Math.floor((W - totalW) / 2));
      for (var j = 0; j < res.visible; j++) {
        res.strip.push({ x: x0 + j * (tW + gap), y: H - stripH, w: tW, h: tH });
      }
      res.main = { x: 0, y: 0, w: W, h: H - stripH - gap };
    }
    return res;
  }

  /** Cỡ cửa sổ theo số người (đã kẹp theo vùng làm việc của màn hình). */
  function windowSizeForCount(n, area) {
    var w;
    var h;
    // 1–2 người: ô thường là một ngang + một dọc, nên cửa sổ phải **rộng và
    // thấp** để hai ô lấp đầy bề ngang, tránh đệm dọc thừa.
    if (n <= 2) { w = 960; h = 560; }
    else if (n <= 4) { w = 940; h = 600; }
    else if (n <= 6) { w = 980; h = 640; }
    else if (n <= 9) { w = 1100; h = 700; }
    else { w = 1200; h = 760; }
    var maxW = Math.floor((area && area.width ? area.width : 1366) * 0.94);
    var maxH = Math.floor((area && area.height ? area.height : 768) * 0.94);
    return { width: Math.max(640, Math.min(w, maxW)), height: Math.max(480, Math.min(h, maxH)) };
  }

  /** Chữ cái đầu cho avatar mặc định (tiếng Việt: lấy chữ cuối của tên). */
  function initials(name) {
    var parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    var word = parts[parts.length - 1];
    var ch = Array.from(word)[0] || '?';
    return ch.toLocaleUpperCase();
  }

  /** Màu nền ổn định theo tên (HSL), đủ tương phản với chữ trắng. */
  function colorFor(name) {
    var s = String(name || '');
    var h = 0;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return 'hsl(' + (h % 360) + ', 52%, 42%)';
  }

  return {
    ZOOM_MIN: ZOOM_MIN,
    isZoomMode: isZoomMode,
    gallery: gallery,
    fitAspects: fitAspects,
    perPage: perPage,
    speaker: speaker,
    windowSizeForCount: windowSizeForCount,
    initials: initials,
    colorFor: colorFor,
  };
});

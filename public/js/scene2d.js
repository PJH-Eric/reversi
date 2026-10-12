/* ===== scene2d.js — 黑白棋的 2D 棋盤畫面（Canvas）=====
 * 美術方向：胡桃木桌面＋楓木棋盤＋黃銅細邊；黑棋是黑曜大理石、白棋是象牙白大理石。
 * 全部用程式即時畫的貼圖（沒有外部圖檔、沒有授權問題）。純平面俯視：不需要 WebGL，任何瀏覽器都能跑。
 * 這個檔只管「看起來」與「點選」：不知道規則，也不知道輪到誰；
 * 規則、回合、網路都在 app.js，這裡只接收「把棋盤變成這樣」「下這一步」。
 * 棋子落下是「由大變小＋淡入」，翻面是左右（或上下）壓扁再展開，換色發生在最扁的那一刻。
 */
(function (root) {
  'use strict';
  const BLACK = 1, WHITE = 2;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeOut = t => 1 - Math.pow(1 - t, 3);
  const easeInOut = t => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

  /* ---------- 程式畫貼圖 ---------- */
  function hash(x, y) { let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967295; }
  function vnoise(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    return lerp(lerp(hash(xi, yi), hash(xi + 1, yi), u), lerp(hash(xi, yi + 1), hash(xi + 1, yi + 1), u), v);
  }
  function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

  /** 木紋：light/dark 是兩端顏色 */
  function woodCanvas(size, light, dark, seed, ringScale) {
    const c = canvas(size, size), g = c.getContext('2d'), img = g.createImageData(size, size), d = img.data;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const n = vnoise(x * 0.006 + seed, y * 0.05 + seed) * 0.65 + vnoise(x * 0.03 + seed, y * 0.22) * 0.25 + vnoise(x * 0.12, y * 0.9 + seed) * 0.1;
        const ring = 0.5 + 0.5 * Math.sin((y * ringScale + n * 9) * Math.PI);
        const fine = vnoise(x * 0.5, y * 0.06 + seed * 3) * 0.12;
        const t = clamp(ring * 0.78 + fine + (n - 0.5) * 0.25, 0, 1);
        const k = (y * size + x) * 4;
        d[k] = lerp(light[0], dark[0], t); d[k + 1] = lerp(light[1], dark[1], t); d[k + 2] = lerp(light[2], dark[2], t); d[k + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    return c;
  }

  /** 棋子貼圖：大理石底＋紋路＋立體光影，畫成一張 256px 的圓形 sprite */
  function discSprite(isBlack, mark) {
    const S = 256, c = canvas(S, S), g = c.getContext('2d'), R = S / 2 - 3;
    g.save(); g.beginPath(); g.arc(S / 2, S / 2, R, 0, Math.PI * 2); g.clip();
    const grad = g.createRadialGradient(S * 0.4, S * 0.35, 10, S / 2, S / 2, S * 0.62);
    if (isBlack) { grad.addColorStop(0, '#3a3d45'); grad.addColorStop(1, '#0b0c0f'); } else { grad.addColorStop(0, '#fffdf6'); grad.addColorStop(1, '#d9d2bf'); }
    g.fillStyle = grad; g.fillRect(0, 0, S, S);
    let s = (isBlack ? 7 : 3) * 9301 + 49297;
    const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
    g.lineCap = 'round';
    for (let k = 0; k < 20; k++) {
      let x = rnd() * S, y = rnd() * S, a = rnd() * Math.PI * 2;
      g.beginPath(); g.moveTo(x, y);
      const len = 5 + (rnd() * 8) | 0;
      for (let j = 0; j < len; j++) { a += (rnd() - 0.5) * 1.1; x += Math.cos(a) * (10 + rnd() * 20); y += Math.sin(a) * (10 + rnd() * 20); g.lineTo(x, y); }
      g.lineWidth = 0.5 + rnd() * (k % 5 === 0 ? 2.6 : 1.1);
      g.strokeStyle = isBlack ? 'rgba(235,238,245,' + (0.05 + rnd() * 0.17) + ')' : 'rgba(95,100,112,' + (0.06 + rnd() * 0.18) + ')';
      g.stroke();
    }
    // 邊緣暗角＋左上高光，做出厚度
    const edge = g.createRadialGradient(S / 2, S / 2, R * 0.62, S / 2, S / 2, R);
    edge.addColorStop(0, 'rgba(0,0,0,0)'); edge.addColorStop(1, isBlack ? 'rgba(0,0,0,.55)' : 'rgba(70,60,40,.38)');
    g.fillStyle = edge; g.fillRect(0, 0, S, S);
    const hi = g.createRadialGradient(S * 0.36, S * 0.3, 2, S * 0.36, S * 0.3, S * 0.34);
    hi.addColorStop(0, isBlack ? 'rgba(255,255,255,.34)' : 'rgba(255,255,255,.95)'); hi.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = hi; g.fillRect(0, 0, S, S);
    if (mark) {                                         // 色彩輔助：黑棋中央一顆亮點、白棋一圈深色細環
      if (isBlack) { g.fillStyle = 'rgba(240,240,248,.88)'; g.beginPath(); g.arc(S / 2, S / 2, 24, 0, Math.PI * 2); g.fill(); }
      else { g.lineWidth = 8; g.strokeStyle = 'rgba(70,74,86,.82)'; g.beginPath(); g.arc(S / 2, S / 2, 56, 0, Math.PI * 2); g.stroke(); }
    }
    g.restore();
    g.beginPath(); g.arc(S / 2, S / 2, R, 0, Math.PI * 2); g.lineWidth = 2.5; g.strokeStyle = isBlack ? 'rgba(0,0,0,.7)' : 'rgba(120,108,84,.7)'; g.stroke();
    return c;
  }

  /* ================= 主程式 ================= */
  function create(canvasEl, opt) {
    opt = opt || {};
    const QUALITY = { high: { pr: 2, tex: 1024 }, mid: { pr: 1.5, tex: 768 }, low: { pr: 1, tex: 512 } };
    let q = QUALITY[opt.quality] || QUALITY.mid;
    const ctx = canvasEl.getContext('2d');
    if (!ctx) throw new Error('canvas 2d unavailable');

    let coords = !!opt.coords, assist = !!opt.colorAssist, reduce = !!opt.reduceMotion, rot = false;
    const hooks = { sound: opt.onSound || function () {} };

    /* ---- 貼圖（只做一次）---- */
    const sprites = { bp: discSprite(true, false), wp: discSprite(false, false), bm: discSprite(true, true), wm: discSprite(false, true) };
    let wood = null, maple = null, walnut = null;
    function ensureTextures() {
      if (wood && wood.size === q.tex) return;
      wood = { size: q.tex, img: woodCanvas(Math.min(512, q.tex), [62, 40, 24], [42, 27, 16], 11, 0.03) };
      walnut = woodCanvas(Math.min(512, q.tex), [104, 66, 38], [54, 31, 18], 5, 0.045);
      maple = woodCanvas(q.tex, [226, 184, 120], [182, 130, 74], 3.1, 0.05);
    }
    const spriteOf = up => sprites[(up === BLACK ? 'b' : 'w') + (assist ? 'm' : 'p')];

    /* ---- 版面 ---- */
    let CW = 300, CH = 300, DPR = 1, S = 280, X0 = 0, Y0 = 0, F = 20, P = 240, CELL = 30, OX = 0, OY = 0;
    let staticLayer = null, dirty = true;
    function layout() {
      const r = canvasEl.getBoundingClientRect();
      CW = Math.max(60, Math.round(r.width)); CH = Math.max(60, Math.round(r.height));
      DPR = Math.min(root.devicePixelRatio || 1, q.pr);
      canvasEl.width = Math.round(CW * DPR); canvasEl.height = Math.round(CH * DPR);
      // 寬螢幕：四個角落有空位放按鈕，棋盤盡量放大；窄螢幕：上下各留一排給浮動按鈕
      const sideFit = CW - CH > 220, portrait = CH > CW * 1.25;
      const pad = sideFit ? 14 : 62;
      S = Math.max(120, Math.min(CW - 16, CH - pad * 2));
      X0 = Math.round((CW - S) / 2);
      // 直向：棋盤往上靠，下方留一塊給房間面板、提示鈕與確認列；其他情況置中
      Y0 = portrait ? Math.round(Math.max(pad - 6, (CH - S) * 0.34)) : Math.round((CH - S) / 2);
      if (canvasEl.parentNode && canvasEl.parentNode.dataset) canvasEl.parentNode.dataset.fit = sideFit ? 'side' : portrait ? 'portrait' : 'stack';
      F = S * 0.07; P = S - 2 * F; CELL = P / 8; OX = X0 + F; OY = Y0 + F;
      staticLayer = null; dirty = true;
    }
    function buildStatic() {
      ensureTextures();
      const c = canvas(canvasEl.width, canvasEl.height), g = c.getContext('2d');
      g.scale(DPR, DPR);
      // 桌面
      g.fillStyle = g.createPattern(wood.img, 'repeat'); g.fillRect(0, 0, CW, CH);
      const vg = g.createRadialGradient(CW / 2, CH / 2, Math.min(CW, CH) * 0.3, CW / 2, CH / 2, Math.max(CW, CH) * 0.75);
      vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.5)');
      g.fillStyle = vg; g.fillRect(0, 0, CW, CH);
      // 棋盤外框（胡桃木）＋陰影
      const rad = S * 0.022;
      g.save(); g.shadowColor = 'rgba(0,0,0,.6)'; g.shadowBlur = S * 0.05; g.shadowOffsetY = S * 0.018;
      g.fillStyle = g.createPattern(walnut, 'repeat'); rr(g, X0, Y0, S, S, rad); g.fill(); g.restore();
      g.save(); rr(g, X0, Y0, S, S, rad); g.clip();
      const bev = g.createLinearGradient(X0, Y0, X0 + S, Y0 + S);
      bev.addColorStop(0, 'rgba(255,225,170,.20)'); bev.addColorStop(0.5, 'rgba(0,0,0,0)'); bev.addColorStop(1, 'rgba(0,0,0,.34)');
      g.fillStyle = bev; g.fillRect(X0, Y0, S, S); g.restore();
      // 楓木棋面
      g.save(); g.beginPath(); g.rect(OX, OY, P, P); g.clip();
      g.fillStyle = g.createPattern(maple, 'repeat'); g.save(); const k = P / maple.width; g.setTransform(DPR * k, 0, 0, DPR * k, OX * DPR, OY * DPR); g.fillRect(0, 0, maple.width, maple.height); g.restore();
      g.restore();
      // 內凹陰影＋黃銅細線
      const ins = g.createLinearGradient(OX, OY, OX, OY + P * 0.05);
      ins.addColorStop(0, 'rgba(0,0,0,.34)'); ins.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = ins; g.fillRect(OX, OY, P, P * 0.05);
      const insL = g.createLinearGradient(OX, OY, OX + P * 0.05, OY);
      insL.addColorStop(0, 'rgba(0,0,0,.26)'); insL.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = insL; g.fillRect(OX, OY, P * 0.05, P);
      g.strokeStyle = '#c89b3c'; g.lineWidth = Math.max(1.5, S * 0.004); g.strokeRect(OX - g.lineWidth, OY - g.lineWidth, P + g.lineWidth * 2, P + g.lineWidth * 2);
      // 格線與星位
      g.strokeStyle = 'rgba(52,30,14,.82)'; g.lineWidth = Math.max(1, S * 0.0035);
      for (let i = 0; i <= 8; i++) {
        g.beginPath(); g.moveTo(OX + i * CELL, OY); g.lineTo(OX + i * CELL, OY + P); g.stroke();
        g.beginPath(); g.moveTo(OX, OY + i * CELL); g.lineTo(OX + P, OY + i * CELL); g.stroke();
      }
      g.fillStyle = 'rgba(52,30,14,.9)';
      [[2, 2], [6, 2], [2, 6], [6, 6]].forEach(p => { g.beginPath(); g.arc(OX + p[0] * CELL, OY + p[1] * CELL, Math.max(2.2, S * 0.0075), 0, Math.PI * 2); g.fill(); });
      // 座標
      if (coords) {
        g.fillStyle = 'rgba(238,208,150,.92)'; g.font = '700 ' + Math.round(F * 0.5) + 'px "Noto Sans TC","Segoe UI",system-ui,sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
        for (let i = 0; i < 8; i++) {
          const col = rot ? 7 - i : i, row = rot ? 7 - i : i;
          const lx = OX + (i + 0.5) * CELL, ly = OY + (i + 0.5) * CELL;
          g.fillText('ABCDEFGH'[col], lx, Y0 + F / 2); g.fillText('ABCDEFGH'[col], lx, Y0 + S - F / 2);
          g.fillText(String(row + 1), X0 + F / 2, ly); g.fillText(String(row + 1), X0 + S - F / 2, ly);
        }
      }
      staticLayer = c;
    }
    function rr(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }

    /* 格子 ↔ 畫面座標（rot = 白棋視角，整盤轉 180°） */
    function center(i) {
      let c = i % 8, r = (i / 8) | 0;
      if (rot) { c = 7 - c; r = 7 - r; }
      return { x: OX + (c + 0.5) * CELL, y: OY + (r + 0.5) * CELL };
    }

    /* ---- 棋子狀態與動畫 ---- */
    const discs = new Array(64).fill(null);                 // { up, drop(0~1 or null), flip:{k,from,to,axis}|null }
    const tweens = [];
    const now = () => (root.performance ? root.performance.now() : Date.now());
    function tween(delay, dur, update, done) { tweens.push({ t0: now() + delay * 1000, dur: dur * 1000, update, done }); }
    let busy = 0;

    function flipDisc(i, fromIdx, delay, done) {
      const d = discs[i]; if (!d) { done(); return; }
      const a = fromIdx % 8, b = i % 8, ar = (fromIdx / 8) | 0, br = (i / 8) | 0;
      const axis = Math.abs(b - a) >= Math.abs(br - ar) ? 'x' : 'y';     // 橫向鄰居左右壓扁，縱向鄰居上下壓扁
      const from = d.up, to = from === BLACK ? WHITE : BLACK;
      const dur = reduce ? 0.2 : 0.58;
      tween(delay, 0.001, () => {}, () => hooks.sound('flip', i));
      tween(delay, dur, k => { d.flip = { k: easeInOut(k), from: from, to: to, axis: axis }; }, () => { d.up = to; d.flip = null; hooks.sound('land', i); done(); });
    }

    /* ---- 標記 ---- */
    let legal = [], hint = -1, last = -1, cursor = -1, selected = -1, hover = -1, ghost = { i: -1, p: 0 };

    /* ---- 繪製 ---- */
    function drawDisc(x, y, up, sx, sy, lift, alpha) {
      const r = CELL * 0.43, sp = spriteOf(up);
      // 陰影（翻起來時變淡變遠）
      if (!(opt.noShadow || q.pr === 1 && false)) {
        ctx.save(); ctx.globalAlpha = (alpha == null ? 1 : alpha) * (0.34 - lift * 0.18);
        ctx.fillStyle = '#000'; ctx.beginPath(); ctx.ellipse(x + r * (0.1 + lift * 0.5), y + r * (0.14 + lift * 0.55), r * 0.98 * Math.max(0.15, sx), r * 0.98 * Math.max(0.15, sy), 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      }
      ctx.save(); if (alpha != null) ctx.globalAlpha = alpha;
      ctx.translate(x, y - lift * r * 0.5); ctx.scale(sx * (1 + lift * 0.22), sy * (1 + lift * 0.22));
      ctx.drawImage(sp, -r - r * 0.03, -r - r * 0.03, r * 2.06, r * 2.06);
      ctx.restore();
    }
    /** 翻面中的棋子：平面畫面裡做出「硬幣翻轉」的立體感——
     *  棋面依角度壓扁、露出黑白兩色的厚度側邊、飛起時放大、影子變淡變遠，並掃過一道高光。 */
    function drawCoin(x, y, f) {
      const r = CELL * 0.43, T = r * 0.26, th = Math.PI * f.k;
      const c = Math.cos(th), sn = Math.sin(th), ac = Math.abs(c), s = Math.abs(sn);
      const lift = reduce ? 0 : sn, sc = 1 + (reduce ? 0 : 0.34 * sn);
      const front = f.k < 0.5 ? f.from : f.to, back = front === BLACK ? WHITE : BLACK;
      // 影子：飛得越高越淡、越往右下偏
      ctx.save(); ctx.globalAlpha = 0.34 - lift * 0.2; ctx.fillStyle = '#000';
      ctx.beginPath(); ctx.ellipse(x + r * (0.12 + lift * 0.55), y + r * (0.16 + lift * 0.7), r * (f.axis === 'x' ? Math.max(0.2, ac * 0.9 + 0.1) : 0.98), r * (f.axis === 'y' ? Math.max(0.2, ac * 0.9 + 0.1) : 0.98), 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      ctx.save();
      ctx.translate(x, y - lift * r * 0.55); ctx.scale(sc, sc);
      if (f.axis === 'y') ctx.rotate(Math.PI / 2);            // 縱向翻轉＝把座標轉 90° 後用同一套畫法
      const off = T * s / 2, dir = c >= 0 ? 1 : -1, fx = dir * off, bx = -dir * off;
      const rimOf = col => (col === BLACK ? ['#2b2d34', '#0b0c0f'] : ['#f4efe0', '#c9c0a6']);
      // 後面那一面
      ctx.save(); ctx.translate(bx, 0); ctx.scale(Math.max(0.03, ac), 1); ctx.drawImage(spriteOf(back), -r * 1.03, -r * 1.03, r * 2.06, r * 2.06); ctx.restore();
      // 厚度側邊：靠近前面那半是前面的顏色、靠近後面那半是後面的顏色
      if (off > 0.4) {
        const x0 = Math.min(fx, bx), x1 = Math.max(fx, bx), mid = (fx + bx) / 2;
        const half = (xa, xb, col) => { const g = ctx.createLinearGradient(0, -r, 0, r); const cc = rimOf(col); g.addColorStop(0, cc[1]); g.addColorStop(0.5, cc[0]); g.addColorStop(1, cc[1]); ctx.fillStyle = g; ctx.fillRect(xa, -r * 0.985, xb - xa, r * 1.97); };
        if (dir > 0) { half(x0, mid, back); half(mid, x1, front); } else { half(x0, mid, front); half(mid, x1, back); }
      }
      // 前面那一面
      ctx.save(); ctx.translate(fx, 0); ctx.scale(Math.max(0.03, ac), 1); ctx.drawImage(spriteOf(front), -r * 1.03, -r * 1.03, r * 2.06, r * 2.06);
      if (!reduce) { const gl = ctx.createLinearGradient(-r, -r, r, r); gl.addColorStop(Math.max(0, 0.5 - 0.5 * s), 'rgba(255,255,255,0)'); gl.addColorStop(0.5, 'rgba(255,255,255,' + (0.28 * s) + ')'); gl.addColorStop(Math.min(1, 0.5 + 0.5 * s), 'rgba(255,255,255,0)'); ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(0, 0, r * 0.98, 0, Math.PI * 2); ctx.fill(); }
      ctx.restore();
      ctx.restore();
    }
    function drawSquare(i, color, w) {
      const p = center(i), h = CELL * 0.47;
      ctx.strokeStyle = color; ctx.lineWidth = w; ctx.strokeRect(p.x - h, p.y - h, h * 2, h * 2);
    }
    function render(t) {
      if (!staticLayer) buildStatic();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
      ctx.drawImage(staticLayer, 0, 0);
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      const pulse = 0.5 + 0.5 * Math.sin(t / 380);
      // 上一步
      if (last >= 0 && discs[last]) { const p = center(last); ctx.strokeStyle = 'rgba(255,157,60,.95)'; ctx.lineWidth = Math.max(2, CELL * 0.055); ctx.beginPath(); ctx.arc(p.x, p.y, CELL * 0.47, 0, Math.PI * 2); ctx.stroke(); }
      // 棋子
      for (let i = 0; i < 64; i++) {
        const d = discs[i]; if (!d) continue;
        const p = center(i);
        if (d.drop != null) {
          const k = d.drop, e = easeOut(k), s = 1 + (1 - e) * (reduce ? 0.12 : 0.5);
          drawDisc(p.x, p.y, d.up, s, s, (1 - e) * 0.9, 0.35 + 0.65 * e);
        } else if (d.flip) {
          drawCoin(p.x, p.y, d.flip);
        } else drawDisc(p.x, p.y, d.up, 1, 1, 0, null);
      }
      // 提示與游標
      ctx.fillStyle = 'rgba(29,90,56,' + (0.45 + 0.35 * pulse) + ')';
      for (let n = 0; n < legal.length; n++) { const p = center(legal[n]), r = CELL * (reduce ? 0.14 : 0.12 + 0.03 * pulse); ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill(); }
      if (hint >= 0) { const p = center(hint); ctx.strokeStyle = 'rgba(70,225,130,' + (0.6 + 0.4 * pulse) + ')'; ctx.lineWidth = Math.max(3, CELL * 0.08); ctx.beginPath(); ctx.arc(p.x, p.y, CELL * (reduce ? 0.36 : 0.34 + 0.05 * pulse), 0, Math.PI * 2); ctx.stroke(); }
      if (hover >= 0) { drawSquare(hover, 'rgba(255,255,255,.4)', Math.max(2, CELL * 0.04)); }
      if (ghost.i >= 0 && ghost.p) drawDisc(center(ghost.i).x, center(ghost.i).y, ghost.p, 1, 1, 0, 0.55);
      if (selected >= 0) { const p = center(selected); ctx.strokeStyle = 'rgba(143,214,255,' + (0.7 + 0.3 * pulse) + ')'; ctx.lineWidth = Math.max(3, CELL * 0.07); ctx.beginPath(); ctx.arc(p.x, p.y, CELL * 0.46, 0, Math.PI * 2); ctx.stroke(); }
      if (cursor >= 0) drawSquare(cursor, '#ffffff', Math.max(2.5, CELL * 0.055));
    }

    let stop = false;
    function frame(t) {
      if (stop) return;
      requestAnimationFrame(frame);
      const tt = now();
      for (let i = tweens.length - 1; i >= 0; i--) {
        const tw = tweens[i];
        if (tt < tw.t0) continue;
        const k = clamp((tt - tw.t0) / tw.dur, 0, 1);
        tw.update(k);
        if (k >= 1) { tweens.splice(i, 1); tw.done && tw.done(); }
      }
      render(tt);
    }

    const handlers = {};
    const fire = (n, a) => (handlers[n] || []).forEach(f => { try { f(a); } catch (e) { console.error(e); } });

    const api = {
      canvas: canvasEl,
      /** 一瞬間把棋盤變成指定局面（開局、重連、同步用） */
      sync(board) { for (let i = 0; i < 64; i++) { if (!board[i]) discs[i] = null; else if (!discs[i] || discs[i].up !== board[i] || discs[i].flip || discs[i].drop != null) discs[i] = { up: board[i], drop: null, flip: null }; } },
      /** 下一步：落子 → 依距離依序翻面。回傳 Promise，動畫全部結束才 resolve */
      applyMove(m, o) {
        o = o || {};
        return new Promise(resolve => {
          const animate = o.animate !== false;
          const nd = { up: m.player, drop: animate ? 0 : null, flip: null }; discs[m.idx] = nd;
          if (!animate) { m.flipped.forEach(i => { discs[i] = { up: m.player, drop: null, flip: null }; }); resolve(); return; }
          busy++;
          const pi = m.idx;
          tween(0, reduce ? 0.12 : 0.26, k => { nd.drop = k; }, () => {
            nd.drop = null; hooks.sound('place', pi);
            if (!m.flipped.length) { busy--; resolve(); return; }
            const dist = i => Math.hypot((i % 8) - (pi % 8), ((i / 8) | 0) - ((pi / 8) | 0));
            const order = m.flipped.slice().sort((a, b) => dist(a) - dist(b));
            let left = order.length;
            order.forEach(i => flipDisc(i, pi, 0.04 + dist(i) * (reduce ? 0.02 : 0.085), () => { if (--left === 0) { busy--; resolve(); } }));
          });
        });
      },
      isBusy() { return busy > 0; },
      getBoard() { return discs.map(d => (d ? d.up : 0)); },
      setLegal(list) { legal = (list || []).slice(); },
      setHint(i) { hint = i == null ? -1 : i; },
      setLast(i) { last = i == null ? -1 : i; },
      setCursor(i) { cursor = i == null ? -1 : i; },
      setSelected(i) { selected = i == null ? -1 : i; },
      setHover(i) { hover = i == null ? -1 : i; },
      /** 幽靈棋：滑鼠移到合法格時預覽「這顆會長這樣」 */
      setGhost(i, player) { ghost = { i: (i == null || !player) ? -1 : i, p: player || 0 }; },
      setCoords(v) { coords = !!v; staticLayer = null; },
      setColorAssist(v) { assist = !!v; },
      setReduceMotion(v) { reduce = !!v; },
      /** 面向哪一方：黑棋＝正常；白棋＝整盤轉 180°，讓自己的棋永遠在下方 */
      faceSide(player) { const want = player === WHITE; if (want !== rot) { rot = want; staticLayer = null; } },
      setQuality(name) { q = QUALITY[name] || QUALITY.mid; wood = null; layout(); },
      resize: layout,
      /** 螢幕座標 → 格子 index（棋盤外 −1） */
      pick(clientX, clientY) {
        const r = canvasEl.getBoundingClientRect();
        const x = clientX - r.left, y = clientY - r.top;
        let c = Math.floor((x - OX) / CELL), rw = Math.floor((y - OY) / CELL);
        if (c < 0 || c > 7 || rw < 0 || rw > 7) return -1;
        if (rot) { c = 7 - c; rw = 7 - rw; }
        return rw * 8 + c;
      },
      on(name, fn) { (handlers[name] = handlers[name] || []).push(fn); },
      debug() { return { discs: discs.filter(Boolean).length, tweens: tweens.length, busy: busy, rot: rot, layout: { S: S, CELL: CELL, OX: OX, OY: OY, CW: CW, CH: CH } }; },
      dispose() { stop = true; }
    };

    /* ---- 指標：點一下選格、滑鼠移動預覽 ---- */
    let downInfo = null;
    canvasEl.style.touchAction = 'manipulation';
    canvasEl.addEventListener('pointerdown', e => { downInfo = { x: e.clientX, y: e.clientY, t: now(), type: e.pointerType, button: e.button }; });
    canvasEl.addEventListener('pointermove', e => { if (e.pointerType === 'mouse') fire('hover', api.pick(e.clientX, e.clientY)); });
    canvasEl.addEventListener('pointerup', e => {
      const d = downInfo; downInfo = null;
      if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 14 && now() - d.t < 900 && (d.button === 0 || d.button === undefined)) fire('tap', { idx: api.pick(e.clientX, e.clientY), pointerType: d.type });
    });
    canvasEl.addEventListener('pointercancel', () => { downInfo = null; });
    canvasEl.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') fire('hover', -1); });
    canvasEl.addEventListener('contextmenu', e => e.preventDefault());

    layout();
    if (root.ResizeObserver) new ResizeObserver(layout).observe(canvasEl); else root.addEventListener('resize', layout);
    requestAnimationFrame(frame);
    api.sync(opt.board || new Array(64).fill(0));
    return api;
  }

  function supported() { try { return !!document.createElement('canvas').getContext('2d'); } catch (e) { return false; } }

  root.Scene2D = { create: create, supported: supported, BLACK: BLACK, WHITE: WHITE };
})(typeof self !== 'undefined' ? self : this);

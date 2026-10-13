/* ===== scrollbar.js — 自訂卷軸：隱藏瀏覽器原生卷軸，改畫黃銅色滑塊（可拖曳、可點軌道） =====
 * 內容仍用原生捲動（觸控慣性、鍵盤、滾輪都照常），只是外觀由這裡負責。
 */
(function () {
  'use strict';
  var SEL = '#summary, .history, .chat-list, .card, .room-list, .room-panel, .modal-body, .result-layer';
  var layer = document.createElement('div');
  layer.id = 'sb-layer'; layer.setAttribute('aria-hidden', 'true');
  var items = new Map(), queued = false;

  function attach(el) {
    if (items.has(el)) return;
    el.classList.add('sb-host');
    var track = document.createElement('div'), thumb = document.createElement('div');
    track.className = 'sb-track'; thumb.className = 'sb-thumb'; track.appendChild(thumb); layer.appendChild(track);
    var it = { track: track, thumb: thumb };
    items.set(el, it);
    thumb.addEventListener('pointerdown', function (e) {
      e.preventDefault(); thumb.setPointerCapture(e.pointerId); thumb.classList.add('drag');
      var y0 = e.clientY, s0 = el.scrollTop, k = (el.scrollHeight - el.clientHeight) / Math.max(1, track.clientHeight - thumb.offsetHeight);
      function mv(ev) { el.scrollTop = s0 + (ev.clientY - y0) * k; }
      function up() { thumb.classList.remove('drag'); thumb.removeEventListener('pointermove', mv); thumb.removeEventListener('pointerup', up); thumb.removeEventListener('pointercancel', up); }
      thumb.addEventListener('pointermove', mv); thumb.addEventListener('pointerup', up); thumb.addEventListener('pointercancel', up);
    });
    track.addEventListener('pointerdown', function (e) {
      if (e.target !== track) return;
      var r = thumb.getBoundingClientRect();
      el.scrollTop += (e.clientY < r.top ? -1 : 1) * el.clientHeight * 0.85;
    });
    el.addEventListener('scroll', schedule, { passive: true });
  }
  function update() {
    queued = false;
    items.forEach(function (it, el) {
      if (!el.isConnected) { it.track.remove(); items.delete(el); return; }
      var r = el.getBoundingClientRect(), cs = getComputedStyle(el);
      var max = el.scrollHeight - el.clientHeight;
      if (cs.display === 'none' || cs.visibility === 'hidden' || max <= 2 || r.width === 0 || r.height < 40) { it.track.style.display = 'none'; return; }
      var th = Math.max(36, r.height * el.clientHeight / el.scrollHeight), room = r.height - 12 - th;
      var tt = r.top + 6, tr = it.track.style;
      tr.display = 'block'; tr.top = tt + 'px'; tr.height = (r.height - 12) + 'px'; tr.left = (r.right - 10) + 'px';
      it.thumb.style.height = th + 'px'; it.thumb.style.transform = 'translateY(' + (room * el.scrollTop / max) + 'px)';
    });
  }
  function schedule() { if (!queued) { queued = true; requestAnimationFrame(update); } }
  function scan(root) {
    if (root.nodeType !== 1) return;
    if (root.matches && root.matches(SEL)) attach(root);
    if (root.querySelectorAll) root.querySelectorAll(SEL).forEach(attach);
  }
  function boot() {
    document.body.appendChild(layer); scan(document.body);
    new MutationObserver(function (ms) { ms.forEach(function (m) { m.addedNodes.forEach(scan); }); schedule(); })
      .observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'class', 'style', 'open'] });
    window.addEventListener('resize', schedule); window.addEventListener('orientationchange', schedule);
    setInterval(schedule, 600);
  }
  if (document.body) boot(); else document.addEventListener('DOMContentLoaded', boot);
})();

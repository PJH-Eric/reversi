/* ===== ui.js — 自製的介面元件（開關、滑桿、分段選單、彈窗、提示）=====
 * 遊戲裡玩家看得到的控制項一律用自己的外觀，不裸用瀏覽器預設的 checkbox／select／range。
 * 語意用 button role="switch"、role="radiogroup"、role="slider"，鍵盤、觸控、螢幕閱讀器都能操作。
 */
(function (root) {
  'use strict';

  const ICONS = {
    gear: '<path d="M12 8.6a3.4 3.4 0 1 0 0 6.8 3.4 3.4 0 0 0 0-6.8Zm8.2 4.4-.1-2 1.8-1.5-1.8-3.1-2.2.8a7.7 7.7 0 0 0-1.7-1l-.4-2.3h-3.6l-.4 2.3c-.6.2-1.2.6-1.7 1l-2.2-.8-1.8 3.1L6 11l-.1 2 .1 1-1.8 1.5 1.8 3.1 2.2-.8c.5.4 1.1.8 1.7 1l.4 2.3h3.6l.4-2.3c.6-.2 1.2-.6 1.7-1l2.2.8 1.8-3.1L18.2 14l.1-1Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
    home: '<path d="M4 11.5 12 4l8 7.5V20h-5.5v-5.5h-5V20H4v-8.5Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>',
    panel: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M9.5 4.5v15" stroke="currentColor" stroke-width="1.7"/>',
    bulb: '<path d="M9 18h6m-5 3h4M12 3.5a6 6 0 0 0-3.4 10.9c.6.5.9 1.2.9 2V17h5v-.6c0-.8.3-1.5.9-2A6 6 0 0 0 12 3.5Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
    copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M15.5 8.5v-2a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2" fill="none" stroke="currentColor" stroke-width="1.7"/>',
    close: '<path d="m6 6 12 12M18 6 6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    flag: '<path d="M6 21V4m0 1.5h11l-2 4 2 4H6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
    exit: '<path d="M10 4.5H6.5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2H10M15 8l4 4-4 4M19 12H9.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
    eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><circle cx="12" cy="12" r="2.8" fill="none" stroke="currentColor" stroke-width="1.7"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
    chat: '<path d="M4.5 5.5h15v10h-8l-4.5 3.5v-3.5h-2.5v-10Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>',
    crown: '<path d="m4 8 4.5 4 3.5-6 3.5 6L20 8l-1.5 10h-13L4 8Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>'
  };
  function icon(name) { return '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">' + (ICONS[name] || '') + '</svg>'; }
  function hydrateIcons(rootEl) { (rootEl || document).querySelectorAll('[data-icon]').forEach(el => { if (!el.firstChild) el.innerHTML = icon(el.getAttribute('data-icon')); }); }

  /** 迷你 DOM 產生器：h('div', {class:'x', onclick:fn}, '字', child) */
  function h(tag, attrs) {
    const el = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
      else if (k === 'dataset') for (const d in v) el.dataset[d] = v[d];
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (let i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }
  function append(el, c) {
    if (c == null || c === false) return;
    if (Array.isArray(c)) c.forEach(x => append(el, x));
    else if (c.nodeType) el.appendChild(c);
    else el.appendChild(document.createTextNode(String(c)));
  }

  /* ---------- 開關 ---------- */
  function Switch(label, get, set, hint) {
    const btn = h('button', { type: 'button', class: 'sw', role: 'switch', 'aria-checked': String(!!get()) }, h('span', { class: 'sw-knob' }));
    const lab = h('span', { class: 'row-label' }, label, hint ? h('small', null, hint) : null);
    const row = h('div', { class: 'row' }, lab, btn);
    const flip = () => { const v = !(btn.getAttribute('aria-checked') === 'true'); btn.setAttribute('aria-checked', String(v)); set(v); };
    btn.addEventListener('click', flip);
    lab.addEventListener('click', () => btn.focus());
    row.refresh = () => btn.setAttribute('aria-checked', String(!!get()));
    btn.setAttribute('aria-label', label);
    return row;
  }

  /* ---------- 滑桿 ---------- */
  function Slider(label, get, set) {
    const fill = h('span', { class: 'sl-fill' }), knob = h('span', { class: 'sl-knob' });
    const track = h('div', { class: 'sl', role: 'slider', tabindex: '0', 'aria-label': label, 'aria-valuemin': '0', 'aria-valuemax': '100' }, h('span', { class: 'sl-rail' }, fill), knob);
    const paint = () => { const v = Math.round(get() * 100); track.setAttribute('aria-valuenow', String(v)); track.setAttribute('aria-valuetext', v + '%'); fill.style.width = v + '%'; knob.style.left = v + '%'; val.textContent = v + '%'; };
    const val = h('span', { class: 'sl-val' });
    const fromEvent = e => { const r = track.getBoundingClientRect(); set(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width))); paint(); };
    let drag = false;
    track.addEventListener('pointerdown', e => { drag = true; track.setPointerCapture(e.pointerId); fromEvent(e); });
    track.addEventListener('pointermove', e => { if (drag) fromEvent(e); });
    track.addEventListener('pointerup', () => { drag = false; });
    track.addEventListener('keydown', e => {
      const step = e.shiftKey ? 0.2 : 0.05;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { set(Math.max(0, get() - step)); paint(); e.preventDefault(); }
      else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { set(Math.min(1, get() + step)); paint(); e.preventDefault(); }
      else if (e.key === 'Home') { set(0); paint(); e.preventDefault(); } else if (e.key === 'End') { set(1); paint(); e.preventDefault(); }
    });
    const row = h('div', { class: 'row slider-row' }, h('span', { class: 'row-label' }, label), track, val);
    row.refresh = paint; paint();
    return row;
  }

  /* ---------- 分段選單（取代 select / radio） ---------- */
  function Segmented(label, options, get, set, cls) {
    const group = h('div', { class: 'seg ' + (cls || ''), role: 'radiogroup', 'aria-label': label });
    const btns = options.map(o => {
      const b = h('button', { type: 'button', class: 'seg-btn', role: 'radio', 'aria-checked': 'false', tabindex: '-1', dataset: { v: o.value } }, o.label, o.sub ? h('small', null, o.sub) : null);
      b.addEventListener('click', () => { set(o.value); paint(); });
      group.appendChild(b); return b;
    });
    function paint() {
      const cur = get();
      btns.forEach((b, i) => { const on = options[i].value === cur; b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1; b.classList.toggle('on', on); });
      if (!btns.some(b => b.tabIndex === 0) && btns[0]) btns[0].tabIndex = 0;
    }
    group.addEventListener('keydown', e => {
      const i = btns.indexOf(document.activeElement); if (i < 0) return;
      let n = -1;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') n = (i + 1) % btns.length;
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') n = (i - 1 + btns.length) % btns.length;
      if (n >= 0) { e.preventDefault(); btns[n].focus(); btns[n].click(); }
    });
    group.refresh = paint; paint();
    return group;
  }

  /* ---------- 彈窗（遮罩、焦點鎖定、Esc、關閉後還原焦點）---------- */
  const stack = [];
  function modal(opts) {
    const root0 = document.getElementById('modal-root');
    const prev = document.activeElement;
    const titleId = 'm' + Math.random().toString(36).slice(2, 7);
    const box = h('div', { class: 'modal ' + (opts.cls || ''), role: opts.alert ? 'alertdialog' : 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId },
      h('header', { class: 'modal-head' }, h('h2', { id: titleId }, opts.title), opts.noClose ? null : h('button', { class: 'icon-btn small', type: 'button', 'aria-label': '關閉', onclick: () => api.close('x') }, h('span', { html: icon('close') }))),
      h('div', { class: 'modal-body' }, opts.body),
      opts.actions ? h('footer', { class: 'modal-foot' }, opts.actions) : null);
    const veil = h('div', { class: 'veil', onpointerdown: e => { if (e.target === veil && !opts.noClose) api.close('veil'); } }, box);
    root0.appendChild(veil);
    requestAnimationFrame(() => veil.classList.add('in'));
    const focusables = () => Array.from(box.querySelectorAll('button:not([disabled]),input,[tabindex="0"],a[href]')).filter(el => el.offsetParent !== null);
    const keyHandler = e => {
      if (stack[stack.length - 1] !== api) return;
      if (e.key === 'Escape' && !opts.noClose) { e.stopPropagation(); api.close('esc'); }
      else if (e.key === 'Tab') {
        const f = focusables(); if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { last.focus(); e.preventDefault(); }
        else if (!e.shiftKey && document.activeElement === last) { first.focus(); e.preventDefault(); }
      }
    };
    document.addEventListener('keydown', keyHandler, true);
    const api = {
      el: box,
      close(why) {
        if (api.closed) return; api.closed = true;
        document.removeEventListener('keydown', keyHandler, true);
        stack.splice(stack.indexOf(api), 1);
        veil.classList.remove('in'); setTimeout(() => veil.remove(), 160);
        if (prev && prev.focus) { try { prev.focus(); } catch (e) { /* ignore */ } }
        if (opts.onClose) opts.onClose(why);
      }
    };
    stack.push(api);
    setTimeout(() => { const f = opts.focus ? box.querySelector(opts.focus) : focusables().filter(el => !el.classList.contains('icon-btn'))[0] || focusables()[0]; if (f) f.focus(); }, 30);
    return api;
  }
  function confirmDialog(title, text, okLabel, danger) {
    return new Promise(res => {
      const m = modal({
        title: title, alert: true, cls: 'small', noClose: false,
        body: h('p', { class: 'modal-text' }, text),
        actions: [h('button', { class: 'btn ghost', type: 'button', onclick: () => { res(false); m.close('no'); } }, '先不要'),
          h('button', { class: 'btn ' + (danger ? 'danger' : 'primary'), type: 'button', onclick: () => { res(true); m.close('yes'); } }, okLabel || '確定')],
        onClose: why => { if (why !== 'yes' && why !== 'no') res(false); }
      });
    });
  }

  /* ---------- 提示 ---------- */
  function toast(text, kind) {
    const box = document.getElementById('toasts'); if (!box) return;
    const t = h('div', { class: 'toast ' + (kind || '') }, text);
    box.appendChild(t);
    while (box.children.length > 3) box.firstChild.remove();
    setTimeout(() => t.classList.add('out'), 2600);
    setTimeout(() => t.remove(), 3000);
  }

  root.UI = { h, icon, hydrateIcons, Switch, Slider, Segmented, modal, confirmDialog, toast };
})(typeof self !== 'undefined' ? self : this);

/* 本機儲存：暱稱、設定、戰績。全部包 try/catch（無痕、被擋時照樣能玩） */
(function (root) {
  'use strict';
  const KEY = 'reversi:v1';
  const DEFAULTS = {
    nickname: '',
    musicOn: true, musicVol: 0.5, sfxOn: true, sfxVol: 0.8, vibrate: true,
    reduceMotion: false, colorAssist: false, showLegal: true, showCoords: false, showLast: true,
    confirmMove: 'auto',            // auto：觸控要點兩下確認、滑鼠一下就下；on：一律兩下；off：一律一下
    quality: 'auto',                // auto／high／mid／low
    cameraSide: 'auto',             // auto：面向自己的顏色；fixed：永遠黑棋在下
    lastLevel: 'easy', lastColor: 'black', hintOn: 'auto',
    stats: { wins: 0, losses: 0, draws: 0, games: 0, bestMargin: 0 }
  };
  let data = null;
  function load() {
    if (data) return data;
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { raw = null; }
    data = Object.assign({}, DEFAULTS, raw || {});
    data.stats = Object.assign({}, DEFAULTS.stats, (raw && raw.stats) || {});
    return data;
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { /* ignore */ } }
  const listeners = [];
  function get(k) { return load()[k]; }
  function set(k, v) { load()[k] = v; save(); listeners.forEach(f => { try { f(k, v); } catch (e) { /* ignore */ } }); }
  /** 恢復預設（暱稱與戰績保留） */
  function reset() {
    const keep = { nickname: load().nickname, stats: load().stats };
    data = Object.assign(JSON.parse(JSON.stringify(DEFAULTS)), keep);
    save(); listeners.forEach(f => f('*', null));
  }
  function onChange(f) { listeners.push(f); }
  function addStats(d) {
    const s = load().stats;
    Object.keys(d).forEach(k => { if (k === 'bestMargin') s.bestMargin = Math.max(s.bestMargin, d[k]); else s[k] = (s[k] || 0) + d[k]; });
    save();
  }
  /* 每個瀏覽器分頁一個祕密 id（sessionStorage）：斷線重連靠它認出同一個人；分頁各自獨立，同機可開兩個分頁對打 */
  function clientId() {
    let id = '';
    try { id = sessionStorage.getItem('reversi:cid') || ''; } catch (e) { id = ''; }
    if (!id) {
      id = 'c' + Math.random().toString(36).slice(2) + Date.now().toString(36) + Math.random().toString(36).slice(2);
      try { sessionStorage.setItem('reversi:cid', id); } catch (e) { /* ignore */ }
    }
    return id;
  }
  root.Store = { get, set, reset, onChange, addStats, clientId, DEFAULTS };
})(typeof self !== 'undefined' ? self : this);

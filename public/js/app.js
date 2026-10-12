/* ===== app.js — 畫面流程、單機對局、線上對局、設定 =====
 * 規則一律走 Rules（與伺服器同一份），畫面一律走 Scene2D；這裡只負責把它們接起來。
 * 線上時局面以伺服器為準：自己下的棋也要等伺服器回 moved 才會動畫，不做樂觀更新。
 */
(function () {
  'use strict';
  const { h, Switch, Slider, Segmented, modal, confirmDialog, toast, icon, hydrateIcons } = UI;
  const R = Rules, BLACK = R.BLACK, WHITE = R.WHITE;
  const $ = id => document.getElementById(id);
  const app = $('app'), glEl = $('gl');
  const COLOR_NAME = { 1: '黑棋', 2: '白棋' };
  const ADJ = ['開心', '勇敢', '機靈', '安靜', '閃亮', '溫柔', '神秘', '迷糊', '大方', '勤勞'];
  const ANI = ['小熊', '小貓', '柴犬', '企鵝', '狐狸', '海獺', '貓頭鷹', '小鹿', '兔子', '浣熊'];
  const randomName = () => ADJ[(Math.random() * ADJ.length) | 0] + ANI[(Math.random() * ANI.length) | 0];
  const PHRASES = ['好棋！', '再來一局', '等我一下', '哈哈', '你好～'];
  const LEVEL_STARS = { toddler: '★', easy: '★★', normal: '★★★', hard: '★★★★', myth: '★★★★★' };

  /* ---------- 全域狀態 ---------- */
  const G = {
    screen: 'home', mode: null, state: null, me: BLACK, names: { 1: '黑棋', 2: '白棋' },
    level: 'easy', busy: false, queue: [], applied: 0, gameId: 0, aiToken: 0, rng: RNG.create(RNG.newSeed()),
    hintOn: false, selected: -1, cursor: -1, waitingMove: false, localCfg: null,
    room: null, skew: 0, gameNo: -1, resultShown: false, resultDismissed: false, lobby: [], invite: null, inviteError: '',
    unread: 0, hist: [], draftLimit: 0, draftPrivate: false, roomBusy: false, scene: null
  };
  window.__rv = { G: G };

  /* ---------- 小工具 ---------- */
  const nick = () => { let n = Store.get('nickname'); if (!n) { n = randomName(); Store.set('nickname', n); } return n; };
  const discIco = (c, cls) => h('span', { class: 'disc-ico ' + (c === BLACK ? 'b' : 'w') + (cls ? ' ' + cls : '') });
  const wide = () => window.matchMedia('(min-width: 900px)').matches;
  const inGame = () => G.screen === 'game';
  const isLocal = () => G.mode === 'local';
  const isOnline = () => G.mode === 'online';
  const spectating = () => isOnline() && G.room && G.room.you.role !== 'player';
  function resolveQuality() { const q = Store.get('quality'); return q === 'auto' ? (window.matchMedia('(pointer: coarse)').matches ? 'mid' : 'high') : q; }

  /* ================= 棋盤畫面（Canvas 2D）================= */
  let scene = null;
  function initScene() {
    if (!Scene2D.supported()) return false;
    try {
      scene = Scene2D.create(glEl, {
        quality: resolveQuality(), coords: Store.get('showCoords'), colorAssist: Store.get('colorAssist'), reduceMotion: Store.get('reduceMotion'),
        onSound: n => Sound.play(n)
      });
    } catch (e) { console.error(e); return false; }
    G.scene = scene; window.__rv.scene = scene;
    scene.on('tap', onTap);
    scene.on('hover', onHover);
    return true;
  }
  function demoBoard() {
    const s = R.newGame(), rng = RNG.create('demo-board');
    for (let i = 0; i < 20 && !s.over; i++) R.play(s, AI.choose(s, 'easy', rng));
    return s.board;
  }

  /* ================= 畫面切換 ================= */
  function show(name) {
    G.screen = name;
    app.dataset.screen = name;
    app.dataset.inGame = name === 'game' ? '1' : '0';
    ['home', 'setup', 'lobby'].forEach(s => $('scr-' + s).classList.toggle('on', s === name));
    $('btn-home').hidden = name === 'home';
    $('screens').hidden = name === 'game';
    $('hud-bottom').hidden = !(name === 'game' && isLocal());
    if (name !== 'game') { scene.setLegal([]); scene.setHint(-1); scene.setSelected(-1); scene.setGhost(-1); scene.setLast(-1); scene.setCursor(-1); $('turn-chip').hidden = true; $('room-panel').hidden = true; $('result-layer').hidden = true; $('confirm-bar').hidden = true; }
    if (name === 'home' || name === 'setup' || name === 'lobby') scene.sync(demoBoard());
    if (name === 'game') setSide(wide()); else $('side-backdrop').hidden = true;
    if (name === 'home') renderHome();
    if (name === 'setup') renderSetup();
    if (name === 'lobby') renderLobby();
    scene.resize();
  }
  function setSide(open) {
    app.dataset.side = open ? 'open' : 'closed';
    $('side-toggle').setAttribute('aria-expanded', String(open));
    $('side-backdrop').hidden = !(open && !wide() && inGame());
    if (open) { G.unread = 0; renderBadge(); }
    setTimeout(() => scene && scene.resize(), 30);
  }
  function renderBadge() { const b = $('side-badge'); b.hidden = G.unread <= 0 || app.dataset.side === 'open'; b.textContent = G.unread > 9 ? '9+' : G.unread; }

  /* ---------- 首頁 ---------- */
  function renderHome() {
    const s = Store.get('stats'), box = $('scr-home');
    const online = Net.enabled;
    box.replaceChildren(
      h('h1', { id: 'home-title' }, '黑白', h('span', { class: 'b' }), h('span', { class: 'w' }), '棋'),
      h('p', { class: 'sub' }, '翻轉棋子，把整盤染成你的顏色'),
      h('div', { class: 'menu' },
        h('button', { class: 'btn primary big', type: 'button', onclick: () => show('setup') }, '一個人玩'),
        h('button', { class: 'btn big', type: 'button', disabled: !online, 'aria-disabled': String(!online), onclick: () => online && show('lobby') }, '跟別人玩'),
        h('button', { class: 'btn ghost big', type: 'button', onclick: openHow }, '怎麼玩')),
      h('p', { class: 'foot-note' }, online ? ('單機戰績　勝 ' + s.wins + '　負 ' + s.losses + '　和 ' + s.draws) : '目前沒有設定伺服器，只能玩單機　·　單機戰績 勝 ' + s.wins + '　負 ' + s.losses + '　和 ' + s.draws));
  }

  /* ---------- 單機設定 ---------- */
  function renderSetup() {
    const box = $('scr-setup');
    const cfg = G.localCfg = G.localCfg || { level: Store.get('lastLevel'), color: Store.get('lastColor'), hint: Store.get('hintOn') };
    const lv = Segmented('電腦難度', AI.LEVELS.map(l => ({ value: l.id, label: h('span', { class: 'lv' }, h('b', null, l.name), h('small', null, l.desc), h('span', { class: 'stars' }, LEVEL_STARS[l.id])) })), () => cfg.level, v => { cfg.level = v; Store.set('lastLevel', v); }, 'levels-seg');
    const col = Segmented('你要執哪一色', [{ value: 'black', label: '黑棋', sub: '先手' }, { value: 'white', label: '白棋', sub: '後手' }, { value: 'random', label: '隨機' }], () => cfg.color, v => { cfg.color = v; Store.set('lastColor', v); });
    const hint = Segmented('提示', [{ value: 'auto', label: '自動', sub: '幼幼班開啟' }, { value: 'on', label: '開' }, { value: 'off', label: '關' }], () => cfg.hint, v => { cfg.hint = v; Store.set('hintOn', v); });
    box.replaceChildren(
      h('h2', { class: 'title', id: 'setup-title' }, '單機對戰'),
      h('p', { class: 'sub', style: 'text-align:left;margin-top:0' }, '選好難度與顏色就能開始。'),
      h('div', { class: 'sec-title' }, '電腦難度'), lv,
      h('div', { class: 'sec-title' }, '你的顏色'), col,
      h('div', { class: 'sec-title' }, '提示（標出建議的位置）'), hint,
      h('div', { class: 'menu', style: 'grid-template-columns:1fr 2fr;margin-top:20px' },
        h('button', { class: 'btn', type: 'button', onclick: () => show('home') }, '返回'),
        h('button', { class: 'btn primary', type: 'button', onclick: () => startLocal(cfg) }, '開始遊戲')));
  }

  /* ================= 單機流程 ================= */
  function startLocal(cfg) {
    leaveOnlineQuiet();
    G.mode = 'local'; G.gameId++; G.aiToken++; G.busy = false; G.queue = []; G.room = null; G.resultShown = false; G.resultDismissed = false;
    G.level = cfg.level; G.localCfg = cfg;
    const color = cfg.color === 'random' ? (Math.random() < 0.5 ? BLACK : WHITE) : cfg.color === 'white' ? WHITE : BLACK;
    G.me = color;
    const lvName = AI.LEVELS.find(l => l.id === G.level).name;
    G.names = {}; G.names[color] = nick(); G.names[R.other(color)] = lvName + '電腦';
    G.state = R.newGame(); G.hist = [];
    G.hintOn = cfg.hint === 'on' || (cfg.hint === 'auto' && G.level === 'toddler');
    $('btn-hint').setAttribute('aria-pressed', String(G.hintOn));
    $('chatbox').hidden = true;
    scene.setReduceMotion(Store.get('reduceMotion'));
    show('game');
    scene.sync(G.state.board); applyCameraSide(true);
    Sound.play('start');
    fullRefresh();
    toast('你執' + COLOR_NAME[color] + (color === BLACK ? '，先下！' : '，電腦先下'));
    maybeAI();
  }

  function maybeAI() {
    if (!isLocal() || !G.state || G.state.over || G.busy) return;
    if (G.state.turn === G.me) return;
    const token = ++G.aiToken, gid = G.gameId;
    const base = G.level === 'toddler' ? 900 : 520;
    setTimeout(() => {
      if (token !== G.aiToken || gid !== G.gameId || !isLocal() || G.state.over) return;
      const idx = AI.choose(G.state, G.level, G.rng);
      if (idx < 0) return;
      playMove(idx, G.state.turn);
    }, base + Math.random() * 380);
  }

  function playMove(idx, player) {
    const r = R.play(G.state, idx, player);
    if (!r.ok) return;
    animateMove({ idx: idx, player: player, flipped: r.flipped }, { passed: r.passed, over: r.over });
  }

  /** 播一步：先更新側欄紀錄，動畫結束後再更新比數與下一步 */
  function animateMove(m, meta) {
    G.busy = true; clearSelection(); scene.setLegal([]); scene.setHint(-1);
    G.hist.push({ p: m.player, i: m.idx, f: m.flipped.length });
    scene.setLast(Store.get('showLast') ? m.idx : -1);
    renderHistory(); setStatus();
    if (m.player === G.me) Sound.buzz(18);
    const gid = G.gameId;
    scene.applyMove(m).then(() => {
      if (gid !== G.gameId) return;
      G.busy = false;
      renderScores(m.flipped);
      afterMove(meta);
    });
  }

  function afterMove(meta) {
    if (meta.passed) {
      const who = G.names[meta.passed] || COLOR_NAME[meta.passed];
      toast(who + ' 沒有可下的位置，跳過這回合'); Sound.play('pass');
    }
    if (isOnline()) { pumpQueue(); }
    if (G.state.over && !G.busy && !G.queue.length) { onGameOver(); }
    fullRefresh();
    if (isLocal()) maybeAI();
    if (isOnline() && !G.busy && !G.queue.length) { reconcile(); }
  }

  /* ---------- 結束 ---------- */
  function onGameOver() {
    if (G.resultShown) return;
    const c = R.count(G.state.board);
    if (isLocal()) {
      G.resultShown = true;
      const win = G.state.winner === G.me, draw = G.state.winner === 0;
      Store.addStats({ games: 1, wins: win ? 1 : 0, losses: !win && !draw ? 1 : 0, draws: draw ? 1 : 0, bestMargin: win ? Math.abs(c.black - c.white) : 0 });
      setTimeout(() => showResult({ outcome: draw ? 'draw' : win ? 'win' : 'lose', why: c.black + ' 比 ' + c.white + (c.empty ? '（雙方都無棋可下）' : ''), black: c.black, white: c.white, winner: G.state.winner }), 900);
    } else if (isOnline() && G.room && G.room.status === 'finished') {
      showOnlineResult();
    }
  }

  function showResult(info) {
    const layer = $('result-layer');
    const online = isOnline(), spec = spectating();
    const names = G.names;
    let title = info.outcome === 'win' ? '你贏了！' : info.outcome === 'lose' ? '你輸了' : info.outcome === 'draw' ? '平手' : (info.title || '對局結束');
    Sound.play(info.outcome === 'win' ? 'win' : info.outcome === 'lose' ? 'lose' : 'draw'); Sound.buzz(info.outcome === 'win' ? [40, 40, 90] : 40);
    const again = h('button', { class: 'btn primary', type: 'button', id: 'res-again', disabled: spec, onclick: onAgain }, online ? '再來一局' : '再來一局');
    const card = h('div', { class: 'result-card ' + (info.outcome || ''), role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'res-title' },
      h('h2', { id: 'res-title' }, title),
      h('p', { class: 'why' }, info.why || ''),
      h('div', { class: 'final' },
        h('div', { class: 'side' + (info.winner === BLACK ? ' win' : '') }, discIco(BLACK), h('b', null, info.black), h('small', null, names[BLACK] || '黑棋')),
        h('span', { class: 'vs' }, 'VS'),
        h('div', { class: 'side' + (info.winner === WHITE ? ' win' : '') }, discIco(WHITE), h('b', null, info.white), h('small', null, names[WHITE] || '白棋'))),
      h('div', { class: 'result-actions' }, again,
        h('div', { class: 'row2' },
          h('button', { class: 'btn', type: 'button', onclick: onBackRoom }, '回到房間'),
          h('button', { class: 'btn', type: 'button', onclick: onBackHome }, '回到首頁'))),
      h('p', { class: 'result-note', id: 'res-note' }, spec ? '觀戰者不能開新局' : ''));
    layer.replaceChildren(card); layer.hidden = false;
    $('room-panel').hidden = true;
    setTimeout(() => { const b = $('res-again'); if (b && !b.disabled) b.focus(); }, 60);
  }
  function hideResult() { $('result-layer').hidden = true; }
  function onAgain() {
    if (isLocal()) { hideResult(); startLocal(G.localCfg); return; }
    if (isOnline() && G.room) { Net.send({ type: 'ready', value: true }); const b = $('res-again'); if (b) { b.disabled = true; b.textContent = '等待對手…'; } const n = $('res-note'); if (n) n.textContent = '對手也按「再來一局」就會開始（顏色會對調）'; }
  }
  function onBackRoom() {
    hideResult();
    if (isLocal()) { show('setup'); return; }
    G.resultDismissed = true; renderRoomPanel();
  }
  function onBackHome() {
    hideResult();
    if (isOnline()) { Net.send({ type: 'leave' }); leaveOnlineQuiet(); }
    goHome();
  }
  function goHome() {
    G.aiToken++; G.gameId++; G.mode = null; G.state = null;
    if (Net.status !== 'closed' && Net.status !== 'idle' && !G.room) Net.close();
    show('home');
  }

  /* ================= 盤面互動 ================= */
  function legalNow() { return G.state ? R.legalList(G.state.board, G.state.turn) : []; }
  function canIPlay() {
    if (!G.state || G.state.over || G.busy || G.queue.length || G.waitingMove) return false;
    if (G.me === 0 || G.state.turn !== G.me) return false;
    if (isOnline()) return !!(G.room && G.room.status === 'playing');
    return isLocal();
  }
  function needConfirm(pointerType) {
    const m = Store.get('confirmMove');
    return m === 'on' || (m === 'auto' && (pointerType === 'touch' || pointerType === 'pen'));
  }
  function clearSelection() { G.selected = -1; scene.setSelected(-1); scene.setGhost(-1); $('confirm-bar').hidden = true; }

  function onTap(e) {
    Sound.unlock();
    if (!inGame() || e.idx < 0) { return; }
    G.cursor = e.idx; scene.setCursor(-1);
    attempt(e.idx, e.pointerType);
  }
  function attempt(idx, pointerType) {
    if (!canIPlay()) { if (G.state && !G.state.over && G.me && G.state.turn !== G.me && !G.busy) { toast('還沒輪到你', 'bad'); Sound.play('error'); } return; }
    const legal = legalNow();
    if (legal.indexOf(idx) < 0) { Sound.play('error'); toast('這裡不能下（要夾住對手的棋子才行）', 'bad'); clearSelection(); return; }
    if (needConfirm(pointerType)) {
      if (G.selected === idx) { commit(idx); return; }
      G.selected = idx; scene.setSelected(idx); scene.setGhost(idx, G.me); $('confirm-bar').hidden = false; Sound.play('select');
      return;
    }
    commit(idx);
  }
  function commit(idx) {
    clearSelection();
    if (isLocal()) { playMove(idx, G.me); return; }
    G.waitingMove = true; scene.setGhost(idx, G.me); scene.setLegal([]); scene.setHint(-1);
    Net.send({ type: 'move', idx: idx });
    setTimeout(() => { if (G.waitingMove) { G.waitingMove = false; scene.setGhost(-1); refreshMarks(); } }, 2500);
  }
  function onHover(idx) {
    if (!inGame() || !canIPlay() || G.selected >= 0) { scene.setHover(-1); if (G.selected < 0) scene.setGhost(-1); return; }
    const legal = idx >= 0 && legalNow().indexOf(idx) >= 0;
    scene.setHover(idx >= 0 ? idx : -1);
    scene.setGhost(legal ? idx : -1, G.me);
    glEl.style.cursor = legal ? 'pointer' : 'default';
  }
  glEl.addEventListener('keydown', e => {
    if (!inGame()) return;
    const k = e.key;
    const flip = (Store.get('cameraSide') !== 'fixed' && G.me === WHITE) ? -1 : 1;
    let d = null;
    if (k === 'ArrowLeft') d = [-1 * flip, 0]; else if (k === 'ArrowRight') d = [1 * flip, 0]; else if (k === 'ArrowUp') d = [0, -1 * flip]; else if (k === 'ArrowDown') d = [0, 1 * flip];
    if (d) {
      e.preventDefault();
      if (G.cursor < 0) { const l = legalNow(); G.cursor = l.length ? l[0] : 27; }
      else { const c = Math.max(0, Math.min(7, (G.cursor % 8) + d[0])), r = Math.max(0, Math.min(7, ((G.cursor / 8) | 0) + d[1])); G.cursor = r * 8 + c; }
      scene.setCursor(G.cursor); announceCell(G.cursor);
    } else if (k === 'Enter' || k === ' ') { e.preventDefault(); if (G.cursor >= 0) attempt(G.cursor, 'keyboard'); }
    else if (k === 'Escape') { clearSelection(); }
    else if (k === 'h' || k === 'H') { if (isLocal()) toggleHint(); }
  });
  glEl.addEventListener('blur', () => scene && scene.setCursor(-1));
  glEl.addEventListener('focus', () => { if (G.cursor >= 0 && inGame()) scene.setCursor(G.cursor); });
  function announceCell(i) {
    const v = G.state ? G.state.board[i] : 0, legal = legalNow().indexOf(i) >= 0;
    $('status-line').setAttribute('aria-label', R.label(i) + (v ? '，' + COLOR_NAME[v] : legal ? '，可以下' : '，空格'));
  }

  /* ---------- 提示 ---------- */
  function toggleHint() {
    G.hintOn = !G.hintOn; $('btn-hint').setAttribute('aria-pressed', String(G.hintOn));
    refreshMarks(); toast(G.hintOn ? '提示已開啟' : '提示已關閉');
  }
  $('btn-hint').addEventListener('click', toggleHint);
  $('confirm-cancel').addEventListener('click', clearSelection);

  /* ================= 畫面同步 ================= */
  function fullRefresh() { refreshMarks(); renderScores(); renderHistory(); setStatus(); renderSideActions(); renderChip(); if (isOnline()) renderRoomPanel(); }

  function refreshMarks() {
    if (!inGame() || !G.state) return;
    const mine = canIPlay();
    scene.setLegal(mine && Store.get('showLegal') ? legalNow() : []);
    scene.setHint(mine && G.hintOn && isLocal() ? AI.hint(G.state) : -1);
    if (G.state.lastMove >= 0 && Store.get('showLast')) scene.setLast(G.state.lastMove); else scene.setLast(-1);
  }

  function renderScores() {
    if (!G.state) return;
    const c = R.count(G.state.board);
    // 動畫中的比數維持動畫前的數字，動畫結束才更新（避免先看到結果）
    const board = G.busy ? G.shownBoard || G.state.board : G.state.board;
    const cc = G.busy ? R.count(board) : c;
    G.shownBoard = G.state.board.slice();
    const sb = $('scoreboard');
    const seatInfo = c => {
      if (!isOnline() || !G.room) return null;
      return G.room.seats.find(s => s && s.color === c) || null;
    };
    const rows = [BLACK, WHITE].map(col => {
      const seat = seatInfo(col), turn = G.state.turn === col && !G.state.over;
      const youTag = (G.me === col) ? h('span', { class: 'tag' }, '你') : null;
      const sub = isOnline() ? (seat ? [h('span', { class: 'dot' + (seat.connected ? '' : ' off') }), seat.connected ? (seat.id === G.room.hostId ? '房主' : '玩家') : '離線'] : '等待加入') : (col === G.me ? '玩家' : '電腦');
      return h('div', { class: 'pl-row' + (turn ? ' turn' : '') }, discIco(col),
        h('div', { class: 'nm' }, h('b', null, G.names[col] || COLOR_NAME[col], youTag), h('small', null, COLOR_NAME[col] + ' · ', sub)),
        h('div', { class: 'cnt', 'aria-label': COLOR_NAME[col] + ' ' + (col === BLACK ? cc.black : cc.white) + ' 子' }, col === BLACK ? cc.black : cc.white));
    });
    sb.replaceChildren(rows[0], rows[1]);
  }

  function renderHistory() {
    const ol = $('history');
    ol.replaceChildren(...G.hist.map((m, i) => h('li', null, h('span', { class: 'n' }, (i + 1) + '.'), discIco(m.p, 'sm'), R.label(m.i), h('em', null, '+' + m.f))));
    ol.scrollTop = ol.scrollHeight;
  }

  function statusText() {
    if (!G.state) return '';
    if (isOnline() && G.room) {
      const st = G.room.status;
      if (st === 'waiting') return G.room.seats.filter(Boolean).length < 2 ? '等待對手加入…（可複製邀請連結給朋友）' : '雙方按「準備好了」就開始';
      if (st === 'finished' || G.state.over) return G.room.game.result ? G.room.game.result.text || '對局結束' : '對局結束';
    }
    if (G.state.over) { const c = R.count(G.state.board); return '對局結束　' + c.black + ' 比 ' + c.white; }
    const t = G.state.turn;
    if (G.busy) return '';
    if (G.me && t === G.me) return '輪到你下棋（' + COLOR_NAME[t] + '）';
    if (isLocal()) return '電腦思考中…';
    return '輪到 ' + (G.names[t] || COLOR_NAME[t]) + '（' + COLOR_NAME[t] + '）';
  }
  function setStatus() { const t = statusText(); $('status-line').textContent = t; $('status-line').removeAttribute('aria-label'); renderChip(); }

  function renderChip() {
    const chip = $('turn-chip');
    if (!inGame() || !G.state || G.state.over || (isOnline() && G.room && G.room.status !== 'playing')) { chip.hidden = true; return; }
    const t = G.state.turn, mine = G.me === t;
    chip.hidden = false; chip.className = 'turn-chip' + (mine ? ' mine' : '');
    chip.replaceChildren(discIco(t, 'sm'), mine ? '輪到你' : (isLocal() ? '電腦思考中' : '輪到 ' + (G.names[t] || COLOR_NAME[t])));
  }

  function renderSideActions() {
    const box = $('side-actions'), btns = [];
    if (isLocal()) {
      btns.push(h('button', { class: 'btn small', type: 'button', onclick: restartLocal }, '重新開始'));
      btns.push(h('button', { class: 'btn small ghost', type: 'button', onclick: askLeaveLocal }, h('span', { html: icon('exit') }), '離開'));
    } else if (isOnline() && G.room) {
      const playing = G.room.status === 'playing';
      if (playing && G.room.you.role === 'player') btns.push(h('button', { class: 'btn small danger', type: 'button', onclick: askResign }, h('span', { html: icon('flag') }), '認輸'));
      btns.push(h('button', { class: 'btn small ghost', type: 'button', onclick: askLeaveRoom }, h('span', { html: icon('exit') }), '離開房間'));
    }
    box.replaceChildren(...btns);
  }
  async function restartLocal() { if (G.state && !G.state.over && G.hist.length && !(await confirmDialog('重新開始？', '目前這局會作廢。', '重新開始', true))) return; hideResult(); startLocal(G.localCfg); }
  async function askLeaveLocal() { if (G.state && !G.state.over && G.hist.length && !(await confirmDialog('離開這局？', '離開後這局不會計入戰績。', '離開', true))) return; goHome(); }
  async function askResign() { if (await confirmDialog('確定認輸？', '認輸會直接判對手獲勝。', '認輸', true)) Net.send({ type: 'resign' }); }
  async function askLeaveRoom() {
    const playing = G.room && G.room.status === 'playing' && G.room.you.role === 'player';
    if (playing && !(await confirmDialog('離開房間？', '對局進行中離開，會判對手獲勝。', '離開', true))) return;
    Net.send({ type: 'leave' }); hideResult();
  }

  /* ---------- 計時條 ---------- */
  setInterval(() => {
    const t = $('timer-line');
    if (!isOnline() || !G.room || G.room.status !== 'playing' || !G.room.game.deadline || !G.room.settings.limit) { t.hidden = true; return; }
    const total = G.room.settings.limit * 1000, left = G.room.game.deadline - (Date.now() + G.skew);
    const f = Math.max(0, Math.min(1, left / total));
    t.hidden = false; t.classList.toggle('low', left < 8000);
    t.firstElementChild.style.transform = 'scaleX(' + f + ')';
    t.setAttribute('aria-label', '本步剩餘 ' + Math.max(0, Math.ceil(left / 1000)) + ' 秒');
  }, 250);
  $('timer-line').appendChild(h('i'));

  function applyCameraSide(instant) {
    const side = Store.get('cameraSide') === 'fixed' ? BLACK : (G.me || BLACK);
    scene.faceSide(side, instant);
  }

  /* ================= 線上：大廳 ================= */
  function renderLobby() {
    const box = $('scr-lobby');
    Net.connect(nick());
    const nameIn = h('input', { type: 'text', maxlength: '16', value: nick(), 'aria-label': '暱稱', id: 'nick-input' });
    nameIn.addEventListener('input', () => { const v = nameIn.value.trim(); Store.set('nickname', v); });
    nameIn.addEventListener('change', () => { if (!nameIn.value.trim()) { nameIn.value = randomName(); Store.set('nickname', nameIn.value); } Net.send({ type: 'name', name: nameIn.value.trim() }); });
    const roomList = h('ul', { class: 'room-list', id: 'room-list', 'aria-label': '房間列表' });
    const limitSeg = Segmented('每步限時', [{ value: 0, label: '不限時' }, { value: 30, label: '30 秒' }, { value: 60, label: '60 秒' }], () => G.draftLimit, v => { G.draftLimit = v; });
    const privRow = Switch('私人房', () => G.draftPrivate, v => { G.draftPrivate = v; }, '不會出現在列表，只能用邀請連結加入');
    const codeIn = h('input', { type: 'text', maxlength: '4', placeholder: '房號 4 碼', 'aria-label': '房號', id: 'code-input', style: 'text-transform:uppercase' });
    const joinCode = () => { const c = codeIn.value.trim().toUpperCase(); if (c.length < 4) { toast('請輸入 4 碼房號', 'bad'); return; } Net.send({ type: 'join', roomId: c, want: 'player', name: nick() }); };
    codeIn.addEventListener('keydown', e => { if (e.key === 'Enter') joinCode(); });
    box.replaceChildren(...[
      h('div', { class: 'card-head' }, h('h2', { class: 'title', id: 'lobby-title' }, '線上對戰'), h('button', { class: 'btn small ghost', type: 'button', onclick: () => { Net.close(); G.invite = null; show('home'); } }, '返回')),
      h('div', { class: 'net-note', id: 'net-note' }),
      G.invite ? inviteCard() : null,
      h('div', { class: 'lobby-grid' },
        h('section', null,
          h('div', { class: 'field' }, h('label', { for: 'nick-input' }, '你的暱稱'), h('div', { class: 'inline' }, nameIn, h('button', { class: 'btn small ghost', type: 'button', onclick: () => { nameIn.value = randomName(); Store.set('nickname', nameIn.value); Net.send({ type: 'name', name: nameIn.value }); } }, '換一個'))),
          h('div', { class: 'sec-title' }, '建立房間'), limitSeg, privRow,
          h('button', { class: 'btn primary', type: 'button', style: 'width:100%;margin-top:10px', onclick: () => Net.send({ type: 'create', name: nick(), limit: G.draftLimit, isPrivate: G.draftPrivate }) }, '建立房間'),
          h('div', { class: 'sec-title' }, '用房號加入'), h('div', { class: 'field' }, h('div', { class: 'inline' }, codeIn, h('button', { class: 'btn small', type: 'button', onclick: joinCode }, '加入')))),
        h('section', null, h('div', { class: 'sec-title', style: 'margin-top:0' }, '公開房間'), roomList))].filter(Boolean));
    renderNetNote(); renderRoomList();
    Net.send({ type: 'lobby' });
  }
  function inviteCard() {
    const inv = G.invite;
    return h('div', { class: 'invite-card', role: 'group', 'aria-label': '邀請' },
      h('h3', null, '你被邀請加入房間 ' + inv.room),
      h('p', { class: 'sub', style: 'text-align:left;margin:0 0 10px' }, '確認上面的暱稱後，選擇要入座對戰還是先觀戰。'),
      G.inviteError ? h('p', { class: 'toast bad', style: 'margin-bottom:10px' }, G.inviteError) : null,
      h('div', { class: 'room-actions' },
        h('button', { class: 'btn primary', type: 'button', onclick: () => Net.send({ type: 'join', roomId: inv.room, token: inv.token, want: 'player', name: nick() }) }, '加入對戰'),
        h('button', { class: 'btn', type: 'button', onclick: () => Net.send({ type: 'join', roomId: inv.room, token: inv.token, want: 'spectator', name: nick() }) }, h('span', { html: icon('eye') }), '先觀戰'),
        h('button', { class: 'btn ghost', type: 'button', onclick: () => { G.invite = null; G.inviteError = ''; clearInviteParams(); renderLobby(); } }, '不加入')));
  }
  function clearInviteParams() { try { const u = new URL(location.href); u.searchParams.delete('room'); u.searchParams.delete('invite'); history.replaceState(null, '', u.toString()); } catch (e) { /* ignore */ } }
  function renderNetNote() {
    const n = $('net-note'); if (!n) return;
    const s = Net.status;
    n.className = 'net-note' + (s === 'failed' || s === 'disabled' ? ' bad' : '');
    n.textContent = s === 'open' ? '已連線到伺服器' : (Net.statusText || '連線中…');
  }
  function renderRoomList() {
    const ul = $('room-list'); if (!ul) return;
    if (!G.lobby.length) { ul.replaceChildren(h('li', { class: 'empty' }, Net.status === 'open' ? '目前沒有公開房間，建立一間吧！' : '連線後會顯示房間')); return; }
    ul.replaceChildren(...G.lobby.map(r => {
      const join = r.status === 'playing' ? '對局中' : r.players >= 2 ? '已滿' : '等待中';
      const canSit = r.players < 2 && r.status !== 'playing';
      return h('li', { class: 'room-item' }, h('span', { class: 'code' }, r.id),
        h('div', { class: 'meta' }, h('b', null, r.hostName + ' 的房間'), r.players + '/' + r.seats + ' 人 · ' + join + (r.limit ? ' · 每步 ' + r.limit + ' 秒' : '') + (r.spectators ? ' · 觀戰 ' + r.spectators : '')),
        h('div', { class: 'acts' },
          canSit ? h('button', { class: 'btn small primary', type: 'button', onclick: () => Net.send({ type: 'join', roomId: r.id, want: 'player', name: nick() }) }, '加入') : null,
          h('button', { class: 'btn small', type: 'button', disabled: r.specFull, onclick: () => Net.send({ type: 'join', roomId: r.id, want: 'spectator', name: nick() }) }, '觀戰')));
    }));
  }

  /* ================= 線上：房間與對局 ================= */
  function leaveOnlineQuiet() { G.room = null; G.queue = []; G.waitingMove = false; G.gameNo = -1; G.unread = 0; renderBadge(); $('chat-list').replaceChildren(); }

  function onRoom(room) {
    const first = !G.room || G.room.id !== room.id;
    G.room = room; if (room.serverNow) G.skew = room.serverNow - Date.now();
    clearInviteParams(); G.invite = null; G.inviteError = '';
    if (first) { enterOnline(room); return; }
    const newGame = room.game.number !== G.gameNo;
    G.me = room.you.color || 0;
    syncNames();
    if (newGame) { beginOnlineGame(room); }
    else { fullRefresh(); if (!G.busy && !G.queue.length) reconcile(); }
  }
  function syncNames() {
    G.names = { 1: '黑棋（空位）', 2: '白棋（空位）' };
    G.room.seats.forEach(s => { if (s) G.names[s.color] = s.name; });
  }
  function enterOnline(room) {
    G.mode = 'online'; G.gameId++; G.aiToken++; G.busy = false; G.queue = []; G.waitingMove = false; G.resultShown = false;
    G.resultDismissed = room.game.over; G.hist = [];
    G.me = room.you.color || 0; syncNames();
    $('chatbox').hidden = false; $('chat-list').replaceChildren(); $('chat-quick').replaceChildren(...PHRASES.map(p => h('button', { type: 'button', onclick: () => Net.send({ type: 'chat', text: p }) }, p)));
    room.chat.forEach(m => addChat(m, true));
    G.hintOn = false;
    show('game');
    $('hud-bottom').hidden = true;
    beginOnlineGame(room, true);
    toast(room.you.role === 'player' ? '已進入房間 ' + room.id : '你正在觀戰房間 ' + room.id);
  }
  function beginOnlineGame(room, entering) {
    G.gameNo = room.game.number; G.resultShown = false; G.resultDismissed = entering ? room.game.over : false;
    G.queue = []; G.hist = []; G.waitingMove = false; clearSelection(); hideResult();
    rebuildFromRoom(room);
    applyCameraSide(!!entering);
    if (!entering && room.status === 'playing') { Sound.play('start'); }
    fullRefresh();
  }
  /** 依伺服器的步數重建局面（開局、重連、不同步時），不播動畫 */
  function rebuildFromRoom(room) {
    try { G.state = R.replay(room.game.moves); } catch (e) { G.state = R.newGame(); }
    G.applied = room.game.moves.length;
    G.hist = room.game.moves.map((m, i) => ({ p: m.p, i: m.i, f: 0 }));
    // 補上每步翻了幾顆（歷史用）
    const tmp = R.newGame(); G.hist.forEach((m, i) => { const r = R.play(tmp, m.i, m.p); m.f = r.ok ? r.flipped.length : 0; });
    scene.sync(G.state.board); G.shownBoard = G.state.board.slice();
    scene.setLast(G.state.lastMove >= 0 && Store.get('showLast') ? G.state.lastMove : -1);
    G.busy = false;
  }
  function reconcile() {
    if (!isOnline() || !G.room) return;
    if (G.busy || G.queue.length) return;
    if (G.room.game.moves.length !== G.applied || G.room.game.number !== G.gameNo) { rebuildFromRoom(G.room); fullRefresh(); }
    if (G.room.status === 'finished' && G.state.over) onGameOver();
    else if (G.room.status === 'finished' && !G.state.over) showOnlineResult();
  }
  function onMoved(m) {
    if (!G.room || m.roomId !== G.room.id) return;
    G.waitingMove = false; scene.setGhost(-1);
    if (m.n !== G.applied + G.queue.length + 1) { G.needResync = true; return; }   // 對不上就等 room 快照整盤重建
    G.queue.push(m); pumpQueue();
  }
  function pumpQueue() {
    if (G.busy || !G.queue.length) return;
    const m = G.queue.shift();
    const r = R.play(G.state, m.idx, m.player);
    if (!r.ok) { G.queue = []; reconcile(); return; }
    G.applied++;
    animateMove({ idx: m.idx, player: m.player, flipped: r.flipped }, { passed: r.passed, over: r.over });
  }
  function showOnlineResult() {
    if (G.resultShown || G.resultDismissed || !G.room || !G.room.game.result) return;
    const res = G.room.game.result, c = R.count(G.state.board);
    G.resultShown = true;
    const mine = G.me;
    const outcome = !mine ? 'spec' : res.winner === 0 ? 'draw' : res.winner === mine ? 'win' : 'lose';
    let why = res.reason === 'normal' ? c.black + ' 比 ' + c.white : (res.text || '');
    const title = outcome === 'spec' ? (res.winner === 0 ? '平手' : (G.names[res.winner] || COLOR_NAME[res.winner]) + ' 獲勝') : null;
    setTimeout(() => { if (G.room && G.room.status === 'finished' && !G.resultDismissed) showResult({ outcome: outcome, title: title, why: why, black: c.black, white: c.white, winner: res.winner }); }, res.reason === 'normal' ? 900 : 300);
  }

  /* ---------- 房間面板 ---------- */
  function inviteUrl() {
    const u = new URL(location.href);
    ['room', 'invite'].forEach(k => u.searchParams.delete(k));
    u.hash = ''; u.searchParams.set('room', G.room.id); u.searchParams.set('invite', G.room.invite.token);
    return u.toString();
  }
  async function copyInvite() {
    const url = inviteUrl();
    try { await navigator.clipboard.writeText(url); toast('邀請連結已複製', 'good'); }
    catch (e) {
      const m = modal({ title: '複製邀請連結', cls: 'small', body: [h('p', { class: 'modal-text' }, '請手動複製下面的連結：'), h('input', { type: 'text', value: url, readonly: true, id: 'inv-url', 'aria-label': '邀請連結' })], actions: h('button', { class: 'btn primary', type: 'button', onclick: () => m.close() }, '好') });
      setTimeout(() => { const i = $('inv-url'); if (i) { i.focus(); i.select(); } }, 60);
    }
  }
  function renderRoomPanel() {
    const p = $('room-panel');
    if (!isOnline() || !G.room || !inGame() || G.room.status === 'playing' || !$('result-layer').hidden) { p.hidden = true; return; }
    const oldMore = p.querySelector('details.room-more'), moreOpen = !!(oldMore && oldMore.open);
    const room = G.room, you = room.you, host = you.host;
    const seats = room.seats.map((s, i) => s ?
      h('div', { class: 'seat taken' }, discIco(s.color), h('div', null, h('b', null, s.name, s.id === you.id ? h('span', { class: 'tag' }, '你') : null, s.id === room.hostId ? h('span', { class: 'tag' }, '房主') : null),
        h('small', null, h('span', { class: 'dot' + (s.connected ? '' : ' off') }), s.connected ? (s.ready ? '已準備' : '還沒準備') : '離線中…'),
        host && s.id !== you.id ? h('button', { class: 'btn small ghost', type: 'button', style: 'margin-left:8px', onclick: () => Net.send({ type: 'kick', target: s.id }) }, '請出') : null)) :
      h('div', { class: 'seat' }, h('span', { class: 'disc-ico', style: 'background:rgba(255,255,255,.07);box-shadow:none' }), h('div', null, h('b', null, '空位'), h('small', null, '等待玩家加入'))));
    const me = room.seats.find(s => s && s.id === you.id);
    const actions = [];
    const full = room.seats.every(Boolean);
    if (you.role === 'player') actions.push(h('button', { class: 'btn primary', type: 'button', disabled: !full, onclick: () => Net.send({ type: 'ready', value: !(me && me.ready) }) }, me && me.ready ? '取消準備' : (full ? '準備好了' : '等對手加入')));
    else if (!full) actions.push(h('button', { class: 'btn primary', type: 'button', onclick: () => Net.send({ type: 'sit' }) }, '入座對戰'));
    if (host) actions.push(h('button', { class: 'btn', type: 'button', onclick: copyInvite }, h('span', { html: icon('link') }), '複製邀請連結'));
    actions.push(h('button', { class: 'btn ghost', type: 'button', onclick: askLeaveRoom }, '離開房間'));
    const inv = room.invite;
    const invText = !inv ? '' : inv.revoked ? '邀請連結已撤銷' : inv.expired ? '邀請連結已過期，請換新的' : '邀請連結有效至 ' + new Date(inv.expiresAt).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' });
    const more = host ? h('details', { class: 'room-more' }, h('summary', null, '邀請與房間設定'),
      h('p', { class: 'spec-line' }, invText),
      h('div', { class: 'room-actions', style: 'margin:8px 0' },
        h('button', { class: 'btn small', type: 'button', onclick: () => Net.send({ type: 'invite_new' }) }, '換新連結'),
        h('button', { class: 'btn small ghost', type: 'button', onclick: () => Net.send({ type: 'invite_revoke' }) }, '撤銷連結')),
      Segmented('每步限時', [{ value: 0, label: '不限時' }, { value: 30, label: '30 秒' }, { value: 60, label: '60 秒' }], () => G.room.settings.limit, v => Net.send({ type: 'settings', limit: v })),
      Switch('私人房', () => G.room.settings.isPrivate, v => Net.send({ type: 'settings', isPrivate: v }), '不出現在公開列表')) : null;
    const specs = room.specs.length ? h('p', { class: 'spec-line' }, '觀戰 ' + room.specs.length + ' 人：' + room.specs.map(s => s.name).join('、')) : null;
    p.replaceChildren(...[
      h('div', { class: 'room-head' }, h('span', { class: 'room-code', 'aria-label': '房號 ' + room.id.split('').join(' ') }, room.id), h('span', { class: 'sub', style: 'margin:0;text-align:left' }, room.status === 'finished' ? '這局結束了，可以再來一局' : '等待開局' + (room.settings.limit ? ' · 每步 ' + room.settings.limit + ' 秒' : '') + (room.settings.isPrivate ? ' · 私人房' : ''))),
      h('div', { class: 'seat-list' }, seats), h('div', { class: 'room-actions' }, actions), specs, more].filter(Boolean));
    const nm = p.querySelector('details.room-more'); if (nm && moreOpen) nm.open = true;
    p.hidden = false;
  }

  /* ---------- 聊天 ---------- */
  function addChat(m, silent) {
    const ul = $('chat-list');
    const li = h('li', { class: m.role === 'spectator' ? 'spec' : '' }, h('b', null, m.name + (m.role === 'spectator' ? '（觀戰）' : '')), m.text);
    ul.appendChild(li); while (ul.children.length > 80) ul.firstChild.remove();
    ul.scrollTop = ul.scrollHeight;
    if (!silent) { if (app.dataset.side !== 'open') { G.unread++; renderBadge(); } if (m.id !== (G.room && G.room.you.id)) Sound.play('chat'); }
  }
  function addSys(text) { const ul = $('chat-list'); ul.appendChild(h('li', { class: 'sys' }, text)); ul.scrollTop = ul.scrollHeight; }
  $('chat-form').addEventListener('submit', e => { e.preventDefault(); const i = $('chat-input'), t = i.value.trim(); if (!t) return; Net.send({ type: 'chat', text: t }); i.value = ''; });

  /* ---------- 網路事件 ---------- */
  Net.on('status', s => { Net.statusText = s.text; if (G.screen === 'lobby') renderNetNote(); if (G.mode === 'online' && s.status === 'retrying') toast('連線中斷，重新連線中…', 'bad'); if (s.status === 'open' && G.screen === 'lobby') Net.send({ type: 'lobby' }); });
  Net.on('lobby', m => { G.lobby = m.rooms || []; if (G.screen === 'lobby') renderRoomList(); });
  Net.on('room', m => onRoom(m.room));
  Net.on('moved', onMoved);
  Net.on('chat', m => addChat(m.msg));
  Net.on('toast', m => { toast(m.text); if (isOnline()) addSys(m.text); });
  Net.on('left', () => { leaveOnlineQuiet(); G.mode = null; G.state = null; show('lobby'); });
  Net.on('closed', m => {
    const text = m.reason === 'kicked' ? '你被房主請出了房間。' : '房間已經結束（房內已沒有玩家）。';
    leaveOnlineQuiet(); G.mode = null; G.state = null; hideResult(); show('lobby');
    const dlg = modal({ title: '房間已結束', cls: 'small', alert: true, body: h('p', { class: 'modal-text' }, text), actions: h('button', { class: 'btn primary', type: 'button', onclick: () => dlg.close() }, '回到大廳') });
  });
  Net.on('error', m => {
    Sound.play('error'); G.waitingMove = false; scene.setGhost(-1);
    if (G.screen === 'lobby' && G.invite) { G.inviteError = m.text || '加入失敗'; renderLobby(); return; }
    toast(m.text || '發生錯誤', 'bad'); if (inGame()) refreshMarks();
  });
  Net.on('dropped', () => { if (G.mode === 'online') toast('連線中斷，正在重新連線…', 'bad'); });

  /* ================= 設定 ================= */
  let settingsModal = null;
  function openSettings() {
    if (settingsModal && !settingsModal.closed) return;
    const rows = [];
    const sw = (label, key, hint) => { const r = Switch(label, () => Store.get(key), v => Store.set(key, v), hint); rows.push(r); return r; };
    const sl = (label, key) => { const r = Slider(label, () => Store.get(key), v => Store.set(key, v)); rows.push(r); return r; };
    const sg = (label, key, opts) => { const r = Segmented(label, opts, () => Store.get(key), v => Store.set(key, v)); rows.push(r); return r; };
    const body = h('div', null,
      h('div', { class: 'sec-title' }, '聲音'),
      sw('背景音樂', 'musicOn'), sl('音樂音量', 'musicVol'), sw('音效', 'sfxOn'), sl('音效音量', 'sfxVol'), sw('震動回饋', 'vibrate', '手機落子時輕震'),
      h('div', { class: 'sec-title' }, '畫面'),
      h('div', { class: 'row' }, h('span', { class: 'row-label' }, '畫質', h('small', null, '機器較舊或發燙時調低（影響畫面細緻度）')), sg('畫質', 'quality', [{ value: 'auto', label: '自動' }, { value: 'high', label: '高' }, { value: 'mid', label: '中' }, { value: 'low', label: '低' }])),
      sw('減少動態', 'reduceMotion', '棋子翻轉改成短而平的動畫、關閉飛起效果'), sw('色彩輔助', 'colorAssist', '黑棋中央有亮點、白棋有細環'),
      sw('顯示可下位置', 'showLegal'), sw('標記上一步', 'showLast'), sw('顯示座標', 'showCoords'),
      h('div', { class: 'sec-title' }, '操作'),
      h('div', { class: 'row' }, h('span', { class: 'row-label' }, '落子確認', h('small', null, '自動：觸控點兩下、滑鼠點一下')), sg('落子確認', 'confirmMove', [{ value: 'auto', label: '自動' }, { value: 'on', label: '點兩下' }, { value: 'off', label: '點一下' }])),
      h('div', { class: 'row' }, h('span', { class: 'row-label' }, '棋盤方向', h('small', null, '面向自己：執白時棋盤轉 180°，自己的棋永遠在下方')), sg('棋盤方向', 'cameraSide', [{ value: 'auto', label: '面向自己' }, { value: 'fixed', label: '黑棋在下' }])));
    settingsModal = modal({
      title: '設定', body: body, focus: '.sw',
      actions: [h('button', { class: 'btn ghost', type: 'button', onclick: () => { Store.reset(); rows.forEach(r => r.refresh && r.refresh()); toast('已恢復預設'); } }, '恢復預設'), h('button', { class: 'btn primary', type: 'button', onclick: () => settingsModal.close() }, '完成')]
    });
  }
  $('btn-settings').addEventListener('click', openSettings);

  function applySetting(k) {
    if (k === '*' || /^(musicOn|musicVol)$/.test(k)) Sound.setMusic(Store.get('musicOn'), Store.get('musicVol'));
    if (k === '*' || /^(sfxOn|sfxVol)$/.test(k)) Sound.setSfx(Store.get('sfxOn'), Store.get('sfxVol'));
    if (k === '*' || k === 'vibrate') Sound.setVibrate(Store.get('vibrate'));
    if (!scene) return;
    if (k === '*' || k === 'showCoords') scene.setCoords(Store.get('showCoords'));
    if (k === '*' || k === 'colorAssist') scene.setColorAssist(Store.get('colorAssist'));
    if (k === '*' || k === 'reduceMotion') { scene.setReduceMotion(Store.get('reduceMotion')); document.body.classList.toggle('reduce-motion', !!Store.get('reduceMotion')); }
    if (k === '*' || k === 'quality') scene.setQuality(resolveQuality());
    if (k === '*' || k === 'cameraSide') applyCameraSide(false);
    if (inGame() && (k === '*' || k === 'showLegal' || k === 'showLast')) refreshMarks();
  }
  Store.onChange(applySetting);

  /* ================= 怎麼玩 ================= */
  function openHow() {
    const m = modal({
      title: '怎麼玩', cls: 'how',
      body: h('div', { class: 'how' },
        h('h3', null, '目標'), h('p', null, '遊戲結束時，盤面上自己顏色的棋子比對手多就贏。'),
        h('h3', null, '輪流下棋'), h('p', null, '黑棋先下。每一步都要把棋子放在空格，並且在某個方向上「夾住」對手連續的棋子（兩端都是你的顏色），被夾住的棋子會全部翻成你的顏色。'),
        h('p', null, '畫面上的小圓點就是這回合可以下的位置。沒有可下的位置時，這回合自動跳過；雙方都沒有位置或棋盤滿了，遊戲結束。'),
        h('h3', null, '小技巧'), h('p', null, '四個角落一旦佔到就不會被翻掉，很值錢；角落旁邊的格子反而容易把角落送給對手。'),
        h('p', { class: 'muted' }, '幼幼班難度有提示可以開，適合剛學的小朋友。'),
        h('h3', null, '操作'), h('p', null, '滑鼠：移到可下位置會預覽，點一下落子。觸控：點一下選位置，再點同一格確認（設定裡可改成點一下）。鍵盤：點棋盤後用方向鍵移動、Enter 落子。'),
        h('h3', null, '線上對戰'), h('p', null, '建立房間後把邀請連結傳給朋友；朋友可以入座對戰或先觀戰，也能在聊天室說話。每局結束後雙方按「再來一局」會對調顏色。')),
      actions: h('button', { class: 'btn primary', type: 'button', onclick: () => m.close() }, '知道了')
    });
  }

  /* ================= 側欄／首頁按鈕 ================= */
  $('side-toggle').addEventListener('click', () => setSide(app.dataset.side !== 'open'));
  $('side-close').addEventListener('click', () => { setSide(false); $('side-toggle').focus(); });
  $('side-backdrop').addEventListener('click', () => setSide(false));
  $('btn-home').addEventListener('click', async () => {
    if (G.screen === 'game') { if (isLocal()) { askLeaveLocal(); } else { askLeaveRoom(); } return; }
    if (G.screen === 'lobby') { Net.close(); G.invite = null; }
    show('home');
  });

  /* 返回遊戲大廳（網址來自 Config.lobbyUrl；沒有就不顯示） */
  if (window.LobbyLink && LobbyLink.url) {
    $('btn-lobby').hidden = false;
    $('btn-lobby').addEventListener('click', () => {
      if (G.screen === 'game' && !window.confirm('離開遊戲並返回遊戲大廳？')) return;
      try { Net.close(); } catch (e) {}
      location.href = LobbyLink.url;
    });
  }

  /* ================= 啟動 ================= */
  function boot() {
    hydrateIcons(document);
    $('boot-text').textContent = '棋盤準備中…';
    if (!initScene()) {
      $('boot').innerHTML = '';
      $('boot').append(h('div', { style: 'text-align:center;max-width:380px;padding:20px' }, h('h2', { style: 'font-family:var(--serif);color:var(--brass-hi);margin-bottom:10px' }, '這個瀏覽器無法顯示棋盤'), h('p', { style: 'color:var(--muted);margin-bottom:16px' }, '棋盤需要瀏覽器支援 Canvas。請換一個較新的瀏覽器後重新整理。'), h('button', { class: 'btn primary', type: 'button', onclick: () => location.reload() }, '重新整理')));
      return;
    }
    applySetting('*');
    document.body.classList.toggle('reduce-motion', !!Store.get('reduceMotion'));
    const params = new URLSearchParams(location.search);
    const room = (params.get('room') || '').toUpperCase(), token = params.get('invite');
    if (room && token && Net.enabled) { G.invite = { room: room, token: token }; show('lobby'); }
    else show('home');
    setTimeout(() => $('boot').classList.add('gone'), 250);
    setTimeout(() => { const b = $('boot'); if (b.classList.contains('gone')) b.hidden = true; }, 800);
    Latency.refresh();
  }
  boot();
})();

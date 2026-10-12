/* ===== rules.js — 黑白棋規則核心（瀏覽器與伺服器共用，無任何畫面／網路相依）=====
 * 棋盤是長度 64 的陣列，index = row * 8 + col；0 空、1 黑、2 白。黑棋先下。
 * 單機、電腦、線上全部走這一份，不另寫會互相漂移的規則。
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Rules = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const N = 8, SIZE = 64, EMPTY = 0, BLACK = 1, WHITE = 2;
  const DIRS = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];

  /* 預先算好每一格往八個方向的射線，之後找合法步與翻子不必再判斷邊界 */
  const RAYS = [];
  for (let i = 0; i < SIZE; i++) {
    const r = (i / N) | 0, c = i % N, rays = [];
    for (const d of DIRS) {
      const ray = [];
      let rr = r + d[0], cc = c + d[1];
      while (rr >= 0 && rr < N && cc >= 0 && cc < N) { ray.push(rr * N + cc); rr += d[0]; cc += d[1]; }
      if (ray.length >= 2) rays.push(ray);
    }
    RAYS.push(rays);
  }

  const other = p => (p === BLACK ? WHITE : BLACK);
  const label = i => 'ABCDEFGH'[i % N] + (((i / N) | 0) + 1);

  function initialBoard() {
    const b = new Array(SIZE).fill(EMPTY);
    b[3 * N + 3] = WHITE; b[3 * N + 4] = BLACK; b[4 * N + 3] = BLACK; b[4 * N + 4] = WHITE;
    return b;
  }

  /** 在 idx 下 player，會被翻的棋子（空陣列＝非法） */
  function flipsFor(board, idx, player) {
    if (board[idx] !== EMPTY) return [];
    const opp = other(player), out = [];
    const rays = RAYS[idx];
    for (let k = 0; k < rays.length; k++) {
      const ray = rays[k];
      let n = 0;
      while (n < ray.length && board[ray[n]] === opp) n++;
      if (n > 0 && n < ray.length && board[ray[n]] === player) for (let j = 0; j < n; j++) out.push(ray[j]);
    }
    return out;
  }

  /** { idx: [被翻的格子...] } */
  function legalMoves(board, player) {
    const out = {};
    for (let i = 0; i < SIZE; i++) {
      if (board[i] !== EMPTY) continue;
      const f = flipsFor(board, i, player);
      if (f.length) out[i] = f;
    }
    return out;
  }
  function legalList(board, player) {
    const out = [];
    for (let i = 0; i < SIZE; i++) if (board[i] === EMPTY && flipsFor(board, i, player).length) out.push(i);
    return out;
  }
  function hasMove(board, player) {
    for (let i = 0; i < SIZE; i++) if (board[i] === EMPTY && flipsFor(board, i, player).length) return true;
    return false;
  }

  function count(board) {
    let b = 0, w = 0;
    for (let i = 0; i < SIZE; i++) { if (board[i] === BLACK) b++; else if (board[i] === WHITE) w++; }
    return { black: b, white: w, empty: SIZE - b - w };
  }

  function newGame() {
    return { board: initialBoard(), turn: BLACK, over: false, winner: 0, passes: 0, lastMove: -1, moves: [], flipped: [] };
  }
  function clone(s) {
    return { board: s.board.slice(), turn: s.turn, over: s.over, winner: s.winner, passes: s.passes, lastMove: s.lastMove, moves: s.moves.slice(), flipped: s.flipped.slice() };
  }

  /** 結算：兩邊都沒有合法步、或棋盤滿了 */
  function finish(s) {
    const c = count(s.board);
    s.over = true;
    s.winner = c.black > c.white ? BLACK : c.white > c.black ? WHITE : 0;   // 0 = 和局
    return s;
  }

  /** 輪到誰：對方沒步就換回自己（pass）。回傳 'pass' 代表剛剛有人被跳過 */
  function settleTurn(s, justMoved) {
    const next = other(justMoved);
    if (hasMove(s.board, next)) { s.turn = next; s.passes = 0; return null; }
    if (hasMove(s.board, justMoved)) { s.turn = justMoved; s.passes = 1; return next; }  // 對方被跳過
    finish(s);
    return null;
  }

  /**
   * 下一步。回傳 { ok, flipped, passed, over } ；非法步 ok=false，不改動 state。
   * passed = 被跳過的那一方（0 = 沒人被跳過）
   */
  function play(s, idx, player) {
    player = player || s.turn;
    if (s.over) return { ok: false, reason: 'over' };
    if (player !== s.turn) return { ok: false, reason: 'turn' };
    if (!(idx >= 0 && idx < SIZE) || (idx | 0) !== idx) return { ok: false, reason: 'range' };
    const f = flipsFor(s.board, idx, player);
    if (!f.length) return { ok: false, reason: 'illegal' };
    s.board[idx] = player;
    for (const i of f) s.board[i] = player;
    s.lastMove = idx; s.flipped = f;
    s.moves.push({ p: player, i: idx, f: f.length });
    const passed = settleTurn(s, player);
    return { ok: true, flipped: f, passed: passed || 0, over: s.over };
  }

  /** 從一串步數重建局面（斷線重連／觀戰中途加入用） */
  function replay(moves) {
    const s = newGame();
    for (const m of moves) { const r = play(s, m.i, m.p); if (!r.ok) throw new Error('replay failed at ' + label(m.i)); }
    return s;
  }

  return { N, SIZE, EMPTY, BLACK, WHITE, DIRS, RAYS, other, label, initialBoard, flipsFor, legalMoves, legalList, hasMove, count, newGame, clone, finish, settleTurn, play, replay };
});

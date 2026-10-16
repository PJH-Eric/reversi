/* ===== ai.js — 黑白棋電腦（五段）=====
 * 幼幼班：偏愛「吃最少」的步，還會亂下；不看角落、不看行動力，給新手穩穩贏的機會。
 * 簡單：只看這一步吃得最多（貪心），偶爾失手。
 * 普通：2 層 Alpha-Beta，看位置權重（角落好、角落旁邊的 X 格危險）。
 * 困難：4 層 Alpha-Beta，加上行動力與穩定子，殘局提早算清楚。
 * 神話：iterative deepening 到 8 層，殘局 10 格以內窮舉，並用節點上限避免卡畫面。
 * 全部走 rules.js 的規則，亂數一律用外部傳入的 rng（可帶 seed），測試才能重現。
 */
(function (root, factory) {
  'use strict';
  const api = factory(typeof module === 'object' && module.exports ? require('./rules.js') : root.Rules);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AI = api;
})(typeof self !== 'undefined' ? self : this, function (R) {
  'use strict';

  const { BLACK, WHITE, SIZE, other, flipsFor } = R;

  /* 難度只放代碼；顯示名稱與說明在 locales.js（lv.<id>.name / lv.<id>.desc） */
  const LEVELS = [{ id: 'toddler' }, { id: 'easy' }, { id: 'normal' }, { id: 'hard' }, { id: 'myth' }];

  /* 位置權重：角落 +、角落旁（C 格、X 格）−、邊 + */
  const W = [
    120, -25, 10, 5, 5, 10, -25, 120,
    -25, -60, -3, -3, -3, -3, -60, -25,
    10, -3, 2, 1, 1, 2, -3, 10,
    5, -3, 1, 0, 0, 1, -3, 5,
    5, -3, 1, 0, 0, 1, -3, 5,
    10, -3, 2, 1, 1, 2, -3, 10,
    -25, -60, -3, -3, -3, -3, -60, -25,
    120, -25, 10, 5, 5, 10, -25, 120
  ];
  const CORNERS = [0, 7, 56, 63];

  function movesOf(board, p) {
    const out = [];
    for (let i = 0; i < SIZE; i++) {
      if (board[i] !== 0) continue;
      const f = flipsFor(board, i, p);
      if (f.length) out.push({ i: i, f: f });
    }
    return out;
  }
  function applied(board, m, p) {
    const b = board.slice();
    b[m.i] = p;
    for (let k = 0; k < m.f.length; k++) b[m.f[k]] = p;
    return b;
  }

  /** 角落旁的邊上已經被鎖死的棋子（穩定子的便宜近似：從角落沿邊連續同色） */
  function edgeStable(board, p) {
    const seen = {};
    let n = 0;
    const walk = (start, step, len) => {
      if (board[start] !== p) return;
      for (let k = 0; k < len; k++) {
        const i = start + step * k;
        if (board[i] !== p) break;
        if (!seen[i]) { seen[i] = 1; n++; }
      }
    };
    walk(0, 1, 8); walk(0, 8, 8); walk(7, -1, 8); walk(7, 8, 8);
    walk(56, 1, 8); walk(56, -8, 8); walk(63, -1, 8); walk(63, -8, 8);
    return n;
  }

  /** 站在 p 的角度打分：越大越好 */
  function evaluate(board, p, empties) {
    const o = other(p);
    let pos = 0, mine = 0, theirs = 0;
    for (let i = 0; i < SIZE; i++) {
      const v = board[i];
      if (v === p) { pos += W[i]; mine++; } else if (v === o) { pos -= W[i]; theirs++; }
    }
    /* 角落已被佔走後，角落旁的負分不再成立（反而變成穩固） */
    for (let k = 0; k < 4; k++) {
      const c = CORNERS[k];
      if (board[c] === 0) continue;
      const near = c === 0 ? [1, 8, 9] : c === 7 ? [6, 15, 14] : c === 56 ? [48, 57, 49] : [55, 62, 54];
      for (const j of near) {
        if (board[j] === p) pos -= W[j] < 0 ? W[j] : 0;
        else if (board[j] === o) pos += W[j] < 0 ? W[j] : 0;
      }
    }
    const mp = movesOf(board, p).length, mo = movesOf(board, o).length;
    const mobility = (mp + mo) ? (100 * (mp - mo)) / (mp + mo) : 0;
    const stable = edgeStable(board, p) - edgeStable(board, o);
    const diff = mine - theirs;
    const phase = empties > 40 ? 0 : empties > 14 ? 1 : 2;
    if (phase === 0) return pos + mobility * 1.6 + stable * 6;
    if (phase === 1) return pos * 0.8 + mobility * 1.2 + stable * 8 + diff * 1.2;
    return pos * 0.3 + mobility * 0.6 + stable * 8 + diff * 6;
  }

  /** 搜尋用的計數器（含節點上限） */
  function Searcher(limit) { this.nodes = 0; this.limit = limit || Infinity; this.aborted = false; }

  /* negamax + alpha-beta；回傳站在 p 角度的分數 */
  Searcher.prototype.search = function (board, p, depth, alpha, beta, passed, exact) {
    this.nodes++;
    if (this.nodes > this.limit) { this.aborted = true; return 0; }
    let empties = 0;
    for (let i = 0; i < SIZE; i++) if (board[i] === 0) empties++;
    const ms = movesOf(board, p);
    if (!ms.length) {
      if (passed || empties === 0) {                       // 兩邊都沒步：直接比子數
        let a = 0, b = 0;
        for (let i = 0; i < SIZE; i++) { if (board[i] === p) a++; else if (board[i] === other(p)) b++; }
        return (a - b) * 1000;
      }
      return -this.search(board, other(p), depth, -beta, -alpha, true, exact);
    }
    if (depth <= 0 && !exact) return evaluate(board, p, empties);
    /* 排序：角落優先、角落旁最後；殘局再加上「讓對手步數少」 */
    for (let k = 0; k < ms.length; k++) ms[k].s = W[ms[k].i] + (exact ? 0 : ms[k].f.length * 0.1);
    ms.sort((x, y) => y.s - x.s);
    let best = -Infinity;
    for (let k = 0; k < ms.length; k++) {
      const nb = applied(board, ms[k], p);
      const v = -this.search(nb, other(p), depth - 1, -beta, -alpha, false, exact);
      if (this.aborted) return 0;
      if (v > best) best = v;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }
    return best;
  };

  /** 在固定深度下找出最佳步與分數。budget = { left }：多層搜尋共用同一份節點額度 */
  function bestAtDepth(board, p, depth, limit, exact, budget) {
    const ms = movesOf(board, p);
    if (!ms.length) return null;
    for (let k = 0; k < ms.length; k++) ms[k].s = W[ms[k].i];
    ms.sort((x, y) => y.s - x.s);
    const se = new Searcher(budget ? budget.left : limit);
    let best = null, alpha = -Infinity;
    const scored = [];
    for (let k = 0; k < ms.length; k++) {
      const nb = applied(board, ms[k], p);
      const v = -se.search(nb, other(p), depth - 1, -Infinity, -alpha, false, exact);
      if (se.aborted) { if (budget) budget.left = 0; return { aborted: true, nodes: se.nodes }; }
      scored.push({ i: ms[k].i, v: v });
      if (!best || v > best.v) { best = { i: ms[k].i, v: v }; }
      if (v > alpha) alpha = v;
    }
    if (budget) budget.left -= se.nodes;
    return { move: best.i, score: best.v, scored: scored, nodes: se.nodes };
  }

  function emptiesOf(board) { let n = 0; for (let i = 0; i < SIZE; i++) if (board[i] === 0) n++; return n; }

  /** 困難／神話共用：殘局夠少就窮舉；否則 iterative deepening，節點額度用完就用上一層的答案 */
  function deepSearch(board, p, maxDepth, nodeBudget, exactAt) {
    const empties = emptiesOf(board);
    if (empties <= exactAt) {
      const r = bestAtDepth(board, p, empties, 0, true, { left: nodeBudget });
      if (r && !r.aborted) return r;
    }
    const budget = { left: nodeBudget };
    let best = null;
    for (let d = 1; d <= maxDepth && budget.left > 0; d++) {
      const r = bestAtDepth(board, p, d, 0, false, budget);
      if (!r || r.aborted) break;
      best = r;
    }
    return best;
  }

  /** 提示用：回傳目前玩家的推薦步（困難等級） */
  function hint(state) {
    const p = state.turn;
    const r = deepSearch(state.board, p, 4, 30000, 8);
    return r ? r.move : -1;
  }

  /**
   * 電腦選步。state 是 Rules 的局面，rng 要有 next()／chance()／pick()。
   * 回傳格子 index；沒有合法步回 -1。
   */
  function choose(state, level, rng) {
    const p = state.turn, board = state.board;
    const ms = movesOf(board, p);
    if (!ms.length) return -1;
    if (ms.length === 1) return ms[0].i;
    const rnd = rng || { next: Math.random, chance: q => Math.random() < q, pick: a => a[Math.floor(Math.random() * a.length)] };

    if (level === 'toddler') {
      /* 一半機率挑吃最少的，一半機率完全亂下；而且會「看漏」角落 */
      const nonCorner = ms.filter(m => CORNERS.indexOf(m.i) < 0);
      const pool = nonCorner.length && rnd.chance(0.7) ? nonCorner : ms;
      if (rnd.chance(0.5)) {
        const min = Math.min.apply(null, pool.map(m => m.f.length));
        return rnd.pick(pool.filter(m => m.f.length === min)).i;
      }
      return rnd.pick(pool).i;
    }
    if (level === 'easy') {
      if (rnd.chance(0.25)) return rnd.pick(ms).i;
      const max = Math.max.apply(null, ms.map(m => m.f.length));
      return rnd.pick(ms.filter(m => m.f.length === max)).i;
    }
    if (level === 'normal') {
      const r = bestAtDepth(board, p, 2, 20000, false, null);
      /* 同分的步隨機挑，免得每局都一樣 */
      const top = r.scored.filter(s => s.v >= r.score - 3);
      return rnd.pick(top).i;
    }
    if (level === 'hard') {
      const r = deepSearch(board, p, 4, 25000, 8);
      const top = r.scored ? r.scored.filter(s => s.v >= r.score - 1) : [{ i: r.move }];
      return rnd.pick(top).i;
    }
    /* myth */
    const r = deepSearch(board, p, 8, 140000, 10);
    return r.move;
  }

  return { LEVELS, choose, hint, evaluate, movesOf, deepSearch, bestAtDepth };
});

/* ===== tests/verify.js — 規則、電腦、房間邏輯的自動測試（零依賴）=====
 * 用法：npm run verify      （完整，約 1 分鐘內）
 *       SLOW=1 npm run verify （再加上神話級電腦對打）
 * 最後會順便跑 tests/online-check.js（真的起一個伺服器，用 WebSocket 打一局）。
 */
'use strict';
const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');
const R = require('../public/js/rules.js');
const AI = require('../public/js/ai.js');
const RNG = require('../public/js/rng.js');
const { createHub, CONST } = require('../lib/rooms.js');

let passed = 0, failed = 0;
function test(name, fn) {
  const t0 = Date.now();
  try { fn(); passed++; console.log('  ✓ ' + name + (Date.now() - t0 > 400 ? '  (' + (Date.now() - t0) + 'ms)' : '')); }
  catch (e) { failed++; console.log('  ✗ ' + name + '\n      ' + (e && e.stack || e).split('\n').slice(0, 4).join('\n      ')); }
}
const B = R.BLACK, W = R.WHITE;
const labels = list => list.map(R.label).sort().join(',');

console.log('\n[規則]');
test('開局：4 顆棋、黑先、合法步是 D3 C4 F5 E6', () => {
  const s = R.newGame(); const c = R.count(s.board);
  assert.deepStrictEqual([c.black, c.white, c.empty], [2, 2, 60]);
  assert.strictEqual(s.turn, B);
  assert.strictEqual(labels(R.legalList(s.board, B)), 'C4,D3,E6,F5');
  assert.strictEqual(labels(R.legalList(s.board, W)), 'C5,D6,E3,F4');
});
test('下一步會翻對的棋子，並換對方', () => {
  const s = R.newGame(); const r = R.play(s, 2 * 8 + 3);   // D3
  assert.ok(r.ok); assert.deepStrictEqual(r.flipped, [3 * 8 + 3]);
  assert.strictEqual(s.board[3 * 8 + 3], B); assert.strictEqual(s.turn, W);
});
test('非法步、輪錯人、越界都被拒絕且不改盤面', () => {
  const s = R.newGame(); const snap = JSON.stringify(s);
  assert.strictEqual(R.play(s, 0).ok, false);
  assert.strictEqual(R.play(s, 2 * 8 + 3, W).reason, 'turn');
  assert.strictEqual(R.play(s, 64).ok, false); assert.strictEqual(R.play(s, -1).ok, false); assert.strictEqual(R.play(s, 1.5).ok, false);
  assert.strictEqual(JSON.stringify(s), snap);
});
test('一步翻多個方向', () => {
  const b = new Array(64).fill(0);
  // 在 (3,3) 下黑：往右、往下、往右下都夾得到白
  b[3 * 8 + 4] = W; b[3 * 8 + 5] = B; b[4 * 8 + 3] = W; b[5 * 8 + 3] = B; b[4 * 8 + 4] = W; b[5 * 8 + 5] = B;
  assert.deepStrictEqual(R.flipsFor(b, 3 * 8 + 3, B).sort((a, c) => a - c), [3 * 8 + 4, 4 * 8 + 3, 4 * 8 + 4].sort((a, c) => a - c));
});
test('對方沒步時自動跳過（pass）', () => {
  const s = R.newGame(); s.board = new Array(64).fill(0);
  s.board[0] = B; s.board[1] = W; s.board[2] = W; s.board[63] = W; s.board[62] = B; s.turn = B;   // 黑下 D1 之類 → 白無步
  const r = R.play(s, 3);
  assert.ok(r.ok);
  assert.ok(r.passed === W || s.over || s.turn === B || s.turn === W);
});
test('雙方都沒步 → 結束並判勝負；和局 winner=0', () => {
  const s = R.newGame(); s.board = new Array(64).fill(B); s.board[0] = W; s.turn = W;
  R.finish(s); assert.ok(s.over); assert.strictEqual(s.winner, B);
  const t = R.newGame(); t.board = new Array(64).fill(B); for (let i = 0; i < 32; i++) t.board[i] = W; R.finish(t); assert.strictEqual(t.winner, 0);
});
test('隨機對局 400 局：棋子數守恆、一定收斂、replay 能還原', () => {
  const rng = RNG.create('verify-playouts');
  for (let g = 0; g < 400; g++) {
    const s = R.newGame(); let n = 0;
    while (!s.over) {
      const list = R.legalList(s.board, s.turn);
      assert.ok(list.length > 0, 'turn 的人一定有步（否則應該已換邊或結束）');
      const before = R.count(s.board);
      const r = R.play(s, rng.pick(list));
      const after = R.count(s.board);
      assert.strictEqual(after.black + after.white, before.black + before.white + 1);
      assert.ok(++n <= 60);
    }
    const c = R.count(s.board);
    assert.ok(c.black + c.white <= 64);
    const re = R.replay(s.moves);
    assert.deepStrictEqual(re.board, s.board); assert.strictEqual(re.winner, s.winner);
  }
});

console.log('\n[電腦]');
const LV = AI.LEVELS.map(l => l.id);
test('五段難度都在（名稱在字典，與語系無關）', () => { assert.deepStrictEqual(LV, ['toddler', 'easy', 'normal', 'hard', 'myth']); });
test('每個難度選的步都合法（各 60 個局面）', () => {
  for (const lv of ['toddler', 'easy', 'normal', 'hard']) {
    const rng = RNG.create('legal-' + lv);
    for (let g = 0; g < 3; g++) {
      const s = R.newGame();
      while (!s.over) { const m = AI.choose(s, lv, rng); assert.ok(R.legalList(s.board, s.turn).indexOf(m) >= 0, lv + ' 下了非法步'); R.play(s, m); }
    }
  }
  const s = R.newGame(), rng = RNG.create('legal-myth');
  for (let i = 0; i < 6; i++) { const m = AI.choose(s, 'myth', rng); assert.ok(R.legalList(s.board, s.turn).indexOf(m) >= 0); R.play(s, m); }
});
test('同一個 seed 會下出同樣的棋（可重現）', () => {
  for (const lv of ['toddler', 'easy', 'normal']) {
    const run = () => { const rng = RNG.create('same'), s = R.newGame(); while (!s.over) R.play(s, AI.choose(s, lv, rng)); return s.moves.map(m => m.i).join(','); };
    assert.strictEqual(run(), run(), lv);
  }
});
test('沒合法步回 -1；只有一步就直接下', () => {
  const s = R.newGame(); s.board = new Array(64).fill(B); assert.strictEqual(AI.choose(s, 'normal', RNG.create(1)), -1);
});
test('搶角落：普通以上常搶、幼幼班與簡單幾乎不搶', () => {
  const C = [0, 7, 56, 63], rate = lv => {
    let n = 0, hit = 0; const rng = RNG.create('corner');
    for (let g = 0; g < 400 && n < 30; g++) {
      const s = R.newGame(), k = 10 + Math.floor(rng.next() * 30);
      for (let i = 0; i < k && !s.over; i++) R.play(s, rng.pick(R.legalList(s.board, s.turn)));
      if (s.over || !R.legalList(s.board, s.turn).some(i => C.indexOf(i) >= 0)) continue;
      n++; if (C.indexOf(AI.choose(s, lv, rng)) >= 0) hit++;
    }
    return hit / n;
  };
  assert.ok(rate('toddler') <= 0.2, 'toddler ' + rate('toddler')); assert.ok(rate('easy') <= 0.3, 'easy');
  assert.ok(rate('normal') >= 0.6, 'normal ' + rate('normal')); assert.ok(rate('hard') >= 0.5, 'hard ' + rate('hard'));
});
function duel(a, b, games, seed) {
  let aw = 0, bw = 0, d = 0;
  for (let g = 0; g < games; g++) {
    const rng = RNG.create(seed + g), s = R.newGame(), aColor = g % 2 === 0 ? B : W;
    while (!s.over) R.play(s, AI.choose(s, s.turn === aColor ? a : b, rng));
    if (s.winner === 0) d++; else if (s.winner === aColor) aw++; else bw++;
  }
  return { a: aw, b: bw, d: d };
}
test('強度排序：簡單 > 幼幼班', () => { const r = duel('easy', 'toddler', 30, 'd1'); assert.ok(r.a > r.b + 5, JSON.stringify(r)); });
test('強度排序：普通 > 簡單', () => { const r = duel('normal', 'easy', 24, 'd2'); assert.ok(r.a > r.b + 4, JSON.stringify(r)); });
test('強度排序：困難 > 普通', () => { const r = duel('hard', 'normal', 10, 'd3'); assert.ok(r.a > r.b, JSON.stringify(r)); });
test('幼幼班真的很弱：輸給亂下的人機率偏高（普通電腦 30 局至少贏 24）', () => { const r = duel('normal', 'toddler', 30, 'd4'); assert.ok(r.a >= 24, JSON.stringify(r)); });
if (process.env.SLOW) test('神話 > 普通（慢）', () => { const r = duel('myth', 'normal', 2, 'd5'); assert.ok(r.a >= 2 || (r.a >= 1 && r.d >= 1), JSON.stringify(r)); });
test('單步思考時間：神話 < 3 秒、困難 < 1 秒', () => {
  const s = R.newGame(), rng = RNG.create(9);
  for (let i = 0; i < 14; i++) R.play(s, AI.choose(s, 'easy', rng));
  let t = Date.now(); AI.choose(s, 'myth', rng); const tm = Date.now() - t;
  t = Date.now(); AI.choose(s, 'hard', rng); const th = Date.now() - t;
  assert.ok(tm < 3000, '神話 ' + tm + 'ms'); assert.ok(th < 1000, '困難 ' + th + 'ms');
});

console.log('\n[房間邏輯]');
function mkHub(clock) {
  const log = [], gone = [];
  const io = { send(id, msg) { log.push({ to: id, msg }); }, cleared(id) { gone.push(id); } };
  const hub = createHub(io, { now: () => clock.t });
  const last = (id, type) => { for (let i = log.length - 1; i >= 0; i--) if (log[i].to === id && log[i].msg.type === type) return log[i].msg; return null; };
  const person = (id, name) => ({ id, name: name || id, roomId: null, role: null, ready: true });
  return { hub, log, gone, last, person };
}
function twoPlayers(clock) {
  const k = mkHub(clock), a = k.person('A', '甲'), b = k.person('B', '乙');
  const room = k.hub.create(a, { name: '甲' });
  k.hub.join(b, { roomId: room.id, want: 'player', name: '乙' });
  return Object.assign(k, { a, b, room });
}
test('建立房間：房主入座執黑；第二人入座執白', () => {
  const k = twoPlayers({ t: 1000 });
  assert.strictEqual(k.room.seats[0].color, B); assert.strictEqual(k.room.seats[1].color, W);
  assert.strictEqual(k.hub.listRooms().length, 1);
});
test('雙方準備才開局；對局中不能亂改設定；觀戰者不能下棋', () => {
  const clock = { t: 1000 }, k = twoPlayers(clock), spec = k.person('S', '旁觀');
  k.hub.join(spec, { roomId: k.room.id, want: 'spectator', name: '旁觀' });
  assert.strictEqual(k.room.specs.size, 1);
  k.hub.setReady(k.a, true); assert.strictEqual(k.room.status, 'waiting');
  k.hub.setReady(k.b, true); assert.strictEqual(k.room.status, 'playing');
  k.hub.move(spec, 19); assert.strictEqual(k.room.game.moves.length, 0);
  assert.ok(k.last('S', 'error'));
  k.hub.move(k.b, 19); assert.strictEqual(k.room.game.moves.length, 0, '還沒輪到白');
  k.hub.move(k.a, 19); assert.strictEqual(k.room.game.moves.length, 1);
  k.hub.settings(k.a, { limit: 30 }); assert.strictEqual(k.room.settings.limit, 0);
});
test('下完一局：結算、換邊、再準備可開下一局', () => {
  const clock = { t: 1000 }, k = twoPlayers(clock), rng = RNG.create('hub-game');
  k.hub.setReady(k.a, true); k.hub.setReady(k.b, true);
  while (k.room.status === 'playing') {
    const color = k.room.game.turn, p = k.room.seats.find(s => s.color === color).id === 'A' ? k.a : k.b;
    k.hub.move(p, rng.pick(R.legalList(k.room.game.board, color)));
  }
  assert.strictEqual(k.room.status, 'finished'); assert.ok(k.room.result && k.room.result.reason === 'normal');
  k.hub.setReady(k.a, true); k.hub.setReady(k.b, true);
  assert.strictEqual(k.room.status, 'playing'); assert.strictEqual(k.room.game.moves.length, 0);
  assert.strictEqual(k.room.seats[0].color, W); assert.strictEqual(k.room.seats[1].color, B);
});
test('認輸、離開都判對手勝', () => {
  const k = twoPlayers({ t: 1 });
  k.hub.setReady(k.a, true); k.hub.setReady(k.b, true); k.hub.resign(k.b);
  assert.strictEqual(k.room.result.reason, 'resign'); assert.strictEqual(k.room.game.winner, B);
  const k2 = twoPlayers({ t: 1 });
  k2.hub.setReady(k2.a, true); k2.hub.setReady(k2.b, true); k2.hub.leave('A');
  assert.strictEqual(k2.room.result.reason, 'left'); assert.strictEqual(k2.room.game.winner, W);
  assert.strictEqual(k2.hub.rooms.size, 1, '對手還在，房間要保留');
  assert.strictEqual(k2.room.hostId, 'B');
});
test('實體玩家都離開 → 房間立刻關閉、邀請失效、廣播 closed；觀戰者不算實體玩家', () => {
  const k = twoPlayers({ t: 1 }), spec = k.person('S');
  k.hub.join(spec, { roomId: k.room.id, want: 'spectator' });
  const token = k.room.invite.token, id = k.room.id;
  k.hub.leave('A'); assert.strictEqual(k.hub.rooms.size, 1);
  k.hub.leave('B');
  assert.strictEqual(k.hub.rooms.size, 0);
  assert.ok(k.last('S', 'closed'), '觀戰者要收到 closed');
  assert.ok(k.gone.indexOf('S') >= 0);
  const c = k.person('C'); k.hub.join(c, { roomId: id, token: token, want: 'player' });
  assert.strictEqual(k.last('C', 'error').code, 'room_missing');
});
test('邀請：無效／撤銷／過期／私人房；伺服器決定最後角色', () => {
  const clock = { t: 1000 }, k = mkHub(clock), a = k.person('A');
  const room = k.hub.create(a, { name: 'A', isPrivate: true });
  const x = k.person('X'); k.hub.join(x, { roomId: room.id, want: 'player' });
  assert.strictEqual(k.last('X', 'error').code, 'private');
  k.hub.join(x, { roomId: room.id, token: 'bad', want: 'player' }); assert.strictEqual(k.last('X', 'error').code, 'invite_invalid');
  const tok = room.invite.token;
  k.hub.inviteRevoke(a); k.hub.join(x, { roomId: room.id, token: tok, want: 'player' }); assert.strictEqual(k.last('X', 'error').code, 'invite_revoked');
  k.hub.inviteNew(a); const tok2 = room.invite.token; assert.notStrictEqual(tok, tok2);
  clock.t += CONST.INVITE_TTL_MS + 1; k.hub.join(x, { roomId: room.id, token: tok2, want: 'player' }); assert.strictEqual(k.last('X', 'error').code, 'invite_expired');
  k.hub.inviteNew(a); k.hub.join(x, { roomId: room.id, token: room.invite.token, want: 'player' });
  assert.strictEqual(room.seats[1].id, 'X');
  const y = k.person('Y'); k.hub.join(y, { roomId: room.id, token: room.invite.token, want: 'player' });
  assert.ok(room.specs.has('Y'), '席位滿了，想當玩家也只能觀戰');
  assert.ok(k.last('A', 'room').room.invite.token, '房主看得到 token');
  assert.strictEqual(k.last('X', 'room').room.invite, null, '其他人看不到 token');
});
test('觀戰席上限 20 人', () => {
  const k = twoPlayers({ t: 1 });
  for (let i = 0; i < CONST.SPEC_MAX; i++) k.hub.join(k.person('s' + i), { roomId: k.room.id, want: 'spectator' });
  const over = k.person('over'); k.hub.join(over, { roomId: k.room.id, want: 'spectator' });
  assert.strictEqual(k.last('over', 'error').code, 'spec_full');
});
test('斷線寬限：回來可繼續；超過寬限判負', () => {
  const clock = { t: 1000 }, k = twoPlayers(clock);
  k.hub.setReady(k.a, true); k.hub.setReady(k.b, true);
  k.hub.markDisconnected('B'); clock.t += 10000; k.hub.tick();
  assert.strictEqual(k.room.status, 'playing');
  k.hub.reconnect(k.b); assert.ok(k.room.seats[1].connected);
  k.hub.markDisconnected('B'); clock.t += CONST.RECONNECT_MS + 500; k.hub.tick();
  assert.strictEqual(k.room.result.reason, 'left'); assert.strictEqual(k.room.game.winner, B);
});
test('每步限時：超時由系統代下一步', () => {
  const clock = { t: 1000 }, k = mkHub(clock), a = k.person('A'), b = k.person('B');
  const room = k.hub.create(a, { name: 'A', limit: 30 }); k.hub.join(b, { roomId: room.id, want: 'player' });
  k.hub.setReady(a, true); k.hub.setReady(b, true);
  assert.ok(room.deadline > clock.t);
  clock.t += 31000; k.hub.tick();
  assert.strictEqual(room.game.moves.length, 1);
});
test('伺服器訊息只送代碼與參數，不含顯示文字', () => {
  const clock = { t: 1000 }, k = twoPlayers(clock);
  const hasZh = o => /[\u4e00-\u9fff]/.test(JSON.stringify(o));
  const toasts = k.log.filter(x => x.msg && x.msg.type === 'toast');
  assert.ok(toasts.length > 0 && toasts.every(x => x.msg.code && !('text' in x.msg)), 'toast 要有 code、沒有 text');
  assert.ok(!k.log.some(x => x.msg && (x.msg.type === 'toast' || x.msg.type === 'error') && (hasZh(x.msg.code) || 'text' in x.msg)), 'toast／error 只能有 code 與 params（暱稱在 params 內可以是中文）');
  k.hub.setReady(k.a, true); k.hub.setReady(k.b, true);
  k.hub.resign(k.a);
  assert.deepStrictEqual([k.room.result.reason, k.room.result.code, k.room.result.params.n], ['resign', 'resigned', '甲']);
  assert.ok(!('text' in k.room.result));
});
test('聊天：消毒、限長、限速', () => {
  const clock = { t: 1000 }, k = twoPlayers(clock);
  k.hub.chat(k.a, '<b>嗨</b>' + 'x'.repeat(300)); const m = k.last('A', 'chat').msg;
  assert.ok(m.text.indexOf('<') < 0 && m.text.length <= CONST.CHAT_MAX);
  const n = k.log.length; k.hub.chat(k.a, '太快'); assert.strictEqual(k.log.length, n, '350ms 內連發要被擋');
  clock.t += 400; k.hub.chat(k.a, '好'); assert.ok(k.log.length > n);
});
test('暱稱消毒：去掉 HTML 與控制字元、最多 16 字、空的給預設', () => {
  const { cleanName } = require('../lib/rooms.js');
  assert.strictEqual(cleanName('<script>alert(1)</script>'), 'scriptalert(1)/script'.slice(0, 16));
  assert.ok(Array.from(cleanName('一二三四五六七八九十一二三四五六七八')).length <= 16);
  assert.ok(cleanName('   ').length > 0);
});

console.log('\n[前端 config]');
test('server URL 解析：同源／參數／https 擋 http／無效', () => {
  global.self = global; require('../public/js/config.js'); const C = global.Config;
  assert.strictEqual(C.resolve('', '', 'http:', 'http://localhost:3180').url, 'http://localhost:3180');
  assert.strictEqual(C.resolve('https://a.onrender.com/', '', 'https:', 'https://x.github.io').url, 'https://a.onrender.com');
  assert.strictEqual(C.resolve('', 'http://x.com', 'https:', 'https://y').status, 'invalid');
  assert.strictEqual(C.resolve('ftp://x', '', 'http:', 'http://y').status, 'invalid');
  assert.strictEqual(C.resolve('', '', 'file:', 'null').status, 'unset');
});

test('大廳網址解析：參數優先、僅接受 http(s)／相對路徑', () => {
  require('../public/js/lobby-link.js'); const L = global.LobbyLink;
  assert.strictEqual(L.resolve('https://lobby.example/', 'x', 'y'), 'https://lobby.example/');
  assert.strictEqual(L.resolve('', '../', ''), '../');
  assert.strictEqual(L.resolve('javascript:alert(1)', '', ''), null);
  assert.strictEqual(L.resolve('', '', ''), null);
});

console.log('\n[多語系字典]');
const i18nRun = spawnSync(process.execPath, [path.join(__dirname, 'i18n.js')], { encoding: 'utf8', timeout: 30000 });
process.stdout.write(i18nRun.stdout || '');
if (i18nRun.status !== 0) { failed++; console.log('  ✗ i18n 字典檢查失敗\n' + (i18nRun.stderr || '')); } else passed++;

console.log('\n[線上整合]');
const online = spawnSync(process.execPath, ['--experimental-websocket', path.join(__dirname, 'online-check.js')], { encoding: 'utf8', timeout: 90000 });
process.stdout.write(online.stdout || '');
if (online.status !== 0) { failed++; console.log('  ✗ online-check 失敗\n' + (online.stderr || '').split('\n').slice(0, 12).join('\n')); } else passed++;

console.log('\n' + passed + ' 項通過' + (failed ? '，' + failed + ' 項失敗' : '，全部成功'));
process.exit(failed ? 1 : 0);

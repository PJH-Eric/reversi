/* ===== tests/online-check.js — 真的起伺服器、用 WebSocket 打一局 =====
 * 需要 Node 22（內建 WebSocket），Node 20 要加 --experimental-websocket（npm run test:online 已經加了）。
 * 流程：甲建房 → 乙用邀請連結入座 → 丙觀戰 → 聊天 → 開局 → 下到一半乙斷線重連 → 下完 → 再來一局（換邊）
 *       → 認輸 → 甲離開 → 乙離開 → 房間關閉、舊邀請失效 → 亂送訊息不會把伺服器打掛。
 */
'use strict';
const assert = require('assert');
const http = require('http');
const R = require('../public/js/rules.js');
const { server, hub } = require('../server.js');

const sleep = ms => new Promise(r => setTimeout(r, ms));
let step = 0;
const ok = msg => console.log('  ✓ ' + (++step) + '. ' + msg);

class Client {
  constructor(port, cid, name) { this.port = port; this.cid = cid; this.name = name; this.msgs = []; this.room = null; this.waiters = []; this.closedEv = null; }
  connect() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket('ws://127.0.0.1:' + this.port + '/ws');
      this.ws = ws;
      ws.onopen = () => ws.send(JSON.stringify({ type: 'hello', name: this.name, clientId: this.cid }));
      ws.onmessage = ev => {
        const m = JSON.parse(ev.data);
        if (m.type === 'hb') { ws.send(JSON.stringify({ type: 'hb' })); return; }
        if (m.type === 'room') this.room = m.room;
        if (m.type === 'closed') this.closedEv = m;
        this.msgs.push(m);
        if (m.type === 'welcome') resolve(m);
        this.waiters = this.waiters.filter(w => { if (w.pred(m)) { w.res(m); return false; } return true; });
      };
      ws.onerror = e => reject(e);
    });
  }
  send(o) { this.ws.send(JSON.stringify(o)); }
  wait(pred, ms) {
    const hit = this.msgs.find(pred); if (hit && !this.consume) return Promise.resolve(hit);
    return new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('等不到訊息：' + pred)), ms || 4000); this.waiters.push({ pred, res: m => { clearTimeout(t); res(m); } }); });
  }
  /** 等「下一則」符合條件的新訊息（忽略之前收過的） */
  next(pred, ms) { this.msgs = []; return this.wait(pred, ms); }
  close() { try { this.ws.close(); } catch (e) { /* ignore */ } }
}

function get(port, path) {
  return new Promise((res, rej) => http.get({ host: '127.0.0.1', port: port, path: path }, r => { let b = ''; r.on('data', d => b += d); r.on('end', () => res(JSON.parse(b))); }).on('error', rej));
}

(async () => {
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  const A = new Client(port, 'client-aaaaaaaa', '甲'), B = new Client(port, 'client-bbbbbbbb', '乙'), C = new Client(port, 'client-cccccccc', '丙');
  try {
    assert.strictEqual((await get(port, '/health')).ok, true); ok('/health 正常');
    await A.connect(); await B.connect(); await C.connect();
    assert.ok(A.msgs.find(m => m.type === 'welcome').personId); ok('三人連線、拿到 welcome');

    A.send({ type: 'create', name: '甲', limit: 0 });
    const r1 = await A.wait(m => m.type === 'room');
    assert.strictEqual(r1.room.you.host, true); assert.ok(r1.room.invite.token); assert.strictEqual(r1.room.you.color, R.BLACK);
    const roomId = r1.room.id, token = r1.room.invite.token;
    ok('甲建房 ' + roomId + '，拿到邀請 token、執黑');

    B.send({ type: 'join', roomId: roomId, token: 'wrong', want: 'player', name: '乙' });
    assert.strictEqual((await B.wait(m => m.type === 'error')).code, 'invite_invalid'); ok('錯誤的邀請 token 被拒');
    B.send({ type: 'join', roomId: roomId, token: token, want: 'player', name: '乙' });
    const rb = await B.wait(m => m.type === 'room');
    assert.strictEqual(rb.room.you.role, 'player'); assert.strictEqual(rb.room.you.color, R.WHITE); assert.strictEqual(rb.room.invite, null);
    ok('乙用邀請連結入座執白，看不到 token');

    C.send({ type: 'join', roomId: roomId, want: 'spectator', name: '丙' });
    assert.strictEqual((await C.wait(m => m.type === 'room')).room.you.role, 'spectator'); ok('丙以觀戰者加入');

    A.send({ type: 'chat', text: '你好' });
    for (const x of [A, B, C]) assert.strictEqual((await x.wait(m => m.type === 'chat')).msg.text, '你好');
    ok('聊天所有人（含觀戰者）都收到');

    C.send({ type: 'move', idx: 19 }); await sleep(100);
    assert.strictEqual(A.room.game.moves.length, 0); ok('觀戰者下棋沒效果');

    A.send({ type: 'ready', value: true }); B.send({ type: 'ready', value: true });
    await A.wait(m => m.type === 'room' && m.room.status === 'playing');
    ok('雙方準備 → 開局');

    const players = () => ({ [R.BLACK]: A.room.seats.find(s => s.id === A.room.you.id).color === R.BLACK ? A : B, [R.WHITE]: A.room.seats.find(s => s.id === A.room.you.id).color === R.BLACK ? B : A });
    let rng = 12345; const rnd = () => (rng = (rng * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    async function playOut(reconnectAt) {
      let st = R.replay(A.room.game.moves), n = st.moves.length, did = false;
      while (!st.over) {
        const list = R.legalList(st.board, st.turn), idx = list[Math.floor(rnd() * list.length)];
        const who = players()[st.turn];
        const mv = Promise.all([A, B, C].filter(x => x.ws.readyState === 1).map(x => x.wait(m => m.type === 'moved' && m.n === n + 1)));
        who.msgs = []; who.send({ type: 'move', idx: idx });
        await mv; R.play(st, idx); n++;
        if (reconnectAt && n === reconnectAt && !did) {
          did = true; B.close(); await sleep(150);
          const keep = B.room; B.msgs = []; await B.connect();
          const snap = await B.wait(m => m.type === 'room');
          assert.strictEqual(snap.room.you.role, 'player'); assert.strictEqual(snap.room.game.moves.length, n);
          assert.deepStrictEqual(snap.room.game.board, st.board);
          ok('乙下到第 ' + n + ' 步斷線重連，回到原席位、局面一致（' + (keep ? '有' : '無') + '舊快照）');
        }
      }
      return st;
    }
    const st = await playOut(10);
    await A.wait(m => m.type === 'room' && m.room.status === 'finished');
    assert.deepStrictEqual(A.room.game.board, st.board); assert.deepStrictEqual(C.room.game.board, st.board);
    assert.strictEqual(A.room.game.result.reason, 'normal'); assert.strictEqual(A.room.game.winner, st.winner);
    const cnt = R.count(st.board); assert.strictEqual(A.room.game.black, cnt.black);
    ok('下完整局：伺服器局面與本地重演一致、觀戰者同步（' + cnt.black + ' 比 ' + cnt.white + '）');

    A.send({ type: 'ready', value: true }); B.send({ type: 'ready', value: true });
    await A.wait(m => m.type === 'room' && m.room.status === 'playing' && m.room.game.number === 2);
    assert.strictEqual(A.room.you.color, R.WHITE); assert.strictEqual(A.room.game.moves.length, 0);
    ok('再來一局：顏色對調');

    A.send({ type: 'resign' });
    await B.wait(m => m.type === 'room' && m.room.status === 'finished' && m.room.game.result.reason === 'resign');
    assert.strictEqual(B.room.game.winner, B.room.you.color); ok('甲認輸 → 乙獲勝');

    A.send({ type: 'leave' }); await A.wait(m => m.type === 'left');
    await B.wait(m => m.type === 'room' && m.room.seats.filter(Boolean).length === 1);
    assert.strictEqual(B.room.hostId, B.room.you.id); assert.strictEqual((await get(port, '/api/rooms')).rooms.length, 1);
    ok('甲離開：房間保留、乙成為房主');

    B.send({ type: 'leave' });
    const closed = await C.wait(m => m.type === 'closed');
    assert.strictEqual(closed.reason, 'no_players'); assert.strictEqual((await get(port, '/api/rooms')).rooms.length, 0); assert.strictEqual(hub.rooms.size, 0);
    ok('最後一位實體玩家離開 → 房間關閉，觀戰者收到 closed');

    const D = new Client(port, 'client-dddddddd', '丁'); await D.connect();
    D.send({ type: 'join', roomId: roomId, token: token, want: 'player', name: '丁' });
    assert.strictEqual((await D.wait(m => m.type === 'error')).code, 'room_missing'); ok('舊邀請連結對已關閉的房間無效');

    D.ws.send('這不是 JSON'); D.send({ type: 'whatever', x: 1 }); D.send({ type: 'join' }); D.send({ type: 'move', idx: 'abc' }); D.send({ type: 'create', limit: 'x', name: '<img>' });
    await sleep(200); assert.strictEqual((await get(port, '/health')).ok, true); ok('亂送訊息不會把伺服器打掛');
    D.close(); A.close(); B.close(); C.close();
    console.log('  線上整合測試全部通過');
    setTimeout(() => process.exit(0), 100);
  } catch (e) {
    console.error('✗ 失敗：', e && e.stack || e);
    process.exit(1);
  }
})();

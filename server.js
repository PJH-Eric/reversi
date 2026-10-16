/* ===== server.js — 靜態檔案 ＋ 房間伺服器（零依賴）=====
 * 靜態檔案用 Node 內建 http，連線用 lib/ws.js（自己寫的原生 WebSocket），
 * 不需要 npm install，雙擊 .bat 就能玩，丟到 Render 也一樣。
 *
 *   lib/rooms.js  房間／席位／觀戰／邀請／聊天／對局（純邏輯）
 *   這一支         HTTP、WebSocket、身分（同一個瀏覽器分頁斷線重連是同一個人）、心跳與計時
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const ws = require('./lib/ws.js');
const { createHub, cleanName } = require('./lib/rooms.js');

const PORT = Number(process.env.PORT) || 3180;
const ROOT = path.join(__dirname, 'public');
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || '*';
const GAME_ID = 'reversi';
const ALIVE_MS = 9000;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json'
};

function sendFile(res, file) {
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
}
function json(res, code, data) { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); }

/** personId → { socket, person } */
const people = new Map();

const io = {
  send(personId, msg) { const it = people.get(personId); if (it && it.socket.alive) it.socket.sendJSON(msg); },
  /** 房間關了／被踢：這個人回到大廳狀態 */
  cleared(personId) { const it = people.get(personId); if (it) { it.person.roomId = null; it.person.role = null; } }
};

const hub = createHub(io);

function lobbyIds() { const out = []; for (const [id, it] of people) if (!it.person.roomId && it.person.ready) out.push(id); return out; }
function sendLobby(pid) { io.send(pid, { type: 'lobby', rooms: hub.listRooms(), online: people.size }); }
function broadcastLobby() { for (const id of lobbyIds()) sendLobby(id); }

setInterval(() => {
  hub.tick();
  for (const it of people.values()) { it.socket.ping(); it.socket.sendJSON({ type: 'hb' }); }
  if (hub.popDirty()) broadcastLobby();
}, 1000).unref();

/* ---------- 訊息處理 ---------- */
function handle(person, msg) {
  if (!msg || typeof msg.type !== 'string') return;
  switch (msg.type) {
    case 'ping': io.send(person.id, { type: 'pong', t: msg.t }); return;
    case 'hb': return;
    case 'name': person.name = cleanName(msg.name, person.name); return;
    case 'lobby': sendLobby(person.id); return;
    case 'create': hub.create(person, msg); sync(person); return;
    case 'join': hub.join(person, msg); sync(person); return;
    case 'leave': hub.leave(person.id); io.send(person.id, { type: 'left' }); sendLobby(person.id); return;
    case 'sit': hub.sit(person); sync(person); return;
    case 'ready': hub.setReady(person, msg.value); return;
    case 'move': hub.move(person, Number(msg.idx)); return;
    case 'resign': hub.resign(person); return;
    case 'settings': hub.settings(person, msg); return;
    case 'invite_new': hub.inviteNew(person); return;
    case 'invite_revoke': hub.inviteRevoke(person); return;
    case 'kick': hub.kick(person, String(msg.target || '')); return;
    case 'chat': hub.chat(person, msg.text); return;
    default: return;
  }
}
/** 把伺服器這邊的 person 狀態對齊房間 */
function sync(person) {
  const room = hub.roomFor(person.id);
  person.roomId = room ? room.id : null;
  person.role = room ? (room.seats.some(s => s && s.id === person.id) ? 'player' : 'spectator') : null;
}

const counts = () => hub.stats();

const server = http.createServer((req, res) => {
  let url = '/';
  try { url = decodeURIComponent((req.url || '/').split('?')[0]); } catch (e) { url = '/'; }
  res.setHeader('Access-Control-Allow-Origin', ALLOW_ORIGIN);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (url === '/api/presence') {
    const c = counts();
    json(res, 200, { gameId: GAME_ID, online: people.size, players: c.players, spectators: c.spectators, lobby: lobbyIds().length, rooms: c.rooms, updatedAt: new Date().toISOString() });
    return;
  }
  if (url === '/api/rooms') { json(res, 200, { rooms: hub.listRooms(), seats: hub.CONST.SEATS }); return; }
  if (url === '/health') {
    const c = counts();
    json(res, 200, { ok: true, game: GAME_ID, rooms: c.rooms, players: c.players, spectators: c.spectators, online: people.size, time: Date.now() });
    return;
  }
  if (url === '/') url = '/index.html';
  const file = path.join(ROOT, path.normalize(url).replace(/^([/\\])+/, ''));
  if (!file.startsWith(ROOT)) { res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Forbidden'); return; }
  sendFile(res, file);
});

/* ---------- WebSocket ---------- */
/** clientId（瀏覽器分頁自己產生的祕密）→ 公開的 personId。斷線重連就是靠這個認出同一個人 */
const idFrom = clientId => 'p' + crypto.createHash('sha256').update(GAME_ID + '|' + clientId).digest('hex').slice(0, 12);

ws.attach(server, {
  path: '/ws',
  onConnection(socket) {
    const person = { id: 'tmp' + crypto.randomBytes(5).toString('hex'), name: '', roomId: null, role: null, ready: false };
    people.set(person.id, { socket: socket, person: person });
    socket.sendJSON({ type: 'hello', game: GAME_ID });

    socket.on('message', text => {
      let msg = null;
      try { msg = JSON.parse(text); } catch (e) { return; }
      try {
        if (msg && msg.type === 'hello' && !person.ready) {
          const cid = String(msg.clientId || '').slice(0, 64);
          const newId = cid.length >= 8 ? idFrom(cid) : 'p' + crypto.randomBytes(6).toString('hex');
          const old = people.get(newId);
          people.delete(person.id);
          if (old && old.socket !== socket) {            // 同一個人從別的連線接手：舊連線直接關掉
            old.socket.data.replaced = true;
            try { old.socket.close(); } catch (e) { /* ignore */ }
          }
          person.id = newId; person.ready = true; person.name = cleanName(msg.name);
          people.set(newId, { socket: socket, person: person });
          socket.sendJSON({ type: 'welcome', personId: newId, name: person.name, reconnectMs: hub.CONST.RECONNECT_MS });
          const room = hub.reconnect(person);
          if (!room) { const r = hub.roomFor(newId); if (r) { person.roomId = r.id; hub.sendRoom(newId); } else sendLobby(newId); }
          return;
        }
        if (!person.ready) return;
        handle(person, msg);
      } catch (e) {
        console.error('[proto] ' + (msg && msg.type) + ' 出錯：', e && e.stack || e);
        io.send(person.id, { type: 'error', code: 'server', params: {} });
      }
    });

    socket.on('close', () => {
      const it = people.get(person.id);
      if (!it || it.socket !== socket) return;           // 已經被新連線接手，不能把新連線判成斷線
      people.delete(person.id);
      if (!person.ready) return;
      hub.markDisconnected(person.id);
      broadcastLobby();
    });
  }
});

function localAddresses() {
  const out = [], nets = os.networkInterfaces();
  for (const name in nets) for (const net of nets[name] || []) if (net.family === 'IPv4' && !net.internal) out.push(net.address);
  return out;
}

if (require.main === module) {
  server.listen(PORT, () => {
    console.log('黑白棋（reversi）已啟動');
    console.log('  本機：http://localhost:' + PORT);
    for (const ip of localAddresses()) console.log('  同網路：http://' + ip + ':' + PORT);
    console.log('  健康檢查：http://localhost:' + PORT + '/health');
  });
}

module.exports = { server, hub, io, people, PORT, ALIVE_MS };

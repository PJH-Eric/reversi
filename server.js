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

const ws = require('./lib/ws.js');
const { createGateway, GAME_ID } = require('./lib/gateway.js');

const PORT = Number(process.env.PORT) || 3180;
const ROOT = path.join(__dirname, 'public');
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || '*';
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

const { hub, io, people, connect, tick } = createGateway();
setInterval(tick, 1000).unref();

const counts = () => hub.stats();

const server = http.createServer((req, res) => {
  let url = '/';
  try { url = decodeURIComponent((req.url || '/').split('?')[0]); } catch (e) { url = '/'; }
  res.setHeader('Access-Control-Allow-Origin', ALLOW_ORIGIN);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

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
ws.attach(server, { path: '/ws', onConnection: connect });

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

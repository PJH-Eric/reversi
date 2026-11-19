'use strict';

const crypto = require('node:crypto');
const { createHub, cleanName } = require('./rooms.js');
const { createHub: createLobbyChat } = require('./lobby-chat.js');

const GAME_ID = 'reversi';

/** clientId（瀏覽器分頁自己產生的祕密）→ 公開的 personId。斷線重連就是靠這個認出同一個人 */
const idFrom = clientId => 'p' + crypto.createHash('sha256').update(GAME_ID + '|' + clientId).digest('hex').slice(0, 12);

function createGateway() {
  /** personId → { socket, person } */
  const people = new Map();

  const io = {
    send(personId, msg) { const it = people.get(personId); if (it && it.socket.alive) it.socket.sendJSON(msg); },
    /** 房間關了／被踢：這個人回到大廳狀態 */
    cleared(personId) { const it = people.get(personId); if (it) { it.person.roomId = null; it.person.role = null; } }
  };

  const hub = createHub(io);

  /* 大廳聊天室（與房間聊天分開；即時傳送訊息，不載入歷史訊息） */
  const lobbyChat = createLobbyChat({ send: (id, msg) => io.send(id, msg), key: 'type' });

  function lobbyIds() { const out = []; for (const [id, it] of people) if (!it.person.roomId && it.person.ready) out.push(id); return out; }
  function sendLobby(pid) { io.send(pid, { type: 'lobby', rooms: hub.listRooms(), online: Array.from(people.values()).filter(it => it.person.ready).length }); }
  function broadcastLobby() { for (const id of lobbyIds()) sendLobby(id); }

  function tick() {
    hub.tick();
    for (const it of people.values()) { it.socket.ping(); it.socket.sendJSON({ type: 'hb' }); }
    if (hub.popDirty()) broadcastLobby();
  }

  /* ---------- 訊息處理 ---------- */
  function handle(person, msg) {
    if (!msg || typeof msg.type !== 'string') return;
    switch (msg.type) {
      case 'ping': io.send(person.id, { type: 'pong', t: msg.t }); return;
      case 'hb': return;
      case 'name': person.name = cleanName(msg.name, person.name); return;
      case 'lobby': sendLobby(person.id); return;
      case 'create': {
        hub.create(person, msg); sync(person);
        const room = hub.roomFor(person.id);
        if (room && room.hostId === person.id && !room.settings.isPrivate) lobbyChat.roomOpened({ code: room.id, host: room.seats[0] ? room.seats[0].name : person.name });
        return;
      }
      case 'lobbychat': lobbyChat.handle(person.id, msg); return;
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

  function connect(socket) {
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
          person.id = newId; person.ready = true; person.name = cleanName(msg.name);
          people.set(newId, { socket: socket, person: person });
          if (old && old.socket !== socket) {            // 同一個人從別的連線接手：舊連線直接關掉
            try { old.socket.close(); } catch (e) { /* ignore */ }
          }
          socket.sendJSON({ type: 'welcome', personId: newId, name: person.name, reconnectMs: hub.CONST.RECONNECT_MS });
          const room = hub.reconnect(person);
          if (!room) { const r = hub.roomFor(newId); if (r) { person.roomId = r.id; hub.sendRoom(newId); } else sendLobby(newId); }
          broadcastLobby();
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
      lobbyChat.drop(person.id);
      hub.markDisconnected(person.id);
      broadcastLobby();
    });
  }

  return { hub, io, people, connect, tick };
}

module.exports = { createGateway, GAME_ID };

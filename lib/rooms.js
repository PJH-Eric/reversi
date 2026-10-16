/* ===== lib/rooms.js — 房間、席位、觀戰、邀請、聊天、回合制對局（純邏輯，不碰 socket）=====
 * 對外只有 createHub(io)：io.send(personId, msg) 負責把訊息送給某個人，其餘全在這裡。
 *
 * 房間生命週期（以「實體玩家」為準）：
 *   - 有實體玩家＝佔著席位、而且連著線（或斷線還在寬限期內）。觀戰者不算。
 *   - 實體玩家數降到 0 → 房間立刻關閉：邀請失效、從大廳移除、廣播 closed、停掉計時，
 *     已關的房間不會因為重新連線而復活。
 *   - 對局中有人離開 → 判對手勝（reason: left），席位空出來，房間留給還在的那位。
 *   - 對局中斷線超過寬限期 → 同樣判對手勝。
 */
'use strict';

const crypto = require('crypto');
const Rules = require('../public/js/rules.js');
const { BLACK, WHITE } = Rules;

const CONST = {
  SEATS: 2,
  SPEC_MAX: 20,
  RECONNECT_MS: 30000,
  INVITE_TTL_MS: 2 * 60 * 60 * 1000,
  LIMITS: [0, 30, 60],
  CHAT_KEEP: 60,
  CHAT_MAX: 200
};

const ID_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function cleanName(raw, fallback) {
  let s = String(raw == null ? '' : raw).replace(/[\u0000-\u001f\u007f<>&"'`]/g, '').replace(/\s+/g, ' ').trim();
  s = Array.from(s).slice(0, 16).join('');
  return s || fallback || ('玩家' + (100 + Math.floor(Math.random() * 900)));
}
function cleanText(raw) {
  return Array.from(String(raw == null ? '' : raw).replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim()).slice(0, CONST.CHAT_MAX).join('');
}

function createHub(io, opt) {
  opt = opt || {};
  const now = opt.now || (() => Date.now());
  const rooms = new Map();
  const where = new Map();        // personId → roomId
  let dirty = true;

  const send = (pid, msg) => { try { io.send(pid, msg); } catch (e) { /* 對方已斷線 */ } };
  const markDirty = () => { dirty = true; };

  function newRoomId() {
    for (let n = 0; n < 50; n++) {
      let id = '';
      for (let i = 0; i < 4; i++) id += ID_CHARS[crypto.randomInt(ID_CHARS.length)];
      if (!rooms.has(id)) return id;
    }
    return 'R' + Date.now().toString(36).toUpperCase();
  }
  const newToken = () => crypto.randomBytes(14).toString('base64url');

  /* ---------- 查詢 ---------- */
  const seatOf = (room, pid) => room.seats.findIndex(s => s && s.id === pid);
  const isSpec = (room, pid) => room.specs.has(pid);
  const presentPlayers = room => room.seats.filter(Boolean);
  const connectedPlayers = room => room.seats.filter(s => s && s.connected);
  const allMembers = room => presentPlayers(room).concat(Array.from(room.specs.values()));
  function roleOf(room, pid) { return seatOf(room, pid) >= 0 ? 'player' : isSpec(room, pid) ? 'spectator' : null; }

  function inviteState(room) {
    const t = now();
    return { revoked: !!room.invite.revoked, expired: t > room.invite.expiresAt, expiresAt: room.invite.expiresAt };
  }

  /** 組給某個人看的房間快照（黑白棋沒有隱藏資訊，所有人看到的局面一樣；邀請 token 只給房主） */
  function snapshot(room, pid) {
    const role = roleOf(room, pid);
    const seat = seatOf(room, pid);
    const st = room.game;
    const c = Rules.count(st.board);
    return {
      id: room.id, status: room.status, version: room.version, serverNow: now(),
      you: { id: pid, role: role, seat: seat, color: seat >= 0 ? room.seats[seat].color : 0, host: room.hostId === pid },
      hostId: room.hostId,
      seats: room.seats.map(s => s && { id: s.id, name: s.name, color: s.color, connected: s.connected, ready: !!s.ready }),
      specs: Array.from(room.specs.values()).map(s => ({ id: s.id, name: s.name, connected: s.connected })),
      settings: { limit: room.settings.limit, isPrivate: room.settings.isPrivate },
      game: {
        board: st.board, turn: st.turn, over: st.over, winner: st.winner, lastMove: st.lastMove,
        moves: st.moves.map(m => ({ p: m.p, i: m.i })), black: c.black, white: c.white,
        result: room.result, deadline: room.status === 'playing' ? room.deadline : 0, number: room.gameNo
      },
      invite: room.hostId === pid ? Object.assign({ token: room.invite.token }, inviteState(room)) : null,
      chat: room.chat.slice(-30)
    };
  }

  function broadcast(room) {
    for (const m of allMembers(room)) if (m.connected) send(m.id, { type: 'room', room: snapshot(room, m.id) });
    markDirty();
  }
  function emit(room, msg) { for (const m of allMembers(room)) if (m.connected) send(m.id, msg); }
  /* 伺服器不送任何顯示文字：只送代碼（code）與參數（params），由前端依語言翻譯 */
  function toast(room, code, params) { emit(room, { type: 'toast', code: code, params: params || {} }); }

  function listRooms() {
    const out = [];
    for (const r of rooms.values()) {
      if (r.settings.isPrivate) continue;
      const host = r.seats.find(s => s && s.id === r.hostId) || r.seats.find(Boolean);
      out.push({
        id: r.id, hostName: host ? host.name : '', players: presentPlayers(r).length, seats: CONST.SEATS,
        spectators: r.specs.size, status: r.status, limit: r.settings.limit, specFull: r.specs.size >= CONST.SPEC_MAX
      });
    }
    out.sort((a, b) => (a.status === 'waiting' ? 0 : 1) - (b.status === 'waiting' ? 0 : 1) || a.id.localeCompare(b.id));
    return out;
  }

  /* ---------- 建立、關閉 ---------- */
  function detach(pid) {
    where.delete(pid);
    if (io.cleared) io.cleared(pid);
  }

  function closeRoom(room, reason) {
    if (room.closed) return;
    room.closed = true;
    room.invite.revoked = true;
    room.status = 'closed';
    for (const m of allMembers(room)) {
      if (m.connected) send(m.id, { type: 'closed', roomId: room.id, reason: reason || 'no_players' });
      detach(m.id);
    }
    rooms.delete(room.id);
    markDirty();
  }

  function create(p, msg) {
    if (where.has(p.id)) leave(p.id, true);
    const id = newRoomId();
    const limit = CONST.LIMITS.indexOf(Number(msg && msg.limit)) >= 0 ? Number(msg.limit) : 0;
    const room = {
      id: id, hostId: p.id, version: 1, status: 'waiting', closed: false, gameNo: 0, deadline: 0,
      seats: [null, null], specs: new Map(), chat: [], result: null, lastChatAt: new Map(),
      settings: { limit: limit, isPrivate: !!(msg && msg.isPrivate) },
      invite: { token: newToken(), revoked: false, expiresAt: now() + CONST.INVITE_TTL_MS },
      game: Rules.newGame()
    };
    room.seats[0] = { id: p.id, name: cleanName(msg && msg.name, p.name), color: BLACK, connected: true, ready: false, dcAt: 0 };
    rooms.set(id, room);
    where.set(p.id, id);
    p.roomId = id; p.role = 'player';
    broadcast(room);
    return room;
  }

  /** 加入：伺服器決定最後的角色。token 有效才算邀請；私人房沒有邀請不能進 */
  function join(p, msg) {
    const room = rooms.get(String(msg && msg.roomId || '').toUpperCase());
    if (!room || room.closed) return fail(p, 'room_missing');
    const name = cleanName(msg.name, p.name);
    const existing = roleOf(room, p.id);
    if (existing) { restore(room, p.id, name); return room; }

    let invited = false;
    if (msg.token) {
      const inv = inviteState(room);
      if (String(msg.token) !== room.invite.token) return fail(p, 'invite_invalid');
      if (inv.revoked) return fail(p, 'invite_revoked');
      if (inv.expired) return fail(p, 'invite_expired');
      invited = true;
    } else if (room.settings.isPrivate) {
      return fail(p, 'private');
    }

    if (where.has(p.id)) leave(p.id, true);
    const free = room.seats.findIndex(s => !s);
    const wantPlayer = msg.want !== 'spectator';
    if (wantPlayer && free >= 0 && room.status !== 'playing') {
      seatPlayer(room, p, free, name);
    } else if (wantPlayer && free >= 0 && room.status === 'playing') {
      // 對局中的空位（對手剛離開）也能補上，但這時局面已經結束，所以不會碰到這種情況；保險起見仍當觀戰
      addSpec(room, p, name);
    } else {
      if (room.specs.size >= CONST.SPEC_MAX) return fail(p, 'spec_full');
      addSpec(room, p, name);
    }
    toast(room, roleOf(room, p.id) === 'player' ? 'joinedPlay' : 'joinedSpec', { n: name, invited: !!invited });
    broadcast(room);
    return room;
  }

  function seatPlayer(room, p, idx, name) {
    const other = room.seats[1 - idx];
    const color = other ? Rules.other(other.color) : (room.gameNo % 2 === 0 ? BLACK : WHITE);
    room.seats[idx] = { id: p.id, name: name, color: color, connected: true, ready: false, dcAt: 0 };
    room.specs.delete(p.id);
    where.set(p.id, room.id);
    p.roomId = room.id; p.role = 'player';
    if (!room.hostId || seatOf(room, room.hostId) < 0) room.hostId = p.id;
  }
  function addSpec(room, p, name) {
    room.specs.set(p.id, { id: p.id, name: name, connected: true, dcAt: 0 });
    where.set(p.id, room.id);
    p.roomId = room.id; p.role = 'spectator';
  }
  function restore(room, pid, name) {
    const s = room.seats[seatOf(room, pid)] || room.specs.get(pid);
    if (!s) return;
    s.connected = true; s.dcAt = 0; if (name) s.name = name;
    where.set(pid, room.id);
    broadcast(room);
  }

  /** 觀戰者坐進空位 */
  function sit(p) {
    const room = roomFor(p.id); if (!room) return;
    if (!isSpec(room, p.id)) return;
    if (room.status === 'playing') return fail(p, 'busy_sit');
    const free = room.seats.findIndex(s => !s);
    if (free < 0) return fail(p, 'full');
    const sp = room.specs.get(p.id);
    seatPlayer(room, p, free, sp.name);
    for (const s of room.seats) if (s) s.ready = false;
    toast(room, 'sat', { n: sp.name });
    broadcast(room);
  }

  function leave(pid, silent) {
    const room = roomFor(pid); if (!room) { where.delete(pid); return; }
    const seat = seatOf(room, pid);
    if (seat >= 0) {
      const name = room.seats[seat].name;
      if (room.status === 'playing') finishGame(room, Rules.other(room.seats[seat].color), 'left', 'leftGame', { n: name });
      freeSeat(room, seat);
      if (!silent) toast(room, 'leftRoom', { n: name });
    } else if (room.specs.has(pid)) {
      room.specs.delete(pid);
    }
    detach(pid);
    afterMembership(room);
  }

  function freeSeat(room, idx) {
    const s = room.seats[idx];
    room.seats[idx] = null;
    if (s && room.hostId === s.id) {
      const nxt = room.seats.find(Boolean);
      room.hostId = nxt ? nxt.id : '';
    }
    for (const x of room.seats) if (x) x.ready = false;
    if (room.status !== 'playing') room.status = room.status === 'finished' ? 'finished' : 'waiting';
  }

  /** 人員變動後：沒有實體玩家就關房，否則廣播 */
  function afterMembership(room) {
    if (room.closed) return;
    if (presentPlayers(room).length === 0) { closeRoom(room, 'no_players'); return; }
    broadcast(room);
  }

  function kick(p, targetId) {
    const room = roomFor(p.id); if (!room || room.hostId !== p.id || targetId === p.id) return;
    if (!roleOf(room, targetId)) return;
    const name = (room.seats[seatOf(room, targetId)] || room.specs.get(targetId) || {}).name;
    send(targetId, { type: 'closed', roomId: room.id, reason: 'kicked' });
    leave(targetId, true);
    toast(room, 'kicked', { n: name || null });
  }

  /* ---------- 準備、開局 ---------- */
  function setReady(p, value) {
    const room = roomFor(p.id); if (!room) return;
    const seat = seatOf(room, p.id); if (seat < 0) return;
    if (room.status === 'playing') return;
    room.seats[seat].ready = value !== false;
    if (room.seats[0] && room.seats[1] && room.seats[0].ready && room.seats[1].ready) startGame(room);
    else broadcast(room);
  }

  function startGame(room) {
    room.gameNo++;
    room.game = Rules.newGame();
    /* 第二局起換邊：上一局黑棋的人這局拿白棋 */
    if (room.gameNo > 1) for (const s of room.seats) if (s) s.color = Rules.other(s.color);
    room.status = 'playing'; room.result = null;
    for (const s of room.seats) if (s) s.ready = false;
    resetDeadline(room);
    toast(room, 'start');
    broadcast(room);
  }

  function resetDeadline(room) {
    room.deadline = room.settings.limit ? now() + room.settings.limit * 1000 : 0;
  }

  function finishGame(room, winnerColor, reason, code, params) {
    if (room.game.over && room.result) return;
    room.game.over = true;
    if (reason !== 'normal') room.game.winner = winnerColor;
    const c = Rules.count(room.game.board);
    room.result = { winner: room.game.winner, reason: reason, code: code || null, params: params || {}, black: c.black, white: c.white };
    room.status = 'finished'; room.deadline = 0;
    for (const s of room.seats) if (s) s.ready = false;
  }

  /* ---------- 下棋 ---------- */
  function move(p, idx) {
    const room = roomFor(p.id); if (!room) return;
    const seat = seatOf(room, p.id);
    if (seat < 0) return fail(p, 'not_player');
    if (room.status !== 'playing') return;
    return applyMove(room, room.seats[seat].color, idx, p.id);
  }

  function applyMove(room, color, idx, pid) {
    const st = room.game;
    const r = Rules.play(st, idx, color);
    if (!r.ok) { if (pid) fail({ id: pid }, r.reason === 'turn' ? 'illegal_turn' : 'illegal'); return null; }
    room.version++;
    emit(room, { type: 'moved', roomId: room.id, n: st.moves.length, idx: idx, player: color, flipped: r.flipped, passed: r.passed, over: st.over, turn: st.turn });
    if (st.over) {
      const c = Rules.count(st.board);
      finishGame(room, st.winner, 'normal');
    } else {
      resetDeadline(room);
    }
    broadcast(room);
    return r;
  }

  function resign(p) {
    const room = roomFor(p.id); if (!room || room.status !== 'playing') return;
    const seat = seatOf(room, p.id); if (seat < 0) return;
    const me = room.seats[seat];
    finishGame(room, Rules.other(me.color), 'resign', 'resigned', { n: me.name });
    broadcast(room);
  }

  /* ---------- 房間設定、邀請、聊天 ---------- */
  function settings(p, msg) {
    const room = roomFor(p.id); if (!room || room.hostId !== p.id) return;
    if (room.status === 'playing') return fail(p, 'busy_settings');
    if (msg.limit != null && CONST.LIMITS.indexOf(Number(msg.limit)) >= 0) room.settings.limit = Number(msg.limit);
    if (msg.isPrivate != null) room.settings.isPrivate = !!msg.isPrivate;
    broadcast(room);
  }
  function inviteNew(p) {
    const room = roomFor(p.id); if (!room || room.hostId !== p.id) return;
    room.invite = { token: newToken(), revoked: false, expiresAt: now() + CONST.INVITE_TTL_MS };
    toast(room, 'newInvite');
    broadcast(room);
  }
  function inviteRevoke(p) {
    const room = roomFor(p.id); if (!room || room.hostId !== p.id) return;
    room.invite.revoked = true;
    broadcast(room);
  }
  function chat(p, text) {
    const room = roomFor(p.id); if (!room) return;
    const t = cleanText(text); if (!t) return;
    const last = room.lastChatAt.get(p.id) || 0;
    if (now() - last < 350) return;
    room.lastChatAt.set(p.id, now());
    const who = room.seats[seatOf(room, p.id)] || room.specs.get(p.id);
    const m = { id: p.id, name: who.name, role: roleOf(room, p.id), text: t, t: now() };
    room.chat.push(m);
    if (room.chat.length > CONST.CHAT_KEEP) room.chat.shift();
    emit(room, { type: 'chat', msg: m });
  }

  /* ---------- 連線狀態 ---------- */
  function markDisconnected(pid) {
    const room = roomFor(pid); if (!room) return;
    const s = room.seats[seatOf(room, pid)] || room.specs.get(pid);
    if (!s) return;
    s.connected = false; s.dcAt = now();
    if (room.specs.has(pid)) { room.specs.delete(pid); detach(pid); broadcast(room); return; }   // 觀戰者斷線就當離開
    broadcast(room);
  }
  /** 重新連線：回到原本的席位（hello 之後呼叫） */
  function reconnect(p) {
    const room = roomFor(p.id);
    if (!room) return null;
    const s = room.seats[seatOf(room, p.id)];
    if (!s) return null;
    s.connected = true; s.dcAt = 0;
    p.roomId = room.id; p.role = 'player';
    broadcast(room);
    return room;
  }

  /** 每秒呼叫：斷線寬限到期、超時代下、關閉沒有實體玩家的房間 */
  function tick() {
    const t = now();
    for (const room of Array.from(rooms.values())) {
      if (room.closed) continue;
      let changed = false;
      for (let i = 0; i < room.seats.length; i++) {
        const s = room.seats[i];
        if (s && !s.connected && t - s.dcAt > CONST.RECONNECT_MS) {
          changed = true;
          if (room.status === 'playing') finishGame(room, Rules.other(s.color), 'left', 'dcLoss', { n: s.name });
          freeSeat(room, i);
          detach(s.id);
        }
      }
      if (presentPlayers(room).length === 0) { closeRoom(room, 'no_players'); continue; }
      if (changed) broadcast(room);
      if (room.status === 'playing' && room.deadline && t > room.deadline) {
        const color = room.game.turn;
        const legal = Rules.legalList(room.game.board, color);
        if (legal.length) {
          const pick = legal[crypto.randomInt(legal.length)];
          const seat = room.seats.find(s => s && s.color === color);
          toast(room, 'timeout', { n: seat ? seat.name : null });
          applyMove(room, color, pick, null);
        }
      }
    }
  }

  /* ---------- 其他 ---------- */
  function roomFor(pid) { const id = where.get(pid); const r = id && rooms.get(id); return r && !r.closed ? r : null; }
  function fail(p, code, params) { send(p.id, { type: 'error', code: code, params: params || {} }); return null; }
  function sendRoom(pid) { const r = roomFor(pid); if (r) send(pid, { type: 'room', room: snapshot(r, pid) }); }
  function popDirty() { const d = dirty; dirty = false; return d; }
  function stats() {
    let players = 0, spectators = 0;
    for (const r of rooms.values()) { players += connectedPlayers(r).length; spectators += Array.from(r.specs.values()).filter(s => s.connected).length; }
    return { rooms: rooms.size, players: players, spectators: spectators };
  }

  return { CONST, rooms, create, join, sit, leave, kick, setReady, move, resign, settings, inviteNew, inviteRevoke, chat, markDisconnected, reconnect, tick, listRooms, roomFor, sendRoom, snapshot, popDirty, stats, closeRoom, applyMove, cleanName };
}

module.exports = { createHub, CONST, cleanName, cleanText };

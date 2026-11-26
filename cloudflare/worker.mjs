import { DurableObject } from 'cloudflare:workers';
import gateway from '../lib/gateway.js';

const { createGateway, GAME_ID } = gateway;
const MAX_MESSAGE_BYTES = 64 * 1024;
const HEARTBEAT_MS = 1000;
const CLIENT_TIMEOUT_MS = 9000;
const ORIGIN = 'https://pjh-eric.github.io';
const DO_VERSION = 'v2';

const headers = {
  'Access-Control-Allow-Origin': ORIGIN,
  'Cache-Control': 'no-store'
};

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === '/ws') {
      const origin = request.headers.get('Origin');
      if (origin && origin !== ORIGIN) return new Response('Forbidden', { status: 403 });
      if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
        return new Response('Expected WebSocket', { status: 426 });
      }
    } else {
      if (pathname !== '/health' && pathname !== '/api/rooms') {
        return new Response('Not found', { status: 404 });
      }
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
      if (request.method !== 'GET') return new Response('Method not allowed', { status: 405, headers });
    }

    const id = env.HUB.idFromName(`${GAME_ID}-${DO_VERSION}`);
    const stub = env.HUB.get(id, { locationHint: 'apac' });
    const started = performance.now();
    const response = await stub.fetch(request);
    const rtt = performance.now() - started;
    const out = new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
      webSocket: response.webSocket
    });
    out.headers.set('x-do-rtt-ms', rtt.toFixed(1));
    out.headers.set('x-edge-colo', request.cf?.colo ?? 'unknown');
    return out;
  }
};

export class GameLobby extends DurableObject {
  gateway = createGateway();
  connections = new Set();
  heartbeat;

  constructor(ctx, env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      if (await ctx.storage.get('creationLogged')) return;
      await ctx.storage.put('creationLogged', true);
      console.log('durable_object_created', { id: ctx.id.toString(), version: DO_VERSION, role: 'lobby' });
    });
  }

  fetch(request) {
    const { pathname } = new URL(request.url);
    const { hub, people } = this.gateway;
    if (pathname === '/health') {
      return Response.json({
        ok: true,
        game: GAME_ID,
        runtime: 'cloudflare',
        ...hub.stats(),
        online: people.size,
        time: Date.now()
      }, { headers });
    }
    if (pathname === '/api/rooms') {
      return Response.json({ rooms: hub.listRooms(), seats: hub.CONST.SEATS }, { headers });
    }

    const [client, server] = Object.values(new WebSocketPair());
    server.accept();
    this.gateway.tick();
    this.connect(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  connect(server) {
    let closed = false;
    let lastMessage = Date.now();
    let onDisconnect;
    const disconnect = () => {
      if (closed) return;
      closed = true;
      this.connections.delete(checkTimeout);
      if (!this.connections.size) {
        clearInterval(this.heartbeat);
        this.heartbeat = undefined;
      }
      onDisconnect?.();
    };
    const close = (code, reason) => {
      disconnect();
      if (server.readyState === WebSocket.OPEN) server.close(code, reason);
    };
    const checkTimeout = now => {
      if (now - lastMessage >= CLIENT_TIMEOUT_MS) close(1008, 'Heartbeat timeout');
    };

    this.connections.add(checkTimeout);
    this.heartbeat ??= setInterval(() => {
      const now = Date.now();
      for (const check of this.connections) check(now);
      this.gateway.tick();
    }, HEARTBEAT_MS);

    this.gateway.connect({
      get alive() { return !closed && server.readyState === WebSocket.OPEN; },
      sendJSON(message) {
        if (this.alive) server.send(JSON.stringify(message));
      },
      ping() {
        // Workers exposes application messages. The shared gateway sends a JSON heartbeat.
      },
      close() { close(1000, 'Connection replaced'); },
      on(event, handler) {
        if (event === 'close') {
          onDisconnect = handler;
          return;
        }
        server.addEventListener('message', ({ data }) => {
          if (typeof data !== 'string') return;
          if (new TextEncoder().encode(data).byteLength > MAX_MESSAGE_BYTES) {
            close(1009, 'Message too large');
            return;
          }
          lastMessage = Date.now();
          handler(data);
        });
      }
    });

    server.addEventListener('close', disconnect);
    server.addEventListener('error', disconnect);
  }
}

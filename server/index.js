// Entry point: serves the static client and speaks the WebSocket protocol.
// No framework: node:http for files, `ws` for sockets. One process, one port.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { RoomManager, RoomError } from './room.js';
import { cleanName, cleanText } from './util.js';
import { gameCatalog } from './games/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
};

const AVATARS = [
  '🦊',
  '🐸',
  '🐙',
  '🦄',
  '🐝',
  '🦖',
  '🐼',
  '🦩',
  '🐨',
  '🦑',
  '🐧',
  '🦔',
  '🐲',
  '🦜',
  '🐺',
  '🦋',
];

function serveFile(res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=300',
    });
    res.end(data);
  });
}

export function createApp() {
  const manager = new RoomManager();
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    let p = decodeURIComponent(url.pathname);

    if (p === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, ...manager.stats(), uptime: process.uptime() }));
      return;
    }
    if (p === '/api/catalog') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(gameCatalog()));
      return;
    }
    // Pretty join links: /r/ABCD opens the app with the code prefilled; /tv shows the big screen.
    if (/^\/r\/[A-Za-z]{4}\/?$/.test(p)) p = '/index.html';
    if (p === '/tv' || p === '/tv/') p = '/tv.html';
    if (p === '/') p = '/index.html';

    const safe = path.normalize(p).replace(/^(\.\.[/\\])+/, '');
    const filePath = path.join(PUBLIC_DIR, safe);
    if (!filePath.startsWith(PUBLIC_DIR)) {
      res.writeHead(403);
      res.end();
      return;
    }
    serveFile(res, filePath);
  });

  const wss = new WebSocketServer({ server, maxPayload: 64 * 1024 });

  function send(ws, msg) {
    if (ws.readyState === 1) ws.send(JSON.stringify(msg));
  }

  function fail(ws, code, message) {
    send(ws, { t: 'error', code, message });
  }

  wss.on('connection', (ws, req) => {
    ws.isAlive = true;
    ws.on('pong', () => (ws.isAlive = true));
    // simple flood guard: 40 messages per second per socket
    let budget = 40;
    const refill = setInterval(() => (budget = 40), 1000);
    refill.unref?.();

    ws.on('message', (raw) => {
      if (--budget < 0) return; // drop silently; the client will resync on next view
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return fail(ws, 'bad_json', 'Malformed message.');
      }
      if (!msg || typeof msg.t !== 'string') return fail(ws, 'bad_msg', 'Malformed message.');
      try {
        handle(ws, msg);
      } catch (err) {
        if (err instanceof RoomError) return fail(ws, err.code, err.message);
        console.error('handler error', err);
        fail(ws, 'server_error', 'Something went wrong on the server.');
      }
    });

    ws.on('close', () => {
      clearInterval(refill);
      ws.__room?.onDisconnect(ws);
    });
    ws.on('error', () => {
      /* close will follow */
    });
  });

  function pickAvatar(input) {
    return AVATARS.includes(input) ? input : AVATARS[Math.floor(Math.random() * AVATARS.length)];
  }

  function handle(ws, msg) {
    switch (msg.t) {
      case 'ping':
        return send(ws, { t: 'pong', now: Date.now(), echo: msg.at });

      case 'create': {
        const name = cleanName(msg.name);
        if (!name) throw new RoomError('bad_name', 'Pick a name (letters or emoji, up to 16 characters).');
        const room = manager.createRoom();
        const player = room.addPlayer(ws, { name, avatar: pickAvatar(msg.avatar) });
        send(ws, { t: 'joined', code: room.code, token: player.token, playerId: player.id });
        return;
      }

      case 'join': {
        const room = manager.getRoom(msg.code);
        if (!room) throw new RoomError('no_room', 'No room with that code. Check the letters and try again.');
        const name = cleanName(msg.name);
        if (!name) throw new RoomError('bad_name', 'Pick a name (letters or emoji, up to 16 characters).');
        const player = room.addPlayer(ws, { name, avatar: pickAvatar(msg.avatar) });
        send(ws, { t: 'joined', code: room.code, token: player.token, playerId: player.id });
        return;
      }

      case 'resume': {
        const room = manager.getRoom(msg.code);
        if (!room) throw new RoomError('no_room', 'That room has ended.');
        const player = room.resume(ws, String(msg.token || ''));
        send(ws, { t: 'joined', code: room.code, token: player.token, playerId: player.id, resumed: true });
        return;
      }

      case 'watch': {
        const room = manager.getRoom(msg.code);
        if (!room) throw new RoomError('no_room', 'No room with that code.');
        room.addTv(ws);
        return;
      }

      case 'host': {
        const room = ws.__room;
        const player = ws.__player;
        if (!room || !player) throw new RoomError('not_in_room', 'Join a room first.');
        return room.hostCommand(player, msg);
      }

      case 'action': {
        const room = ws.__room;
        const player = ws.__player;
        if (!room || !player) throw new RoomError('not_in_room', 'Join a room first.');
        return room.playerAction(player, msg.a);
      }

      case 'rename': {
        const room = ws.__room;
        const player = ws.__player;
        if (!room || !player) throw new RoomError('not_in_room', 'Join a room first.');
        const name = cleanName(msg.name);
        if (!name) throw new RoomError('bad_name', 'That name will not work.');
        player.name = name;
        if (AVATARS.includes(msg.avatar)) player.avatar = msg.avatar;
        room.sync();
        return;
      }

      case 'leave': {
        const room = ws.__room;
        const player = ws.__player;
        if (room && player) room.removePlayer(player.id, 'left');
        return;
      }

      default:
        throw new RoomError('unknown', `Unknown message type "${cleanText(msg.t, 20)}".`);
    }
  }

  // Heartbeat: proxies (Render, Koyeb, Cloudflare) drop idle sockets; we ping every 25s.
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.isAlive === false) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      try {
        ws.ping();
      } catch {
        /* ignore */
      }
    }
  }, 25 * 1000);
  heartbeat.unref?.();

  return { server, wss, manager };
}

export { AVATARS };

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const { server } = createApp();
  server.listen(PORT, HOST, () => {
    console.log(
      `partyline listening on http://${HOST}:${PORT}  (games: ${
        gameCatalog()
          .map((g) => g.id)
          .join(', ') || 'none yet'
      })`,
    );
  });
}

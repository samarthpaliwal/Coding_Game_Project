// Minimal WebSocket test client built on Node 22's global WebSocket.
// Every incoming message is queued; tests await messages matching a predicate.

export class TestClient {
  constructor(url) {
    this.url = url;
    this.inbox = [];
    this.waiters = [];
    this.view = null;
    this.events = [];
    this.errors = [];
    this.closed = false;
  }

  static async connect(url) {
    const c = new TestClient(url);
    await c.open();
    return c;
  }

  open() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url);
      this.ws.addEventListener('open', () => resolve(this));
      this.ws.addEventListener('error', (e) => reject(new Error('ws error ' + (e.message || ''))));
      this.ws.addEventListener('close', () => (this.closed = true));
      this.ws.addEventListener('message', (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.t === 'view') this.view = msg;
        if (msg.t === 'event') this.events.push(msg.e);
        if (msg.t === 'error') this.errors.push(msg);
        this.inbox.push(msg);
        for (const w of this.waiters.slice()) {
          if (w.pred(msg)) {
            this.waiters.splice(this.waiters.indexOf(w), 1);
            clearTimeout(w.timer);
            w.resolve(msg);
          }
        }
      });
    });
  }

  send(msg) {
    this.ws.send(JSON.stringify(msg));
  }

  // Resolve with the first (queued or future) message matching pred.
  next(pred, timeoutMs = 4000, { consume = true } = {}) {
    const idx = this.inbox.findIndex(pred);
    if (idx >= 0) {
      const msg = this.inbox[idx];
      if (consume) this.inbox.splice(0, idx + 1);
      return Promise.resolve(msg);
    }
    if (consume) this.inbox.length = 0;
    return new Promise((resolve, reject) => {
      const w = { pred, resolve };
      w.timer = setTimeout(() => {
        this.waiters.splice(this.waiters.indexOf(w), 1);
        reject(new Error(`timeout waiting for message; last view phase=${this.view?.phase} game=${this.view?.game?.view?.phase}`));
      }, timeoutMs);
      this.waiters.push(w);
    });
  }

  // Wait until the latest view satisfies pred (checks the current one first).
  async untilView(pred, timeoutMs = 4000) {
    if (this.view && pred(this.view)) return this.view;
    this.inbox.length = 0;
    const msg = await this.next((m) => m.t === 'view' && pred(m), timeoutMs);
    return msg;
  }

  async waitEvent(pred, timeoutMs = 4000) {
    const found = this.events.find(pred);
    if (found) return found;
    const msg = await this.next((m) => m.t === 'event' && pred(m.e), timeoutMs);
    return msg.e;
  }

  async expectError(code, timeoutMs = 3000) {
    const msg = await this.next((m) => m.t === 'error' && (!code || m.code === code), timeoutMs);
    return msg;
  }

  action(a) {
    this.send({ t: 'action', a });
  }

  host(cmd, extra = {}) {
    this.send({ t: 'host', cmd, ...extra });
  }

  close() {
    this.ws.close();
  }
}

export async function startServer() {
  const { createApp } = await import('../../server/index.js');
  const app = createApp();
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const port = app.server.address().port;
  const url = `ws://127.0.0.1:${port}`;
  return {
    ...app,
    port,
    url,
    http: `http://127.0.0.1:${port}`,
    async stop() {
      for (const c of app.wss.clients) c.terminate();
      await new Promise((r) => app.server.close(r));
      clearInterval(app.manager.gc);
    },
  };
}

// Create a room with a host and n-1 joiners. Returns { host, players:[host,...], code }.
export async function makeRoom(url, names) {
  const host = await TestClient.connect(url);
  host.send({ t: 'create', name: names[0], avatar: '🦊' });
  const joined = await host.next((m) => m.t === 'joined');
  const code = joined.code;
  host.playerId = joined.playerId;
  host.token = joined.token;
  host.name = names[0];
  const players = [host];
  for (const name of names.slice(1)) {
    const c = await TestClient.connect(url);
    c.send({ t: 'join', code, name, avatar: '🐸' });
    const j = await c.next((m) => m.t === 'joined');
    c.playerId = j.playerId;
    c.token = j.token;
    c.name = name;
    players.push(c);
  }
  await host.untilView((v) => v.players.length === names.length);
  return { host, players, code };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

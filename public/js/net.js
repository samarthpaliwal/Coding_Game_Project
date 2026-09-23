// WebSocket connection with automatic reconnect and server-clock offset.
// Emits: 'status' (online/offline/connecting), 'view', 'event', 'error', 'joined', 'kicked', 'open'.

export class Net extends EventTarget {
  constructor() {
    super();
    this.ws = null;
    this.wanted = false;
    this.backoff = 400;
    this.offset = 0; // serverNow - localNow, refined by ping/pong
    this.status = 'idle';
    this.pingTimer = null;
    this.onOpenOnce = [];
  }

  url() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    return `${proto}://${location.host}`;
  }

  now() {
    return Date.now() + this.offset;
  }

  setStatus(s) {
    if (this.status === s) return;
    this.status = s;
    this.dispatchEvent(new CustomEvent('status', { detail: s }));
  }

  connect() {
    this.wanted = true;
    if (this.ws && (this.ws.readyState === 0 || this.ws.readyState === 1)) return;
    this.setStatus('connecting');
    const ws = new WebSocket(this.url());
    this.ws = ws;
    ws.addEventListener('open', () => {
      this.backoff = 400;
      this.setStatus('online');
      this.ping();
      clearInterval(this.pingTimer);
      this.pingTimer = setInterval(() => this.ping(), 20000);
      const fns = this.onOpenOnce.splice(0);
      fns.forEach((fn) => fn());
      this.dispatchEvent(new CustomEvent('open'));
    });
    ws.addEventListener('message', (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (msg.t === 'pong') {
        const rtt = Date.now() - msg.echo;
        this.offset = msg.now - (msg.echo + rtt / 2);
        return;
      }
      if (msg.t === 'view' && !this.offsetSeen) {
        this.offset = msg.now - Date.now();
      }
      this.dispatchEvent(new CustomEvent(msg.t, { detail: msg }));
    });
    ws.addEventListener('close', () => {
      clearInterval(this.pingTimer);
      this.setStatus('offline');
      if (this.wanted) {
        setTimeout(() => this.connect(), this.backoff);
        this.backoff = Math.min(this.backoff * 1.8, 6000);
      }
    });
    ws.addEventListener('error', () => {
      /* close follows */
    });
  }

  whenOpen(fn) {
    if (this.ws && this.ws.readyState === 1) fn();
    else {
      this.onOpenOnce.push(fn);
      this.connect();
    }
  }

  ping() {
    this.send({ t: 'ping', at: Date.now() });
  }

  send(msg) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(msg));
  }

  close() {
    this.wanted = false;
    clearInterval(this.pingTimer);
    this.ws?.close();
  }
}

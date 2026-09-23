// WebSocket connection with automatic reconnect and server-clock offset.
// Emits: 'status' (online/offline/connecting), 'view', 'event', 'error', 'joined', 'kicked', 'open'.

export class Net extends EventTarget {
  constructor() {
    super();
    this.ws = null;
    this.wanted = false;
    this.backoff = 400;
    this.offset = 0; // serverNow - localNow, refined by ping/pong
    this.bestRtt = Infinity;
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
      // Clock sync: a burst of 5 pings; keep the sample with the smallest round trip.
      this.bestRtt = Infinity;
      for (let i = 0; i < 5; i++) setTimeout(() => this.ping(), i * 150);
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
        const sample = msg.now - (msg.echo + rtt / 2);
        // adopt a sample if it is at least as good as the best, or the estimate drifted a lot
        if (rtt <= this.bestRtt * 1.5 || Math.abs(sample - this.offset) > 400) {
          this.offset = sample;
          this.bestRtt = Math.min(this.bestRtt, rtt);
        }
        return;
      }
      if (msg.t === 'view' && this.bestRtt === Infinity) {
        this.offset = msg.now - Date.now();
      }
      this.dispatchEvent(new CustomEvent(msg.t, { detail: msg }));
    });
    ws.addEventListener('close', (ev) => {
      clearInterval(this.pingTimer);
      this.setStatus('offline');
      // 4000 replaced by another tab, 4001 kicked/left, 4002 room closed: the server meant it.
      if (ev.code >= 4000 && ev.code < 4100) {
        this.wanted = false;
        this.dispatchEvent(new CustomEvent('closed', { detail: { code: ev.code, reason: ev.reason } }));
        return;
      }
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

// Tiny DOM toolkit: h() builder, focus-preserving render, countdown ticker, toasts, confetti, haptics.

export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'html') el.innerHTML = v;
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else if (c instanceof Node) el.appendChild(c);
    else el.appendChild(document.createTextNode(String(c)));
  }
}

// Replace root's children, keeping the typed text and caret of a focused input with an id.
export function render(root, ...nodes) {
  const active = document.activeElement;
  let snap = null;
  if (active && root.contains(active) && active.id && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) {
    snap = { id: active.id, value: active.value, s: active.selectionStart, e: active.selectionEnd };
  }
  const scrollY = root.scrollTop;
  root.replaceChildren();
  append(root, nodes);
  root.scrollTop = scrollY;
  if (snap) {
    const el = document.getElementById(snap.id);
    if (el && !el.disabled) {
      el.value = snap.value;
      try {
        el.focus({ preventScroll: true });
        if (snap.s !== null && el.setSelectionRange) el.setSelectionRange(snap.s, snap.e);
      } catch {
        /* some input types refuse selection ranges */
      }
    }
  }
}

// Countdown ticker: every element with data-ends="<serverMs>" gets its text set to seconds left,
// and --p (fraction remaining, using data-total ms) for progress bars.
let tickerClock = () => Date.now();
let lastTickSec = -1;
export function startTicker(clock, { quiet = false } = {}) {
  tickerClock = clock;
  const tick = () => {
    const now = tickerClock();
    for (const el of document.querySelectorAll('[data-ends]')) {
      const ends = Number(el.dataset.ends);
      const left = Math.max(0, ends - now);
      const secs = Math.ceil(left / 1000);
      if (el.dataset.mode !== 'bar') {
        const txt = String(secs);
        if (el.textContent !== txt) {
          el.textContent = txt;
          // last five seconds: a soft tick and a tiny buzz, once per second
          if (!quiet && secs <= 5 && secs > 0 && lastTickSec !== secs && el.classList.contains('timer')) {
            lastTickSec = secs;
            beep('tick');
            vibrate(10);
          }
        }
        el.classList.toggle('urgent', secs <= 5 && secs > 0);
      }
      const total = Number(el.dataset.total) || 0;
      if (total > 0) el.style.setProperty('--p', String(Math.min(1, left / total)));
    }
  };
  tick();
  setInterval(tick, 200);
}

let toastTimer = null;
export function toast(message, kind = 'info', ms = 2600) {
  let el = document.getElementById('toast');
  if (!el) {
    el = h('div', { id: 'toast', role: 'status', 'aria-live': 'polite' });
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.className = `show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = ''), ms);
}

export function vibrate(pattern = 20) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* unsupported */
  }
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = h('textarea', { style: { position: 'fixed', opacity: '0' } }, text);
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

// Confetti burst on a full-screen canvas; cheap and self-cleaning.
export function confetti({ count = 140, duration = 2200, colors } = {}) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const canvas = h('canvas', { class: 'confetti', 'aria-hidden': 'true' });
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(2, devicePixelRatio || 1);
  const W = (canvas.width = innerWidth * dpr);
  const H = (canvas.height = innerHeight * dpr);
  const palette = colors || ['#FF5C7A', '#3DF2C5', '#FFC84A', '#7C6CFF', '#FFFFFF'];
  const parts = Array.from({ length: count }, () => ({
    x: W / 2 + (Math.random() - 0.5) * W * 0.3,
    y: H * 0.35,
    vx: (Math.random() - 0.5) * 18 * dpr,
    vy: (-8 - Math.random() * 14) * dpr,
    s: (4 + Math.random() * 6) * dpr,
    r: Math.random() * Math.PI,
    vr: (Math.random() - 0.5) * 0.3,
    c: palette[Math.floor(Math.random() * palette.length)],
  }));
  const start = performance.now();
  const frame = (t) => {
    const k = (t - start) / duration;
    ctx.clearRect(0, 0, W, H);
    for (const p of parts) {
      p.vy += 0.35 * dpr;
      p.x += p.vx;
      p.y += p.vy;
      p.vx *= 0.99;
      p.r += p.vr;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.r);
      ctx.globalAlpha = Math.max(0, 1 - k);
      ctx.fillStyle = p.c;
      ctx.fillRect(-p.s / 2, -p.s / 2, p.s, p.s * 0.6);
      ctx.restore();
    }
    if (k < 1) requestAnimationFrame(frame);
    else canvas.remove();
  };
  requestAnimationFrame(frame);
}

// Short synthesized sounds (no audio files). Unlocked on the first tap.
const audio = { ctx: null, muted: false };
export function unlockAudio() {
  try {
    if (!audio.ctx) audio.ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (audio.ctx.state === 'suspended') audio.ctx.resume();
  } catch {
    /* no audio */
  }
}
export function setMuted(m) {
  audio.muted = m;
}
export function beep(kind = 'tap') {
  if (audio.muted || !audio.ctx) return;
  const c = audio.ctx;
  const o = c.createOscillator();
  const g = c.createGain();
  o.connect(g);
  g.connect(c.destination);
  const t = c.currentTime;
  const presets = {
    tap: [660, 0.05, 'sine'],
    tick: [880, 0.04, 'square'],
    go: [520, 0.18, 'triangle'],
    win: [780, 0.35, 'triangle'],
    lose: [220, 0.3, 'sawtooth'],
    reveal: [440, 0.12, 'sine'],
  };
  const [f, d, type] = presets[kind] || presets.tap;
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  if (kind === 'win') o.frequency.exponentialRampToValueAtTime(f * 1.5, t + d);
  if (kind === 'lose') o.frequency.exponentialRampToValueAtTime(f * 0.6, t + d);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.18, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + d);
  o.start(t);
  o.stop(t + d + 0.02);
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
}

export function plural(n, word, words = word + 's') {
  return `${n} ${n === 1 ? word : words}`;
}

export function initials(name) {
  return String(name || '?')
    .trim()
    .slice(0, 1)
    .toUpperCase();
}

export function qrSvg(text, cellSize = 4) {
  try {
    if (typeof qrcode !== 'function') return '';
    const q = qrcode(0, 'M');
    q.addData(text);
    q.make();
    return q.createSvgTag({ cellSize, margin: 2, scalable: true });
  } catch {
    return '';
  }
}

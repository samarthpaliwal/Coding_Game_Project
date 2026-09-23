// Small helpers shared by the server and the game modules.

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I or O: they read like 1 and 0 on a TV

export function randomCode(len = 4, taken = new Set()) {
  for (let attempt = 0; attempt < 10000; attempt++) {
    let s = '';
    for (let i = 0; i < len; i++) s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    if (!taken.has(s)) return s;
  }
  throw new Error('code space exhausted');
}

export function randomToken(bytes = 18) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let s = '';
  for (let i = 0; i < bytes; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}

let idCounter = 0;
export function nextId(prefix = 'p') {
  idCounter = (idCounter + 1) % 1e9;
  return `${prefix}${idCounter.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

export function shuffle(arr, rng = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function pick(arr, rng = Math.random) {
  return arr[Math.floor(rng() * arr.length)];
}

// Player-facing text: trim, collapse whitespace, strip control chars, cap length.
export function cleanText(input, max = 120) {
  if (typeof input !== 'string') return '';
  return input
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

const NAME_BLOCKLIST = ['nigg', 'fag', 'retard', 'kike', 'chink', 'spic', 'tranny'];
export function cleanName(input) {
  let name = cleanText(input, 16);
  const lower = name.toLowerCase();
  if (!name || NAME_BLOCKLIST.some((w) => lower.includes(w))) name = '';
  return name;
}

export function nowMs() {
  return Date.now();
}

export function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

// Deterministic-ish "no repeats" picker: keeps a per-room cursor over a shuffled bank.
export class BankCursor {
  constructor(items, rng = Math.random) {
    this.rng = rng;
    this.items = items;
    this.reset();
  }
  reset() {
    this.order = shuffle(this.items, this.rng);
    this.i = 0;
  }
  next() {
    if (this.i >= this.order.length) this.reset();
    return this.order[this.i++];
  }
  take(n) {
    const out = [];
    for (let k = 0; k < n; k++) out.push(this.next());
    return out;
  }
}

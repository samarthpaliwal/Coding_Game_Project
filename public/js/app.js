// Player app: home (create/join) -> lobby -> game (delegated to a game renderer) -> results.

import { Net } from './net.js';
import { h, render, startTicker, toast, vibrate, copyText, confetti, unlockAudio, beep, setMuted, plural, qrSvg } from './ui.js';
import { GAME_RENDERERS } from './games/index.js';

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
  '🐢',
  '🦥',
  '🐳',
  '🦉',
  '🐷',
  '🦁',
  '🐮',
  '🦎',
];
const SESSION_KEY = 'contraband.session';
const PREFS_KEY = 'contraband.prefs';

const net = new Net();
const root = document.getElementById('app');
let paintQueued = false;
const state = {
  view: null,
  session: load(SESSION_KEY),
  prefs: load(PREFS_KEY) || { name: '', avatar: AVATARS[Math.floor(Math.random() * AVATARS.length)], muted: false },
  screen: 'home',
  busy: false,
  urlCode: codeFromUrl(),
  showQr: false,
  codeDraft: '',
  attempt: 0,
  keep: new Map(), // persistent DOM nodes for game renderers (canvases etc.)
  keepScope: '',
  lastPhaseKey: '',
};
setMuted(!!state.prefs.muted);

function load(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null');
  } catch {
    return null;
  }
}
function save(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode */
  }
}
function codeFromUrl() {
  const m = location.pathname.match(/^\/r\/([A-Za-z]{4})/);
  if (m) return m[1].toUpperCase();
  const q = new URLSearchParams(location.search).get('room');
  return q ? q.toUpperCase().slice(0, 4) : '';
}

// ---------- networking ----------

net.addEventListener('status', (e) => {
  document.body.dataset.net = e.detail;
  if (e.detail === 'online' && state.session && state.screen !== 'home') {
    net.send({ t: 'resume', code: state.session.code, token: state.session.token });
  }
  paint();
});
net.addEventListener('joined', (e) => {
  const m = e.detail;
  state.session = { code: m.code, token: m.token, playerId: m.playerId };
  save(SESSION_KEY, state.session);
  state.busy = false;
  state.attempt++;
  state.screen = 'room';
  state.codeDraft = '';
  if (!location.pathname.startsWith(`/r/${m.code}`)) history.replaceState(null, '', `/r/${m.code}`);
  if (!m.resumed) beep('go');
});
net.addEventListener('view', (e) => {
  state.view = e.detail;
  state.screen = 'room';
  paint();
});
net.addEventListener('event', (e) => {
  const ev = e.detail.e;
  const game = state.view?.game && GAME_RENDERERS[state.view.game.id];
  game?.onEvent?.(ev, api());
});
net.addEventListener('closed', (e) => {
  const { code } = e.detail;
  if (code === 4000) {
    state.screen = 'elsewhere';
    paint();
  } else if (code === 4002) {
    leaveToHome('That room has ended.');
  }
});
net.addEventListener('kicked', (e) => {
  leaveToHome(e.detail.reason === 'kicked' ? 'The host removed you from the room.' : 'You left the room.');
});
net.addEventListener('error', (e) => {
  const m = e.detail;
  state.busy = false;
  if (m.code === 'bad_token' || (m.code === 'no_room' && state.session && state.screen !== 'home')) {
    leaveToHome(m.code === 'no_room' ? 'That room has ended.' : 'Your seat expired. Join again.');
    return;
  }
  toast(m.message || 'Something went wrong.', 'error');
  vibrate([30, 40, 30]);
  paint();
});

function clearKeep() {
  for (const v of state.keep.values()) if (v && v.timer) clearInterval(v.timer);
  state.keep.clear();
}

function leaveToHome(message) {
  state.session = null;
  save(SESSION_KEY, null);
  state.view = null;
  state.screen = 'home';
  clearKeep();
  history.replaceState(null, '', '/');
  if (message) toast(message, 'info', 3500);
  paint();
}

function api() {
  // Getters, so long-lived closures (tickers, intervals) always see the latest view.
  return {
    get view() {
      return state.view;
    },
    get me() {
      return state.view?.you;
    },
    get players() {
      return state.view?.players || [];
    },
    player: (id) => (state.view?.players || []).find((p) => p.id === id) || null,
    get isHost() {
      return !!state.view?.you?.isHost;
    },
    send: (a) => net.send({ t: 'action', a }),
    host: (cmd, extra = {}) => net.send({ t: 'host', cmd, ...extra }),
    now: () => net.now(),
    h,
    toast,
    vibrate,
    confetti,
    beep,
    plural,
    // Persistent element across re-renders (e.g. a canvas). Cleared when the scope key changes.
    keep: (key, factory) => {
      if (!state.keep.has(key)) state.keep.set(key, factory());
      return state.keep.get(key);
    },
    forget: (key) => state.keep.delete(key),
  };
}

// ---------- boot ----------

startTicker(() => net.now());
document.addEventListener('pointerdown', unlockAudio, { once: true });
document.addEventListener('keydown', unlockAudio, { once: true });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') net.connect();
});
window.addEventListener('online', () => net.connect());
document.addEventListener('contraband:rerender', () => paint());

if (state.session && (!state.urlCode || state.urlCode === state.session.code)) {
  state.screen = 'room';
  net.connect();
} else {
  if (state.urlCode && state.session) {
    state.session = null;
    save(SESSION_KEY, null);
  }
  state.screen = 'home';
}
paint();

// ---------- painting ----------

function paint() {
  if (paintQueued) return;
  paintQueued = true;
  requestAnimationFrame(() => {
    paintQueued = false;
    try {
      doPaint();
    } catch (err) {
      console.error(err);
      render(
        root,
        h(
          'div',
          { class: 'screen center' },
          h('h2', null, 'Something broke on this screen'),
          h('p', { class: 'muted' }, String(err.message)),
          h('button', { class: 'btn', onClick: () => location.reload() }, 'Reload'),
        ),
      );
    }
  });
}

function doPaint() {
  const v = state.view;
  if (state.screen === 'elsewhere') {
    render(root, renderElsewhere());
    return;
  }
  if (state.screen === 'home') {
    render(root, renderHome());
    return;
  }
  if (!v) {
    render(root, renderReconnecting());
    return;
  }
  if (v.phase !== 'playing' && state.keep.size) {
    clearKeep();
    state.keepScope = '';
    state.lastPhaseKey = '';
  }
  if (v.phase === 'lobby') {
    document.body.dataset.phase = 'lobby';
    render(root, renderLobby(v));
  } else if (v.phase === 'results') {
    document.body.dataset.phase = 'results';
    render(root, renderResults(v));
  } else {
    document.body.dataset.phase = 'playing';
    render(root, renderPlaying(v));
  }
}

function topBar(v, { center } = {}) {
  const online = net.status === 'online';
  return h(
    'header',
    { class: 'topbar' },
    h(
      'button',
      { class: 'code-pill', title: 'Copy invite link', onClick: () => shareLink(v.code) },
      h('span', { class: 'code-label' }, 'ROOM'),
      h('span', { class: 'code' }, v.code),
    ),
    h('div', { class: 'topbar-center' }, center || null),
    h(
      'div',
      { class: 'topbar-right' },
      h('span', { class: `net-dot ${online ? 'on' : 'off'}`, title: online ? 'Connected' : 'Reconnecting…' }),
      h('span', { class: 'me-avatar', title: v.you?.name }, v.you?.avatar || ''),
    ),
  );
}

async function shareLink(code) {
  const url = `${location.origin}/r/${code}`;
  const ok = await copyText(url);
  toast(ok ? 'Invite link copied' : url, ok ? 'ok' : 'info');
  vibrate(15);
}

// ---------- RECONNECTING / ELSEWHERE ----------

function renderReconnecting() {
  return h(
    'main',
    { class: 'screen center home' },
    h('div', { class: 'hero' }, h('div', { class: 'logo' }, 'CONTRA', h('span', null, 'BAND'))),
    h(
      'div',
      { class: 'card done-card' },
      h('span', { class: 'pulse' }),
      h('h2', null, 'Finding your seat…'),
      h(
        'p',
        { class: 'muted' },
        net.status === 'online' ? 'Rejoining the room.' : 'Connecting to the server. Free hosting can take ~30 s to wake up.',
      ),
    ),
    h('button', { class: 'btn ghost small', onClick: () => leaveToHome() }, 'Start over instead'),
  );
}

function renderElsewhere() {
  return h(
    'main',
    { class: 'screen center home' },
    h('div', { class: 'hero' }, h('div', { class: 'logo' }, 'CONTRA', h('span', null, 'BAND'))),
    h(
      'div',
      { class: 'card done-card' },
      h('div', { class: 'check' }, '📱'),
      h('h2', null, 'This seat is open in another tab'),
      h('p', { class: 'muted' }, 'Your room is being played from another tab or device. Play there, or take it back here.'),
    ),
    h(
      'button',
      {
        class: 'btn big primary',
        onClick: () => {
          state.screen = 'room';
          state.view = null;
          net.connect();
          paint();
        },
      },
      'Play here instead',
    ),
    h('button', { class: 'btn ghost small', onClick: () => leaveToHome() }, 'Leave the room'),
  );
}

// ---------- HOME ----------

function renderHome() {
  const p = state.prefs;
  const setName = (e) => {
    p.name = e.target.value;
    save(PREFS_KEY, p);
  };
  const submit = (mode) => (e) => {
    e.preventDefault();
    if (state.busy) return;
    const name = (document.getElementById('name')?.value || '').trim();
    const code = (document.getElementById('code')?.value || state.codeDraft || '').trim().toUpperCase();
    if (mode === 'auto') mode = code.length === 4 ? 'join' : 'create';
    if (!name) return toast('Pick a name first', 'error');
    if (mode === 'join' && code.length !== 4) return toast('Room codes are 4 letters', 'error');
    p.name = name;
    save(PREFS_KEY, p);
    state.busy = true;
    const attempt = ++state.attempt;
    paint();
    net.whenOpen(() => {
      if (attempt !== state.attempt) return;
      if (mode === 'create') net.send({ t: 'create', name, avatar: p.avatar });
      else net.send({ t: 'join', code, name, avatar: p.avatar });
    });
    setTimeout(() => {
      if (state.busy && attempt === state.attempt) toast('Waking up the server (free hosting takes ~30 s)…', 'info', 6000);
    }, 3000);
    setTimeout(() => {
      if (state.busy && attempt === state.attempt) {
        state.busy = false;
        toast('Still connecting… check your signal and try again.', 'error');
        paint();
      }
    }, 45000);
  };
  if (!state.codeDraft && state.urlCode) state.codeDraft = state.urlCode;
  return h(
    'main',
    { class: 'screen home' },
    h(
      'div',
      { class: 'hero' },
      h(
        'div',
        { class: 'logo-wrap' },
        h('div', { class: 'logo' }, 'CONTRA', h('span', null, 'BAND')),
        h('div', { class: 'stamp-classified', 'aria-hidden': 'true' }, 'CLASSIFIED'),
      ),
      h('p', { class: 'tagline' }, "Sneak the word. Steal the laugh. Don't get caught."),
      h('p', { class: 'tagline small' }, 'One room code. Everyone on their own phone. Nothing to install.'),
    ),
    h(
      'form',
      { class: 'card form', onSubmit: submit('auto') },
      h(
        'label',
        { class: 'field' },
        h('span', null, 'Your name'),
        h('input', {
          id: 'name',
          type: 'text',
          maxlength: '16',
          autocomplete: 'nickname',
          placeholder: 'e.g. Sam',
          value: p.name,
          onInput: setName,
          enterkeyhint: 'go',
        }),
      ),
      h(
        'div',
        { class: 'avatars', role: 'radiogroup', 'aria-label': 'Pick an avatar' },
        AVATARS.map((a) =>
          h(
            'button',
            {
              type: 'button',
              class: `avatar ${p.avatar === a ? 'selected' : ''}`,
              role: 'radio',
              'aria-checked': p.avatar === a ? 'true' : 'false',
              onClick: () => {
                p.avatar = a;
                save(PREFS_KEY, p);
                beep('tap');
                paint();
              },
            },
            a,
          ),
        ),
      ),
      h(
        'div',
        { class: 'join-row' },
        h(
          'label',
          { class: 'field code-field' },
          h('span', null, 'Room code'),
          h('input', {
            id: 'code',
            type: 'text',
            maxlength: '4',
            autocapitalize: 'characters',
            autocomplete: 'off',
            spellcheck: 'false',
            placeholder: 'ABCD',
            value: state.codeDraft || '',
            onInput: (e) => {
              e.target.value = e.target.value
                .toUpperCase()
                .replace(/[^A-Z]/g, '')
                .slice(0, 4);
              state.codeDraft = e.target.value;
            },
          }),
        ),
        h('button', { type: 'button', class: 'btn primary', disabled: state.busy, onClick: submit('join') }, state.busy ? '…' : 'Join'),
      ),
      h('div', { class: 'or' }, h('span', null, 'or')),
      h(
        'button',
        { type: 'button', class: 'btn big', disabled: state.busy, onClick: submit('create') },
        state.busy ? 'Connecting…' : 'Create a new room',
      ),
    ),
    h('p', { class: 'foot muted' }, 'Got a TV? Open ', h('a', { href: '/tv' }, '/tv'), ' on it and type the code.'),
  );
}

// ---------- LOBBY ----------

function renderLobby(v) {
  const me = v.you;
  const host = v.players.find((p) => p.id === v.hostId);
  const game = v.catalog.find((g) => g.id === v.settings.gameId) || v.catalog[0];
  const present = v.players.filter((p) => p.connected).length;
  const canStart = game && present >= game.minPlayers && present <= game.maxPlayers;
  const url = `${location.origin}/r/${v.code}`;

  return h(
    'main',
    { class: 'screen lobby' },
    topBar(v),
    h(
      'section',
      { class: 'invite' },
      h('div', { class: 'invite-code', onClick: () => shareLink(v.code) }, ...v.code.split('').map((ch) => h('span', null, ch))),
      h(
        'div',
        { class: 'invite-actions' },
        h('button', { class: 'btn small', onClick: () => shareLink(v.code) }, 'Copy link'),
        h(
          'button',
          { class: 'btn small ghost', onClick: () => ((state.showQr = !state.showQr), paint()) },
          state.showQr ? 'Hide QR' : 'Show QR',
        ),
      ),
      state.showQr ? h('div', { class: 'qr', html: qrSvg(url, 5) }) : null,
      h('p', { class: 'muted small' }, 'Friends open ', h('b', null, location.host), ' and type the code, or scan.'),
    ),
    h(
      'section',
      { class: 'players' },
      h('h3', null, plural(v.players.length, 'player'), h('span', { class: 'muted' }, ' in the room')),
      h(
        'ul',
        { class: 'player-list' },
        v.players.map((p) =>
          h(
            'li',
            { class: `player ${p.connected ? '' : 'away'} ${p.id === me.id ? 'me' : ''}` },
            h('span', { class: 'p-avatar' }, p.avatar),
            h(
              'span',
              { class: 'p-name' },
              p.name,
              p.id === v.hostId ? h('span', { class: 'crown', title: 'Host' }, ' 👑') : null,
              p.id === me.id ? h('span', { class: 'muted' }, ' (you)') : null,
            ),
            v.gamesPlayed > 0 ? h('span', { class: 'p-score' }, p.score) : null,
            !p.connected ? h('span', { class: 'muted small' }, 'away') : null,
            me.isHost && p.id !== me.id ? h('button', { class: 'kick', title: 'Remove', onClick: () => confirmKick(p) }, '×') : null,
          ),
        ),
      ),
    ),
    h(
      'section',
      { class: 'game-pick' },
      v.catalog.length > 1 ? h('h3', null, me.isHost ? 'Pick a game' : 'Game') : null,
      v.catalog.length === 1 && GAME_RENDERERS[game?.id]?.renderHowTo ? GAME_RENDERERS[game.id].renderHowTo(v, api()) : null,
      v.catalog.length === 1
        ? null
        : h(
            'div',
            { class: 'game-cards' },
            (me.isHost ? v.catalog : v.catalog.filter((g) => g.id === game?.id)).map((g) =>
              h(
                'button',
                {
                  class: `game-card ${g.id === game?.id ? 'selected' : ''}`,
                  disabled: !me.isHost,
                  onClick: () => api().host('settings', { settings: { gameId: g.id } }),
                },
                h('div', { class: 'g-name' }, g.name),
                h('div', { class: 'g-tag' }, g.tagline),
                h('div', { class: 'g-meta' }, `${g.minPlayers}–${g.maxPlayers} players · ~${g.minutes} min`),
              ),
            ),
          ),
      game && Object.keys(game.settingsSchema || {}).length ? renderSettings(v, game) : null,
    ),
    h(
      'section',
      { class: 'start' },
      me.isHost
        ? h(
            'button',
            { class: 'btn big primary', disabled: !canStart, onClick: () => api().host('start') },
            canStart ? `Start ${game.name}` : `Need ${game ? game.minPlayers : 3}+ players`,
          )
        : h('div', { class: 'waiting' }, h('span', { class: 'pulse' }), `Waiting for ${host ? host.name : 'the host'} to start…`),
      v.gamesPlayed > 0 && me.isHost
        ? h('button', { class: 'btn ghost small', onClick: () => api().host('reset_scores') }, 'Reset scores')
        : null,
      h('button', { class: 'btn ghost small', onClick: leaveRoom }, 'Leave room'),
    ),
    v.log?.length
      ? h(
          'ul',
          { class: 'feed' },
          v.log
            .slice(-4)
            .reverse()
            .map((l) => h('li', null, l.text)),
        )
      : null,
  );
}

function renderSettings(v, game) {
  const a = api();
  const rows = Object.entries(game.settingsSchema).map(([key, def]) => {
    const value = v.settings[key] ?? def.default;
    let control;
    if (def.type === 'number') {
      control = h(
        'div',
        { class: 'stepper' },
        h(
          'button',
          {
            class: 'btn small',
            disabled: !a.isHost || value <= def.min,
            onClick: () => a.host('settings', { settings: { [key]: value - (def.step || 1) } }),
          },
          '−',
        ),
        h('span', { class: 'stepper-val' }, value),
        h(
          'button',
          {
            class: 'btn small',
            disabled: !a.isHost || value >= def.max,
            onClick: () => a.host('settings', { settings: { [key]: value + (def.step || 1) } }),
          },
          '+',
        ),
      );
    } else if (def.type === 'choice') {
      control = h(
        'div',
        { class: 'segmented' },
        def.options.map((o) =>
          h(
            'button',
            {
              class: `seg ${o.value === value ? 'on' : ''}`,
              disabled: !a.isHost,
              onClick: () => a.host('settings', { settings: { [key]: o.value } }),
            },
            o.label,
          ),
        ),
      );
    } else if (def.type === 'boolean') {
      control = h(
        'button',
        { class: `toggle ${value ? 'on' : ''}`, disabled: !a.isHost, onClick: () => a.host('settings', { settings: { [key]: !value } }) },
        value ? 'On' : 'Off',
      );
    }
    return h('div', { class: 'setting' }, h('span', { class: 'setting-label' }, def.label), control);
  });
  return h('div', { class: 'settings' }, rows);
}

function confirmKick(p) {
  const a = api();
  toast(`Removing ${p.name}…`, 'info', 1500);
  a.host('kick', { playerId: p.id });
}

function leaveRoom() {
  net.send({ t: 'leave' });
  leaveToHome('You left the room.');
}

// ---------- PLAYING ----------

function renderPlaying(v) {
  const g = v.game;
  const renderer = g && GAME_RENDERERS[g.id];
  const phaseKey = `${g?.id}:${g?.view?.phase}:${g?.view?.round}`;
  if (phaseKey !== state.lastPhaseKey) {
    state.lastPhaseKey = phaseKey;
    if (state.keepScope !== g?.id) {
      clearKeep();
      state.keepScope = g?.id;
    }
    root.classList.add('phase-enter');
    clearTimeout(state.enterTimer);
    state.enterTimer = setTimeout(() => root.classList.remove('phase-enter'), 450);
  }
  if (!renderer) {
    return h('main', { class: 'screen' }, topBar(v), h('pre', { class: 'debug' }, JSON.stringify(g?.view, null, 2)));
  }
  const a = api();
  const timer = g.view?.endsAt
    ? h('div', { class: 'timer', dataset: { ends: String(g.view.endsAt), total: String(g.view.duration || 0) } }, '')
    : null;
  const body = renderer.render(v, a);
  return h(
    'main',
    { class: `screen playing game-${g.id}` },
    topBar(v, { center: timer }),
    v.you.spectator ? h('div', { class: 'banner' }, 'You are watching this game. You will be in the next one.') : null,
    h('div', { class: 'stage' }, body),
    a.isHost
      ? h(
          'div',
          { class: 'host-tools' },
          h('button', { class: 'btn ghost tiny', onClick: () => a.host('skip') }, 'Skip phase'),
          h('button', { class: 'btn ghost tiny', onClick: () => a.host('end') }, 'End game'),
        )
      : null,
  );
}

// ---------- RESULTS ----------

let confettiFor = '';
function renderResults(v) {
  const r = v.results || {};
  const standings = r.standings || v.players.slice().sort((a, b) => b.score - a.score);
  const top = standings.slice(0, 3);
  const key = `${v.code}:${v.gamesPlayed}`;
  if (confettiFor !== key) {
    confettiFor = key;
    setTimeout(() => {
      confetti();
      beep(top[0]?.id === v.you.id ? 'win' : 'reveal');
    }, 400);
  }
  const me = v.you;
  const order = [top[1], top[0], top[2]].filter(Boolean);
  const renderer = r.gameId && GAME_RENDERERS[r.gameId];
  return h(
    'main',
    { class: 'screen results' },
    topBar(v),
    h('h2', { class: 'results-title' }, r.aborted ? 'Game ended early' : `${r.gameName || 'Game'} — final scores`),
    h(
      'div',
      { class: 'podium' },
      order.map((p) => {
        const place = top.indexOf(p) + 1;
        return h(
          'div',
          { class: `podium-spot place-${place} ${p.id === me.id ? 'me' : ''}` },
          h('div', { class: 'podium-avatar' }, p.avatar),
          h('div', { class: 'podium-name' }, p.name),
          h('div', { class: 'podium-score' }, p.score),
          h('div', { class: 'podium-block' }, place === 1 ? '🏆' : place === 2 ? '🥈' : '🥉'),
        );
      }),
    ),
    renderer?.renderSummary ? renderer.renderSummary(r, api()) : null,
    h(
      'ol',
      { class: 'standings' },
      standings.map((p, i) =>
        h(
          'li',
          { class: p.id === me.id ? 'me' : '' },
          h('span', { class: 'rank' }, p.rank || i + 1),
          h('span', { class: 'p-avatar' }, p.avatar),
          h('span', { class: 'p-name' }, p.name, p.tied ? h('span', { class: 'muted small' }, ' (tie)') : null),
          h('span', { class: 'p-score' }, p.score),
        ),
      ),
    ),
    me.isHost
      ? h(
          'div',
          { class: 'results-actions' },
          h('button', { class: 'btn big primary', onClick: () => api().host('start') }, 'Play again'),
          h('button', { class: 'btn', onClick: () => api().host('lobby') }, 'Change game'),
        )
      : h('div', { class: 'waiting' }, h('span', { class: 'pulse' }), 'Waiting for the host…'),
    h('button', { class: 'btn ghost small', onClick: leaveRoom }, 'Leave room'),
  );
}

export { api, net, state };

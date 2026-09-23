// Big-screen view: shows the room code + QR in the lobby, the shared game view while playing,
// and the podium at the end. It never acts; phones do the acting.

import { Net } from './net.js';
import { h, render, startTicker, toast, confetti, qrSvg, plural } from './ui.js';
import { GAME_RENDERERS } from './games/index.js';

const net = new Net();
const root = document.getElementById('app');
const state = { view: null, code: new URLSearchParams(location.search).get('room')?.toUpperCase() || '', keep: new Map(), keepScope: '' };

startTicker(() => net.now());

net.addEventListener('view', (e) => {
  state.view = e.detail;
  paint();
});
net.addEventListener('event', (e) => {
  const g = state.view?.game && GAME_RENDERERS[state.view.game.id];
  g?.onEvent?.(e.detail.e, api());
});
net.addEventListener('error', (e) => {
  toast(e.detail.message, 'error', 4000);
  if (e.detail.code === 'no_room') {
    state.view = null;
    state.code = '';
    paint();
  }
});
net.addEventListener('status', (e) => {
  document.body.dataset.net = e.detail;
  if (e.detail === 'online' && state.code) net.send({ t: 'watch', code: state.code });
});

function api() {
  const v = state.view;
  return {
    view: v,
    tv: true,
    players: v?.players || [],
    player: (id) => (v?.players || []).find((p) => p.id === id) || null,
    now: () => net.now(),
    h,
    confetti,
    plural,
    keep: (key, factory) => {
      if (!state.keep.has(key)) state.keep.set(key, factory());
      return state.keep.get(key);
    },
    forget: (key) => state.keep.delete(key),
  };
}

function watch(code) {
  state.code = code;
  history.replaceState(null, '', `/tv?room=${code}`);
  net.whenOpen(() => net.send({ t: 'watch', code }));
}

document.addEventListener('contraband:rerender', () => paint());
if (state.code) watch(state.code);
paint();

function paint() {
  const v = state.view;
  if (!v) return render(root, renderEnter());
  if (v.phase !== 'playing' && state.keep.size) {
    for (const k of state.keep.values()) if (k && k.timer) clearInterval(k.timer);
    state.keep.clear();
    state.keepScope = '';
  }
  if (v.phase === 'lobby') return render(root, renderLobby(v));
  if (v.phase === 'results') return render(root, renderResults(v));
  return render(root, renderPlaying(v));
}

function renderEnter() {
  return h(
    'main',
    { class: 'screen tv-enter' },
    h('div', { class: 'logo huge' }, 'CONTRA', h('span', null, 'BAND')),
    h('p', { class: 'tagline' }, 'Type the room code from a phone to mirror it here.'),
    h(
      'form',
      {
        class: 'tv-form',
        onSubmit: (e) => {
          e.preventDefault();
          const code = document.getElementById('tvcode').value.toUpperCase();
          if (code.length === 4) watch(code);
        },
      },
      h('input', { id: 'tvcode', class: 'tv-input', maxlength: '4', autocapitalize: 'characters', placeholder: 'ABCD', autofocus: true, onInput: (e) => (e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, '')) }),
      h('button', { class: 'btn big primary' }, 'Watch')
    )
  );
}

function renderLobby(v) {
  const url = `${location.origin}/r/${v.code}`;
  const game = v.catalog.find((g) => g.id === v.settings.gameId);
  return h(
    'main',
    { class: 'screen tv-lobby' },
    h('div', { class: 'tv-join' }, h('div', { class: 'tv-hint' }, 'Join at ', h('b', null, location.host)), h('div', { class: 'invite-code giant' }, ...v.code.split('').map((ch) => h('span', null, ch))), h('div', { class: 'qr big', html: qrSvg(url, 8) })),
    h(
      'div',
      { class: 'tv-side' },
      h('h2', null, plural(v.players.length, 'player')),
      h('ul', { class: 'player-list tv' }, v.players.map((p) => h('li', { class: `player ${p.connected ? '' : 'away'}` }, h('span', { class: 'p-avatar' }, p.avatar), h('span', { class: 'p-name' }, p.name, p.id === v.hostId ? ' 👑' : ''), v.gamesPlayed ? h('span', { class: 'p-score' }, p.score) : null))),
      game ? h('div', { class: 'tv-next' }, h('div', { class: 'muted' }, 'Up next'), h('div', { class: 'g-name' }, game.name), h('div', { class: 'g-tag' }, game.tagline)) : null
    )
  );
}

function renderPlaying(v) {
  const g = v.game;
  const renderer = g && GAME_RENDERERS[g.id];
  if (state.keepScope !== g?.id) {
    for (const k of state.keep.values()) if (k && k.timer) clearInterval(k.timer);
    state.keep.clear();
    state.keepScope = g?.id;
  }
  const timer = g.view?.endsAt ? h('div', { class: 'timer tv-timer', dataset: { ends: String(g.view.endsAt), total: String(g.view.duration || 0) } }, '') : null;
  const body = renderer?.tv ? renderer.tv(v, api()) : renderer?.render ? renderer.render(v, api()) : h('pre', null, JSON.stringify(g?.view, null, 2));
  return h('main', { class: `screen tv-playing game-${g?.id}` }, h('header', { class: 'topbar tv' }, h('div', { class: 'code-pill' }, h('span', { class: 'code-label' }, 'ROOM'), h('span', { class: 'code' }, v.code)), h('div', { class: 'topbar-center' }, timer), h('div', { class: 'muted' }, g?.name)), h('div', { class: 'stage tv-stage' }, body));
}

let confettiFor = '';
function renderResults(v) {
  const r = v.results || {};
  const standings = r.standings || [];
  const top = standings.slice(0, 3);
  const key = `${v.code}:${v.gamesPlayed}`;
  if (confettiFor !== key) {
    confettiFor = key;
    setTimeout(() => confetti({ count: 260 }), 300);
  }
  const order = [top[1], top[0], top[2]].filter(Boolean);
  const renderer = r.gameId && GAME_RENDERERS[r.gameId];
  return h(
    'main',
    { class: 'screen results tv-results' },
    h('h2', { class: 'results-title' }, `${r.gameName || 'Game'} — final scores`),
    h(
      'div',
      { class: 'podium' },
      order.map((p) => {
        const place = top.indexOf(p) + 1;
        return h('div', { class: `podium-spot place-${place}` }, h('div', { class: 'podium-avatar' }, p.avatar), h('div', { class: 'podium-name' }, p.name), h('div', { class: 'podium-score' }, p.score), h('div', { class: 'podium-block' }, place === 1 ? '🏆' : place === 2 ? '🥈' : '🥉'));
      })
    ),
    renderer?.renderSummary ? renderer.renderSummary(r, api()) : null,
    h('ol', { class: 'standings' }, standings.map((p, i) => h('li', null, h('span', { class: 'rank' }, i + 1), h('span', { class: 'p-avatar' }, p.avatar), h('span', { class: 'p-name' }, p.name), h('span', { class: 'p-score' }, p.score))))
  );
}

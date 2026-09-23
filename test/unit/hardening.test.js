import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { TestClient, startServer, makeRoom, sleep } from '../helpers/client.js';
import { T } from '../../server/games/contraband.js';
import { LIMITS } from '../../server/room.js';

const ORIG = { ...T };
before(() => {
  Object.assign(T, {
    BRIEF_SECONDS: 0.2,
    BRIEF_FINAL_SECONDS: 0.2,
    WRITE_SECONDS: 0.6,
    VOTE_SECONDS: () => 0.5,
    ACCUSE_SECONDS: () => 0.5,
    LINEUP_SECONDS: () => 0.5,
    REVEAL_SECONDS: () => 0.3,
    SCOREBOARD_SECONDS: 0.3,
    REVEAL_LEAD_MS: 20,
  });
});
after(() => Object.assign(T, ORIG));

let srv;
before(async () => (srv = await startServer()));
after(async () => srv.stop());

const gv = (c) => c.view?.game?.view;
const untilPhase = (c, phase, ms = 8000) => c.untilView((v) => v.phase === 'playing' && v.game?.view?.phase === phase, ms);
const untilRound = (c, round, ms = 12000) => c.untilView((v) => v.phase === 'playing' && v.game?.view?.round === round && v.game.view.phase === 'briefing', ms);

test('an idle player is marked AFK after two rounds and any message deals them back in', async () => {
  const { host, players } = await makeRoom(srv.url, ['Ana', 'Ben', 'Cy', 'Dee']);
  host.host('start', { settings: { rounds: 4 } });
  // Dee never acts; timers run everything (0.6 s write etc.)
  const dee = players[3];
  for (let round = 1; round <= 2; round++) {
    await Promise.all(players.slice(0, 3).map((p) => untilPhase(p, 'write')));
    for (const p of players.slice(0, 3)) p.action({ type: 'submit', text: gv(p).you.word ? `${gv(p).you.word} it is` : 'nothing here' });
    await Promise.all(players.slice(0, 3).map((p) => untilPhase(p, 'vote')));
    for (const p of players.slice(0, 3)) p.action({ type: 'vote', key: gv(p).answers.find((a) => !a.mine && !a.filler).key });
    await Promise.all(players.slice(0, 3).map((p) => untilPhase(p, 'accuse')));
    for (const p of players.slice(0, 3)) p.action({ type: 'lock' });
    await untilRound(host, round + 1);
  }
  // Round 3: Dee is AFK and not a participant
  const r3 = await untilRound(dee, 3);
  assert.equal(r3.game.view.you.role, 'spectator');
  assert.ok(!r3.game.view.participants.includes(dee.playerId));
  assert.ok(r3.game.view.afk.includes(dee.playerId));
  // Dee taps something: cleared at once, dealt in next round
  dee.action({ type: 'react', e: '👀' });
  await dee.untilView((v) => !v.game.view.afk.includes(dee.playerId));
  await Promise.all(players.slice(0, 3).map((p) => untilPhase(p, 'write')));
  for (const p of players.slice(0, 3)) p.action({ type: 'submit', text: gv(p).you.word ? `${gv(p).you.word} again` : 'still nothing' });
  await Promise.all(players.slice(0, 3).map((p) => untilPhase(p, 'vote')));
  for (const p of players.slice(0, 3)) p.action({ type: 'vote', key: gv(p).answers.find((a) => !a.mine && !a.filler).key });
  await Promise.all(players.slice(0, 3).map((p) => untilPhase(p, 'accuse')));
  for (const p of players.slice(0, 3)) p.action({ type: 'lock' });
  const r4 = await untilRound(dee, 4);
  assert.notEqual(r4.game.view.you.role, 'spectator');
  assert.ok(r4.game.view.participants.includes(dee.playerId));
  players.forEach((p) => p.close());
});

test('a 3-player room does not stall in waiting when one player was idle', async () => {
  const { host, players } = await makeRoom(srv.url, ['Ana', 'Ben', 'Cy']);
  host.host('start', { settings: { rounds: 4 } });
  const cy = players[2];
  for (let round = 1; round <= 2; round++) {
    await Promise.all(players.slice(0, 2).map((p) => untilPhase(p, 'write')));
    for (const p of players.slice(0, 2)) p.action({ type: 'submit', text: gv(p).you.word ? `${gv(p).you.word} it is` : 'nothing here' });
    await untilRound(host, round + 1);
  }
  // Cy was idle twice; round 3 must still start with all three rather than parking in "waiting"
  const v = await untilRound(host, 3);
  assert.notEqual(v.game.view.phase, 'waiting');
  assert.equal(v.game.view.participants.length, 3);
  players.forEach((p) => p.close());
});

test('malformed URLs get a 400 and the server keeps running', async () => {
  for (const path of ['/%', '/index.html%00', '/%E0%A4%A']) {
    const r = await fetch(srv.http + path);
    assert.ok(r.status === 400 || r.status === 404, `${path} -> ${r.status}`);
  }
  const ok = await fetch(srv.http + '/healthz');
  assert.equal(ok.status, 200);
});

test('a socket that joins twice holds one seat; the first seat is released', async () => {
  const { host, code } = await makeRoom(srv.url, ['Ana']);
  const c = await TestClient.connect(srv.url);
  c.send({ t: 'join', code, name: 'Ben' });
  await c.next((m) => m.t === 'joined');
  c.send({ t: 'join', code, name: 'Cy' });
  await c.next((m) => m.t === 'joined');
  const v = await host.untilView((v) => v.players.some((p) => p.name === 'Cy'));
  const ben = v.players.find((p) => p.name === 'Ben');
  assert.ok(!ben || ben.connected === false, 'Ben is not a connected ghost');
  c.close();
  await host.untilView((v) => v.players.every((p) => p.name === 'Ana' || !p.connected));
  host.close();
});

test('rename keeps names unique', async () => {
  const { host, players } = await makeRoom(srv.url, ['Ana', 'Ben']);
  host.send({ t: 'rename', name: 'Ben' });
  const v = await host.untilView((v) => v.players.find((p) => p.id === host.playerId)?.name !== 'Ana');
  assert.equal(v.players.find((p) => p.id === host.playerId).name, 'Ben 2');
  players.forEach((p) => p.close());
});

test('prototype keys and non-string picks are rejected cleanly, never a server error', async () => {
  const { host, players } = await makeRoom(srv.url, ['Ana', 'Ben', 'Cy']);
  host.host('start', { settings: { rounds: 3 } });
  await Promise.all(players.map((p) => untilPhase(p, 'write')));
  for (const p of players) p.action({ type: 'submit', text: gv(p).you.word ? `${gv(p).you.word} sure` : 'plain enough' });
  await Promise.all(players.map((p) => untilPhase(p, 'vote')));
  for (const p of players) p.action({ type: 'vote', key: gv(p).answers.find((a) => !a.mine).key });
  await Promise.all(players.map((p) => untilPhase(p, 'accuse')));
  host.action({ type: 'accuse', picks: [{ toString: 1 }, '__proto__', 42] });
  await sleep(100);
  assert.ok(!host.errors.some((e) => e.code === 'server_error'), 'no server_error');
  host.action({ type: 'guess', authorId: '__proto__', word: 'x' });
  const err = await host.expectError();
  assert.notEqual(err.code, 'server_error');
  players.forEach((p) => p.close());
});

test('play again keeps a seat that disconnected seconds ago', async () => {
  LIMITS.lobbyGhostMs = 5000;
  const { host, players, code } = await makeRoom(srv.url, ['Ana', 'Ben', 'Cy', 'Dee']);
  host.host('start', { settings: { rounds: 3 } });
  await untilPhase(host, 'write');
  host.host('end');
  await host.untilView((v) => v.phase === 'results');
  const dee = players[3];
  dee.close();
  await host.untilView((v) => v.players.find((p) => p.name === 'Dee')?.connected === false);
  host.host('start');
  await untilPhase(host, 'briefing');
  const dee2 = await TestClient.connect(srv.url);
  dee2.send({ t: 'resume', code, token: dee.token });
  const j = await dee2.next((m) => m.t === 'joined' || m.t === 'error');
  assert.equal(j.t, 'joined', 'Dee resumes her seat after Play again');
  const v = await dee2.untilView((x) => x.phase === 'playing');
  assert.equal(v.you.name, 'Dee');
  assert.equal(v.you.spectator, false);
  dee2.close();
  players.slice(0, 3).forEach((p) => p.close());
});

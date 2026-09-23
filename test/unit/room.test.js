import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { TestClient, startServer, makeRoom, sleep } from '../helpers/client.js';
import { LIMITS } from '../../server/room.js';

let srv;
before(async () => {
  LIMITS.hostGraceMs = 150;
  LIMITS.lobbyGhostMs = 300;
  srv = await startServer();
});
after(async () => srv.stop());

test('create and join a room; views stay in sync', async () => {
  const { host, players, code } = await makeRoom(srv.url, ['Ana', 'Ben', 'Cy']);
  assert.match(code, /^[A-HJ-NP-Z]{4}$/);
  const v = await host.untilView((v) => v.players.length === 3);
  assert.equal(v.phase, 'lobby');
  assert.equal(v.hostId, host.playerId);
  assert.equal(v.you.isHost, true);
  const pv = await players[1].untilView((v) => v.players.length === 3);
  assert.equal(pv.you.isHost, false);
  assert.deepEqual(
    pv.players.map((p) => p.name),
    ['Ana', 'Ben', 'Cy'],
  );
  players.forEach((p) => p.close());
});

test('duplicate names get a suffix, bad names are rejected', async () => {
  const { players, code } = await makeRoom(srv.url, ['Sam', 'Sam']);
  const v = await players[0].untilView((v) => v.players.length === 2);
  assert.deepEqual(
    v.players.map((p) => p.name),
    ['Sam', 'Sam 2'],
  );
  const c = await TestClient.connect(srv.url);
  c.send({ t: 'join', code, name: '   ' });
  const err = await c.expectError('bad_name');
  assert.ok(err.message.length > 0);
  c.close();
  players.forEach((p) => p.close());
});

test('unknown room code is a clean error', async () => {
  const c = await TestClient.connect(srv.url);
  c.send({ t: 'join', code: 'ZZZZ', name: 'X' });
  const err = await c.expectError('no_room');
  assert.ok(err.message.includes('No room'));
  c.close();
});

test('resume with token re-attaches the same seat', async () => {
  const { host, players, code } = await makeRoom(srv.url, ['Ana', 'Ben']);
  const ben = players[1];
  ben.close();
  await host.untilView((v) => v.players.find((p) => p.name === 'Ben')?.connected === false);
  const ben2 = await TestClient.connect(srv.url);
  ben2.send({ t: 'resume', code, token: ben.token });
  const j = await ben2.next((m) => m.t === 'joined');
  assert.equal(j.resumed, true);
  assert.equal(j.playerId, ben.playerId);
  const v = await host.untilView((v) => v.players.find((p) => p.name === 'Ben')?.connected === true);
  assert.equal(v.players.length, 2);
  host.close();
  ben2.close();
});

test('bad resume token is rejected', async () => {
  const { host, code } = await makeRoom(srv.url, ['Ana']);
  const c = await TestClient.connect(srv.url);
  c.send({ t: 'resume', code, token: 'nope' });
  await c.expectError('bad_token');
  c.close();
  host.close();
});

test('host crown moves when the host stays away', async () => {
  const { host, players } = await makeRoom(srv.url, ['Ana', 'Ben']);
  host.close();
  const v = await players[1].untilView((v) => v.hostId === players[1].playerId, 3000);
  assert.equal(v.you.isHost, true);
  players[1].close();
});

test('host can kick; kicked player is told', async () => {
  const { host, players } = await makeRoom(srv.url, ['Ana', 'Ben']);
  host.host('kick', { playerId: players[1].playerId });
  const k = await players[1].next((m) => m.t === 'kicked');
  assert.equal(k.reason, 'kicked');
  const v = await host.untilView((v) => v.players.length === 1);
  assert.equal(v.players[0].name, 'Ana');
  host.close();
});

test('non-host cannot use host commands', async () => {
  const { host, players } = await makeRoom(srv.url, ['Ana', 'Ben']);
  players[1].host('start');
  await players[1].expectError('not_host');
  host.close();
  players[1].close();
});

test('lobby ghosts are dropped after the grace period', async () => {
  const { host, players } = await makeRoom(srv.url, ['Ana', 'Ben']);
  players[1].close();
  const v = await host.untilView((v) => v.players.length === 1, 2000);
  assert.equal(v.players[0].name, 'Ana');
  host.close();
});

test('TV mode receives views without joining as a player', async () => {
  const { host, code } = await makeRoom(srv.url, ['Ana']);
  const tv = await TestClient.connect(srv.url);
  tv.send({ t: 'watch', code });
  const v = await tv.next((m) => m.t === 'view');
  assert.equal(v.tv, true);
  assert.equal(v.players.length, 1);
  assert.equal(v.you, undefined);
  tv.close();
  host.close();
});

test('room is full at 12 players', async () => {
  const names = Array.from({ length: 12 }, (_, i) => `P${i}`);
  const { players, code } = await makeRoom(srv.url, names);
  const extra = await TestClient.connect(srv.url);
  extra.send({ t: 'join', code, name: 'Late' });
  await extra.expectError('room_full');
  extra.close();
  players.forEach((p) => p.close());
  await sleep(20);
});

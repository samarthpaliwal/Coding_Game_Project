import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, makeRoom, sleep } from '../helpers/client.js';
import { T as CT, quotaFor } from '../../server/games/cardsmith.js';
import { T as IT } from '../../server/games/imposter.js';

before(() => {
  Object.assign(CT, { FORGE_SECONDS: 6, PICK_SECONDS: 6, JUDGE_SECONDS: 6, REVEAL_SECONDS: 0.3 });
  Object.assign(IT, { SECRET_SECONDS: 0.2, ANSWER_SECONDS: 6, VOTE_SECONDS: 6, GUESS_SECONDS: 6, REVEAL_SECONDS: 0.3 });
});

let srv;
before(async () => (srv = await startServer({ CONTRABAND_NO_AI: '1' })));
after(async () => srv.stop());

const gv = (c) => c.view?.game?.view;
const untilPhase = (c, phase, ms = 8000) => c.untilView((v) => v.phase === 'playing' && v.game?.view?.phase === phase, ms);
const untilRound = (c, phase, round, ms = 8000) =>
  c.untilView((v) => v.phase === 'playing' && v.game?.view?.phase === phase && v.game.view.round === round, ms);

test('quota shrinks with the room size', () => {
  assert.equal(quotaFor(3), 10);
  assert.equal(quotaFor(5), 8);
  assert.equal(quotaFor(8), 5);
  assert.equal(quotaFor(12), 3);
});

test('switching games in the lobby resets settings to that game’s defaults', async () => {
  const { host, players } = await makeRoom(srv.url, ['Ana', 'Ben', 'Cy']);
  host.host('settings', { settings: { gameId: 'cardsmith', rounds: 12, category: 'our dorm' } });
  await host.untilView((v) => v.settings.gameId === 'cardsmith' && v.settings.rounds === 12 && v.settings.category === 'our dorm');
  host.host('settings', { settings: { gameId: 'contraband' } });
  const v = await host.untilView((v) => v.settings.gameId === 'contraband');
  assert.equal(v.settings.rounds, 4);
  assert.equal(v.settings.category, undefined);
  players.forEach((p) => p.close());
});

test('Cardsmith: write cards, play, judge, reveal, results with a rotating judge', async () => {
  const names = ['Ana', 'Ben', 'Cy', 'Dee'];
  const { host, players } = await makeRoom(srv.url, names);
  host.host('start', { settings: { gameId: 'cardsmith', rounds: 4, category: 'the office', judging: 'czar' } });
  await Promise.all(players.map((p) => untilPhase(p, 'forge')));
  const q = gv(host).quota;
  assert.equal(q, quotaFor(4));
  assert.equal(gv(host).theme, 'the office');
  assert.equal(gv(host).aiStatus, 'off');
  for (const p of players) {
    for (let i = 0; i < q; i++) p.action({ type: 'card', text: `${p.name} card ${i}` });
  }
  // duplicates and overflow are rejected cleanly
  host.action({ type: 'card', text: 'one too many' });
  await host.expectError('bad_action');
  await Promise.all(players.map((p) => untilPhase(p, 'pick')));
  const judges = new Set();
  for (let round = 1; round <= 4; round++) {
    await Promise.all(players.map((p) => untilRound(p, 'pick', round)));
    const v = gv(host);
    assert.ok(v.black.includes('____'), 'prompt has a blank');
    assert.ok(v.judgeId, 'a judge is set');
    judges.add(v.judgeId);
    const judge = players.find((p) => p.playerId === v.judgeId);
    assert.equal(gv(judge).you.role, 'judge');
    assert.equal(gv(judge).you.hand.length, 7);
    for (const p of players) {
      if (p === judge) continue;
      const hand = gv(p).you.hand;
      assert.equal(hand.length, 7);
      p.action({ type: 'play', cardId: hand[0].id });
    }
    judge.action({ type: 'play', cardId: 'x' });
    await judge.expectError('not_now');
    await Promise.all(players.map((p) => untilRound(p, 'judge', round)));
    const plays = gv(judge).plays;
    assert.equal(plays.length, 3);
    const other = players.find((p) => p !== judge);
    other.action({ type: 'crown', key: 0 });
    await other.expectError('not_host');
    judge.action({ type: 'crown', key: 1 });
    await Promise.all(players.map((p) => untilRound(p, 'reveal', round)));
    const r = gv(host).reveal;
    assert.equal(r.cards.filter((c) => c.won).length, 1);
    const won = r.cards.find((c) => c.won);
    assert.equal(won.points, 100);
    if (won.authorId && won.authorId !== won.playerId) assert.equal(won.authorBonus, 50);
    // hands refill after the round
  }
  assert.ok(judges.size >= 3, 'judge rotates');
  const res = await host.untilView((v) => v.phase === 'results', 8000);
  assert.equal(res.results.gameName, 'Cardsmith');
  assert.ok(res.results.hallOfFame.length === 4);
  assert.ok(res.results.standings.some((p) => p.score >= 100));
  players.forEach((p) => p.close());
});

test('Cardsmith: everyone-votes mode scores votes and never lets you vote for yourself', async () => {
  const { host, players } = await makeRoom(srv.url, ['Ana', 'Ben', 'Cy']);
  host.host('start', { settings: { gameId: 'cardsmith', rounds: 4, judging: 'vote' } });
  await Promise.all(players.map((p) => untilPhase(p, 'forge')));
  host.host('skip'); // forge closes; fillers from the bank complete the deck
  await Promise.all(players.map((p) => untilPhase(p, 'pick')));
  assert.equal(gv(host).judgeId, null);
  for (const p of players) p.action({ type: 'play', cardId: gv(p).you.hand[0].id });
  await Promise.all(players.map((p) => untilPhase(p, 'judge')));
  const me = gv(host).you.myKey;
  host.action({ type: 'vote', key: me });
  await host.expectError('bad_action');
  for (const p of players) {
    const mine = gv(p).you.myKey;
    p.action({ type: 'vote', key: (mine + 1) % 3 });
  }
  await Promise.all(players.map((p) => untilPhase(p, 'reveal')));
  const r = gv(host).reveal;
  assert.equal(
    Object.values(r.tally).reduce((a, b) => a + b, 0),
    3,
  );
  assert.ok(r.cards.some((c) => c.won));
  host.host('end');
  await host.untilView((v) => v.phase === 'results');
  players.forEach((p) => p.close());
});

test('Imposter: secret prompts, answers, vote, guess, reveal, results', async () => {
  const { host, players } = await makeRoom(srv.url, ['Ana', 'Ben', 'Cy', 'Dee']);
  host.host('start', { settings: { gameId: 'imposter', rounds: 3 } });
  await Promise.all(players.map((p) => untilPhase(p, 'secret')));
  const prompts = players.map((p) => gv(p).you.prompt);
  const counts = {};
  for (const t of prompts) counts[t] = (counts[t] || 0) + 1;
  assert.equal(Object.keys(counts).length, 2, 'two distinct prompts');
  const impPrompt = Object.keys(counts).find((k) => counts[k] === 1);
  const imp = players[prompts.indexOf(impPrompt)];
  // nobody's view names the imposter before the reveal
  for (const p of players) assert.equal(gv(p).you.isImposter, null);
  await Promise.all(players.map((p) => untilPhase(p, 'answer')));
  for (const p of players) p.action({ type: 'answer', text: `${p.name}-word` });
  await Promise.all(players.map((p) => untilPhase(p, 'vote')));
  assert.equal(gv(host).answers.length, 4);
  for (const p of players) p.action({ type: 'vote', targetId: p === imp ? players.find((x) => x !== imp).playerId : imp.playerId });
  await Promise.all(players.map((p) => untilPhase(p, 'guess')));
  assert.equal(gv(imp).you.canGuess, true);
  assert.equal(gv(host).you.canGuess, false);
  const opts = gv(imp).guessOptions;
  assert.equal(opts.length, 3);
  const crewPrompt = Object.keys(counts).find((k) => counts[k] === 3);
  assert.ok(opts.includes(crewPrompt));
  imp.action({ type: 'guess', text: crewPrompt });
  await Promise.all(players.map((p) => untilPhase(p, 'reveal')));
  const r = gv(host).reveal;
  assert.equal(r.imposterId, imp.playerId);
  assert.equal(r.caught, true);
  assert.equal(r.guessRight, true);
  assert.equal(r.deltas[imp.playerId], 150);
  for (const p of players) if (p !== imp) assert.equal(r.deltas[p.playerId], 100);
  // round 2: nobody votes for the imposter -> escape
  await Promise.all(players.map((p) => untilRound(p, 'secret', 2)));
  const prompts2 = players.map((p) => gv(p).you.prompt);
  const c2 = {};
  for (const t of prompts2) c2[t] = (c2[t] || 0) + 1;
  const imp2 = players[prompts2.indexOf(Object.keys(c2).find((k) => c2[k] === 1))];
  assert.notEqual(imp2, imp, 'least-imposted player is picked next');
  await Promise.all(players.map((p) => untilRound(p, 'answer', 2)));
  for (const p of players) p.action({ type: 'answer', text: 'same' });
  await Promise.all(players.map((p) => untilRound(p, 'vote', 2)));
  const scapegoat = players.find((p) => p !== imp2);
  for (const p of players)
    p.action({
      type: 'vote',
      targetId:
        p === scapegoat
          ? imp2.playerId === p.playerId
            ? players[0].playerId
            : players.find((x) => x !== scapegoat).playerId
          : scapegoat.playerId,
    });
  await Promise.all(players.map((p) => untilRound(p, 'reveal', 2)));
  const r2 = gv(host).reveal;
  assert.equal(r2.caught, false);
  assert.equal(r2.deltas[imp2.playerId], 300);
  host.host('end');
  const res = await host.untilView((v) => v.phase === 'results');
  assert.equal(res.results.gameName, 'Imposter');
  players.forEach((p) => p.close());
});

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { TestClient, startServer, makeRoom, sleep } from '../helpers/client.js';
import contraband, { T, rangeFor, drawCount, k0For, scoreRound, norm } from '../../server/games/contraband.js';

// Fast timers for the whole file (the server runs in-process).
const ORIG = { ...T };
before(() => {
  T.BRIEF_SECONDS = 0.25;
  T.BRIEF_FINAL_SECONDS = 0.25;
  // phases that end early when everyone acts get generous ceilings; the rest stay short
  T.WRITE_SECONDS = 6;
  T.VOTE_SECONDS = () => 6;
  T.ACCUSE_SECONDS = () => 6;
  T.LINEUP_SECONDS = () => 6;
  T.REVEAL_SECONDS = () => 0.4;
  T.SCOREBOARD_SECONDS = 0.3;
  T.REVEAL_LEAD_MS = 50;
});
after(() => Object.assign(T, ORIG));

let srv;
before(async () => (srv = await startServer()));
after(async () => srv.stop());

const gv = (c) => c.view?.game?.view;
const untilPhase = (c, phase, ms = 6000) => c.untilView((v) => v.phase === 'playing' && v.game?.view?.phase === phase, ms);

async function startGame(names, settings = { rounds: 3 }) {
  const room = await makeRoom(srv.url, names);
  room.host.host('start', { settings });
  await Promise.all(room.players.map((p) => untilPhase(p, 'briefing')));
  return room;
}

// ---------- pure rules ----------

test('count/range table matches the spec for n=3..10, rounds 1..6', () => {
  for (let n = 3; n <= 10; n++) {
    const k0 = k0For(n);
    assert.equal(k0, n <= 4 ? 1 : n <= 7 ? 2 : 3);
    for (let round = 1; round <= 6; round++) {
      const r = rangeFor(round, n);
      if (round === 1) assert.deepEqual([r.lo, r.hi], [k0, k0]);
      else {
        assert.equal(r.hi, Math.max(1, Math.min(k0 + 1, n - 2, 3)));
        assert.equal(r.lo, round >= 3 && n >= 5 ? 0 : Math.min(r.hi, Math.max(1, k0 - 1)));
      }
      for (let i = 0; i < 200; i++) {
        const c = drawCount(round, n, Math.random);
        assert.ok(c >= r.lo && c <= r.hi, `n=${n} round=${round} count=${c} range=${r.lo}-${r.hi}`);
        if (round === 1) assert.equal(c, k0);
        if (!(round >= 3 && n >= 5)) assert.ok(c >= 1);
      }
    }
  }
  assert.deepEqual([rangeFor(2, 3).lo, rangeFor(2, 3).hi], [1, 1]);
  assert.deepEqual([rangeFor(2, 4).lo, rangeFor(2, 4).hi], [1, 2]);
  assert.deepEqual([rangeFor(3, 6).lo, rangeFor(3, 6).hi], [0, 3]);
  assert.deepEqual([rangeFor(3, 8).lo, rangeFor(3, 8).hi], [0, 3]);
});

test('worked example from the spec (6 players, round 2) reproduces exactly', () => {
  const ids = ['ana', 'ben', 'cy', 'dee', 'eve', 'fox'];
  const scores = Object.fromEntries(ids.map((id) => [id, 0]));
  const ctx = {
    rng: Math.random,
    store: {},
    now: () => Date.now(),
    award: (id, pts) => (scores[id] += pts),
    player: (id) => ({ id, name: id[0].toUpperCase() + id.slice(1), score: scores[id], avatar: '🦊', connected: true }),
    players: () => ids.map((id) => ({ id, name: id, connected: true, score: scores[id] })),
    isConnected: () => true,
    schedule() {},
    clearTimer() {},
    sync() {},
    emit() {},
    end() {},
  };
  const state = contraband.init(ctx, { rounds: 4, words: 'normal' });
  const cur = {
    round: 2,
    isFinal: false,
    tier: 1,
    n: 6,
    participants: ids,
    left: new Set(),
    prompt: { text: 'A rejected name for a new energy drink', subjectId: null },
    range: { lo: 1, hi: 3 },
    count: 2,
    smugglers: { ben: 'gravy', eve: 'cousin' },
    voided: new Set(),
    drafts: {},
    answers: Object.fromEntries(ids.map((id) => [id, { text: `${id} answer gravy cousin`, filler: false }])),
    wiretaps: {},
    tappedBy: {},
    votes: { ben: 'ana', cy: 'ana', ana: 'ben', dee: 'ben', eve: 'cy', fox: 'eve' },
    accusations: {
      ana: { picks: ['ben', 'eve'], nobody: false, locked: true },
      cy: { picks: ['ben', 'dee'], nobody: false, locked: true },
      dee: { picks: ['ana', 'fox'], nobody: false, locked: true },
      fox: { picks: ['eve'], nobody: false, locked: true },
      ben: { picks: ['cy'], nobody: false, locked: true },
      eve: { picks: ['ana'], nobody: false, locked: true },
    },
    lineupOptions: {},
    guesses: {},
    lineupLocked: new Set(),
    order: ids,
    revealAt: null,
    results: null,
  };
  state.cur = cur;
  const res = scoreRound(state, ctx);
  // Eve is accused by Ana and Fox: 2 of 5 accusers >= ceil(0.4 * 5) = 2, so Eve is busted (keeps her vote points only).
  assert.deepEqual(scores, { ana: 500, eve: 100, ben: 200, cy: 150, fox: 100, dee: 0 });
  const card = (id) => res.cards.find((c) => c.id === id);
  assert.equal(card('ben').outcome, 'busted');
  assert.equal(card('eve').outcome, 'busted');
  assert.equal(card('eve').accusedBy.length, 2);
  assert.deepEqual(res.fullBusters, ['ana']);
  assert.equal(state.players.ana.wiretaps, 2, 'full bust refunds a wiretap (cap 2)');
  assert.ok(card('ben').stamp.length > 0);
});

test('norm() makes the word check forgiving about case and spacing', () => {
  assert.ok(norm('I love   LASAGNAS a lot').includes(norm('lasagna')));
  assert.ok(norm('per   my last email').includes(norm('per my last email')));
});

// ---------- secrecy ----------

test('leak test: no innocent view or TV view contains a live contraband word before reveal', async () => {
  const { host, players, code } = await startGame(['Ana', 'Ben', 'Cy', 'Dee', 'Eve'], { rounds: 3 });
  const tv = await TestClient.connect(srv.url);
  tv.send({ t: 'watch', code });
  await tv.next((m) => m.t === 'view');
  const words = {};
  for (const p of players) {
    const you = gv(p).you;
    if (you.role === 'smuggler') words[p.playerId] = you.word;
  }
  assert.equal(Object.keys(words).length, 2, 'round 1 with 5 players has exactly 2 smugglers');
  const checkViews = (label) => {
    for (const p of players) {
      const json = JSON.stringify(p.view);
      assert.ok(!json.includes('"smugglers"'), `${label}: smugglers key leaked to ${p.name}`);
      assert.ok(!json.includes('"votes"') || p.view.game.view.phase === 'reveal', `${label}: votes leaked`);
      for (const [id, w] of Object.entries(words)) {
        if (id === p.playerId) continue;
        assert.ok(!json.toLowerCase().includes(`"word":"${w.toLowerCase()}"`), `${label}: ${p.name} can see ${w}`);
        assert.ok(!json.includes(`"draft":"`) || !json.includes(`"draft":"${w}`), `${label}: draft leak`);
      }
    }
    const tvJson = JSON.stringify(tv.view.game.view);
    assert.equal(tv.view.you, undefined, `${label}: tv has a you`);
    assert.equal(tv.view.game.view.you, null, `${label}: tv game view has a you`);
    for (const w of Object.values(words)) assert.ok(!tvJson.includes(`"${w}"`), `${label}: TV shows ${w}`);
  };
  checkViews('briefing');
  await Promise.all(players.map((p) => untilPhase(p, 'write')));
  // drafts from a smuggler must not reach other players' views
  const smuggler = players.find((p) => gv(p).you.role === 'smuggler');
  smuggler.action({ type: 'draft', text: `secret draft with ${words[smuggler.playerId]}` });
  await sleep(150);
  for (const p of players) if (p !== smuggler) assert.ok(!JSON.stringify(p.view).includes('secret draft'), 'draft leaked');
  checkViews('write');
  tv.close();
  players.forEach((p) => p.close());
});

// ---------- full flow ----------

test('full game: submit/vote/accuse/reveal/scoreboard, final lineup, results with awards', async () => {
  const names = ['Ana', 'Ben', 'Cy', 'Dee'];
  const { host, players } = await startGame(names, { rounds: 3 });
  const v0 = gv(host);
  assert.equal(v0.round, 1);
  assert.deepEqual(v0.range, { lo: 1, hi: 1 });
  assert.ok(v0.prompt.text.length > 5);

  let smuggledSoFar = 0;
  for (let round = 1; round <= 3; round++) {
    await Promise.all(players.map((p) => untilPhase(p, 'write')));
    // a smuggler whose answer lacks the word is rejected
    const smuggler = players.find((p) => gv(p).you.role === 'smuggler');
    assert.ok(smuggler, 'there is a smuggler');
    smuggler.action({ type: 'submit', text: 'zzq zzq zzq zzq' }); // cannot contain any real word
    const err = await smuggler.expectError('missing_word');
    assert.ok(err.message.includes(gv(smuggler).you.word));
    // wiretap: Ben taps the smuggler (or Ana if Ben is the smuggler)
    // wiretap: a non-smuggler who still has a token (tokens only recharge for last place / full busts)
    const tapper = players.find((p) => p !== smuggler && gv(p).you.wiretaps > 0);
    if (tapper) {
      tapper.action({ type: 'wiretap', targetId: smuggler.playerId });
      await tapper.untilView((v) => v.game.view.you.wiretap?.targetId === smuggler.playerId);
      smuggler.action({ type: 'draft', text: `typing something ${round}` });
      const draftEv = await tapper.waitEvent((e) => e.type === 'draft' && e.text === `typing something ${round}`);
      assert.equal(draftEv.from, smuggler.playerId);
      await smuggler.untilView((v) => v.game.view.you.tappedBy === 1);
    } else {
      const broke = players.find((p) => p !== smuggler);
      broke.action({ type: 'wiretap', targetId: smuggler.playerId });
      await broke.expectError('no_tokens');
    }
    // everyone submits -> vote starts early
    for (const p of players) {
      const you = gv(p).you;
      p.action({ type: 'submit', text: you.word ? `My ${you.word} answer from ${p.name}` : `Plain answer from ${p.name}` });
    }
    await Promise.all(players.map((p) => untilPhase(p, 'vote')));
    const answers = gv(host).answers;
    assert.equal(answers.length, 4);
    assert.ok(
      answers.every((a) => a.id === null),
      'author ids hidden during vote',
    );
    for (const p of players) {
      const mine = gv(p).answers.find((a) => a.mine);
      const other = gv(p).answers.find((a) => !a.mine && !a.filler);
      assert.ok(mine && other);
      p.action({ type: 'vote', key: other.key });
    }
    await Promise.all(players.map((p) => untilPhase(p, 'accuse')));
    const acc = gv(host);
    assert.ok(
      acc.answers.every((a) => a.id),
      'names public during accuse',
    );
    assert.ok(acc.heat && typeof acc.heat.nobody === 'number');
    for (const p of players) {
      const target = gv(p).answers.find((a) => a.id !== p.playerId);
      p.action({ type: 'accuse', picks: [target.id] });
      p.action({ type: 'lock' });
    }
    await Promise.all(players.map((p) => untilPhase(p, 'reveal')));
    const rv = gv(host).reveal;
    assert.ok(rv.revealAt > 0);
    assert.equal(rv.cards.length, 4);
    const sm = rv.cards.filter((c) => c.role === 'smuggler');
    // 4 players: exactly 1 smuggler in round 1, then 1-2 (range 1-2) in later rounds
    if (round === 1) assert.equal(sm.length, 1);
    else assert.ok(sm.length >= 1 && sm.length <= 2, `smugglers in round ${round}: ${sm.length}`);
    assert.deepEqual([rv.count, gv(host).range], [sm.length, round === 1 ? { lo: 1, hi: 1 } : { lo: 1, hi: 2 }]);
    for (const c of sm) {
      assert.ok(c.word && c.text.toLowerCase().includes(c.word.toLowerCase()));
      assert.ok(['busted', 'getaway', 'ghost'].includes(c.outcome));
    }
    smuggledSoFar += sm.length;
    assert.ok(rv.cards.every((c) => c.votes.length + (c.accusedBy?.length || 0) >= 0));
    await Promise.all(players.map((p) => untilPhase(p, 'scoreboard')));
    const sb = gv(host).scoreboard;
    assert.equal(sb.rows.length, 4);
    assert.equal(sb.mostWanted.length, smuggledSoFar, 'most wanted lists every smuggled word so far');
    assert.ok(sb.rows.every((r) => Number.isInteger(r.rank)));
  }

  // final round
  await Promise.all(players.map((p) => untilPhase(p, 'briefing')));
  const fv = gv(host);
  assert.equal(fv.isFinal, true);
  assert.equal(fv.round, 4);
  for (const p of players) assert.equal(gv(p).you.role, 'smuggler');
  const finalWords = new Set(players.map((p) => gv(p).you.word));
  assert.equal(finalWords.size, 4, 'distinct final words');
  await Promise.all(players.map((p) => untilPhase(p, 'write')));
  for (const p of players) p.action({ type: 'submit', text: `Final ${gv(p).you.word} from ${p.name}` });
  await Promise.all(players.map((p) => untilPhase(p, 'vote')));
  for (const p of players) p.action({ type: 'vote', key: gv(p).answers.find((a) => !a.mine).key });
  await Promise.all(players.map((p) => untilPhase(p, 'lineup')));
  const lv = gv(host);
  assert.ok(lv.lineup);
  for (const p of players) {
    const opts = gv(p).lineup;
    for (const a of gv(p).answers) {
      if (a.id === p.playerId) continue;
      assert.equal(opts[a.id].length, 4, 'four tiles');
      p.action({ type: 'guess', authorId: a.id, word: opts[a.id][0] });
    }
    p.action({ type: 'lock' });
  }
  await Promise.all(players.map((p) => untilPhase(p, 'reveal')));
  const frv = gv(host).reveal;
  assert.ok(frv.cards.every((c) => c.outcome === 'final' && c.word));
  const results = await host.untilView((v) => v.phase === 'results', 6000);
  assert.equal(results.results.gameName, 'Contraband');
  assert.ok(results.results.awards.length >= 1, 'awards present');
  assert.ok(results.results.wordOfTheNight, 'word of the night');
  assert.equal(results.results.standings.length, 4);
  assert.ok(results.results.standings.some((p) => p.score > 0));
  // play again continues the room without repeating words
  host.host('start');
  await Promise.all(players.map((p) => untilPhase(p, 'briefing')));
  const again = players.map((p) => gv(p).you.word).filter(Boolean);
  for (const w of again) assert.ok(!finalWords.has(w), `word ${w} repeated across games`);
  assert.equal(host.view.gamesPlayed, 2);
  players.forEach((p) => p.close());
});

test('a disconnected player never blocks a phase; filler is dealt for them', async () => {
  const { host, players } = await startGame(['Ana', 'Ben', 'Cy'], { rounds: 3 });
  await Promise.all(players.map((p) => untilPhase(p, 'write')));
  const gone = players[2];
  gone.close();
  await host.untilView((v) => v.players.find((p) => p.name === 'Cy')?.connected === false);
  for (const p of players.slice(0, 2)) {
    const you = gv(p).you;
    p.action({ type: 'submit', text: you.word ? `${you.word} indeed` : 'nothing to declare' });
  }
  const v = await untilPhase(host, 'vote', 3000);
  // Cy's answer is either a filler or their auto-submitted draft
  assert.equal(v.game.view.answers.length, 3);
  players.slice(0, 2).forEach((p) => p.close());
});

test('refresh mid-write resumes with the draft, role, and wiretap stream intact', async () => {
  const { host, players, code } = await startGame(['Ana', 'Ben', 'Cy'], { rounds: 3 });
  await Promise.all(players.map((p) => untilPhase(p, 'write')));
  const ben = players[1];
  const benRole = gv(ben).you.role;
  const benWord = gv(ben).you.word;
  ben.action({ type: 'wiretap', targetId: host.playerId });
  host.action({ type: 'draft', text: 'host is typing' });
  await ben.waitEvent((e) => e.type === 'draft' && e.text === 'host is typing');
  ben.action({ type: 'draft', text: 'my half written' });
  await sleep(80);
  ben.close();
  const ben2 = await TestClient.connect(srv.url);
  ben2.send({ t: 'resume', code, token: ben.token });
  await ben2.next((m) => m.t === 'joined');
  const v = await ben2.untilView((x) => x.game?.view?.phase === 'write');
  assert.equal(v.game.view.you.draft, 'my half written');
  assert.equal(v.game.view.you.role, benRole);
  assert.equal(v.game.view.you.word, benWord);
  assert.equal(v.game.view.you.wiretap.targetId, host.playerId);
  assert.equal(v.game.view.you.wiretap.text, 'host is typing');
  const ev = await ben2.waitEvent((e) => e.type === 'draft' && e.text === 'host is typing', 2000);
  assert.ok(ev);
  ben2.close();
  host.close();
  players[2].close();
});

test('mid-game joiner spectates, then is dealt in at the next round', async () => {
  const { host, players, code } = await startGame(['Ana', 'Ben', 'Cy'], { rounds: 3 });
  await Promise.all(players.map((p) => untilPhase(p, 'write')));
  const late = await TestClient.connect(srv.url);
  late.send({ t: 'join', code, name: 'Late' });
  const joined = await late.next((m) => m.t === 'joined');
  late.playerId = joined.playerId;
  const lv = await late.untilView((v) => v.phase === 'playing');
  assert.equal(lv.you.spectator, true);
  assert.equal(lv.game.view.you.role, 'spectator');
  late.action({ type: 'submit', text: 'sneaky' });
  await late.expectError('spectator');
  for (const p of players) {
    const you = gv(p).you;
    p.action({ type: 'submit', text: you.word ? `${you.word} yes` : 'fine answer' });
  }
  await Promise.all(players.map((p) => untilPhase(p, 'vote')));
  for (const p of players) p.action({ type: 'vote', key: gv(p).answers.find((a) => !a.mine).key });
  await Promise.all(players.map((p) => untilPhase(p, 'accuse')));
  for (const p of players) p.action({ type: 'lock' });
  await untilPhase(host, 'scoreboard');
  const b = await late.untilView((v) => v.game?.view?.phase === 'briefing' && v.game.view.round === 2, 6000);
  assert.equal(b.you.spectator, false);
  assert.notEqual(b.game.view.you.role, 'spectator');
  assert.ok(b.game.view.participants.includes(late.playerId));
  late.close();
  players.forEach((p) => p.close());
});

test('host skip advances the phase; host end aborts to results', async () => {
  const { host, players } = await startGame(['Ana', 'Ben', 'Cy'], { rounds: 3 });
  host.host('skip');
  await untilPhase(host, 'write', 2000);
  host.host('end');
  const v = await host.untilView((x) => x.phase === 'results');
  assert.equal(v.results.aborted, true);
  players.forEach((p) => p.close());
});

// IMPOSTER — everyone gets the same secret prompt, except one. Answer in a word or two,
// read the room, vote out the imposter. A caught imposter can still steal points by guessing
// the crew's prompt.

import { RoomError } from '../errors.js';
import { enterPhase, finishPhase, everyoneDone } from './phases.js';
import { cleanText, shuffle, pick, clamp, BankCursor } from '../util.js';
import PAIRS from '../content/imposter_pairs.js';

export const T = {
  SECRET_SECONDS: 8,
  ANSWER_SECONDS: 30,
  VOTE_SECONDS: 60,
  GUESS_SECONDS: 20,
  REVEAL_SECONDS: 9,
  ANSWER_MAX: 24,
  CATCH: 100, // each crew member who voted for the imposter
  ESCAPE: 300, // imposter not caught
  GUESS: 150, // caught imposter guesses the crew prompt
  SURVIVE_VOTE: 25, // crew member who was not voted for at all
};
if (process.env.CONTRABAND_FAST === '1')
  Object.assign(T, { SECRET_SECONDS: 1.5, ANSWER_SECONDS: 15, VOTE_SECONDS: 15, GUESS_SECONDS: 10, REVEAL_SECONDS: 3 });

function bank(ctx) {
  const store = ctx.store;
  if (!store.imposterPairs) store.imposterPairs = new BankCursor(PAIRS, ctx.rng);
  return store.imposterPairs;
}

const imposter = {
  id: 'imposter',
  name: 'Imposter',
  tagline: 'One of you got a different prompt. Find them from a single word.',
  minPlayers: 3,
  maxPlayers: 12,
  minutes: 12,
  defaultSettings: { rounds: 5 },
  settingsSchema: { rounds: { type: 'number', label: 'Rounds', min: 3, max: 10, default: 5 } },
  silentActions: new Set(),

  init(ctx, settings) {
    return {
      phase: 'secret',
      phaseId: 0,
      endsAt: null,
      duration: null,
      round: 0,
      totalRounds: clamp(Number(settings.rounds) || 5, 3, 10),
      players: Object.fromEntries(ctx.players().map((p) => [p.id, { timesImposter: 0 }])),
      pendingJoiners: new Set(),
      cur: null,
      history: [],
      stats: { catches: {}, escapes: {}, guesses: {}, fooled: {} },
    };
  },
  start(state, ctx) {
    beginRound(state, ctx);
  },
  skip(state, ctx) {
    finishPhase(state, ctx);
  },
  playerJoined(state, ctx, id) {
    state.pendingJoiners.add(id);
  },
  playerDisconnected(state, ctx) {
    checkEarly(state, ctx);
  },
  playerLeft(state, ctx, id) {
    const cur = state.cur;
    state.pendingJoiners.delete(id);
    if (cur) {
      cur.participants = cur.participants.filter((p) => p !== id);
      delete cur.votes[id];
      if (cur.imposterId === id && state.phase !== 'reveal') {
        // the imposter walked out: the crew wins the round by default
        cur.left = true;
        finishPhase(state, ctx);
        return;
      }
      checkEarly(state, ctx);
    }
  },

  action(state, ctx, id, a) {
    const cur = state.cur;
    if (!cur || !cur.participants.includes(id)) throw new RoomError('not_now', 'You are in from the next round.');
    switch (a.type) {
      case 'answer': {
        if (state.phase !== 'answer') throw new RoomError('not_now', 'Answer time is over.');
        if (cur.answers[id]) throw new RoomError('not_now', 'You already answered.');
        const text = cleanText(a.text, T.ANSWER_MAX);
        if (text.length < 1) throw new RoomError('bad_action', 'Type a word.');
        cur.answers[id] = text;
        if (everyoneDone(ctx, cur.participants, cur.answers)) finishPhase(state, ctx);
        return;
      }
      case 'vote': {
        if (state.phase !== 'vote') throw new RoomError('not_now', 'Voting is closed.');
        const target = String(a.targetId || '');
        if (target === id || !cur.participants.includes(target)) throw new RoomError('bad_action', 'Pick someone else in the round.');
        cur.votes[id] = target;
        if (everyoneDone(ctx, cur.participants, cur.votes)) finishPhase(state, ctx);
        return;
      }
      case 'guess': {
        if (state.phase !== 'guess') throw new RoomError('not_now', 'No guess to make.');
        if (cur.imposterId !== id) throw new RoomError('not_now', 'Only the imposter guesses.');
        if (!cur.guessOptions.includes(a.text)) throw new RoomError('bad_action', 'Pick one of the options.');
        cur.guess = a.text;
        finishPhase(state, ctx);
        return;
      }
      case 'react': {
        ctx.emit({ type: 'react', from: id, e: ['🔥', '💀', '😂', '👀', '🫣'].includes(a.e) ? a.e : '😂' });
        return;
      }
      default:
        throw new RoomError('bad_action', 'That is not a move in this game.');
    }
  },

  view(state, ctx, playerId) {
    return buildView(state, ctx, playerId, false);
  },
  tvView(state, ctx) {
    return buildView(state, ctx, null, true);
  },
};

function checkEarly(state, ctx) {
  const cur = state.cur;
  if (!cur) return;
  const live = cur.participants.filter((id) => ctx.isConnected(id));
  if (!live.length) return;
  if (state.phase === 'answer' && everyoneDone(ctx, cur.participants, cur.answers)) finishPhase(state, ctx);
  if (state.phase === 'vote' && everyoneDone(ctx, cur.participants, cur.votes)) finishPhase(state, ctx);
  if (state.phase === 'guess' && !ctx.isConnected(cur.imposterId)) finishPhase(state, ctx);
}

function beginRound(state, ctx) {
  for (const id of state.pendingJoiners) {
    const p = ctx.player(id);
    if (p) {
      p.spectator = false;
      state.players[id] = state.players[id] || { timesImposter: Math.max(0, ...Object.values(state.players).map((x) => x.timesImposter)) };
    }
  }
  state.pendingJoiners.clear();
  const ids = ctx
    .players()
    .filter((p) => p.connected)
    .map((p) => p.id);
  for (const id of ids) state.players[id] = state.players[id] || { timesImposter: 0 };
  state.round++;
  if (state.round > state.totalRounds || ids.length < 3) return finishGame(state, ctx);
  const pair = bank(ctx).next();
  const sorted = shuffle(ids, ctx.rng).sort((a, b) => state.players[a].timesImposter - state.players[b].timesImposter);
  const imposterId = sorted[0];
  state.players[imposterId].timesImposter++;
  state.cur = {
    round: state.round,
    participants: ids,
    pair,
    imposterId,
    answers: {},
    votes: {},
    guess: null,
    guessOptions: [],
    results: null,
    left: false,
  };
  enterPhase(state, ctx, {
    phase: 'secret',
    seconds: T.SECRET_SECONDS,
    onEnd: () => enterPhase(state, ctx, { phase: 'answer', seconds: T.ANSWER_SECONDS, onEnd: () => closeAnswer(state, ctx) }),
  });
}

function closeAnswer(state, ctx) {
  const cur = state.cur;
  for (const id of cur.participants) if (!cur.answers[id]) cur.answers[id] = '…';
  cur.order = shuffle(cur.participants, ctx.rng);
  enterPhase(state, ctx, { phase: 'vote', seconds: T.VOTE_SECONDS, onEnd: () => closeVote(state, ctx) });
}

function closeVote(state, ctx) {
  const cur = state.cur;
  const tally = {};
  for (const t of Object.values(cur.votes)) tally[t] = (tally[t] || 0) + 1;
  const max = Math.max(0, ...Object.values(tally));
  const top = Object.keys(tally).filter((k) => tally[k] === max);
  cur.tally = tally;
  cur.caught = cur.left || (max > 0 && top.includes(cur.imposterId) && (top.length === 1 || max >= 2));
  if (cur.caught && !cur.left && ctx.isConnected(cur.imposterId)) {
    const decoys = shuffle(
      PAIRS.filter((p) => p.crew !== cur.pair.crew && p.category === cur.pair.category).map((p) => p.crew),
      ctx.rng,
    ).slice(0, 2);
    while (decoys.length < 2) decoys.push(pick(PAIRS, ctx.rng).crew);
    cur.guessOptions = shuffle([cur.pair.crew, ...decoys], ctx.rng);
    return enterPhase(state, ctx, { phase: 'guess', seconds: T.GUESS_SECONDS, onEnd: () => enterReveal(state, ctx) });
  }
  enterReveal(state, ctx);
}

function enterReveal(state, ctx) {
  const cur = state.cur;
  const deltas = {};
  const add = (id, pts) => {
    if (!pts) return;
    deltas[id] = (deltas[id] || 0) + pts;
    ctx.award(id, pts);
  };
  const imp = cur.imposterId;
  if (cur.caught) {
    for (const [voter, target] of Object.entries(cur.votes)) if (target === imp && voter !== imp) add(voter, T.CATCH);
    state.stats.catches[imp] = state.stats.catches[imp] || 0;
    for (const [voter, target] of Object.entries(cur.votes))
      if (target === imp && voter !== imp) state.stats.catches[voter] = (state.stats.catches[voter] || 0) + 1;
    if (cur.guess && cur.guess === cur.pair.crew) {
      add(imp, T.GUESS);
      state.stats.guesses[imp] = (state.stats.guesses[imp] || 0) + 1;
    }
  } else {
    add(imp, T.ESCAPE);
    state.stats.escapes[imp] = (state.stats.escapes[imp] || 0) + 1;
    for (const id of cur.participants) if (id !== imp && !(cur.tally || {})[id]) add(id, T.SURVIVE_VOTE);
  }
  const fooledCount = Object.values(cur.votes).filter((t) => t !== imp).length;
  if (!cur.caught) state.stats.fooled[imp] = (state.stats.fooled[imp] || 0) + fooledCount;
  cur.results = {
    imposterId: imp,
    caught: cur.caught,
    left: cur.left,
    guess: cur.guess,
    guessRight: cur.guess === cur.pair.crew,
    tally: cur.tally || {},
    votes: cur.votes,
    deltas,
    crew: cur.pair.crew,
    imposterPrompt: cur.pair.imposter,
  };
  state.history.push({ round: cur.round, imposterId: imp, caught: cur.caught, answer: cur.answers[imp] });
  enterPhase(state, ctx, { phase: 'reveal', seconds: T.REVEAL_SECONDS, onEnd: () => beginRound(state, ctx) });
}

function finishGame(state, ctx) {
  const nameOf = (id) => ctx.player(id)?.name || 'Someone';
  const avatarOf = (id) => ctx.player(id)?.avatar || '';
  const top = (map) => {
    const e = Object.entries(map).filter(([, v]) => v >= 1);
    if (!e.length) return null;
    const max = Math.max(...e.map(([, v]) => v));
    return { ids: e.filter(([, v]) => v === max).map(([id]) => id), n: max };
  };
  const awards = [];
  const push = (key, title, w, blurb) =>
    w && awards.push({ key, title, winners: w.ids.map((id) => ({ id, name: nameOf(id), avatar: avatarOf(id) })), n: w.n, blurb });
  const esc = top(state.stats.escapes);
  push('escape', 'Master Imposter', esc, esc && `Escaped ${esc.n} ${esc.n === 1 ? 'time' : 'times'} without being caught.`);
  const cat = top(state.stats.catches);
  push('detective', 'Detective', cat, cat && `Voted out the imposter ${cat.n} ${cat.n === 1 ? 'time' : 'times'}.`);
  const g = top(state.stats.guesses);
  push('mindreader', 'Mind Reader', g, g && `Guessed the crew’s prompt after being caught, ${g.n === 1 ? 'once' : `${g.n} times`}.`);
  ctx.end({ awards, rounds: state.history });
}

function buildView(state, ctx, playerId, isTv) {
  const cur = state.cur;
  const v = {
    phase: state.phase,
    phaseId: state.phaseId,
    endsAt: state.endsAt,
    duration: state.duration,
    round: state.round,
    totalRounds: state.totalRounds,
    participants: cur ? cur.participants.slice() : [],
    done: [],
    you: null,
    answers: null,
    guessing: false,
    reveal: null,
  };
  if (!cur) return v;
  if (state.phase === 'answer') v.done = Object.keys(cur.answers);
  if (state.phase === 'vote') v.done = Object.keys(cur.votes);
  if (['vote', 'guess', 'reveal'].includes(state.phase))
    v.answers = (cur.order || cur.participants).map((id) => ({ id, text: cur.answers[id] || '…' }));
  if (state.phase === 'guess') {
    v.guessing = true;
    v.guessOptions = cur.guessOptions;
  }
  if (state.phase === 'reveal' && cur.results) v.reveal = cur.results;
  if (isTv || !playerId) return v;
  const isP = cur.participants.includes(playerId);
  if (!isP) {
    v.you = { role: 'spectator' };
    return v;
  }
  const isImp = cur.imposterId === playerId;
  v.you = {
    role: 'player',
    prompt: ['secret', 'answer'].includes(state.phase) ? (isImp ? cur.pair.imposter : cur.pair.crew) : null,
    answer: cur.answers[playerId] || null,
    vote: cur.votes[playerId] || null,
    isImposter: state.phase === 'guess' || state.phase === 'reveal' ? isImp : null,
    canGuess: state.phase === 'guess' && isImp,
  };
  return v;
}

export default imposter;

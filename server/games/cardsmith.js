// CARDSMITH — write the cards, judge the room.
// The room picks a theme, every player writes their own answer cards, the deck is topped up with
// AI-generated cards (when a key is set) or the built-in bank, then it plays like a
// fill-in-the-blank card game: one prompt card per round, everyone plays a card from their hand,
// a rotating judge (or a vote) crowns the winner.

import { RoomError } from '../errors.js';
import { enterPhase, finishPhase, everyoneDone } from './phases.js';
import { cleanText, shuffle, pick, clamp } from '../util.js';
import { generateCards, aiEnabled } from '../ai.js';
import BLACK from '../content/cards_black.js';
import WHITE from '../content/cards_white.js';

export const T = {
  FORGE_SECONDS: 150,
  PICK_SECONDS: 45,
  JUDGE_SECONDS: 35,
  REVEAL_SECONDS: 7,
  HAND_SIZE: 7,
  CARD_MAX: 60,
  WIN: 100,
  AUTHOR_BONUS: 50,
  VOTE_POINTS: 50,
  DECK_TARGET: 36, // total player-written cards we aim for across the room
};
if (process.env.CONTRABAND_FAST === '1') Object.assign(T, { FORGE_SECONDS: 20, PICK_SECONDS: 15, JUDGE_SECONDS: 15, REVEAL_SECONDS: 3 });

export function quotaFor(n) {
  return clamp(Math.ceil(T.DECK_TARGET / Math.max(1, n)), 3, 10);
}

let cardSeq = 0;
const mkCard = (text, author, source) => ({ id: `c${(++cardSeq).toString(36)}`, text, author, source });

const cardsmith = {
  id: 'cardsmith',
  name: 'Cardsmith',
  tagline: 'Pick a theme, write your own cards, judge the room.',
  minPlayers: 3,
  maxPlayers: 12,
  minutes: 20,
  defaultSettings: { category: '', rounds: 8, judging: 'czar' },
  settingsSchema: {
    category: { type: 'text', label: 'Theme', max: 40, placeholder: 'e.g. our friend group, college, the office' },
    rounds: { type: 'number', label: 'Rounds', min: 4, max: 15, default: 8 },
    judging: {
      type: 'choice',
      label: 'Who picks the winner',
      default: 'czar',
      options: [
        { value: 'czar', label: 'Rotating judge' },
        { value: 'vote', label: 'Everyone votes' },
      ],
    },
  },
  silentActions: new Set(),

  init(ctx, settings) {
    const ids = ctx.players().map((p) => p.id);
    const state = {
      phase: 'forge',
      phaseId: 0,
      endsAt: null,
      duration: null,
      round: 0,
      totalRounds: clamp(Number(settings.rounds) || 8, 4, 15),
      settings: {
        category: cleanText(settings.category || '', 40),
        rounds: clamp(Number(settings.rounds) || 8, 4, 15),
        judging: settings.judging === 'vote' ? 'vote' : 'czar',
      },
      participants: ids,
      quota: quotaFor(ids.length),
      written: Object.fromEntries(ids.map((id) => [id, []])),
      ai: { status: aiEnabled() ? 'pending' : 'off', black: [], white: [] },
      deck: { black: [], white: [] },
      hands: {},
      judgeIdx: -1,
      cur: null,
      history: [],
      stats: { wins: {}, authored: {}, played: {} },
      pendingJoiners: new Set(),
    };
    return state;
  },

  start(state, ctx) {
    enterPhase(state, ctx, { phase: 'forge', seconds: T.FORGE_SECONDS, onEnd: () => closeForge(state, ctx) });
    if (state.ai.status === 'pending') {
      const examples = () => Object.values(state.written).flat();
      generateCards({
        category: state.settings.category,
        blackCount: Math.max(12, state.totalRounds + 4),
        whiteCount: 40,
        examples: examples(),
      })
        .then((res) => {
          if (!res) {
            state.ai.status = 'off';
          } else {
            state.ai = { status: 'done', black: res.black, white: res.white };
            if (state.phase !== 'forge') mergeAi(state, ctx);
          }
          ctx.sync();
        })
        .catch(() => {
          state.ai.status = 'off';
          ctx.sync();
        });
    }
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
    state.participants = state.participants.filter((p) => p !== id);
    state.pendingJoiners.delete(id);
    if (state.cur) {
      delete state.cur.plays[id];
      delete state.cur.votes[id];
      if (state.cur.judgeId === id) state.cur.mode = 'vote';
    }
    checkEarly(state, ctx);
  },

  action(state, ctx, id, a) {
    if (!state.participants.includes(id)) throw new RoomError('not_now', 'You are in from the next game.');
    const cur = state.cur;
    switch (a.type) {
      case 'card': {
        if (state.phase !== 'forge') throw new RoomError('not_now', 'Card writing is over.');
        const mine = state.written[id] || (state.written[id] = []);
        if (mine.length >= state.quota) throw new RoomError('bad_action', `You already wrote ${state.quota} cards.`);
        const text = cleanText(a.text, T.CARD_MAX)
          .replace(/https?:\/\/\S+/gi, '')
          .trim();
        if (text.length < 2) throw new RoomError('bad_action', 'Write a little more than that.');
        if (mine.some((t) => t.toLowerCase() === text.toLowerCase())) throw new RoomError('bad_action', 'You already wrote that one.');
        mine.push(text);
        if (
          everyoneDone(
            ctx,
            state.participants,
            Object.fromEntries(state.participants.filter((p) => (state.written[p] || []).length >= state.quota).map((p) => [p, true])),
          )
        )
          finishPhase(state, ctx);
        return;
      }
      case 'uncard': {
        if (state.phase !== 'forge') throw new RoomError('not_now', 'Card writing is over.');
        const mine = state.written[id] || [];
        const i = Number(a.index);
        if (!Number.isInteger(i) || i < 0 || i >= mine.length) throw new RoomError('bad_action', 'No such card.');
        mine.splice(i, 1);
        return;
      }
      case 'play': {
        if (state.phase !== 'pick' || !cur) throw new RoomError('not_now', 'Not the time to play a card.');
        if (cur.mode === 'czar' && cur.judgeId === id) throw new RoomError('not_now', 'You are the judge this round.');
        if (cur.plays[id]) throw new RoomError('not_now', 'You already played.');
        const hand = state.hands[id] || [];
        const card = hand.find((c) => c.id === String(a.cardId));
        if (!card) throw new RoomError('bad_action', 'That card is not in your hand.');
        cur.plays[id] = card;
        state.hands[id] = hand.filter((c) => c.id !== card.id);
        if (everyoneDone(ctx, pickers(state, cur), cur.plays)) finishPhase(state, ctx);
        return;
      }
      case 'crown': {
        if (state.phase !== 'judge' || !cur) throw new RoomError('not_now', 'Nothing to judge right now.');
        if (cur.mode !== 'czar' || cur.judgeId !== id) throw new RoomError('not_host', 'Only the judge picks this round.');
        const key = Number(a.key);
        if (!cur.order[key]) throw new RoomError('bad_action', 'Pick one of the cards.');
        cur.crowned = key;
        finishPhase(state, ctx);
        return;
      }
      case 'vote': {
        if (state.phase !== 'judge' || !cur) throw new RoomError('not_now', 'Voting is closed.');
        if (cur.mode !== 'vote') throw new RoomError('not_now', 'The judge decides this round.');
        if (cur.votes[id] !== undefined) throw new RoomError('not_now', 'You already voted.');
        const key = Number(a.key);
        const entry = cur.order[key];
        if (!entry) throw new RoomError('bad_action', 'Pick one of the cards.');
        if (entry.playerId === id) throw new RoomError('bad_action', 'Not your own card.');
        cur.votes[id] = key;
        if (everyoneDone(ctx, voters(state, cur), cur.votes)) finishPhase(state, ctx);
        return;
      }
      case 'react': {
        const e = ['🔥', '💀', '😂', '👀', '🫣'].includes(a.e) ? a.e : '😂';
        ctx.emit({ type: 'react', from: id, e });
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

function pickers(state, cur) {
  return state.participants.filter((id) => !(cur.mode === 'czar' && id === cur.judgeId));
}
function voters(state, cur) {
  return state.participants.filter((id) => cur.plays[id]);
}

function checkEarly(state, ctx) {
  const cur = state.cur;
  if (state.phase === 'forge') {
    const done = Object.fromEntries(state.participants.filter((p) => (state.written[p] || []).length >= state.quota).map((p) => [p, true]));
    if (state.participants.length && everyoneDone(ctx, state.participants, done)) finishPhase(state, ctx);
  } else if (state.phase === 'pick' && cur) {
    const ps = pickers(state, cur);
    if (ps.length && everyoneDone(ctx, ps, cur.plays)) finishPhase(state, ctx);
  } else if (state.phase === 'judge' && cur && cur.mode === 'vote') {
    const vs = voters(state, cur);
    if (vs.length && everyoneDone(ctx, vs, cur.votes)) finishPhase(state, ctx);
  }
}

function mergeAi(state, ctx) {
  const have = new Set(state.deck.white.map((c) => c.text.toLowerCase()));
  for (const t of state.ai.white) if (!have.has(t.toLowerCase())) state.deck.white.push(mkCard(t, null, 'ai'));
  state.deck.white = shuffle(state.deck.white, ctx.rng);
  const haveB = new Set(state.deck.black);
  const extra = state.ai.black.filter((b) => !haveB.has(b));
  // AI prompt cards go to the front of the remaining rounds so the theme shows up
  const played = state.round;
  state.deck.black = [...state.deck.black.slice(0, played), ...shuffle(extra, ctx.rng), ...state.deck.black.slice(played)];
}

function closeForge(state, ctx) {
  const n = state.participants.length;
  const whites = [];
  for (const id of state.participants) for (const t of state.written[id] || []) whites.push(mkCard(t, id, 'player'));
  for (const t of state.ai.white) whites.push(mkCard(t, null, 'ai'));
  const need = n * T.HAND_SIZE + state.totalRounds * n + 6;
  const bank = shuffle(WHITE, ctx.rng);
  let i = 0;
  while (whites.length < need && i < bank.length) whites.push(mkCard(bank[i++], null, 'bank'));
  state.deck.white = shuffle(whites, ctx.rng);
  const blacks = shuffle(state.ai.black, ctx.rng).concat(shuffle(BLACK, ctx.rng));
  state.deck.black = [...new Set(blacks)];
  state.hands = {};
  beginRound(state, ctx);
}

function draw(state, ctx, id) {
  const hand = state.hands[id] || (state.hands[id] = []);
  while (hand.length < T.HAND_SIZE) {
    if (!state.deck.white.length) {
      // recycle: rebuild from the bank when the deck runs dry
      state.deck.white = shuffle(WHITE, ctx.rng).map((t) => mkCard(t, null, 'bank'));
    }
    const card = state.deck.white.pop();
    if (!hand.some((c) => c.text.toLowerCase() === card.text.toLowerCase())) hand.push(card);
  }
}

function beginRound(state, ctx) {
  for (const id of state.pendingJoiners) {
    const p = ctx.player(id);
    if (p) {
      p.spectator = false;
      if (!state.participants.includes(id)) state.participants.push(id);
    }
  }
  state.pendingJoiners.clear();
  state.round++;
  if (state.round > state.totalRounds || state.participants.length < 3) return finishGame(state, ctx);
  for (const id of state.participants) draw(state, ctx, id);
  let judgeId = null;
  let mode = state.settings.judging;
  if (mode === 'czar') {
    const live = state.participants.filter((id) => ctx.isConnected(id));
    const pool = live.length ? live : state.participants;
    state.judgeIdx = (state.judgeIdx + 1) % pool.length;
    judgeId = pool[state.judgeIdx];
  }
  state.cur = {
    round: state.round,
    black: state.deck.black[(state.round - 1) % state.deck.black.length],
    judgeId,
    mode,
    plays: {},
    order: [],
    votes: {},
    crowned: null,
    winner: null,
    results: null,
  };
  enterPhase(state, ctx, { phase: 'pick', seconds: T.PICK_SECONDS, onEnd: () => closePick(state, ctx) });
}

function closePick(state, ctx) {
  const cur = state.cur;
  cur.order = shuffle(
    Object.entries(cur.plays).map(([playerId, card]) => ({ playerId, card })),
    ctx.rng,
  );
  if (cur.order.length === 0) return enterReveal(state, ctx);
  if (cur.mode === 'czar' && !ctx.isConnected(cur.judgeId)) cur.mode = 'vote';
  if (cur.order.length === 1) {
    cur.crowned = 0;
    return enterReveal(state, ctx);
  }
  enterPhase(state, ctx, { phase: 'judge', seconds: T.JUDGE_SECONDS, onEnd: () => enterReveal(state, ctx) });
}

function enterReveal(state, ctx) {
  const cur = state.cur;
  let winnerKey = null;
  const tally = {};
  if (cur.mode === 'czar') {
    winnerKey = cur.crowned;
  } else {
    for (const k of Object.values(cur.votes)) tally[k] = (tally[k] || 0) + 1;
    const max = Math.max(0, ...Object.values(tally));
    if (max > 0) {
      const top = Object.keys(tally)
        .filter((k) => tally[k] === max)
        .map(Number);
      winnerKey = pick(top, ctx.rng);
    }
  }
  const results = { winnerKey, tally, cards: [] };
  cur.order.forEach((entry, key) => {
    const won = key === winnerKey;
    const votes = tally[key] || 0;
    let points = 0;
    if (won) {
      points += T.WIN;
      state.stats.wins[entry.playerId] = (state.stats.wins[entry.playerId] || 0) + 1;
    }
    if (cur.mode === 'vote') points += votes * T.VOTE_POINTS;
    if (points) ctx.award(entry.playerId, points);
    let authorBonus = 0;
    if (won && entry.card.author && entry.card.author !== entry.playerId && state.participants.includes(entry.card.author)) {
      authorBonus = T.AUTHOR_BONUS;
      ctx.award(entry.card.author, authorBonus);
      state.stats.authored[entry.card.author] = (state.stats.authored[entry.card.author] || 0) + 1;
    }
    state.stats.played[entry.playerId] = (state.stats.played[entry.playerId] || 0) + 1;
    results.cards.push({
      key,
      text: entry.card.text,
      playerId: entry.playerId,
      authorId: entry.card.author,
      source: entry.card.source,
      votes,
      won,
      points,
      authorBonus,
    });
  });
  cur.results = results;
  if (winnerKey !== null && cur.order[winnerKey])
    state.history.push({
      round: cur.round,
      black: cur.black,
      text: cur.order[winnerKey].card.text,
      playerId: cur.order[winnerKey].playerId,
      authorId: cur.order[winnerKey].card.author,
    });
  enterPhase(state, ctx, {
    phase: 'reveal',
    seconds: T.REVEAL_SECONDS + Math.min(6, cur.order.length),
    onEnd: () => beginRound(state, ctx),
  });
}

function finishGame(state, ctx) {
  const nameOf = (id) => ctx.player(id)?.name || 'Someone';
  const avatarOf = (id) => ctx.player(id)?.avatar || '';
  const top = (map) => {
    const entries = Object.entries(map).filter(([, v]) => v >= 1);
    if (!entries.length) return null;
    const max = Math.max(...entries.map(([, v]) => v));
    return { ids: entries.filter(([, v]) => v === max).map(([id]) => id), n: max };
  };
  const awards = [];
  const w = top(state.stats.wins);
  if (w)
    awards.push({
      key: 'wins',
      title: 'Round winner',
      winners: w.ids.map((id) => ({ id, name: nameOf(id), avatar: avatarOf(id) })),
      n: w.n,
      blurb: `Won ${w.n} ${w.n === 1 ? 'round' : 'rounds'}.`,
    });
  const a = top(state.stats.authored);
  if (a)
    awards.push({
      key: 'author',
      title: 'Card of the people',
      winners: a.ids.map((id) => ({ id, name: nameOf(id), avatar: avatarOf(id) })),
      n: a.n,
      blurb: `Wrote ${a.n === 1 ? 'a card' : `${a.n} cards`} that won in someone else’s hand.`,
    });
  const best = state.history.slice().sort((x, y) => 0)[0];
  ctx.end({
    awards,
    theme: state.settings.category,
    hallOfFame: state.history.map((hh) => ({ ...hh, name: nameOf(hh.playerId), author: hh.authorId ? nameOf(hh.authorId) : null })),
    topAnswer: best ? { text: best.text, name: nameOf(best.playerId), round: best.round } : null,
    aiUsed: state.ai.status === 'done',
  });
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
    theme: state.settings.category,
    judging: state.settings.judging,
    participants: state.participants.slice(),
    quota: state.quota,
    aiStatus: state.ai.status,
    counts: Object.fromEntries(state.participants.map((id) => [id, (state.written[id] || []).length])),
    done: [],
    you: null,
    black: cur ? cur.black : null,
    judgeId: cur ? cur.judgeId : null,
    mode: cur ? cur.mode : null,
    plays: null,
    reveal: null,
    scores: Object.fromEntries(ctx.players().map((p) => [p.id, p.score])),
    history: state.history.slice(-3),
  };
  if (state.phase === 'forge') v.done = state.participants.filter((id) => (state.written[id] || []).length >= state.quota);
  if (state.phase === 'pick' && cur) v.done = Object.keys(cur.plays);
  if (state.phase === 'judge' && cur) {
    v.done = cur.mode === 'vote' ? Object.keys(cur.votes) : cur.crowned !== null ? [cur.judgeId] : [];
    v.plays = cur.order.map((e, key) => ({ key, text: e.card.text }));
  }
  if (state.phase === 'reveal' && cur?.results) v.reveal = cur.results;
  if (isTv || !playerId) return v;
  const isP = state.participants.includes(playerId);
  v.you = {
    role: isP ? (cur && cur.mode === 'czar' && cur.judgeId === playerId ? 'judge' : 'player') : 'spectator',
    written: state.written[playerId] || [],
    hand:
      state.phase === 'pick' && isP
        ? (state.hands[playerId] || []).map((c) => ({ id: c.id, text: c.text, mine: c.author === playerId }))
        : [],
    played: cur?.plays[playerId] ? { id: cur.plays[playerId].id, text: cur.plays[playerId].text } : null,
    vote: cur?.votes[playerId] ?? null,
    myKey: cur ? cur.order.findIndex((e) => e.playerId === playerId) : -1,
  };
  return v;
}

export default cardsmith;

// CONTRABAND — sneak the word, steal the laugh, don't get caught.
// Everyone answers the same prompt; a secret few must hide an assigned word in their answer.
// Vote for the funniest, accuse the smugglers, reveal. Final round: everyone smuggles.

import { RoomError } from '../errors.js';
import { enterPhase, finishPhase, everyoneDone } from './phases.js';
import { cleanText, shuffle, pick, clamp, BankCursor } from '../util.js';
import PROMPTS from '../content/prompts.js';
import TIER1 from '../content/words_tier1.js';
import TIER2 from '../content/words_tier2.js';
import TIER3 from '../content/words_tier3.js';
import CALLBACKS from '../content/callbacks.js';
import STAMPS from '../content/stamps.js';
import FILLERS from '../content/fillers.js';

// ---------- tuning (one place) ----------
export const T = {
  ANSWER_MAX: 70,
  ANSWER_MIN: 2,
  BRIEF_SECONDS: 8,
  BRIEF_FINAL_SECONDS: 10,
  WRITE_SECONDS: 60,
  VOTE_SECONDS: (a) => clamp(15 + 3 * a, 20, 45),
  ACCUSE_SECONDS: (n) => (n >= 8 ? 30 : 25),
  LINEUP_SECONDS: (l) => clamp(12 + 6 * Math.max(l, 1), 20, 60),
  REVEAL_SECONDS: (a, isFinal) => 4 + 1.5 * a + (isFinal ? 4 : 0),
  SCOREBOARD_SECONDS: 8,
  CARD_STEP_MS: 1100,
  REVEAL_LEAD_MS: 400,
  FUNNY_VOTE: 100,
  FINAL_FUNNY_VOTE: 200,
  GOLD_WEIGHT: 2,
  CORRECT_PICK: 100,
  WRONG_PICK: 50,
  FULL_BUST: 100,
  NOBODY_RIGHT: 200,
  GETAWAY: 250,
  GHOST: 100,
  LINEUP_CORRECT: 100,
  FOOLED: 100,
  BUST_FRACTION: 0.4,
  P_CLEAN_ROUND: 0.15,
  WIRETAP_START: 1,
  WIRETAP_CAP: 2,
  AFK_STRIKES: 2,
  TIER_SCHEDULE: {
    mild: { rounds: [1, 1, 1, 2, 2, 2], final: 1 },
    normal: { rounds: [1, 1, 2, 2, 3, 3], final: 2 },
    spicy: { rounds: [1, 2, 2, 3, 3, 3], final: 3 },
  },
};

if (process.env.CONTRABAND_FAST === '1') {
  // Test-only: short phases so an automated browser can play a whole game in under a minute.
  Object.assign(T, {
    BRIEF_SECONDS: 2,
    BRIEF_FINAL_SECONDS: 2,
    WRITE_SECONDS: 20,
    VOTE_SECONDS: () => 15,
    ACCUSE_SECONDS: () => 15,
    LINEUP_SECONDS: () => 20,
    REVEAL_SECONDS: () => 4,
    SCOREBOARD_SECONDS: 2.5,
    CARD_STEP_MS: 500,
  });
}

const TIERS = { 1: TIER1, 2: TIER2, 3: TIER3 };
const RECENT_PROMPTS = []; // process-wide ring so two rooms on one night rarely share a prompt
const RECENT_MAX = 80;

// ---------- content selection ----------

function banks(ctx) {
  const store = ctx.store;
  if (!store.banks) {
    store.banks = {
      prompts: new BankCursor(
        PROMPTS.map((p, i) => ({ ...p, id: i })),
        ctx.rng,
      ),
      words: { 1: new BankCursor(TIER1, ctx.rng), 2: new BankCursor(TIER2, ctx.rng), 3: new BankCursor(TIER3, ctx.rng) },
      callbacks: new BankCursor(CALLBACKS.templates, ctx.rng),
      fallbacks: new BankCursor(CALLBACKS.fallbacks, ctx.rng),
      fillers: new BankCursor(FILLERS, ctx.rng),
    };
    store.usedWords = new Set();
  }
  return store.banks;
}

function nextWord(ctx, tier) {
  const b = banks(ctx);
  const cursor = b.words[tier] || b.words[1];
  for (let i = 0; i < cursor.items.length + 5; i++) {
    const w = cursor.next();
    if (!ctx.store.usedWords.has(w)) {
      ctx.store.usedWords.add(w);
      return w;
    }
  }
  // every word in the tier has been used in this room: fall back to any tier, then allow repeats
  for (const t of [1, 2, 3]) {
    if (t === tier) continue;
    const c = b.words[t];
    for (let i = 0; i < c.items.length; i++) {
      const w = c.next();
      if (!ctx.store.usedWords.has(w)) {
        ctx.store.usedWords.add(w);
        return w;
      }
    }
  }
  return cursor.next();
}

function nextPrompt(state, ctx, ids) {
  const b = banks(ctx);
  let prompt = null;
  for (let tries = 0; tries < 20; tries++) {
    const cand = b.prompts.next();
    if (!RECENT_PROMPTS.includes(cand.id)) {
      prompt = cand;
      break;
    }
    prompt = cand;
  }
  RECENT_PROMPTS.push(prompt.id);
  if (RECENT_PROMPTS.length > RECENT_MAX) RECENT_PROMPTS.shift();
  let subjectId = null;
  let text = prompt.text;
  if (prompt.p) {
    const counts = ids.map((id) => state.players[id]?.subjectCount || 0);
    const min = Math.min(...counts);
    const pool = ids.filter((id, i) => counts[i] === min);
    subjectId = pick(pool, ctx.rng);
    state.players[subjectId].subjectCount++;
    const name = ctx.player(subjectId)?.name || 'someone';
    text = prompt.text.replace('{p}', () => name);
  }
  return { id: prompt.id, text, subjectId, callback: null };
}

function finalePrompt(state, ctx) {
  const b = banks(ctx);
  let best = null;
  for (const r of state.rounds) {
    if (!r.results) continue;
    for (const card of r.results.cards) {
      if (card.filler || !card.text || card.text.length > 50) continue;
      const weight = card.voteWeight || 0;
      if (!best || weight > best.weight) best = { weight, text: card.text, round: r.round, authorId: card.id };
    }
  }
  if (best && best.weight > 0) {
    const tpl = b.callbacks.next();
    return {
      id: -1,
      text: tpl.replace('{answer}', () => `“${best.text}”`),
      subjectId: null,
      callback: { round: best.round, authorId: best.authorId, answer: best.text },
    };
  }
  return { id: -2, text: b.fallbacks.next(), subjectId: null, callback: null };
}

function stampLine(state, ctx, group, vars) {
  const s = state.stampCursors;
  if (!s[group]) s[group] = new BankCursor(STAMPS[group] || ['...'], ctx.rng);
  let line = s[group].next();
  for (const [k, v] of Object.entries(vars)) {
    const val = String(v);
    if (line.startsWith(`{${k}}`)) line = val.charAt(0).toUpperCase() + val.slice(1) + line.slice(k.length + 2);
    line = line.split(`{${k}}`).join(val);
  }
  return line;
}

// ---------- rules helpers ----------

function tierFor(setting, round, isFinal) {
  const sched = T.TIER_SCHEDULE[setting] || T.TIER_SCHEDULE.normal;
  if (isFinal) return sched.final;
  return sched.rounds[Math.min(round, sched.rounds.length) - 1];
}

export function k0For(n) {
  return n <= 4 ? 1 : n <= 7 ? 2 : 3;
}

export function rangeFor(round, n) {
  const k0 = k0For(n);
  if (round === 1) return { lo: k0, hi: k0 };
  const hi = Math.max(1, Math.min(k0 + 1, n - 2, 3));
  const loNonZero = Math.min(hi, Math.max(1, k0 - 1));
  const zeroAllowed = round >= 3 && n >= 5;
  return { lo: zeroAllowed ? 0 : loNonZero, hi, loNonZero, zeroAllowed };
}

export function drawCount(round, n, rng = Math.random) {
  const r = rangeFor(round, n);
  if (round === 1) return r.hi;
  if (r.zeroAllowed && rng() < T.P_CLEAN_ROUND) return 0;
  return r.loNonZero + Math.floor(rng() * (r.hi - r.loNonZero + 1));
}

function pickSmugglers(state, ids, count, round, rng) {
  const eligible = ids.filter((id) => state.players[id].joinedRound !== round || round === 1);
  const pool = eligible.length >= count ? eligible : ids;
  const sorted = shuffle(pool, rng).sort((a, b) => state.players[a].timesSmuggled - state.players[b].timesSmuggled);
  return sorted.slice(0, count);
}

export function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function validAnswer(cur, id, text) {
  let t = cleanText(text, T.ANSWER_MAX)
    .replace(/https?:\/\/\S+/gi, '')
    .trim();
  if (t.length < T.ANSWER_MIN) return null;
  const word = cur.smugglers[id];
  if (word && !norm(t).includes(norm(word))) return null;
  return t;
}

function votable(cur) {
  return cur.order.filter((id) => cur.answers[id] && !cur.answers[id].filler);
}

function live(state, cur, ctx) {
  return cur.participants.filter((id) => ctx.isConnected(id) && !state.players[id]?.afk);
}

function voters(state, cur, ctx) {
  const v = votable(cur);
  return live(state, cur, ctx).filter((id) => v.some((a) => a !== id));
}

function accusable(cur, forId) {
  return votable(cur).filter((id) => id !== forId);
}

// ---------- module ----------

const contraband = {
  id: 'contraband',
  name: 'Contraband',
  tagline: 'Sneak the word. Steal the laugh. Don’t get caught.',
  minPlayers: 3,
  maxPlayers: 12,
  minutes: 16,
  defaultSettings: { mode: 'classic', rounds: 4, words: 'normal' },
  settingsSchema: {
    mode: {
      type: 'choice',
      label: 'Mode',
      default: 'classic',
      options: [
        { value: 'classic', label: 'Classic' },
        { value: 'blitz', label: 'Blitz' },
        { value: 'hardcore', label: 'Hardcore' },
      ],
    },
    rounds: { type: 'number', label: 'Rounds before the final', min: 3, max: 6, default: 4 },
    words: {
      type: 'choice',
      label: 'Contraband',
      default: 'normal',
      options: [
        { value: 'mild', label: 'Mild' },
        { value: 'normal', label: 'Normal' },
        { value: 'spicy', label: 'Spicy' },
      ],
    },
  },
  silentActions: new Set(['draft']),

  init(ctx, settings) {
    banks(ctx);
    // Modes are presets on top of the settings: Blitz is short and mild, Hardcore is long,
    // spicy, and never tells you how many smugglers there are.
    const mode = ['classic', 'blitz', 'hardcore'].includes(settings.mode) ? settings.mode : 'classic';
    if (mode === 'blitz') settings = { ...settings, rounds: 3, words: 'mild' };
    if (mode === 'hardcore') settings = { ...settings, rounds: 6, words: 'spicy' };
    const state = {
      mode,
      phase: 'briefing',
      phaseId: 0,
      endsAt: null,
      duration: null,
      round: 0,
      totalRounds: clamp(Number(settings.rounds) || 4, 3, 6),
      isFinal: false,
      settings: { rounds: clamp(Number(settings.rounds) || 4, 3, 6), words: settings.words || 'normal' },
      players: {},
      pendingJoiners: new Set(),
      rounds: [],
      cur: null,
      stats: { votes: {}, getaways: {}, busts: {}, correct: {}, wrong: {}, fooled: {}, wiretapsUsed: {}, mostWanted: [] },
      stampCursors: {},
      waiting: null,
      lastSummary: null,
    };
    for (const p of ctx.players()) state.players[p.id] = freshPlayer(0);
    return state;
  },

  start(state, ctx) {
    beginRound(state, ctx, 1);
  },

  skip(state, ctx) {
    if (state.phase === 'waiting') return;
    finishPhase(state, ctx);
  },

  playerJoined(state, ctx, id) {
    state.pendingJoiners.add(id);
    if (state.phase === 'waiting') tryLeaveWaiting(state, ctx);
  },

  playerReconnected(state, ctx, id) {
    const me = state.players[id];
    if (me) {
      me.afk = false;
      me.strikes = 0;
    }
    if (state.phase === 'waiting') tryLeaveWaiting(state, ctx);
    if (state.cur && state.phase === 'write' && state.cur.wiretaps[id]) {
      // resume the tapped stream for a returning tapper
      const target = state.cur.wiretaps[id];
      ctx.emit({ type: 'draft', from: target, text: state.cur.drafts[target] || '' }, [id]);
    }
  },

  playerDisconnected(state, ctx) {
    checkEarlyAdvance(state, ctx);
  },

  playerLeft(state, ctx, id) {
    const cur = state.cur;
    state.pendingJoiners.delete(id);
    if (cur) {
      if (cur.smugglers[id] && !cur.answers[id]) {
        cur.voided.add(id);
        delete cur.smugglers[id];
      }
      cur.left.add(id);
      if (!cur.answers[id]) cur.participants = cur.participants.filter((p) => p !== id);
      checkEarlyAdvance(state, ctx);
    }
  },

  action(state, ctx, id, a) {
    const cur = state.cur;
    const me = state.players[id];
    if (!me) throw new RoomError('not_now', 'Hang on, the next round is starting.');
    // Any message from a player proves they are present: it clears idle strikes even when they
    // are not in this round, so an AFK player is dealt back in at the next round.
    if (me.afk || me.strikes) {
      me.afk = false;
      me.strikes = 0;
    }
    me.acted = true;
    if (state.phase === 'waiting') {
      tryLeaveWaiting(state, ctx);
      return;
    }
    if (!cur) throw new RoomError('not_now', 'Hang on, the next round is starting.');
    const isParticipant = cur.participants.includes(id) && !cur.left.has(id);
    const clearAfk = () => {
      me.strikes = 0;
      me.afk = false;
      me.acted = true;
    };
    switch (a.type) {
      case 'draft': {
        if (state.phase !== 'write' || !isParticipant || cur.answers[id]) return;
        const text = cleanText(a.text, T.ANSWER_MAX);
        cur.drafts[id] = text;
        const tappers = cur.tappedBy[id];
        if (tappers?.length) ctx.emit({ type: 'draft', from: id, text }, tappers);
        return;
      }
      case 'submit': {
        if (state.phase !== 'write') throw new RoomError('not_now', 'Writing time is over.');
        if (!isParticipant) throw new RoomError('not_now', 'You are not in this round.');
        if (cur.answers[id]) throw new RoomError('not_now', 'You already submitted.');
        const raw = cleanText(a.text, T.ANSWER_MAX)
          .replace(/https?:\/\/\S+/gi, '')
          .trim();
        if (raw.length < T.ANSWER_MIN) throw new RoomError('bad_action', 'Write a little more than that.');
        const word = cur.smugglers[id];
        if (word && !norm(raw).includes(norm(word))) throw new RoomError('missing_word', `Your answer must include “${word}”.`);
        cur.answers[id] = { text: raw, filler: false, auto: false };
        delete cur.drafts[id];
        clearAfk();
        if (everyoneDone(ctx, live(state, cur, ctx), cur.answers)) finishPhase(state, ctx);
        return;
      }
      case 'wiretap': {
        if (state.phase !== 'write') throw new RoomError('not_now', 'Wiretaps only work while people are writing.');
        if (!isParticipant) throw new RoomError('not_now', 'You are not in this round.');
        if (me.wiretaps <= 0) throw new RoomError('no_tokens', 'No wiretap tokens left. Finish last to earn one.');
        if (cur.wiretaps[id]) throw new RoomError('not_now', 'One wiretap per round.');
        const target = String(a.targetId || '');
        if (target === id || !cur.participants.includes(target) || cur.left.has(target))
          throw new RoomError('bad_action', 'Pick someone in this round.');
        me.wiretaps--;
        cur.wiretaps[id] = target;
        (cur.tappedBy[target] ||= []).push(id);
        state.stats.wiretapsUsed[id] = (state.stats.wiretapsUsed[id] || 0) + 1;
        ctx.emit({ type: 'draft', from: target, text: cur.answers[target] ? cur.answers[target].text : cur.drafts[target] || '' }, [id]);
        ctx.emit({ type: 'tapped', count: cur.tappedBy[target].length }, [target]);
        clearAfk();
        return;
      }
      case 'vote': {
        if (state.phase !== 'vote') throw new RoomError('not_now', 'Voting is closed.');
        if (!isParticipant) throw new RoomError('not_now', 'You are not in this round.');
        if (cur.votes[id] !== undefined) throw new RoomError('not_now', 'You already voted.');
        const key = Number(a.key);
        const authorId = cur.order[key];
        if (!authorId || authorId === id || !cur.answers[authorId] || cur.answers[authorId].filler)
          throw new RoomError('bad_action', 'You cannot vote for that one.');
        cur.votes[id] = authorId;
        clearAfk();
        if (everyoneDone(ctx, voters(state, cur, ctx), cur.votes)) finishPhase(state, ctx);
        return;
      }
      case 'accuse': {
        if (state.phase !== 'accuse') throw new RoomError('not_now', 'Accusations are closed.');
        if (!isParticipant) throw new RoomError('not_now', 'You are not in this round.');
        const acc = (cur.accusations[id] ||= { picks: [], nobody: false, locked: false });
        if (acc.locked) throw new RoomError('not_now', 'You already locked in.');
        if (a.nobody) {
          if (cur.range.lo !== 0) throw new RoomError('bad_action', 'There is at least one smuggler this round.');
          acc.picks = [];
          acc.nobody = true;
        } else {
          const ok = accusable(cur, id);
          const picks = [...new Set((Array.isArray(a.picks) ? a.picks : []).filter((p) => typeof p === 'string'))].filter((p) =>
            ok.includes(p),
          );
          if (picks.length > cur.range.hi) throw new RoomError('bad_action', `You can accuse up to ${cur.range.hi}.`);
          acc.picks = picks;
          acc.nobody = false;
        }
        clearAfk();
        return;
      }
      case 'guess': {
        if (state.phase !== 'lineup') throw new RoomError('not_now', 'The lineup is over.');
        if (!isParticipant) throw new RoomError('not_now', 'You are not in this round.');
        if (cur.lineupLocked.has(id)) throw new RoomError('not_now', 'You already locked in.');
        const authorId = String(a.authorId || '');
        const opts = Object.hasOwn(cur.lineupOptions, authorId) ? cur.lineupOptions[authorId] : null;
        if (authorId === id || !Array.isArray(opts)) throw new RoomError('bad_action', 'Not in the lineup.');
        if (!opts.includes(a.word)) throw new RoomError('bad_action', 'Pick one of the four words.');
        (cur.guesses[id] ||= {})[authorId] = a.word;
        clearAfk();
        return;
      }
      case 'lock': {
        if (!isParticipant) throw new RoomError('not_now', 'You are not in this round.');
        if (state.phase === 'accuse') {
          const acc = (cur.accusations[id] ||= { picks: [], nobody: false, locked: false });
          acc.locked = true;
          clearAfk();
          const lockedMap = {};
          for (const [pid, x] of Object.entries(cur.accusations)) if (x.locked) lockedMap[pid] = true;
          if (everyoneDone(ctx, live(state, cur, ctx), lockedMap)) finishPhase(state, ctx);
          return;
        }
        if (state.phase === 'lineup') {
          cur.lineupLocked.add(id);
          clearAfk();
          const lockedMap = {};
          for (const pid of cur.lineupLocked) lockedMap[pid] = true;
          if (everyoneDone(ctx, live(state, cur, ctx), lockedMap)) finishPhase(state, ctx);
          return;
        }
        throw new RoomError('not_now', 'Nothing to lock right now.');
      }
      case 'react': {
        if (!['vote', 'reveal', 'scoreboard', 'accuse', 'lineup'].includes(state.phase)) return;
        const e = ['🔥', '💀', '😂', '👀', '🫣'].includes(a.e) ? a.e : '😂';
        const now = ctx.now();
        if (me.lastReact && now - me.lastReact < 700) return;
        me.lastReact = now;
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

function freshPlayer(round) {
  return {
    timesSmuggled: 0,
    subjectCount: 0,
    wiretaps: T.WIRETAP_START,
    strikes: 0,
    afk: false,
    joinedRound: round,
    acted: false,
    lastReact: 0,
  };
}

// ---------- round flow ----------

function eligible(state, ctx) {
  return ctx
    .players()
    .filter((p) => p.connected && state.players[p.id] && !state.players[p.id].afk)
    .map((p) => p.id);
}

function dealInJoiners(state, ctx, round) {
  const maxSmuggled = Math.max(0, ...Object.values(state.players).map((p) => p.timesSmuggled));
  // Spectators who joined mid-game become players first, so ctx.players() includes them below.
  for (const id of state.pendingJoiners) {
    const p = ctx.player(id);
    if (p) p.spectator = false;
  }
  state.pendingJoiners.clear();
  for (const p of ctx.players()) {
    if (!state.players[p.id]) {
      state.players[p.id] = freshPlayer(round);
      state.players[p.id].timesSmuggled = maxSmuggled;
      state.players[p.id].isNew = true;
    }
  }
}

function tryLeaveWaiting(state, ctx) {
  if (state.phase !== 'waiting') return;
  dealInJoiners(state, ctx, state.round + 1);
  if (eligible(state, ctx).length >= 3) beginRound(state, ctx, state.round + 1);
  else {
    state.waiting = { have: eligible(state, ctx).length, need: 3 };
    ctx.sync();
  }
}

function beginRound(state, ctx, r) {
  dealInJoiners(state, ctx, r);
  for (const p of Object.values(state.players)) p.acted = false;
  let ids = eligible(state, ctx);
  if (ids.length < 3) {
    // Rather than park the room, give connected idle players a fresh start.
    for (const p of ctx.players()) {
      const me = state.players[p.id];
      if (p.connected && me?.afk) {
        me.afk = false;
        me.strikes = 0;
      }
    }
    ids = eligible(state, ctx);
  }
  if (ids.length < 3) {
    state.phase = 'waiting';
    state.phaseId = (state.phaseId || 0) + 1;
    state.waiting = { have: ids.length, need: 3 };
    state.endsAt = null;
    state.duration = null;
    ctx.clearTimer();
    return;
  }
  state.waiting = null;
  state.round = r;
  state.isFinal = r > state.totalRounds;
  const cur = {
    round: r,
    isFinal: state.isFinal,
    tier: tierFor(state.settings.words, r, state.isFinal),
    n: ids.length,
    participants: ids.slice(),
    left: new Set(),
    prompt: null,
    range: null,
    count: 0,
    smugglers: {},
    voided: new Set(),
    drafts: {},
    answers: {},
    wiretaps: {},
    tappedBy: {},
    votes: {},
    accusations: {},
    lineupOptions: {},
    guesses: {},
    lineupLocked: new Set(),
    order: [],
    revealAt: null,
    results: null,
    stamps: {},
  };
  state.cur = cur;
  if (state.isFinal) {
    cur.prompt = finalePrompt(state, ctx);
    cur.range = { lo: ids.length, hi: ids.length };
    cur.count = ids.length;
    for (const id of ids) cur.smugglers[id] = nextWord(ctx, cur.tier);
  } else {
    cur.prompt = nextPrompt(state, ctx, ids);
    const range = rangeFor(r, ids.length);
    cur.range = { lo: range.lo, hi: range.hi };
    cur.count = drawCount(r, ids.length, ctx.rng);
    for (const id of pickSmugglers(state, ids, cur.count, r, ctx.rng)) {
      cur.smugglers[id] = nextWord(ctx, cur.tier);
      state.players[id].timesSmuggled++;
    }
  }
  if (state.mode === 'hardcore' && !state.isFinal) {
    // hardcore never announces the exact count, even in round 1
    const r2 = rangeFor(Math.max(2, r), ids.length);
    cur.range = { lo: r2.lo, hi: r2.hi };
  }
  enterPhase(state, ctx, {
    phase: 'briefing',
    seconds: state.isFinal ? T.BRIEF_FINAL_SECONDS : T.BRIEF_SECONDS,
    onEnd: () => enterWrite(state, ctx),
  });
}

function writeSeconds(state) {
  if (state.mode === 'blitz') return Math.max(10, Math.round(T.WRITE_SECONDS / 2));
  if (state.mode === 'hardcore') return Math.max(10, Math.round(T.WRITE_SECONDS * 0.75));
  return T.WRITE_SECONDS;
}

function enterWrite(state, ctx) {
  enterPhase(state, ctx, { phase: 'write', seconds: writeSeconds(state), onEnd: () => closeWrite(state, ctx) });
}

function closeWrite(state, ctx) {
  const cur = state.cur;
  for (const id of cur.participants) {
    if (cur.answers[id]) continue;
    const d = validAnswer(cur, id, cur.drafts[id]);
    if (d) cur.answers[id] = { text: d, filler: false, auto: true };
    else {
      cur.answers[id] = { text: banks(ctx).fillers.next(), filler: true, auto: false };
      if (cur.smugglers[id]) {
        cur.voided.add(id);
        delete cur.smugglers[id];
      }
    }
  }
  cur.drafts = {};
  cur.order = shuffle(cur.participants, ctx.rng);
  const A = votable(cur).length;
  if (A < 2) return enterJudgement(state, ctx);
  enterPhase(state, ctx, { phase: 'vote', seconds: T.VOTE_SECONDS(A), onEnd: () => enterJudgement(state, ctx) });
}

function enterJudgement(state, ctx) {
  const cur = state.cur;
  const A = votable(cur).length;
  if (cur.isFinal) {
    buildLineupOptions(state, ctx);
    if (A < 2) return enterReveal(state, ctx);
    enterPhase(state, ctx, { phase: 'lineup', seconds: T.LINEUP_SECONDS(A - 1), onEnd: () => enterReveal(state, ctx) });
  } else {
    if (A < 1) return enterReveal(state, ctx);
    enterPhase(state, ctx, { phase: 'accuse', seconds: T.ACCUSE_SECONDS(cur.n), onEnd: () => enterReveal(state, ctx) });
  }
}

function buildLineupOptions(state, ctx) {
  const cur = state.cur;
  const currentWords = new Set(Object.values(cur.smugglers));
  // Decoys must be words that could plausibly be someone's real word: never one already
  // smuggled in this room (players can see those in Most Wanted and would rule them out).
  const fresh = (tier) => (TIERS[tier] || TIER2).filter((w) => !currentWords.has(w) && !ctx.store.usedWords.has(w));
  let pool = shuffle(fresh(cur.tier), ctx.rng);
  for (const t of [1, 2, 3]) if (pool.length < 3 * cur.n && t !== cur.tier) pool = pool.concat(shuffle(fresh(t), ctx.rng));
  if (pool.length < 3)
    pool = pool.concat(
      shuffle(
        (TIERS[cur.tier] || TIER2).filter((w) => !currentWords.has(w)),
        ctx.rng,
      ),
    );
  let idx = 0;
  for (const id of votable(cur)) {
    const real = cur.smugglers[id];
    if (!real) continue;
    const decoys = new Set();
    while (decoys.size < 3 && idx < pool.length) {
      const w = pool[idx++];
      if (w !== real) decoys.add(w);
    }
    cur.lineupOptions[id] = shuffle([real, ...decoys], ctx.rng);
  }
}

function enterReveal(state, ctx) {
  const cur = state.cur;
  cur.results = cur.isFinal ? scoreFinal(state, ctx) : scoreRound(state, ctx);
  cur.revealAt = ctx.now() + T.REVEAL_LEAD_MS;
  const cardCount = cur.order.filter((id) => cur.answers[id]).length;
  enterPhase(state, ctx, {
    phase: 'reveal',
    seconds: T.REVEAL_SECONDS(cardCount, cur.isFinal),
    onEnd: () => (cur.isFinal ? finishGame(state, ctx) : enterScoreboard(state, ctx)),
  });
}

function enterScoreboard(state, ctx) {
  const cur = state.cur;
  applyStrikes(state, cur);
  const underdog = grantUnderdog(state, ctx, cur);
  state.rounds.push(cur);
  const rows = scoreboardRows(state, ctx, cur, underdog);
  state.lastSummary = rows;
  enterPhase(state, ctx, { phase: 'scoreboard', seconds: T.SCOREBOARD_SECONDS, onEnd: () => beginRound(state, ctx, state.round + 1) });
}

function finishGame(state, ctx) {
  state.rounds.push(state.cur);
  const summary = computeAwards(state, ctx);
  if (summary.wordOfTheNight) ctx.note?.(`Word of the Night: ${summary.wordOfTheNight.word} (${summary.wordOfTheNight.name})`);
  ctx.end(summary);
}

function checkEarlyAdvance(state, ctx) {
  const cur = state.cur;
  if (!cur) return;
  const liveIds = live(state, cur, ctx);
  if (state.phase === 'write' && liveIds.length && everyoneDone(ctx, liveIds, cur.answers)) return finishPhase(state, ctx);
  if (state.phase === 'vote') {
    const vs = voters(state, cur, ctx);
    if (vs.length && everyoneDone(ctx, vs, cur.votes)) return finishPhase(state, ctx);
  }
  if (state.phase === 'accuse') {
    const m = {};
    for (const [pid, x] of Object.entries(cur.accusations)) if (x.locked) m[pid] = true;
    if (liveIds.length && everyoneDone(ctx, liveIds, m)) return finishPhase(state, ctx);
  }
  if (state.phase === 'lineup') {
    const m = {};
    for (const pid of cur.lineupLocked) m[pid] = true;
    if (liveIds.length && everyoneDone(ctx, liveIds, m)) return finishPhase(state, ctx);
  }
}

// ---------- scoring ----------

function voteTally(cur) {
  const tally = {};
  const weight = {};
  for (const [voter, author] of Object.entries(cur.votes)) {
    const gold = cur.prompt.subjectId === voter;
    (tally[author] ||= []).push(voter);
    weight[author] = (weight[author] || 0) + (gold ? T.GOLD_WEIGHT : 1);
  }
  return { tally, weight };
}

function scoreRound(state, ctx) {
  const cur = state.cur;
  const per = cur.isFinal ? T.FINAL_FUNNY_VOTE : T.FUNNY_VOTE;
  const { tally, weight } = voteTally(cur);
  const deltas = {};
  const add = (id, key, pts) => {
    if (!pts) return;
    (deltas[id] ||= { funny: 0, smuggle: 0, accuse: 0, lineup: 0 })[key] += pts;
    ctx.award(id, pts);
  };
  for (const id of cur.participants) deltas[id] = { funny: 0, smuggle: 0, accuse: 0, lineup: 0 };

  // funny votes
  for (const id of cur.participants) {
    const w = weight[id] || 0;
    if (w) {
      add(id, 'funny', w * per);
      state.stats.votes[id] = (state.stats.votes[id] || 0) + w;
    }
  }

  const realSmugglers = Object.keys(cur.smugglers);
  const effectiveCount = realSmugglers.length;
  const cleanRound = effectiveCount === 0;
  const accusers = cur.participants.filter((id) => {
    const a = cur.accusations[id];
    return a && (a.picks.length > 0 || a.nobody);
  });
  const accusedBy = {};
  for (const id of accusers) for (const p of cur.accusations[id].picks) (accusedBy[p] ||= []).push(id);
  const nobodyVoters = accusers.filter((id) => cur.accusations[id].nobody);
  const fullBusters = [];

  // accusers
  for (const id of accusers) {
    const a = cur.accusations[id];
    if (a.nobody) {
      if (cleanRound) add(id, 'accuse', T.NOBODY_RIGHT);
      continue;
    }
    const correct = a.picks.filter((p) => cur.smugglers[p]).length;
    const wrong = a.picks.length - correct;
    state.stats.correct[id] = (state.stats.correct[id] || 0) + correct;
    state.stats.wrong[id] = (state.stats.wrong[id] || 0) + wrong;
    let pts = Math.max(0, T.CORRECT_PICK * correct - T.WRONG_PICK * wrong);
    if (effectiveCount >= 1 && correct === effectiveCount && wrong === 0) {
      pts += T.FULL_BUST;
      fullBusters.push(id);
      const me = state.players[id];
      if (me) me.wiretaps = Math.min(T.WIRETAP_CAP, me.wiretaps + 1);
    }
    add(id, 'accuse', pts);
  }

  // smugglers
  const cards = [];
  for (const id of cur.order) {
    const ans = cur.answers[id];
    if (!ans) continue;
    const card = {
      id,
      text: ans.text,
      filler: ans.filler,
      auto: !!ans.auto,
      role: cur.voided.has(id) ? 'voided' : cur.smugglers[id] ? 'smuggler' : 'clean',
      word: cur.smugglers[id] || null,
      votes: tally[id] || [],
      voteWeight: weight[id] || 0,
      goldVoterId: (tally[id] || []).find((v) => v === cur.prompt.subjectId) || null,
      accusedBy: accusedBy[id] || [],
      outcome: 'clean',
      stamp: null,
      delta: deltas[id],
      left: cur.left.has(id),
    };
    const name = ctx.player(id)?.name || 'Someone';
    if (card.role === 'smuggler') {
      const others = accusers.filter((a) => a !== id);
      const n = (accusedBy[id] || []).length;
      const threshold = Math.max(1, Math.ceil(T.BUST_FRACTION * others.length));
      const busted = others.length >= 1 && n >= threshold;
      if (busted) {
        card.outcome = 'busted';
        state.stats.busts[id] = (state.stats.busts[id] || 0) + 1;
        card.stamp = stampLine(state, ctx, 'busted', { word: card.word, name, n });
      } else {
        const ghost = n === 0 && others.length >= 3;
        card.outcome = ghost ? 'ghost' : 'getaway';
        add(id, 'smuggle', T.GETAWAY + (ghost ? T.GHOST : 0));
        state.stats.getaways[id] = (state.stats.getaways[id] || 0) + 1;
        card.stamp = stampLine(state, ctx, ghost ? 'ghost' : 'getaway', { word: card.word, name, n });
      }
      state.stats.mostWanted.push({ word: card.word, id, name, outcome: card.outcome, round: cur.round, votes: card.voteWeight });
    } else if (card.role === 'voided') {
      card.outcome = 'voided';
    }
    cards.push(card);
  }
  let cleanStamp = null;
  if (cleanRound && accusers.length) {
    const worst = accusers
      .filter((a) => !cur.accusations[a].nobody)
      .sort((a, b) => cur.accusations[b].picks.length - cur.accusations[a].picks.length)[0];
    cleanStamp = stampLine(state, ctx, 'clean_round', {
      name: worst ? ctx.player(worst)?.name || 'Someone' : 'Everyone',
      n: worst ? cur.accusations[worst].picks.length : 0,
      word: '',
    });
  }
  const fullBustStamps = fullBusters.map((id) =>
    stampLine(state, ctx, 'full_bust', { name: ctx.player(id)?.name || 'Someone', n: effectiveCount, word: '' }),
  );
  return {
    cards,
    cleanRound,
    nobodyVoters,
    fullBusters,
    cleanStamp,
    fullBustStamps,
    deltas,
    wiretaps: Object.entries(cur.wiretaps).map(([tapperId, targetId]) => ({ tapperId, targetId })),
  };
}

function scoreFinal(state, ctx) {
  const cur = state.cur;
  const { tally, weight } = voteTally(cur);
  const deltas = {};
  for (const id of cur.participants) deltas[id] = { funny: 0, smuggle: 0, accuse: 0, lineup: 0 };
  const add = (id, key, pts) => {
    if (!pts) return;
    (deltas[id] ||= { funny: 0, smuggle: 0, accuse: 0, lineup: 0 })[key] += pts;
    ctx.award(id, pts);
  };
  for (const id of cur.participants) {
    const w = weight[id] || 0;
    if (w) {
      add(id, 'funny', w * T.FINAL_FUNNY_VOTE);
      state.stats.votes[id] = (state.stats.votes[id] || 0) + w;
    }
  }
  const cards = [];
  for (const id of cur.order) {
    const ans = cur.answers[id];
    if (!ans) continue;
    const real = cur.smugglers[id] || null;
    const guesses = {};
    const right = [];
    const fooled = [];
    if (real && !ans.filler) {
      for (const [guesser, g] of Object.entries(cur.guesses)) {
        if (guesser === id || g[id] === undefined) continue;
        guesses[guesser] = g[id];
        if (g[id] === real) right.push(guesser);
        else fooled.push(guesser);
      }
      for (const g of right) add(g, 'lineup', T.LINEUP_CORRECT);
      add(id, 'smuggle', T.FOOLED * fooled.length);
      state.stats.fooled[id] = (state.stats.fooled[id] || 0) + fooled.length;
    }
    const name = ctx.player(id)?.name || 'Someone';
    let stamp = null;
    if (real && !ans.filler && Object.keys(guesses).length) {
      stamp = fooled.length
        ? stampLine(state, ctx, 'fooled', { word: real, name, n: fooled.length })
        : stampLine(state, ctx, 'unfooled', { word: real, name, n: right.length });
    }
    cards.push({
      id,
      text: ans.text,
      filler: ans.filler,
      auto: !!ans.auto,
      role: ans.filler ? 'voided' : 'smuggler',
      word: ans.filler ? null : real,
      votes: tally[id] || [],
      voteWeight: weight[id] || 0,
      goldVoterId: null,
      accusedBy: [],
      outcome: ans.filler ? 'voided' : 'final',
      stamp,
      delta: deltas[id],
      guesses,
      right,
      fooled,
      options: cur.lineupOptions[id] || null,
      left: cur.left.has(id),
    });
    if (real && !ans.filler)
      state.stats.mostWanted.push({
        word: real,
        id,
        name,
        outcome: fooled.length ? 'fooled' : 'seen',
        round: cur.round,
        votes: weight[id] || 0,
        isFinal: true,
      });
  }
  return {
    cards,
    cleanRound: false,
    nobodyVoters: [],
    fullBusters: [],
    cleanStamp: null,
    fullBustStamps: [],
    deltas,
    wiretaps: Object.entries(cur.wiretaps).map(([tapperId, targetId]) => ({ tapperId, targetId })),
  };
}

function applyStrikes(state, cur) {
  for (const id of cur.participants) {
    const p = state.players[id];
    if (!p) continue;
    if (p.acted) {
      p.strikes = 0;
      p.afk = false;
    } else {
      p.strikes++;
      p.afk = p.strikes >= T.AFK_STRIKES;
    }
  }
}

function grantUnderdog(state, ctx, cur) {
  const scores = cur.participants.filter((id) => !cur.left.has(id)).map((id) => ({ id, score: ctx.player(id)?.score ?? 0 }));
  if (!scores.length) return null;
  const min = Math.min(...scores.map((s) => s.score));
  const under = scores.filter((s) => s.score === min).map((s) => s.id);
  const granted = [];
  for (const id of under) {
    const p = state.players[id];
    if (p && p.wiretaps < T.WIRETAP_CAP) {
      p.wiretaps++;
      granted.push({ id, wiretaps: p.wiretaps });
    }
  }
  return granted.length ? granted : null;
}

function scoreboardRows(state, ctx, cur, underdog) {
  const players = ctx.players().filter((p) => state.players[p.id]);
  const rows = players.map((p) => ({
    id: p.id,
    score: p.score,
    delta: sumDelta(cur.results.deltas[p.id]),
    isNew: !!state.players[p.id].isNew && state.players[p.id].joinedRound === cur.round,
  }));
  rows.sort(
    (a, b) =>
      b.score - a.score ||
      (state.stats.votes[b.id] || 0) - (state.stats.votes[a.id] || 0) ||
      (state.stats.getaways[b.id] || 0) - (state.stats.getaways[a.id] || 0),
  );
  const last = state.lastRanks || null;
  rows.forEach((r, i) => {
    r.rank = i + 1;
    // No arrows on the first scoreboard: there was no previous ranking to move from.
    r.prevRank = last && last[r.id] !== undefined ? last[r.id] : r.rank;
  });
  state.lastRanks = Object.fromEntries(rows.map((r) => [r.id, r.rank]));
  for (const p of Object.values(state.players)) p.isNew = false;
  return { rows, mostWanted: state.stats.mostWanted.slice(), underdog, roundsLeft: state.totalRounds - cur.round };
}

function sumDelta(d) {
  if (!d) return 0;
  return (d.funny || 0) + (d.smuggle || 0) + (d.accuse || 0) + (d.lineup || 0);
}

function computeAwards(state, ctx) {
  const nameOf = (id) => ctx.player(id)?.name || 'Someone';
  const avatarOf = (id) => ctx.player(id)?.avatar || '';
  const top = (map, min = 1) => {
    const entries = Object.entries(map).filter(([, v]) => v >= min);
    if (!entries.length) return null;
    const max = Math.max(...entries.map(([, v]) => v));
    return { ids: entries.filter(([, v]) => v === max).map(([id]) => id), n: max };
  };
  const awards = [];
  const push = (key, title, winners, blurb) => {
    if (!winners) return;
    awards.push({ key, title, winners: winners.ids.map((id) => ({ id, name: nameOf(id), avatar: avatarOf(id) })), n: winners.n, blurb });
  };
  const s = state.stats;
  const fav = top(s.votes);
  push('crowd', 'Crowd Favorite', fav, fav ? `${fav.n} laughs. The people have spoken.` : '');
  const ghost = top(s.getaways);
  push('ghost', 'Ghost', ghost, ghost ? `${ghost.n} clean ${ghost.n === 1 ? 'getaway' : 'getaways'}. Never seen, never caught.` : '');
  const hound = top(s.correct);
  push(
    'bloodhound',
    'Bloodhound',
    hound,
    hound ? `${hound.n} correct ${hound.n === 1 ? 'accusation' : 'accusations'}. Trusts nobody.` : '',
  );
  const fooledMost = top(s.wrong);
  push(
    'fooled',
    'Most Fooled',
    fooledMost,
    fooledMost ? `Accused ${fooledMost.n} innocent ${fooledMost.n === 1 ? 'person' : 'people'}. Apologize.` : '',
  );
  const dis = top(s.fooled);
  push('disguise', 'Master of Disguise', dis, dis ? `Fooled ${dis.n} ${dis.n === 1 ? 'person' : 'people'} in the final.` : '');
  let wordOfTheNight = null;
  for (const w of s.mostWanted) {
    if (!wordOfTheNight || w.votes > wordOfTheNight.votes) wordOfTheNight = w;
  }
  let topAnswer = null;
  for (const r of state.rounds) {
    for (const c of r.results?.cards || []) {
      if (c.filler) continue;
      if (!topAnswer || c.voteWeight > topAnswer.votes)
        topAnswer = { text: c.text, name: nameOf(c.id), votes: c.voteWeight, round: r.round };
    }
  }
  const finale = state.cur?.prompt || null;
  // Standings: score, then funny votes, then clean getaways, then who joined first.
  const standings = ctx
    .players()
    .map((p) => p.publicInfo())
    .sort(
      (a, b) =>
        b.score - a.score ||
        (s.votes[b.id] || 0) - (s.votes[a.id] || 0) ||
        (s.getaways[b.id] || 0) - (s.getaways[a.id] || 0) ||
        (ctx.player(a.id)?.joinedAt || 0) - (ctx.player(b.id)?.joinedAt || 0),
    );
  let rank = 0;
  standings.forEach((row, i) => {
    if (i === 0 || row.score !== standings[i - 1].score) rank = i + 1;
    row.rank = rank;
    row.tied = false;
  });
  for (const row of standings) row.tied = standings.filter((r) => r.rank === row.rank).length > 1;
  return {
    standings,
    awards,
    mostWanted: s.mostWanted.slice(),
    wordOfTheNight: wordOfTheNight
      ? {
          ...wordOfTheNight,
          blurb: `“${wordOfTheNight.word}”, smuggled by ${wordOfTheNight.name}, ${wordOfTheNight.votes} ${wordOfTheNight.votes === 1 ? 'vote' : 'votes'}, ${wordOfTheNight.outcome === 'busted' ? 'busted' : wordOfTheNight.outcome === 'fooled' ? 'fooled the room' : wordOfTheNight.outcome === 'seen' ? 'seen through' : 'got away'}.`,
        }
      : null,
    topAnswer,
    finalePrompt: finale ? finale.text : null,
    rounds: state.rounds.length,
  };
}

// ---------- views ----------

function buildView(state, ctx, playerId, isTv) {
  const cur = state.cur;
  const base = {
    phase: state.phase,
    phaseId: state.phaseId,
    endsAt: state.endsAt,
    duration: state.duration,
    round: state.round,
    totalRounds: state.totalRounds,
    isFinal: state.isFinal,
    mode: state.mode || 'classic',
    waiting: state.waiting,
    prompt: null,
    range: null,
    tier: null,
    done: [],
    afk: Object.entries(state.players)
      .filter(([, p]) => p.afk)
      .map(([id]) => id),
    tappedAny: false,
    participants: cur ? cur.participants.filter((id) => !cur.left.has(id)) : [],
    you: null,
    answers: null,
    heat: null,
    lineup: null,
    reveal: null,
    scoreboard: null,
    wiretapCap: T.WIRETAP_CAP,
    answerMax: T.ANSWER_MAX,
  };
  if (!cur) return base;
  const phase = state.phase;
  const afterWrite = ['vote', 'accuse', 'lineup', 'reveal', 'scoreboard'].includes(phase);
  const namesPublic = ['accuse', 'lineup', 'reveal', 'scoreboard'].includes(phase);
  base.prompt = {
    text: cur.prompt.text,
    subjectId: cur.prompt.subjectId,
    callback: cur.prompt.callback ? { round: cur.prompt.callback.round, authorId: cur.prompt.callback.authorId } : null,
  };
  base.range = cur.range;
  base.tier = cur.tier;
  base.tappedAny = Object.keys(cur.wiretaps).length > 0;
  if (phase === 'write') base.done = cur.participants.filter((id) => cur.answers[id]);
  if (phase === 'vote') base.done = Object.keys(cur.votes);
  if (phase === 'accuse')
    base.done = Object.entries(cur.accusations)
      .filter(([, a]) => a.locked)
      .map(([id]) => id);
  if (phase === 'lineup') base.done = [...cur.lineupLocked];
  if (afterWrite) {
    base.answers = cur.order
      .filter((id) => cur.answers[id])
      .map((id, key) => ({
        key,
        id: namesPublic ? id : null,
        text: cur.answers[id].text,
        filler: cur.answers[id].filler,
        auto: !!cur.answers[id].auto,
        mine: playerId ? id === playerId : false,
        left: cur.left.has(id),
      }));
  }
  if (phase === 'accuse') {
    const heat = { nobody: 0 };
    for (const a of Object.values(cur.accusations)) {
      if (a.nobody) heat.nobody++;
      for (const p of a.picks) heat[p] = (heat[p] || 0) + 1;
    }
    base.heat = heat;
    base.lockedCount = base.done.length;
  }
  if (['lineup', 'reveal'].includes(phase) && cur.isFinal) base.lineup = cur.lineupOptions;
  if (['reveal', 'scoreboard'].includes(phase) && cur.results) {
    base.reveal = {
      revealAt: cur.revealAt,
      cardStepMs: T.CARD_STEP_MS,
      cleanRound: cur.results.cleanRound,
      cleanStamp: cur.results.cleanStamp,
      fullBustStamps: cur.results.fullBustStamps,
      nobodyVoters: cur.results.nobodyVoters,
      fullBusters: cur.results.fullBusters,
      wiretaps: cur.results.wiretaps,
      count: Object.keys(cur.smugglers).length,
      cards: cur.results.cards,
    };
  }
  if (phase === 'scoreboard' && state.lastSummary) base.scoreboard = state.lastSummary;

  if (isTv || !playerId) return base;

  const me = state.players[playerId];
  const isParticipant = cur.participants.includes(playerId) && !cur.left.has(playerId);
  if (!me || !isParticipant) {
    base.you = { role: 'spectator', word: null, wiretaps: me?.wiretaps ?? 0 };
    return base;
  }
  const acc = cur.accusations[playerId] || { picks: [], nobody: false, locked: false };
  const revealOn = ['reveal', 'scoreboard'].includes(phase);
  base.you = {
    role: cur.voided.has(playerId) ? 'voided' : cur.smugglers[playerId] ? 'smuggler' : 'clean',
    word: cur.smugglers[playerId] || null,
    draft: phase === 'write' ? cur.drafts[playerId] || '' : '',
    answer: cur.answers[playerId] ? { text: cur.answers[playerId].text, filler: cur.answers[playerId].filler } : null,
    wiretaps: me.wiretaps,
    wiretap: cur.wiretaps[playerId]
      ? {
          targetId: cur.wiretaps[playerId],
          text:
            phase === 'write'
              ? cur.drafts[cur.wiretaps[playerId]] || cur.answers[cur.wiretaps[playerId]]?.text || ''
              : cur.answers[cur.wiretaps[playerId]]?.text || '',
        }
      : null,
    tappedBy: (cur.tappedBy[playerId] || []).length,
    tappedByIds: revealOn ? cur.tappedBy[playerId] || [] : [],
    vote: cur.votes[playerId] !== undefined ? cur.order.indexOf(cur.votes[playerId]) : null,
    picks: acc.picks,
    nobody: acc.nobody,
    locked: phase === 'accuse' ? acc.locked : phase === 'lineup' ? cur.lineupLocked.has(playerId) : false,
    guesses: cur.guesses[playerId] || {},
    isSubject: cur.prompt.subjectId === playerId,
    afk: me.afk,
    strikes: me.strikes,
  };
  return base;
}

export default contraband;
export { buildView, scoreRound, scoreFinal, computeAwards };

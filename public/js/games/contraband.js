// CONTRABAND phone + TV renderer. Pure functions of (view, api); persistent bits live in api.keep().

const TIPS = [
  'Innocents: a weird answer is a decoy. Suspicion is a resource.',
  'Smugglers keep their laugh points even when busted.',
  'Wrong accusations cost 50. Confidence costs nothing.',
  'A boring answer with a strange word in it is a confession.',
  'The funniest answer gets votes. The smoothest one gets away.',
  'Watch who answers fast. Smugglers have a word to place.',
  'You can accuse nobody. Sometimes nobody is right.',
  'Wiretap someone and watch them type. They will know, but not who.',
  'Finish last and you get an extra wiretap. Losing has perks.',
  'In the final everyone smuggles. Guess their words, hide yours.',
];

const REACTIONS = ['😂', '🔥', '💀', '👀', '🫣'];

function pl(n, w, ws = w + 's') {
  return `${n} ${n === 1 ? w : ws}`;
}

function nameOf(api, id) {
  return api.player(id)?.name || 'Someone';
}
function avatarOf(api, id) {
  return api.player(id)?.avatar || '❔';
}

function countBanner(h, v) {
  const r = v.range;
  if (!r) return null;
  if (v.isFinal) return h('div', { class: 'count-banner final' }, 'Everyone is smuggling tonight');
  if (r.lo === r.hi)
    return h('div', { class: 'count-banner' }, r.lo === 1 ? 'There is 1 smuggler among you' : `There are ${r.lo} smugglers among you`);
  return h('div', { class: 'count-banner' }, `Somewhere between ${r.lo} and ${r.hi} of you are smuggling`);
}

function promptCard(h, v, api, { small } = {}) {
  const p = v.prompt;
  if (!p) return null;
  const subject = p.subjectId ? nameOf(api, p.subjectId) : null;
  let text = p.text;
  let nodes = [text];
  if (subject && text.includes(subject)) {
    const i = text.indexOf(subject);
    nodes = [text.slice(0, i), h('b', { class: 'subject' }, subject), text.slice(i + subject.length)];
  }
  return h(
    'div',
    { class: `prompt-card ${small ? 'small' : ''}` },
    h('div', { class: 'eyebrow' }, v.isFinal ? 'Final round · everyone’s dirty' : `Round ${v.round} of ${v.totalRounds}`),
    h('div', { class: 'prompt-text' }, nodes),
    p.callback ? h('div', { class: 'hint' }, `callback: round ${p.callback.round}, by ${nameOf(api, p.callback.authorId)}`) : null,
  );
}

function roleCard(h, v, api) {
  const you = v.you;
  if (!you || you.role === 'spectator')
    return h(
      'div',
      { class: 'role-card spectator' },
      h('div', { class: 'role-title' }, 'WATCHING'),
      h('p', null, 'You are in from the next round.'),
    );
  if (v.isFinal) {
    return h(
      'div',
      { class: 'role-card smuggler final flip-in' },
      h('div', { class: 'role-title' }, 'EVERYONE’S DIRTY'),
      h('p', null, 'You are all smugglers tonight. They will be guessing your word.'),
      h('div', { class: 'role-word' }, you.word),
      h('p', { class: 'small' }, 'Hide it well. Fooling people pays.'),
    );
  }
  if (you.role === 'smuggler') {
    return h(
      'div',
      { class: 'role-card smuggler flip-in' },
      h('div', { class: 'role-title' }, 'SMUGGLER'),
      h('p', null, 'Contraband:'),
      h('div', { class: 'role-word' }, you.word),
      h('p', { class: 'small' }, 'It must appear in your answer. Make it look natural.'),
    );
  }
  return h(
    'div',
    { class: 'role-card clean flip-in' },
    h('div', { class: 'role-title' }, 'YOU’RE CLEAN'),
    h('p', null, 'Write something funny. Spot the smugglers.'),
  );
}

function avatarStrip(h, v, api, doneIds, { label } = {}) {
  const ids = v.participants || [];
  const done = new Set(doneIds || []);
  return h(
    'div',
    { class: 'strip-wrap' },
    label ? h('div', { class: 'progress-row' }, label) : null,
    h(
      'div',
      { class: 'avatar-strip' },
      ids.map((id) => {
        const p = api.player(id);
        const away = p && !p.connected;
        return h(
          'div',
          {
            class: `strip-avatar ${done.has(id) ? 'done' : 'pending'} ${away ? 'away' : ''} ${v.afk?.includes(id) ? 'afk' : ''}`,
            title: p?.name || '',
          },
          h('span', { class: 'strip-emoji' }, p?.avatar || '❔'),
          h('span', { class: 'strip-mark' }, done.has(id) ? '✓' : away ? '·' : '…'),
          h('span', { class: 'strip-name' }, p?.name || ''),
        );
      }),
    ),
  );
}

function reactionBar(h, api) {
  return h(
    'div',
    { class: 'reaction-bar' },
    REACTIONS.map((e) =>
      h(
        'button',
        {
          class: 'react',
          onClick: () => {
            api.send({ type: 'react', e });
            floatEmoji(e, true);
          },
        },
        e,
      ),
    ),
  );
}

function floatEmoji(e, mine = false) {
  const el = document.createElement('div');
  el.className = 'float-emoji' + (mine ? ' mine' : '');
  el.textContent = e;
  el.style.left = `${15 + Math.random() * 70}%`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1900);
}

function heatBar(h, count, total) {
  const pct = total > 0 ? Math.min(100, Math.round((count / total) * 100)) : 0;
  return h(
    'div',
    { class: 'heat' },
    h('div', { class: 'heat-track' }, h('span', { class: 'heat-fill', style: { width: `${pct}%` } })),
    h('span', { class: 'heat-n' }, count || ''),
  );
}

// ---------- phase screens ----------

function renderWaiting(h, v, api) {
  const url = `${location.origin}/r/${api.view.code}`;
  return h(
    'div',
    { class: 'done-card card' },
    h('div', { class: 'check' }, '⏳'),
    h('h2', null, `Waiting for players (${v.waiting?.have ?? 0} of ${v.waiting?.need ?? 3})`),
    h('p', { class: 'muted' }, 'Share the room code so the round can start.'),
    h('div', { class: 'invite-code' }, ...api.view.code.split('').map((ch) => h('span', null, ch))),
    h('p', { class: 'muted small' }, url),
  );
}

function renderBriefing(h, v, api) {
  const tip = TIPS[(v.round * 7 + (v.phaseId || 0)) % TIPS.length];
  return [roleCard(h, v, api), promptCard(h, v, api), countBanner(h, v), h('p', { class: 'tip' }, tip)];
}

function renderWrite(h, v, api) {
  const you = v.you;
  const me = api.me;
  if (!you || you.role === 'spectator')
    return [promptCard(h, v, api), avatarStrip(h, v, api, v.done, { label: `${v.done.length} of ${v.participants.length} in` })];
  const w = api.keep('write', () => ({ text: null, dirty: false, timer: null, tapText: '', sheet: false, round: null }));
  if (w.round !== v.round) {
    w.round = v.round;
    w.text = null;
    w.dirty = false;
    w.tapText = you.wiretap?.text || '';
    w.sheet = false;
  }
  if (w.text === null) w.text = you.draft || '';
  if (!w.timer) {
    w.timer = setInterval(() => {
      if (w.dirty) {
        w.dirty = false;
        api.send({ type: 'draft', text: w.text });
      }
    }, 250);
  }
  const word = you.word;
  const has = word ? w.text.toLowerCase().replace(/\s+/g, ' ').includes(word.toLowerCase()) : true;
  const submitted = !!you.answer;

  if (submitted) {
    return [
      promptCard(h, v, api, { small: true }),
      h(
        'div',
        { class: 'done-card card' },
        h('div', { class: 'check' }, '📨'),
        h('div', { class: 'eyebrow' }, 'Your answer is in'),
        h('div', { class: 'submitted-answer' }, you.answer.text),
        you.tappedBy ? h('div', { class: 'tapped-banner' }, 'SOMEONE TAPPED YOUR LINE') : null,
      ),
      you.wiretap ? tapPanel(h, api, you, w) : null,
      avatarStrip(h, v, api, v.done, { label: `${v.done.length} of ${v.participants.length} in · waiting for the rest` }),
    ];
  }

  const submit = () => {
    const text = (document.getElementById('answer')?.value || w.text).trim();
    if (text.length < 2) return api.toast('Write a little more than that.', 'error');
    if (word && !text.toLowerCase().replace(/\s+/g, ' ').includes(word.toLowerCase()))
      return api.toast(`Your answer must include “${word}”.`, 'error');
    api.send({ type: 'submit', text });
    api.beep('go');
    api.vibrate(20);
  };

  return [
    you.tappedBy
      ? h('div', { class: 'tapped-banner pulse-red' }, `SOMEONE IS TAPPING YOUR LINE${you.tappedBy > 1 ? ` (×${you.tappedBy})` : ''}`)
      : null,
    promptCard(h, v, api, { small: true }),
    you.wiretap ? tapPanel(h, api, you, w) : null,
    h(
      'div',
      { class: 'write-box card' },
      h('textarea', {
        id: 'answer',
        rows: '3',
        maxlength: String(v.answerMax || 70),
        placeholder: v.isFinal ? 'Answer, and hide your word in it…' : word ? `Answer… and sneak in “${word}”` : 'Your funniest answer…',
        autocomplete: 'off',
        autocapitalize: 'sentences',
        enterkeyhint: 'done',
        onInput: (e) => {
          w.text = e.target.value;
          w.dirty = true;
          const pill = document.getElementById('pill');
          if (pill && word) pill.classList.toggle('ok', w.text.toLowerCase().replace(/\s+/g, ' ').includes(word.toLowerCase()));
          const counter = document.getElementById('counter');
          if (counter) counter.textContent = `${w.text.length}/${v.answerMax || 70}`;
        },
        onKeydown: (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            submit();
          }
        },
      }),
      h(
        'div',
        { class: 'write-meta' },
        word
          ? h('span', { id: 'pill', class: `pill ${has ? 'ok' : ''}` }, 'must include: ', h('b', null, word))
          : h('span', { class: 'pill clean' }, 'clean · just be funny'),
        h('span', { id: 'counter', class: 'counter' }, `${w.text.length}/${v.answerMax || 70}`),
      ),
      h('button', { class: 'btn big primary', onClick: submit }, 'Submit'),
      you.isSubject ? h('p', { class: 'hint center' }, 'This one is about you. Your vote counts double.') : null,
    ),
    wiretapControls(h, v, api, you, w),
    avatarStrip(h, v, api, v.done, { label: `${v.done.length} of ${v.participants.length} in` }),
  ];
}

function tapPanel(h, api, you, w) {
  const target = you.wiretap.targetId;
  return h(
    'div',
    { class: 'tap-panel', id: 'tap-panel' },
    h('div', { class: 'eyebrow' }, `🎧 Tapping ${avatarOf(api, target)} ${nameOf(api, target)}`),
    h('div', { class: 'tap-text' }, h('span', { id: 'tap-text' }, w.tapText || ''), h('span', { class: 'caret' }, '▍')),
  );
}

function wiretapControls(h, v, api, you, w) {
  if (you.wiretap) return null;
  const others = v.participants.filter((id) => id !== api.me.id);
  if (w.sheet) {
    return h(
      'div',
      { class: 'sheet card' },
      h('div', { class: 'eyebrow' }, 'Tap whose line?'),
      h('p', { class: 'hint' }, 'They will know someone is listening, but not who.'),
      h(
        'div',
        { class: 'sheet-grid' },
        others.map((id) =>
          h(
            'button',
            {
              class: 'sheet-target',
              onClick: () => {
                w.sheet = false;
                api.send({ type: 'wiretap', targetId: id });
                api.beep('tick');
              },
            },
            h('span', { class: 'p-avatar' }, avatarOf(api, id)),
            h('span', null, nameOf(api, id)),
          ),
        ),
      ),
      h('button', { class: 'btn ghost small', onClick: () => ((w.sheet = false), rerender(api)) }, 'Cancel'),
    );
  }
  const tokens = you.wiretaps || 0;
  return h(
    'div',
    { class: 'wiretap-row' },
    h(
      'button',
      {
        class: `btn wiretap ${tokens > 0 && v.round === 1 ? 'pulse' : ''}`,
        disabled: tokens <= 0 || others.length === 0,
        onClick: () => {
          w.sheet = true;
          rerender(api);
        },
      },
      '🎧 Wiretap',
      h(
        'span',
        { class: 'pips' },
        Array.from({ length: v.wiretapCap || 2 }, (_, i) => h('i', { class: i < tokens ? 'on' : '' })),
      ),
    ),
    h('span', { class: 'hint' }, tokens > 0 ? 'Watch someone type. They’ll know, but not who.' : 'No tokens. Finish last to earn one.'),
  );
}

// Re-render without a new view: nudge the app by dispatching a synthetic event on the root.
function rerender(api) {
  document.dispatchEvent(new CustomEvent('contraband:rerender'));
}

function renderVote(h, v, api) {
  const you = v.you;
  const s = api.keep('vote', () => ({ picked: null, round: null }));
  if (s.round !== v.round) {
    s.round = v.round;
    s.picked = null;
  }
  const voted = you && you.vote !== null && you.vote !== undefined;
  const canVote = you && you.role !== 'spectator' && !voted;
  const cards = (v.answers || []).map((a, i) =>
    h(
      'button',
      {
        class: `choice answer-card deal ${a.filler ? 'filler' : ''} ${a.mine ? 'mine' : ''} ${s.picked === a.key ? 'picked' : ''} ${voted && you.vote === a.key ? 'picked' : ''}`,
        style: { animationDelay: `${i * 120}ms` },
        disabled: !canVote || a.filler || a.mine,
        onClick: () => {
          s.picked = a.key;
          api.beep('tap');
          rerender(api);
        },
      },
      h('span', { class: 'answer-text' }, a.text),
      a.mine ? h('span', { class: 'tag' }, 'yours') : a.filler ? h('span', { class: 'tag' }, 'no answer') : null,
    ),
  );
  return [
    promptCard(h, v, api, { small: true }),
    h(
      'div',
      { class: 'progress-row' },
      canVote ? 'Vote for the funniest answer' : voted ? 'Vote locked. Watching the room…' : 'Watching the vote…',
      h('span', { class: 'muted' }, ` · ${v.done.length} of ${v.participants.length} voted`),
    ),
    you?.isSubject && !voted ? h('div', { class: 'gold-note' }, '⭐ This one is about you. Your vote counts double.') : null,
    h('div', { class: 'choice-list' }, cards),
    canVote
      ? h(
          'button',
          {
            class: 'btn big primary',
            disabled: s.picked === null,
            onClick: () => {
              api.send({ type: 'vote', key: s.picked });
              api.beep('go');
              api.vibrate(20);
            },
          },
          s.picked === null ? 'Pick one' : 'Vote',
        )
      : null,
    reactionBar(h, api),
  ];
}

function renderAccuse(h, v, api) {
  const you = v.you;
  const s = api.keep('accuse', () => ({ picks: null, nobody: false, round: null, sentAt: 0 }));
  if (s.round !== v.round) {
    s.round = v.round;
    s.picks = null;
    s.nobody = false;
  }
  if (s.picks === null) {
    s.picks = (you?.picks || []).slice();
    s.nobody = !!you?.nobody;
  }
  const locked = !!you?.locked;
  const canAct = you && you.role !== 'spectator' && !locked;
  const max = v.range?.hi || 1;
  const total = v.participants.length;
  const sendPicks = () => {
    if (s.nobody) api.send({ type: 'accuse', nobody: true });
    else api.send({ type: 'accuse', picks: s.picks });
  };
  const rows = (v.answers || []).map((a) => {
    const mine = a.id === api.me.id;
    const picked = s.picks.includes(a.id);
    return h(
      'div',
      { class: `accuse-row ${picked ? 'picked' : ''} ${mine ? 'mine' : ''} ${a.filler ? 'filler' : ''}` },
      h(
        'div',
        { class: 'accuse-head' },
        h('span', { class: 'p-avatar' }, avatarOf(api, a.id)),
        h('span', { class: 'p-name' }, nameOf(api, a.id), mine ? h('span', { class: 'muted' }, ' (you)') : null),
        !mine && !a.filler
          ? h(
              'button',
              {
                class: `suspect ${picked ? 'on' : ''}`,
                disabled: !canAct,
                onClick: () => {
                  if (picked) s.picks = s.picks.filter((x) => x !== a.id);
                  else {
                    if (s.picks.length >= max) return api.toast(`You can accuse up to ${max}.`, 'error');
                    s.picks.push(a.id);
                    s.nobody = false;
                  }
                  api.beep('tap');
                  api.vibrate(12);
                  sendPicks();
                  rerender(api);
                },
              },
              picked ? 'SUSPECT ✓' : 'Suspect',
            )
          : null,
      ),
      h('div', { class: 'accuse-answer' }, a.text),
      heatBar(h, v.heat?.[a.id] || 0, total),
    );
  });
  return [
    promptCard(h, v, api, { small: true }),
    countBanner(h, v),
    h(
      'div',
      { class: 'progress-row' },
      locked ? 'Locked in. Heat still rising…' : `Who was smuggling? ${s.picks.length} of ${max} picks`,
      h('span', { class: 'muted' }, ` · ${v.done.length} of ${total} locked`),
    ),
    h('div', { class: 'accuse-list' }, rows),
    v.range?.lo === 0
      ? h(
          'div',
          { class: `nobody-tile ${s.nobody ? 'on' : ''}` },
          h(
            'button',
            {
              class: `choice ${s.nobody ? 'picked' : ''}`,
              disabled: !canAct,
              onClick: () => {
                s.nobody = !s.nobody;
                if (s.nobody) s.picks = [];
                sendPicks();
                api.beep('tap');
                rerender(api);
              },
            },
            h('span', { class: 'answer-text' }, '🕊️ NOBODY is smuggling'),
            h('span', { class: 'tag' }, `${v.heat?.nobody || 0}`),
          ),
        )
      : null,
    canAct
      ? h(
          'button',
          {
            class: 'btn big primary',
            disabled: s.picks.length === 0 && !s.nobody,
            onClick: () => {
              sendPicks();
              api.send({ type: 'lock' });
              api.beep('go');
              api.vibrate([20, 30, 20]);
            },
          },
          'Lock in',
        )
      : null,
    reactionBar(h, api),
  ];
}

function renderLineup(h, v, api) {
  const you = v.you;
  const s = api.keep('lineup', () => ({ open: 0, round: null }));
  if (s.round !== v.round) {
    s.round = v.round;
    s.open = 0;
  }
  const locked = !!you?.locked;
  const canAct = you && you.role !== 'spectator' && !locked;
  const answers = (v.answers || []).filter((a) => !a.filler && a.id !== api.me.id && v.lineup?.[a.id]);
  const guessed = you?.guesses || {};
  const blocks = answers.map((a, i) => {
    const opts = v.lineup[a.id] || [];
    const mine = guessed[a.id];
    const open = s.open === i || !!mine;
    return h(
      'div',
      { class: `lineup-block ${open ? 'open' : ''} ${mine ? 'guessed' : ''}` },
      h(
        'button',
        { class: 'lineup-head', onClick: () => ((s.open = i), rerender(api)) },
        h('span', { class: 'p-avatar' }, avatarOf(api, a.id)),
        h('span', { class: 'p-name' }, nameOf(api, a.id)),
        mine ? h('span', { class: 'tag mint' }, mine) : h('span', { class: 'tag' }, 'pick a word'),
      ),
      h('div', { class: 'lineup-answer' }, a.text),
      h(
        'div',
        { class: 'tiles' },
        opts.map((wd) =>
          h(
            'button',
            {
              class: `tile ${mine === wd ? 'on' : ''}`,
              disabled: !canAct,
              onClick: () => {
                api.send({ type: 'guess', authorId: a.id, word: wd });
                api.beep('tap');
                const next = answers.findIndex((x, j) => j > i && !guessed[x.id]);
                s.open = next >= 0 ? next : i;
              },
            },
            wd,
          ),
        ),
      ),
    );
  });
  const done = Object.keys(guessed).length;
  return [
    promptCard(h, v, api, { small: true }),
    h(
      'div',
      { class: 'progress-row' },
      locked ? 'Locked in. Waiting for the others…' : `Which word was each of them hiding? ${done} of ${answers.length} guessed`,
      h('span', { class: 'muted' }, ` · ${v.done.length} of ${v.participants.length} locked`),
    ),
    h('div', { class: 'lineup-list' }, blocks),
    canAct
      ? h(
          'button',
          { class: 'btn big primary', disabled: done === 0, onClick: () => (api.send({ type: 'lock' }), api.beep('go')) },
          done < answers.length ? `Lock in (${done}/${answers.length})` : 'Lock in',
        )
      : null,
    reactionBar(h, api),
  ];
}

// Reveal choreography is time-based from the server's revealAt, so every screen agrees.
function revealClasses(view, api, i) {
  const r = view.reveal;
  const elapsed = api.now() - r.revealAt;
  const step = r.cardStepMs || 1100;
  const cls = [];
  if (elapsed >= i * step) cls.push('flipped');
  if (elapsed >= i * step + 500) cls.push('stamped');
  return cls.join(' ');
}

function ensureRevealTick(api, view) {
  const t = api.keep('revealTick', () => ({ timer: null, fired: new Set(), key: '' }));
  const key = `${view.round}:${view.reveal?.revealAt}`;
  if (t.key !== key) {
    t.key = key;
    t.fired.clear();
  }
  if (t.timer) return t;
  t.timer = setInterval(() => {
    const cards = document.querySelectorAll('[data-reveal-index]');
    if (!cards.length) return;
    const v = api.view?.game?.view;
    if (!v?.reveal) return;
    cards.forEach((el) => {
      const i = Number(el.dataset.revealIndex);
      const cls = revealClasses(v, api, i);
      const wasStamped = el.classList.contains('stamped');
      el.classList.toggle('flipped', cls.includes('flipped'));
      el.classList.toggle('stamped', cls.includes('stamped'));
      if (!wasStamped && cls.includes('stamped') && !t.fired.has(`${t.key}:${i}`)) {
        t.fired.add(`${t.key}:${i}`);
        api.beep?.(el.dataset.role === 'smuggler' ? 'lose' : 'reveal');
        api.vibrate?.(30);
      }
    });
    const summary = document.getElementById('reveal-summary');
    if (summary) {
      const total = cards.length;
      const elapsed = api.now() - v.reveal.revealAt;
      summary.classList.toggle('show', elapsed >= total * (v.reveal.cardStepMs || 1100) + 300);
    }
  }, 100);
  return t;
}

function revealCard(h, v, api, card, i, { tv } = {}) {
  const word = card.word;
  let text = [card.text];
  if (word && card.text.toLowerCase().includes(word.toLowerCase())) {
    const lower = card.text.toLowerCase();
    const at = lower.indexOf(word.toLowerCase());
    text = [
      card.text.slice(0, at),
      h('mark', { class: 'contra' }, card.text.slice(at, at + word.length)),
      card.text.slice(at + word.length),
    ];
  }
  const stampText =
    card.outcome === 'busted'
      ? 'BUSTED'
      : card.outcome === 'getaway'
        ? 'GOT AWAY'
        : card.outcome === 'ghost'
          ? 'GHOST'
          : card.outcome === 'voided'
            ? 'NO ANSWER'
            : card.outcome === 'final'
              ? 'SMUGGLER'
              : 'CLEAN';
  const delta = (card.delta?.funny || 0) + (card.delta?.smuggle || 0);
  return h(
    'div',
    {
      class: `reveal-card ${revealClasses(v, api, i)} role-${card.role} outcome-${card.outcome}`,
      dataset: { revealIndex: String(i), role: card.role },
    },
    h('div', { class: 'reveal-front' }, h('div', { class: 'answer-text' }, card.text)),
    h(
      'div',
      { class: 'reveal-back' },
      h(
        'div',
        { class: 'who' },
        h('span', { class: 'p-avatar' }, avatarOf(api, card.id)),
        h('span', { class: 'p-name' }, nameOf(api, card.id)),
        card.left ? h('span', { class: 'tag' }, 'left') : null,
        card.auto ? h('span', { class: 'tag' }, 'auto') : null,
      ),
      h('div', { class: 'answer-text' }, text),
      h('div', { class: `stamp ${card.outcome}` }, stampText),
      word ? h('div', { class: 'reveal-word' }, 'contraband: ', h('b', null, word)) : null,
      h(
        'div',
        { class: 'reveal-meta' },
        card.votes?.length
          ? h(
              'span',
              { class: 'meta-group' },
              '😂 ',
              card.votes.map((id) =>
                h('span', { class: `mini-avatar ${id === card.goldVoterId ? 'gold' : ''}`, title: nameOf(api, id) }, avatarOf(api, id)),
              ),
              h('span', { class: 'tag gold' }, `+${card.delta?.funny || 0}`),
            )
          : h('span', { class: 'muted small' }, 'no votes'),
        card.accusedBy?.length
          ? h(
              'span',
              { class: 'meta-group' },
              '👉 ',
              card.accusedBy.map((id) => h('span', { class: 'mini-avatar', title: nameOf(api, id) }, avatarOf(api, id))),
            )
          : null,
        card.outcome === 'final' && card.right
          ? h('span', { class: 'meta-group' }, `🔎 ${card.right.length} guessed it · 🙈 ${card.fooled.length} fooled`)
          : null,
        card.delta?.smuggle ? h('span', { class: 'tag mint' }, `+${card.delta.smuggle}`) : null,
      ),
      card.stamp ? h('div', { class: 'stamp-line' }, card.stamp) : null,
    ),
  );
}

function verdictBanner(h, v, api) {
  const r = v.reveal;
  const me = api.me?.id;
  const card = r.cards.find((c) => c.id === me);
  const you = v.you;
  if (!card || !you || you.role === 'spectator') return null;
  const d = card.delta || {};
  const lines = [];
  if (v.isFinal) {
    lines.push(`Votes +${d.funny || 0}`);
    if (card.fooled) lines.push(`Fooled ${card.fooled.length} · +${d.smuggle || 0}`);
    if (d.lineup) lines.push(`Your guesses +${d.lineup}`);
  } else {
    if (card.outcome === 'getaway') lines.push(`CLEAN GETAWAY +${d.smuggle || 0}`);
    else if (card.outcome === 'ghost') lines.push(`GHOST. Nobody even looked at you. +${d.smuggle || 0}`);
    else if (card.outcome === 'busted') lines.push('BUSTED. They saw right through you.');
    else if (card.outcome === 'voided') lines.push('No answer, no points. Next round.');
    if (you.nobody) lines.push(r.cleanRound ? `Nobody was smuggling. You called it. +${d.accuse || 0}` : 'You said nobody. Somebody was.');
    else if (you.picks?.length) {
      const smugglers = new Set(r.cards.filter((c) => c.role === 'smuggler').map((c) => c.id));
      const correct = you.picks.filter((id) => smugglers.has(id));
      const wrong = you.picks.filter((id) => !smugglers.has(id));
      if (r.cleanRound) lines.push('There were no smugglers. Look what you’ve done.');
      else if (correct.length && !wrong.length && correct.length === r.count)
        lines.push(`You nailed ${pl(correct.length, 'smuggler')} +${d.accuse || 0}`);
      else if (correct.length)
        lines.push(
          `You caught ${correct.map((id) => nameOf(api, id)).join(' & ')}${wrong.length ? `, missed on ${wrong.map((id) => nameOf(api, id)).join(' & ')}` : ''} +${d.accuse || 0}`,
        );
      else lines.push(`You accused ${wrong.map((id) => nameOf(api, id)).join(' & ')} for nothing.`);
    }
    if (d.funny) lines.push(`Laughs +${d.funny}`);
  }
  const total = (d.funny || 0) + (d.smuggle || 0) + (d.accuse || 0) + (d.lineup || 0);
  return h(
    'div',
    { id: 'reveal-summary', class: `verdict ${card.outcome}` },
    lines.map((l) => h('div', { class: 'verdict-line' }, l)),
    h('div', { class: 'verdict-total' }, `+${total} this round`),
    you.tappedByIds?.length
      ? h('div', { class: 'verdict-line small' }, `🎧 Your line was tapped by ${you.tappedByIds.map((id) => nameOf(api, id)).join(' & ')}`)
      : null,
  );
}

function renderReveal(h, v, api, { tv } = {}) {
  ensureRevealTick(api, v);
  const r = v.reveal;
  if (!r) return h('p', null, 'Revealing…');
  const cards = r.cards.map((c, i) => revealCard(h, v, api, c, i, { tv }));
  return [
    promptCard(h, v, api, { small: true }),
    r.cleanRound
      ? h('div', { class: 'count-banner clean' }, 'There were NO smugglers this round')
      : v.isFinal
        ? null
        : h('div', { class: 'count-banner' }, `${pl(r.count, 'smuggler')} this round`),
    h('div', { class: 'reveal-list' }, cards),
    r.cleanStamp ? h('div', { class: 'stamp-line big' }, r.cleanStamp) : null,
    ...(r.fullBustStamps || []).map((s) => h('div', { class: 'stamp-line big gold' }, s)),
    tv ? null : verdictBanner(h, v, api),
    tv ? null : reactionBar(h, api),
  ];
}

function renderScoreboard(h, v, api, { tv } = {}) {
  const sb = v.scoreboard;
  if (!sb) return h('p', null, '…');
  const max = Math.max(1, ...sb.rows.map((r) => r.score));
  return [
    h('h2', { class: 'center' }, `After round ${v.round}`),
    h(
      'ol',
      { class: 'score-rows' },
      sb.rows.map((r) => {
        const arrow = r.prevRank > r.rank ? '▲' : r.prevRank < r.rank ? '▼' : '';
        return h(
          'li',
          { class: `score-row ${r.id === api.me?.id ? 'me' : ''}` },
          h('span', { class: 'rank' }, r.rank),
          h('span', { class: 'p-avatar' }, avatarOf(api, r.id)),
          h('span', { class: 'p-name' }, nameOf(api, r.id), r.isNew ? h('span', { class: 'tag' }, 'new') : null),
          h('span', { class: `arrow ${arrow === '▲' ? 'up' : arrow === '▼' ? 'down' : ''}` }, arrow),
          h(
            'span',
            { class: 'score-bar' },
            h('span', { class: 'score-bar-fill', style: { width: `${Math.round((r.score / max) * 100)}%` } }),
          ),
          h('span', { class: 'score-delta' }, r.delta ? `+${r.delta}` : ''),
          h('span', { class: 'p-score' }, r.score),
        );
      }),
    ),
    sb.underdog?.length
      ? h(
          'div',
          { class: 'underdog' },
          `🎧 ${sb.underdog.map((u) => nameOf(api, u.id)).join(' & ')} got an extra Wiretap for finishing last`,
        )
      : null,
    sb.mostWanted?.length
      ? h(
          'div',
          { class: 'most-wanted' },
          h('div', { class: 'eyebrow' }, 'Most wanted'),
          h(
            'div',
            { class: 'chips' },
            sb.mostWanted.map((w) =>
              h(
                'span',
                { class: `chip ${w.outcome}` },
                h('b', null, w.word),
                ` ${w.name} · ${w.outcome === 'busted' ? 'busted' : w.outcome === 'ghost' ? 'ghost' : 'got away'}`,
              ),
            ),
          ),
        )
      : null,
    h(
      'p',
      { class: 'status-line' },
      sb.roundsLeft > 0 ? `Round ${v.round + 1} of ${v.totalRounds} next` : 'The final round is next. Everyone smuggles.',
    ),
    tv ? null : reactionBar(h, api),
  ];
}

// ---------- TV screens ----------

function tvBriefing(h, v, api) {
  return [
    h('div', { class: 'tv-prompt' }, promptCard(h, v, api)),
    countBanner(h, v),
    h(
      'div',
      { class: 'redacted' },
      h('span', null, 'Smugglers are being briefed'),
      h(
        'div',
        { class: 'redacted-lines' },
        Array.from({ length: 5 }, (_, i) => h('i', { style: { width: `${40 + ((i * 37) % 50)}%` } })),
      ),
    ),
  ];
}
function tvWrite(h, v, api) {
  return [
    h('div', { class: 'tv-prompt' }, promptCard(h, v, api)),
    v.tappedAny ? h('div', { class: 'tapped-banner pulse-red' }, '🎧 LINE TAPPED') : null,
    avatarStrip(h, v, api, v.done, { label: `${v.done.length} of ${v.participants.length} in` }),
  ];
}
function tvVote(h, v, api) {
  const k = api.keep('tvvote', () => ({}));
  const started = (v.endsAt || 0) - (v.duration || 0);
  const elapsed = api.now() - started;
  const per = 2500;
  const answers = v.answers || [];
  const idx = Math.floor(elapsed / per);
  const rolling = idx < answers.length;
  if (!k.timer) {
    k.timer = setInterval(() => {
      if (api.view?.game?.view?.phase === 'vote') rerender(api);
      else {
        clearInterval(k.timer);
        k.timer = null;
      }
    }, 500);
  }
  return [
    h('div', { class: 'tv-prompt' }, promptCard(h, v, api, { small: true })),
    rolling
      ? h(
          'div',
          { class: 'rollcall' },
          h('div', { class: 'eyebrow' }, `Answer ${idx + 1} of ${answers.length}`),
          h('div', { class: 'rollcall-text' }, answers[idx].text),
        )
      : h(
          'div',
          { class: 'wall' },
          answers.map((a) => h('div', { class: `answer-card wall-card ${a.filler ? 'filler' : ''}` }, a.text)),
        ),
    h('div', { class: 'progress-row center' }, `${v.done.length} of ${v.participants.length} voted`),
  ];
}
function tvAccuse(h, v, api) {
  const total = v.participants.length;
  return [
    h('div', { class: 'tv-prompt' }, promptCard(h, v, api, { small: true })),
    countBanner(h, v),
    h(
      'div',
      { class: 'tv-grid' },
      (v.answers || []).map((a) =>
        h(
          'div',
          { class: `accuse-row ${a.filler ? 'filler' : ''}` },
          h(
            'div',
            { class: 'accuse-head' },
            h('span', { class: 'p-avatar' }, avatarOf(api, a.id)),
            h('span', { class: 'p-name' }, nameOf(api, a.id)),
          ),
          h('div', { class: 'accuse-answer' }, a.text),
          heatBar(h, v.heat?.[a.id] || 0, total),
        ),
      ),
    ),
    v.range?.lo === 0 ? h('div', { class: 'progress-row center' }, `🕊️ Nobody: ${v.heat?.nobody || 0}`) : null,
    h('div', { class: 'progress-row center' }, `${v.done.length} of ${total} locked`),
  ];
}
function tvLineup(h, v, api) {
  return [
    h('div', { class: 'tv-prompt' }, promptCard(h, v, api, { small: true })),
    h(
      'div',
      { class: 'tv-grid' },
      (v.answers || [])
        .filter((a) => v.lineup?.[a.id])
        .map((a) =>
          h(
            'div',
            { class: 'lineup-block open' },
            h(
              'div',
              { class: 'lineup-head' },
              h('span', { class: 'p-avatar' }, avatarOf(api, a.id)),
              h('span', { class: 'p-name' }, nameOf(api, a.id)),
            ),
            h('div', { class: 'lineup-answer' }, a.text),
            h(
              'div',
              { class: 'tiles' },
              (v.lineup[a.id] || []).map((w) => h('span', { class: 'tile' }, w)),
            ),
          ),
        ),
    ),
    h('div', { class: 'progress-row center' }, `${v.done.length} of ${v.participants.length} locked`),
  ];
}

function renderHowTo(view, api) {
  const h = api.h;
  return h(
    'div',
    { class: 'howto card' },
    h('div', { class: 'eyebrow' }, 'How to play'),
    h(
      'ol',
      { class: 'howto-list' },
      h('li', null, 'Everyone answers the same ridiculous prompt on their phone.'),
      h('li', null, 'A secret few are smugglers: their answer must hide an assigned word.'),
      h('li', null, 'Vote for the funniest answer, then accuse the smugglers. Laughs and getaways both score.'),
    ),
    h('p', { class: 'muted small' }, 'Best with 5–8 players · about 15 minutes'),
  );
}

function renderSummary(results, api) {
  const h = api.h;
  if (!results?.awards) return null;
  return h(
    'div',
    { class: 'awards' },
    results.awards.map((a, i) =>
      h(
        'div',
        { class: `award flip-in`, style: { animationDelay: `${i * 450}ms` } },
        h('div', { class: 'award-title' }, a.title),
        h('div', { class: 'award-who' }, a.winners.map((w) => `${w.avatar} ${w.name}`).join(' & ')),
        h('div', { class: 'award-blurb' }, a.blurb),
      ),
    ),
    results.wordOfTheNight
      ? h(
          'div',
          { class: 'award gold flip-in', style: { animationDelay: `${results.awards.length * 450}ms` } },
          h('div', { class: 'award-title' }, 'Word of the Night'),
          h('div', { class: 'award-who' }, `“${results.wordOfTheNight.word}”`),
          h('div', { class: 'award-blurb' }, results.wordOfTheNight.blurb),
        )
      : null,
    results.topAnswer
      ? h(
          'div',
          { class: 'award flip-in', style: { animationDelay: `${(results.awards.length + 1) * 450}ms` } },
          h('div', { class: 'award-title' }, 'Funniest answer'),
          h('div', { class: 'award-who' }, `“${results.topAnswer.text}”`),
          h('div', { class: 'award-blurb' }, `${results.topAnswer.name}, round ${results.topAnswer.round}`),
        )
      : null,
    api.tv
      ? null
      : h(
          'button',
          {
            class: 'btn ghost small',
            onClick: async () => {
              const lines = [
                `CONTRABAND recap`,
                ...(results.awards || []).map((a) => `${a.title}: ${a.winners.map((w) => w.name).join(' & ')} — ${a.blurb}`),
              ];
              if (results.wordOfTheNight) lines.push(`Word of the Night: ${results.wordOfTheNight.blurb}`);
              if (results.topAnswer) lines.push(`Funniest answer: "${results.topAnswer.text}" (${results.topAnswer.name})`);
              try {
                await navigator.clipboard.writeText(lines.join('\n'));
                api.toast('Recap copied for the group chat', 'ok');
              } catch {
                api.toast('Could not copy on this browser', 'error');
              }
            },
          },
          'Copy recap',
        ),
  );
}

const renderer = {
  render(view, api) {
    const h = api.h;
    const v = view.game.view;
    switch (v.phase) {
      case 'waiting':
        return renderWaiting(h, v, api);
      case 'briefing':
        return renderBriefing(h, v, api);
      case 'write':
        return renderWrite(h, v, api);
      case 'vote':
        return renderVote(h, v, api);
      case 'accuse':
        return renderAccuse(h, v, api);
      case 'lineup':
        return renderLineup(h, v, api);
      case 'reveal':
        return renderReveal(h, v, api);
      case 'scoreboard':
        return renderScoreboard(h, v, api);
      default:
        return h('p', null, `Unknown phase ${v.phase}`);
    }
  },
  tv(view, api) {
    const h = api.h;
    const v = view.game.view;
    switch (v.phase) {
      case 'waiting':
        return renderWaiting(h, v, api);
      case 'briefing':
        return tvBriefing(h, v, api);
      case 'write':
        return tvWrite(h, v, api);
      case 'vote':
        return tvVote(h, v, api);
      case 'accuse':
        return tvAccuse(h, v, api);
      case 'lineup':
        return tvLineup(h, v, api);
      case 'reveal':
        return renderReveal(h, v, api, { tv: true });
      case 'scoreboard':
        return renderScoreboard(h, v, api, { tv: true });
      default:
        return h('p', null, '…');
    }
  },
  onEvent(e, api) {
    if (e.type === 'draft') {
      const w = api.keep('write', () => ({ text: null, dirty: false, timer: null, tapText: '', sheet: false, round: null }));
      w.tapText = e.text;
      const el = document.getElementById('tap-text');
      if (el) el.textContent = e.text;
    } else if (e.type === 'tapped') {
      api.vibrate?.([60, 40, 60]);
      api.beep?.('lose');
    } else if (e.type === 'react') {
      if (e.from !== api.me?.id) floatEmoji(e.e);
    }
  },
  renderSummary,
  renderHowTo,
};

export default renderer;

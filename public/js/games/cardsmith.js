// CARDSMITH phone + TV renderer.

function nameOf(api, id) {
  return api.player(id)?.name || 'Someone';
}
function avatarOf(api, id) {
  return api.player(id)?.avatar || '❔';
}

function blackCard(h, text, big) {
  const parts = String(text || '').split('____');
  const nodes = [];
  parts.forEach((p, i) => {
    nodes.push(p);
    if (i < parts.length - 1) nodes.push(h('span', { class: 'blank' }, '______'));
  });
  return h('div', { class: `black-card ${big ? 'big' : ''}` }, h('div', { class: 'black-text' }, nodes));
}

function strip(h, v, api, doneIds, label) {
  const done = new Set(doneIds || []);
  return h(
    'div',
    { class: 'strip-wrap' },
    label ? h('div', { class: 'progress-row' }, label) : null,
    h(
      'div',
      { class: 'avatar-strip' },
      v.participants.map((id) => {
        const p = api.player(id);
        return h(
          'div',
          {
            class: `strip-avatar ${done.has(id) ? 'done' : 'pending'} ${p && !p.connected ? 'away' : ''} ${v.judgeId === id ? 'judge' : ''}`,
          },
          h('span', { class: 'strip-emoji' }, p?.avatar || '❔'),
          h('span', { class: 'strip-mark' }, done.has(id) ? '✓' : v.judgeId === id && v.phase !== 'forge' ? '⚖' : '…'),
          h('span', { class: 'strip-name' }, p?.name || ''),
        );
      }),
    ),
  );
}

function rerender() {
  document.dispatchEvent(new CustomEvent('contraband:rerender'));
}

function themeLine(h, v) {
  return h(
    'div',
    { class: 'eyebrow' },
    v.theme ? `Theme: ${v.theme}` : 'Theme: anything goes',
    v.aiStatus === 'pending' ? ' · AI is writing extra cards…' : v.aiStatus === 'done' ? ' · AI cards added' : '',
  );
}

function renderForge(h, v, api) {
  const you = v.you;
  const w = api.keep('forge', () => ({ text: '' }));
  if (!you || you.role === 'spectator')
    return [themeLine(h, v), h('p', { class: 'status-line' }, 'The room is writing cards. You are in from the next game.')];
  const mine = you.written || [];
  const left = v.quota - mine.length;
  const submit = () => {
    const text = (document.getElementById('cardtext')?.value || w.text).trim();
    if (text.length < 2) return api.toast('Write a little more than that.', 'error');
    api.send({ type: 'card', text });
    w.text = '';
    const el = document.getElementById('cardtext');
    if (el) {
      el.value = '';
      el.focus();
    }
    api.beep('tap');
  };
  return [
    themeLine(h, v),
    h(
      'div',
      { class: 'prompt-card' },
      h('div', { class: 'prompt-text' }, left > 0 ? `Write ${left} more answer ${left === 1 ? 'card' : 'cards'}` : 'Your cards are in'),
      h(
        'p',
        { class: 'hint' },
        `Short, specific, a little unhinged. They go into everyone’s hands. Prompts look like: “The real reason I was late today: ____”.`,
      ),
    ),
    left > 0
      ? h(
          'div',
          { class: 'write-box card' },
          h('input', {
            id: 'cardtext',
            type: 'text',
            maxlength: '60',
            placeholder: 'e.g. a raccoon with a lanyard',
            autocomplete: 'off',
            enterkeyhint: 'send',
            onInput: (e) => (w.text = e.target.value),
            onKeydown: (e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                submit();
              }
            },
          }),
          h('button', { class: 'btn primary block', onClick: submit }, 'Add card'),
        )
      : h(
          'div',
          { class: 'done-card card' },
          h('div', { class: 'check' }, '🃏'),
          h('div', { class: 'eyebrow' }, 'Waiting for the others'),
          h('p', { class: 'muted' }, 'Hands are dealt when everyone is done.'),
        ),
    mine.length
      ? h(
          'ul',
          { class: 'my-cards' },
          mine.map((t, i) =>
            h(
              'li',
              { class: 'white-card small' },
              h('span', null, t),
              h('button', { class: 'kick', title: 'Remove', onClick: () => api.send({ type: 'uncard', index: i }) }, '×'),
            ),
          ),
        )
      : null,
    strip(h, v, api, v.done, `${v.done.length} of ${v.participants.length} finished · ${v.quota} cards each`),
  ];
}

function renderPick(h, v, api) {
  const you = v.you;
  const s = api.keep('pick', () => ({ sel: null, round: null }));
  if (s.round !== v.round) {
    s.round = v.round;
    s.sel = null;
  }
  const isJudge = you?.role === 'judge';
  const judgeName = v.judgeId ? nameOf(api, v.judgeId) : null;
  const header = [
    h(
      'div',
      { class: 'eyebrow' },
      `Round ${v.round} of ${v.totalRounds}${judgeName ? ` · ${v.judgeId === api.me?.id ? 'You are' : judgeName + ' is'} the judge` : ' · everyone votes'}`,
    ),
    blackCard(h, v.black, true),
  ];
  if (!you || you.role === 'spectator') return [...header, strip(h, v, api, v.done, `${v.done.length} in`)];
  if (isJudge)
    return [
      ...header,
      h(
        'div',
        { class: 'done-card card' },
        h('div', { class: 'check' }, '⚖️'),
        h('h2', null, 'You judge this round'),
        h('p', { class: 'muted' }, 'Sit back. The cards land on your phone when everyone has played.'),
      ),
      strip(h, v, api, v.done, `${v.done.length} of ${v.participants.length - 1} played`),
    ];
  if (you.played)
    return [
      ...header,
      h(
        'div',
        { class: 'done-card card' },
        h('div', { class: 'eyebrow' }, 'You played'),
        h('div', { class: 'white-card picked' }, you.played.text),
      ),
      strip(h, v, api, v.done, `${v.done.length} played · waiting for the rest`),
    ];
  return [
    ...header,
    h('div', { class: 'progress-row' }, 'Pick the card that fills the blank best'),
    h(
      'div',
      { class: 'hand' },
      you.hand.map((c) =>
        h(
          'button',
          {
            class: `white-card ${s.sel === c.id ? 'picked' : ''}`,
            onClick: () => {
              s.sel = c.id;
              api.beep('tap');
              rerender();
            },
          },
          c.text,
          c.mine ? h('span', { class: 'tag mint' }, 'yours') : null,
        ),
      ),
    ),
    h(
      'button',
      { class: 'btn big primary', disabled: !s.sel, onClick: () => (api.send({ type: 'play', cardId: s.sel }), api.beep('go')) },
      s.sel ? 'Play this card' : 'Pick a card',
    ),
  ];
}

function renderJudge(h, v, api) {
  const you = v.you;
  const s = api.keep('judge', () => ({ sel: null, round: null }));
  if (s.round !== v.round) {
    s.round = v.round;
    s.sel = null;
  }
  const isJudge = v.mode === 'czar' && v.judgeId === api.me?.id;
  const canVote = v.mode === 'vote' && you && you.role !== 'spectator' && you.myKey >= 0 && you.vote === null;
  const acting = isJudge || canVote;
  const title =
    v.mode === 'czar'
      ? isJudge
        ? 'Crown the winner'
        : `${nameOf(api, v.judgeId)} is judging…`
      : canVote
        ? 'Vote for the best card'
        : you?.vote !== null && you?.vote !== undefined
          ? 'Vote locked'
          : 'The room is voting…';
  return [
    h('div', { class: 'eyebrow' }, `Round ${v.round} of ${v.totalRounds}`),
    blackCard(h, v.black, false),
    h('div', { class: 'progress-row' }, title, v.mode === 'vote' ? h('span', { class: 'muted' }, ` · ${v.done.length} voted`) : null),
    h(
      'div',
      { class: 'choice-list' },
      (v.plays || []).map((p, i) =>
        h(
          'button',
          {
            class: `white-card deal ${s.sel === p.key ? 'picked' : ''} ${you?.myKey === p.key ? 'mine' : ''} ${you?.vote === p.key ? 'picked' : ''}`,
            style: { animationDelay: `${i * 100}ms` },
            disabled: !acting || you?.myKey === p.key,
            onClick: () => {
              s.sel = p.key;
              api.beep('tap');
              rerender();
            },
          },
          p.text,
          you?.myKey === p.key ? h('span', { class: 'tag' }, 'yours') : null,
        ),
      ),
    ),
    acting
      ? h(
          'button',
          {
            class: 'btn big primary',
            disabled: s.sel === null,
            onClick: () => (api.send({ type: isJudge ? 'crown' : 'vote', key: s.sel }), api.beep('go')),
          },
          isJudge ? 'Crown it' : 'Vote',
        )
      : null,
  ];
}

function renderReveal(h, v, api, { tv } = {}) {
  const r = v.reveal;
  if (!r) return h('p', null, '…');
  const winner = r.cards.find((c) => c.won);
  return [
    h('div', { class: 'eyebrow' }, `Round ${v.round} of ${v.totalRounds}`),
    blackCard(h, v.black, false),
    winner
      ? h(
          'div',
          { class: 'winner-card' },
          h('div', { class: 'eyebrow' }, 'Winner'),
          h('div', { class: 'white-card picked big' }, winner.text),
          h(
            'div',
            { class: 'who' },
            `${avatarOf(api, winner.playerId)} ${nameOf(api, winner.playerId)} +${winner.points}`,
            winner.authorId && winner.authorId !== winner.playerId
              ? h('span', { class: 'tag gold' }, `written by ${nameOf(api, winner.authorId)} +${winner.authorBonus}`)
              : winner.source === 'ai'
                ? h('span', { class: 'tag' }, 'AI card')
                : null,
          ),
        )
      : h('p', { class: 'status-line' }, 'Nobody played a card this round.'),
    h(
      'div',
      { class: 'reveal-list' },
      r.cards
        .filter((c) => !c.won)
        .map((c) =>
          h(
            'div',
            { class: 'reveal-item' },
            h('div', { class: 'text' }, c.text),
            h(
              'div',
              { class: 'who' },
              `${avatarOf(api, c.playerId)} ${nameOf(api, c.playerId)}`,
              c.votes ? h('span', { class: 'tag mint' }, `${c.votes} ${c.votes === 1 ? 'vote' : 'votes'}`) : null,
              c.authorId && c.authorId !== c.playerId
                ? h('span', { class: 'tag' }, `by ${nameOf(api, c.authorId)}`)
                : c.source === 'ai'
                  ? h('span', { class: 'tag' }, 'AI')
                  : null,
            ),
          ),
        ),
    ),
    h('div', { class: 'progress-row center muted' }, v.round < v.totalRounds ? `Round ${v.round + 1} next` : 'Final scores next'),
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
      h('li', null, 'The host types a theme. Everyone writes a few answer cards about it.'),
      h('li', null, 'Each round shows a fill-in-the-blank prompt. Play the best card from your hand.'),
      h('li', null, 'A rotating judge (or a vote) crowns the winner. Your cards can win in other people’s hands.'),
    ),
    h('p', { class: 'muted small' }, 'Best with 4–8 players · about 20 minutes · AI tops up the deck when the server has a key'),
  );
}

const rules = {
  name: 'Cardsmith',
  summary:
    'A fill-in-the-blank card game where the room writes its own deck. Pick a theme, write cards about your friends, your school, your office, whatever. The server adds AI-written cards on the same theme (or a built-in bank), deals everyone a hand, and the funniest card wins each round.',
  steps: [
    { title: 'Theme.', text: 'The host types a theme in the lobby. Leave it blank for a general deck.' },
    {
      title: 'Write cards (2.5 min).',
      text: 'Everyone writes short answer cards. Ten each with three players, down to three each with a full room. Short, specific, a little unhinged.',
    },
    { title: 'Deal.', text: 'All the cards are shuffled together with the AI or bank cards. Everyone gets a hand of seven.' },
    { title: 'Play.', text: 'A prompt card with a blank appears. Everyone but the judge plays one card from their hand. Hands refill.' },
    {
      title: 'Judge.',
      text: 'The rotating judge crowns the funniest card without knowing who played it. Or switch the setting so everyone votes.',
    },
    { title: 'Reveal.', text: 'Names come out. If the winning card was written by someone else in the room, they get a bonus too.' },
  ],
  scoring: [
    '+100 for winning a round.',
    '+50 to the author when their card wins in someone else’s hand.',
    'In vote mode, +50 per vote your card receives on top.',
  ],
  tips: [
    'Write cards that could answer many prompts, not one specific joke.',
    'Inside jokes win rooms. Generic cards win nothing.',
    'Your own card in your own hand is fair play.',
  ],
};

const renderer = {
  rules,
  render(view, api) {
    const h = api.h;
    const v = view.game.view;
    switch (v.phase) {
      case 'forge':
        return renderForge(h, v, api);
      case 'pick':
        return renderPick(h, v, api);
      case 'judge':
        return renderJudge(h, v, api);
      case 'reveal':
        return renderReveal(h, v, api);
      default:
        return h('p', null, `…`);
    }
  },
  tv(view, api) {
    const h = api.h;
    const v = view.game.view;
    switch (v.phase) {
      case 'forge':
        return [
          themeLine(h, v),
          h('h2', { class: 'center' }, 'Everyone is writing cards'),
          strip(h, v, api, v.done, `${v.done.length} of ${v.participants.length} finished · ${v.quota} cards each`),
        ];
      case 'pick':
        return [
          h(
            'div',
            { class: 'eyebrow center' },
            `Round ${v.round} of ${v.totalRounds}${v.judgeId ? ` · judge: ${nameOf(api, v.judgeId)}` : ''}`,
          ),
          blackCard(h, v.black, true),
          strip(h, v, api, v.done, `${v.done.length} played`),
        ];
      case 'judge':
        return [
          blackCard(h, v.black, true),
          h(
            'div',
            { class: 'wall' },
            (v.plays || []).map((p) => h('div', { class: 'white-card wall-card' }, p.text)),
          ),
          h('div', { class: 'progress-row center' }, v.mode === 'czar' ? `${nameOf(api, v.judgeId)} is judging` : `${v.done.length} voted`),
        ];
      case 'reveal':
        return renderReveal(h, v, api, { tv: true });
      default:
        return h('p', null, '…');
    }
  },
  onEvent(e, api) {
    if (e.type === 'react' && e.from !== api.me?.id) {
      const el = document.createElement('div');
      el.className = 'float-emoji';
      el.textContent = e.e;
      el.style.left = `${15 + Math.random() * 70}%`;
      document.body.appendChild(el);
      setTimeout(() => el.remove(), 1900);
    }
  },
  renderSummary(results, api) {
    const h = api.h;
    if (!results?.hallOfFame) return null;
    return h(
      'div',
      { class: 'awards' },
      results.theme
        ? h(
            'div',
            { class: 'award' },
            h('div', { class: 'award-title' }, 'Theme'),
            h('div', { class: 'award-who' }, results.theme),
            h(
              'div',
              { class: 'award-blurb' },
              results.aiUsed ? 'Deck written by the room plus AI.' : 'Deck written by the room plus the house bank.',
            ),
          )
        : null,
      (results.awards || []).map((a, i) =>
        h(
          'div',
          { class: 'award flip-in', style: { animationDelay: `${i * 400}ms` } },
          h('div', { class: 'award-title' }, a.title),
          h('div', { class: 'award-who' }, a.winners.map((w) => `${w.avatar} ${w.name}`).join(' & ')),
          h('div', { class: 'award-blurb' }, a.blurb),
        ),
      ),
      results.hallOfFame.length
        ? h(
            'div',
            { class: 'award' },
            h('div', { class: 'award-title' }, 'Winning cards'),
            h(
              'ul',
              { class: 'help-list' },
              results.hallOfFame.map((c) => h('li', null, h('b', null, c.text), ` — ${c.black.replace('____', '…')} (${c.name})`)),
            ),
          )
        : null,
    );
  },
  renderHowTo,
};

export default renderer;

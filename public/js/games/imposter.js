// IMPOSTER phone + TV renderer.

function nameOf(api, id) {
  return api.player(id)?.name || 'Someone';
}
function avatarOf(api, id) {
  return api.player(id)?.avatar || '❔';
}
function rerender() {
  document.dispatchEvent(new CustomEvent('contraband:rerender'));
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
          { class: `strip-avatar ${done.has(id) ? 'done' : 'pending'} ${p && !p.connected ? 'away' : ''}` },
          h('span', { class: 'strip-emoji' }, p?.avatar || '❔'),
          h('span', { class: 'strip-mark' }, done.has(id) ? '✓' : '…'),
          h('span', { class: 'strip-name' }, p?.name || ''),
        );
      }),
    ),
  );
}

function secretCard(h, v) {
  const you = v.you;
  if (!you || you.role === 'spectator')
    return h(
      'div',
      { class: 'role-card spectator' },
      h('div', { class: 'role-title' }, 'WATCHING'),
      h('p', null, 'You are in from the next round.'),
    );
  return h(
    'div',
    { class: 'role-card secret flip-in' },
    h('div', { class: 'eyebrow' }, 'Your secret prompt'),
    h('div', { class: 'role-word prompt' }, you.prompt),
    h('p', { class: 'small' }, 'Everyone got a prompt like this. One of you got a slightly different one. Maybe you.'),
  );
}

function renderSecret(h, v, api) {
  return [
    h('div', { class: 'eyebrow' }, `Round ${v.round} of ${v.totalRounds}`),
    secretCard(h, v),
    h('p', { class: 'tip' }, 'Answer in a word or two. Fit in without giving the prompt away.'),
  ];
}

function renderAnswer(h, v, api) {
  const you = v.you;
  const w = api.keep('imp-answer', () => ({ text: '', round: null }));
  if (w.round !== v.round) {
    w.round = v.round;
    w.text = '';
  }
  if (!you || you.role === 'spectator')
    return [
      h('div', { class: 'eyebrow' }, `Round ${v.round}`),
      strip(h, v, api, v.done, `${v.done.length} of ${v.participants.length} answered`),
    ];
  if (you.answer)
    return [
      h('div', { class: 'eyebrow' }, `Round ${v.round} of ${v.totalRounds}`),
      h('div', { class: 'prompt-card small' }, h('div', { class: 'hint' }, 'Your prompt'), h('div', { class: 'prompt-text' }, you.prompt)),
      h(
        'div',
        { class: 'done-card card' },
        h('div', { class: 'eyebrow' }, 'Your answer'),
        h('div', { class: 'submitted-answer' }, you.answer),
      ),
      strip(h, v, api, v.done, `${v.done.length} of ${v.participants.length} answered`),
    ];
  const submit = () => {
    const text = (document.getElementById('imp-text')?.value || w.text).trim();
    if (!text) return api.toast('Type a word.', 'error');
    api.send({ type: 'answer', text });
    api.beep('go');
  };
  return [
    h('div', { class: 'eyebrow' }, `Round ${v.round} of ${v.totalRounds}`),
    h('div', { class: 'prompt-card' }, h('div', { class: 'hint' }, 'Your prompt'), h('div', { class: 'prompt-text' }, you.prompt)),
    h(
      'div',
      { class: 'write-box card' },
      h('input', {
        id: 'imp-text',
        type: 'text',
        maxlength: '24',
        placeholder: 'One or two words',
        autocomplete: 'off',
        enterkeyhint: 'done',
        onInput: (e) => (w.text = e.target.value),
        onKeydown: (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            submit();
          }
        },
      }),
      h('button', { class: 'btn big primary', onClick: submit }, 'Lock answer'),
    ),
    strip(h, v, api, v.done, `${v.done.length} of ${v.participants.length} answered`),
  ];
}

function answerWall(h, v, api, { selectable, selected, onPick, showVotes } = {}) {
  return h(
    'div',
    { class: 'imp-wall' },
    (v.answers || []).map((a) => {
      const mine = a.id === api.me?.id;
      const votes = showVotes ? v.reveal?.tally?.[a.id] || 0 : 0;
      const isImp = v.reveal && v.reveal.imposterId === a.id;
      return h(
        'button',
        {
          class: `imp-answer ${mine ? 'mine' : ''} ${selected === a.id ? 'picked' : ''} ${isImp ? 'imposter' : ''}`,
          disabled: !selectable || mine,
          onClick: () => onPick && onPick(a.id),
        },
        h('span', { class: 'p-avatar' }, avatarOf(api, a.id)),
        h('span', { class: 'imp-name' }, nameOf(api, a.id), mine ? h('span', { class: 'muted' }, ' (you)') : null),
        h('span', { class: 'imp-text' }, a.text),
        showVotes && votes ? h('span', { class: 'tag coral' }, `${votes} ${votes === 1 ? 'vote' : 'votes'}`) : null,
        isImp ? h('span', { class: 'tag coral' }, 'IMPOSTER') : null,
      );
    }),
  );
}

function renderVote(h, v, api) {
  const you = v.you;
  const canVote = you && you.role !== 'spectator';
  return [
    h('div', { class: 'eyebrow' }, `Round ${v.round} of ${v.totalRounds}`),
    h(
      'div',
      { class: 'prompt-card small' },
      h('div', { class: 'prompt-text' }, 'Who got the other prompt?'),
      h('p', { class: 'hint' }, 'Talk it out. Whose answer does not fit? You can change your vote until time runs out.'),
    ),
    answerWall(h, v, api, {
      selectable: canVote,
      selected: you?.vote,
      onPick: (id) => {
        api.send({ type: 'vote', targetId: id });
        api.beep('tap');
        api.vibrate(12);
      },
    }),
    h('div', { class: 'progress-row center' }, `${v.done.length} of ${v.participants.length} voted`),
  ];
}

function renderGuess(h, v, api) {
  const you = v.you;
  if (you?.canGuess) {
    return [
      h(
        'div',
        { class: 'role-card smuggler' },
        h('div', { class: 'role-title' }, 'CAUGHT'),
        h('p', null, 'You were the imposter. Steal it back: which prompt did everyone else have?'),
      ),
      h(
        'div',
        { class: 'choice-list' },
        (v.guessOptions || []).map((o) =>
          h(
            'button',
            { class: 'choice', onClick: () => (api.send({ type: 'guess', text: o }), api.beep('go')) },
            h('span', { class: 'answer-text' }, o),
          ),
        ),
      ),
    ];
  }
  return [
    h('div', { class: 'eyebrow' }, `Round ${v.round} of ${v.totalRounds}`),
    h(
      'div',
      { class: 'done-card card' },
      h('div', { class: 'check' }, '🕵️'),
      h('h2', null, 'The imposter is caught'),
      h('p', { class: 'muted' }, 'They get one guess at the crew’s prompt to steal points.'),
    ),
    answerWall(h, v, api, {}),
  ];
}

function renderReveal(h, v, api) {
  const r = v.reveal;
  if (!r) return h('p', null, '…');
  const imp = r.imposterId;
  const me = api.me?.id;
  const myDelta = r.deltas?.[me] || 0;
  return [
    h('div', { class: 'eyebrow' }, `Round ${v.round} of ${v.totalRounds}`),
    h(
      'div',
      { class: `count-banner ${r.caught ? 'clean' : 'final'}` },
      `${avatarOf(api, imp)} ${nameOf(api, imp)} was the imposter · ${r.left ? 'left the room' : r.caught ? 'CAUGHT' : 'GOT AWAY'}`,
    ),
    h(
      'div',
      { class: 'prompt-card small' },
      h('div', { class: 'hint' }, 'Crew prompt'),
      h('div', { class: 'prompt-text' }, r.crew),
      h('div', { class: 'hint' }, 'Imposter prompt'),
      h('div', { class: 'prompt-text coral' }, r.imposterPrompt),
    ),
    r.caught && r.guess !== null && r.guess !== undefined
      ? h(
          'div',
          { class: 'stamp-line big' },
          r.guessRight
            ? `${nameOf(api, imp)} guessed the crew prompt and steals +${150}`
            : `${nameOf(api, imp)} guessed “${r.guess}”. Wrong.`,
        )
      : null,
    answerWall(h, v, api, { showVotes: true }),
    me && v.participants.includes(me)
      ? h(
          'div',
          { class: 'verdict show' },
          h(
            'div',
            { class: 'verdict-line' },
            me === imp
              ? r.caught
                ? 'They got you.'
                : 'Nobody suspected a thing.'
              : r.votes?.[me] === imp
                ? 'You called it.'
                : r.caught
                  ? 'The room caught them without you.'
                  : 'Fooled.',
          ),
          h('div', { class: 'verdict-total' }, `+${myDelta} this round`),
        )
      : null,
  ];
}

const rules = {
  name: 'Imposter',
  summary:
    'Everyone secretly gets the same short prompt, except one player who gets a slightly different one and does not know it. Answer in a word or two, then vote out whoever does not fit.',
  steps: [
    {
      title: 'Secret.',
      text: 'Your phone shows your prompt, for example “A food you eat with your hands”. One player got a cousin of it, like “A food you eat with a spoon”.',
    },
    {
      title: 'Answer (30 s).',
      text: 'Type one or two words. Be specific enough to prove you belong, vague enough not to give the prompt away.',
    },
    {
      title: 'Vote (60 s).',
      text: 'All answers appear with names. Talk. Tap the person whose answer smells wrong; change your mind as often as you like.',
    },
    { title: 'Guess.', text: 'A caught imposter gets one guess at the crew’s prompt from three options to steal points back.' },
  ],
  scoring: [
    '+100 for every crew member who voted for the imposter (when caught).',
    '+300 for an imposter who is not caught, +25 for each crew member nobody suspected.',
    '+150 for a caught imposter who guesses the crew’s prompt.',
  ],
  tips: [
    'The imposter does not know they are the imposter. Neither do you.',
    'An answer that fits both prompts is the safest. And the most suspicious.',
    'The vote needs a clear plurality: ties with one vote each catch nobody.',
  ],
};

function renderHowTo(view, api) {
  const h = api.h;
  return h(
    'div',
    { class: 'howto card' },
    h('div', { class: 'eyebrow' }, 'How to play'),
    h(
      'ol',
      { class: 'howto-list' },
      h('li', null, 'Everyone gets a secret prompt. One player secretly gets a slightly different one.'),
      h('li', null, 'Answer in a word or two, then all answers appear with names.'),
      h('li', null, 'Vote out the imposter. A caught imposter can guess the real prompt to steal points.'),
    ),
    h('p', { class: 'muted small' }, 'Best with 4–8 players · about 12 minutes'),
  );
}

const renderer = {
  rules,
  render(view, api) {
    const h = api.h;
    const v = view.game.view;
    switch (v.phase) {
      case 'secret':
        return renderSecret(h, v, api);
      case 'answer':
        return renderAnswer(h, v, api);
      case 'vote':
        return renderVote(h, v, api);
      case 'guess':
        return renderGuess(h, v, api);
      case 'reveal':
        return renderReveal(h, v, api);
      default:
        return h('p', null, '…');
    }
  },
  tv(view, api) {
    const h = api.h;
    const v = view.game.view;
    switch (v.phase) {
      case 'secret':
        return [
          h('h2', { class: 'center' }, `Round ${v.round}: prompts are going out`),
          h(
            'div',
            { class: 'redacted' },
            h('span', null, 'One of them is different'),
            h(
              'div',
              { class: 'redacted-lines' },
              [1, 2, 3].map((i) => h('i', { style: { width: `${50 + i * 12}%` } })),
            ),
          ),
        ];
      case 'answer':
        return [
          h('h2', { class: 'center' }, 'Everyone is answering'),
          strip(h, v, api, v.done, `${v.done.length} of ${v.participants.length} in`),
        ];
      case 'vote':
        return [
          h('h2', { class: 'center' }, 'Who got the other prompt?'),
          answerWall(h, v, api, {}),
          h('div', { class: 'progress-row center' }, `${v.done.length} of ${v.participants.length} voted`),
        ];
      case 'guess':
        return [h('h2', { class: 'center' }, 'The imposter is guessing the crew prompt…'), answerWall(h, v, api, {})];
      case 'reveal':
        return renderReveal(h, v, api);
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
    if (!results?.awards) return null;
    return h(
      'div',
      { class: 'awards' },
      results.awards.map((a, i) =>
        h(
          'div',
          { class: 'award flip-in', style: { animationDelay: `${i * 400}ms` } },
          h('div', { class: 'award-title' }, a.title),
          h('div', { class: 'award-who' }, a.winners.map((w) => `${w.avatar} ${w.name}`).join(' & ')),
          h('div', { class: 'award-blurb' }, a.blurb),
        ),
      ),
    );
  },
  renderHowTo,
};

export default renderer;

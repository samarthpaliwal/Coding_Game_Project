// Helpers shared by game modules: timed phases and "everyone is done" checks.

// Enter a phase that lasts `seconds`; `onEnd` runs when the clock runs out (or when a module
// decides everyone is done and calls finishEarly). The client renders the countdown from endsAt.
export function enterPhase(state, ctx, { phase, seconds, onEnd, data }) {
  state.phase = phase;
  state.phaseId = (state.phaseId || 0) + 1;
  state.endsAt = seconds > 0 ? ctx.now() + seconds * 1000 : null;
  state.duration = seconds > 0 ? seconds * 1000 : null;
  if (data) Object.assign(state, data);
  if (seconds > 0 && onEnd) {
    const myPhase = state.phaseId;
    ctx.schedule(seconds, () => {
      if (state.phaseId === myPhase) onEnd();
    });
  } else {
    ctx.clearTimer();
  }
  state._onEnd = onEnd || null;
}

// End the current phase now (used when every player has submitted, or the host skips).
export function finishPhase(state, ctx) {
  const fn = state._onEnd;
  state._onEnd = null;
  ctx.clearTimer();
  if (fn) fn();
}

// Shorten the current timer (e.g. everyone answered but give stragglers 3 more seconds).
export function shortenPhase(state, ctx, seconds) {
  if (!state.endsAt) return;
  const remaining = state.endsAt - ctx.now();
  if (remaining <= seconds * 1000) return;
  state.endsAt = ctx.now() + seconds * 1000;
  const fn = state._onEnd;
  const myPhase = state.phaseId;
  ctx.schedule(seconds, () => {
    if (state.phaseId === myPhase && state._onEnd === fn) finishPhase(state, ctx);
  });
}

// True when every id in `ids` that is still connected has an entry in `map`.
// Disconnected players never block the room; they simply miss the phase.
export function everyoneDone(ctx, ids, map) {
  return ids.every((id) => map[id] !== undefined || !ctx.isConnected(id));
}

export function connectedCount(ctx, ids) {
  return ids.filter((id) => ctx.isConnected(id)).length;
}

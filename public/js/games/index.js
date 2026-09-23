// Client-side renderers, keyed by game id. Each exports { render(view, api), tv?, onEvent?, renderSummary?, renderHowTo? }.
import contraband from './contraband.js';

export const GAME_RENDERERS = { contraband };

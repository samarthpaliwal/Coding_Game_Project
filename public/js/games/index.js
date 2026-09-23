// Client-side renderers, keyed by game id. Each exports { render(view, api), onEvent?, tv?, renderSummary? }.
export const GAME_RENDERERS = {};
export function registerRenderer(id, renderer) {
  GAME_RENDERERS[id] = renderer;
}

// Registry of playable games. Add a module here and it appears in the lobby.
const GAMES = [];

export function registerGame(module) {
  if (!module?.id || GAMES.some((g) => g.id === module.id)) return;
  GAMES.push(module);
}

export function getGame(id) {
  return GAMES.find((g) => g.id === id) || null;
}

export function gameCatalog() {
  return GAMES.map((g) => ({
    id: g.id,
    name: g.name,
    tagline: g.tagline,
    minPlayers: g.minPlayers,
    maxPlayers: g.maxPlayers,
    minutes: g.minutes,
    settingsSchema: g.settingsSchema || {},
    defaultSettings: g.defaultSettings || {},
  }));
}

export { GAMES };

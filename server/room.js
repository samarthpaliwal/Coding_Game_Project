// Room = one group of friends. Holds the players, the current game, and the timer.
// All game rules live in modules under ./games; the room only orchestrates them.

import { randomCode, randomToken, nextId, nowMs } from './util.js';
import { getGame, gameCatalog } from './games/index.js';
import { RoomError } from './errors.js';

export { RoomError };

export const LIMITS = {
  maxPlayers: 12,
  roomIdleMs: 3 * 60 * 60 * 1000, // a room nobody has touched for 3h is deleted
  emptyRoomMs: 10 * 60 * 1000, // a room with nobody connected for 10 min is deleted
  hostGraceMs: 12 * 1000, // host gets 12s to come back (refresh) before the crown moves
  lobbyGhostMs: 60 * 1000, // disconnected players are dropped from the lobby after 60s
};

export class Player {
  constructor({ name, avatar }) {
    this.id = nextId('p');
    this.token = randomToken();
    this.name = name;
    this.avatar = avatar;
    this.ws = null;
    this.connected = false;
    this.spectator = false; // joined mid-game: watches until the next game starts
    this.score = 0; // running total across games in this room
    this.joinedAt = nowMs();
    this.lastSeen = nowMs();
    this.disconnectedAt = 0;
  }
  send(msg) {
    if (this.ws && this.ws.readyState === 1) {
      try {
        this.ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg));
      } catch {
        /* socket died between checks */
      }
    }
  }
  publicInfo() {
    return {
      id: this.id,
      name: this.name,
      avatar: this.avatar,
      connected: this.connected,
      spectator: this.spectator,
      score: this.score,
    };
  }
}

export class Room {
  constructor(manager, code) {
    this.manager = manager;
    this.code = code;
    this.createdAt = nowMs();
    this.lastActivity = nowMs();
    this.players = new Map(); // id -> Player
    this.tvs = new Set(); // ws connections in TV mode
    this.hostId = null;
    this.phase = 'lobby'; // lobby | playing | results
    this.game = null; // { id, module, state }
    this.settings = { gameId: gameCatalog()[0]?.id || null, rounds: 4 };
    this.store = {}; // per-room scratch space for game modules (content cursors survive Play again)
    this.lastResults = null; // shown on the results screen
    this.timer = null; // the single phase timer for the running game
    this.hostTimer = null;
    this._flushScheduled = false;
    this.gamesPlayed = 0;
    this.log = []; // small ring buffer of notable events for the lobby feed
  }

  touch() {
    this.lastActivity = nowMs();
  }

  // ---------- membership ----------

  addPlayer(ws, { name, avatar }) {
    if (this.players.size >= LIMITS.maxPlayers) throw new RoomError('room_full', 'This room is full (12 players max).');
    const player = new Player({ name: this.uniqueName(name), avatar });
    this.players.set(player.id, player);
    this.attach(player, ws);
    if (!this.hostId) this.hostId = player.id;
    if (this.phase === 'playing') {
      player.spectator = true;
      this.game?.module.playerJoined?.(this.game.state, this.ctx(), player.id);
    }
    this.note(`${player.name} joined`);
    this.touch();
    this.sync();
    return player;
  }

  uniqueName(name, exceptId = null) {
    const taken = new Set([...this.players.values()].filter((p) => p.id !== exceptId).map((p) => p.name.toLowerCase()));
    let finalName = name;
    let n = 2;
    while (taken.has(finalName.toLowerCase())) finalName = `${name.slice(0, 13)} ${n++}`;
    return finalName;
  }

  renamePlayer(player, name, avatar) {
    player.name = this.uniqueName(name, player.id);
    if (avatar) player.avatar = avatar;
    this.touch();
    this.sync();
  }

  attach(player, ws) {
    if (player.ws && player.ws !== ws) {
      try {
        player.ws.close(4000, 'replaced by a newer connection');
      } catch {
        /* ignore */
      }
    }
    player.ws = ws;
    player.connected = true;
    player.lastSeen = nowMs();
    player.disconnectedAt = 0;
    ws.__room = this;
    ws.__player = player;
    if (this.hostId === player.id && this.hostTimer) {
      clearTimeout(this.hostTimer);
      this.hostTimer = null;
    }
    if (this.manager.emptyTimer && this.manager.emptyTimer.has(this.code)) {
      clearTimeout(this.manager.emptyTimer.get(this.code));
      this.manager.emptyTimer.delete(this.code);
    }
  }

  resume(ws, token) {
    const player = [...this.players.values()].find((p) => p.token === token);
    if (!player) throw new RoomError('bad_token', 'That seat is gone. Join again with the room code.');
    this.attach(player, ws);
    this.game?.module.playerReconnected?.(this.game.state, this.ctx(), player.id);
    this.touch();
    this.sync();
    return player;
  }

  addTv(ws) {
    this.tvs.add(ws);
    ws.__room = this;
    ws.__tv = true;
    this.touch();
    ws.send(JSON.stringify(this.tvView()));
  }

  onDisconnect(ws) {
    if (ws.__tv) {
      this.tvs.delete(ws);
      return;
    }
    const player = ws.__player;
    if (!player || player.ws !== ws) return; // an older socket of a player who already reconnected
    player.ws = null;
    player.connected = false;
    player.disconnectedAt = nowMs();
    this.game?.module.playerDisconnected?.(this.game.state, this.ctx(), player.id);
    if (this.hostId === player.id) this.scheduleHostMigration();
    if (this.phase === 'lobby') {
      setTimeout(() => {
        if (!player.connected && this.players.get(player.id) === player && this.phase === 'lobby') {
          this.removePlayer(player.id, 'left');
        }
      }, LIMITS.lobbyGhostMs).unref?.();
    }
    if (![...this.players.values()].some((p) => p.connected)) this.manager.scheduleEmptyCheck(this);
    this.sync();
  }

  removePlayer(playerId, reason = 'left') {
    const player = this.players.get(playerId);
    if (!player) return;
    this.players.delete(playerId);
    if (player.ws) {
      try {
        player.ws.send(JSON.stringify({ t: 'kicked', reason }));
        player.ws.close(4001, reason);
      } catch {
        /* ignore */
      }
    }
    this.game?.module.playerLeft?.(this.game.state, this.ctx(), playerId);
    this.note(`${player.name} ${reason === 'kicked' ? 'was removed' : 'left'}`);
    if (this.hostId === playerId) this.migrateHost();
    if (this.players.size === 0) this.manager.deleteRoom(this.code);
    else this.sync();
  }

  scheduleHostMigration() {
    if (this.hostTimer) return;
    this.hostTimer = setTimeout(() => {
      this.hostTimer = null;
      const host = this.players.get(this.hostId);
      if (!host || !host.connected) this.migrateHost();
    }, LIMITS.hostGraceMs);
    this.hostTimer.unref?.();
  }

  migrateHost() {
    const candidates = [...this.players.values()]
      .filter((p) => p.connected && !p.spectator)
      .concat([...this.players.values()].filter((p) => p.connected && p.spectator))
      .concat([...this.players.values()]);
    const next = candidates[0];
    if (!next) {
      this.hostId = null;
      return;
    }
    if (next.id !== this.hostId) {
      this.hostId = next.id;
      this.note(`${next.name} is now the host`);
      this.sync();
    }
  }

  // ---------- game lifecycle ----------

  activePlayers() {
    return [...this.players.values()].filter((p) => !p.spectator);
  }

  connectedPlayers() {
    return [...this.players.values()].filter((p) => p.connected && !p.spectator);
  }

  updateSettings(patch) {
    if (patch.gameId !== undefined) {
      if (!getGame(patch.gameId)) throw new RoomError('bad_game', 'Unknown game.');
      this.settings.gameId = patch.gameId;
    }
    const module = getGame(this.settings.gameId);
    if (module?.settingsSchema) {
      for (const [key, def] of Object.entries(module.settingsSchema)) {
        if (patch[key] === undefined) continue;
        let v = patch[key];
        if (def.type === 'number') {
          v = Number(v);
          if (!Number.isFinite(v)) continue;
          v = Math.max(def.min, Math.min(def.max, Math.round(v)));
        } else if (def.type === 'choice') {
          if (!def.options.some((o) => o.value === v)) continue;
        } else if (def.type === 'boolean') {
          v = !!v;
        }
        this.settings[key] = v;
      }
    }
    this.touch();
    this.sync();
  }

  startGame() {
    if (this.phase === 'playing') throw new RoomError('busy', 'A game is already running.');
    const module = getGame(this.settings.gameId);
    if (!module) throw new RoomError('bad_game', 'Pick a game first.');
    // Everyone present becomes a player. Ghosts gone for a while are dropped; a phone that
    // locked ten seconds ago keeps its seat and score and simply gets fillers until it is back.
    for (const p of [...this.players.values()]) {
      if (!p.connected && nowMs() - p.disconnectedAt > LIMITS.lobbyGhostMs) this.players.delete(p.id);
      else p.spectator = false;
    }
    if (!this.players.has(this.hostId)) this.migrateHost();
    const players = this.activePlayers();
    const present = players.filter((p) => p.connected);
    if (present.length < module.minPlayers) {
      throw new RoomError('not_enough', `${module.name} needs at least ${module.minPlayers} players.`);
    }
    if (players.length > module.maxPlayers) {
      throw new RoomError('too_many', `${module.name} plays with up to ${module.maxPlayers} players.`);
    }
    const settings = { ...module.defaultSettings, ...this.settings };
    this.clearTimer();
    this.phase = 'playing';
    this.lastResults = null;
    this.game = { id: module.id, module, state: null, startedAt: nowMs(), settings };
    this.game.state = module.init(this.ctx(), settings);
    module.start(this.game.state, this.ctx());
    this.gamesPlayed++;
    this.note(`${module.name} started`);
    this.touch();
    this.sync();
  }

  endGame(results) {
    this.clearTimer();
    const module = this.game?.module;
    this.game = null;
    this.phase = 'results';
    const standings = this.activePlayers()
      .map((p) => p.publicInfo())
      .sort((a, b) => b.score - a.score);
    this.lastResults = { gameId: module?.id, gameName: module?.name, standings, ...(results || {}) };
    if (!Array.isArray(this.lastResults.standings) || !this.lastResults.standings.length) this.lastResults.standings = standings;
    for (const p of this.players.values()) p.spectator = false;
    this.touch();
    this.sync();
  }

  backToLobby() {
    this.clearTimer();
    this.game = null;
    this.phase = 'lobby';
    for (const p of this.players.values()) p.spectator = false;
    this.touch();
    this.sync();
  }

  resetScores() {
    for (const p of this.players.values()) p.score = 0;
    this.gamesPlayed = 0;
    this.sync();
  }

  hostCommand(player, msg) {
    if (player.id !== this.hostId) throw new RoomError('not_host', 'Only the host can do that.');
    switch (msg.cmd) {
      case 'settings':
        return this.updateSettings(msg.settings || {});
      case 'start':
        if (msg.settings) this.updateSettings(msg.settings);
        return this.startGame();
      case 'skip':
        if (this.game) {
          this.game.module.skip?.(this.game.state, this.ctx());
          this.touch();
          this.sync();
        }
        return;
      case 'end':
        if (this.phase === 'playing') return this.endGame({ aborted: true });
        return;
      case 'lobby':
        return this.backToLobby();
      case 'reset_scores':
        return this.resetScores();
      case 'kick': {
        if (msg.playerId === player.id) throw new RoomError('bad_target', 'You cannot remove yourself.');
        return this.removePlayer(msg.playerId, 'kicked');
      }
      default:
        throw new RoomError('bad_cmd', 'Unknown host command.');
    }
  }

  playerAction(player, action) {
    if (this.phase !== 'playing' || !this.game) throw new RoomError('no_game', 'No game is running.');
    if (player.spectator) throw new RoomError('spectator', 'You are watching this one; you will be in the next game.');
    if (!action || typeof action.type !== 'string') throw new RoomError('bad_action', 'Malformed action.');
    this.game.module.action(this.game.state, this.ctx(), player.id, action);
    player.lastSeen = nowMs();
    this.touch();
    // Silent actions (e.g. draft keystrokes) are relayed by the module itself and must not
    // trigger a full-view broadcast to everyone.
    if (!this.game?.module.silentActions?.has(action.type)) this.sync();
  }

  // ---------- timers ----------

  setTimer(ms, fn) {
    this.clearTimer();
    this.timer = setTimeout(
      () => {
        this.timer = null;
        try {
          fn();
        } catch (err) {
          console.error(`[room ${this.code}] timer error`, err);
        }
        this.sync();
      },
      Math.max(0, ms),
    );
  }

  clearTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  // ---------- context handed to game modules ----------

  ctx() {
    const room = this;
    return {
      code: room.code,
      store: room.store,
      rng: Math.random,
      players: () => room.activePlayers(),
      connectedPlayers: () => room.connectedPlayers(),
      player: (id) => room.players.get(id) || null,
      isConnected: (id) => !!room.players.get(id)?.connected,
      schedule: (seconds, fn) => room.setTimer(seconds * 1000, fn),
      clearTimer: () => room.clearTimer(),
      award: (id, points) => {
        const p = room.players.get(id);
        if (p) p.score += points;
      },
      sync: () => room.sync(),
      emit: (event, ids) => room.emit(event, ids),
      end: (results) => room.endGame(results),
      note: (text) => room.note(text),
      now: nowMs,
    };
  }

  // ---------- output ----------

  note(text) {
    this.log.push({ at: nowMs(), text });
    if (this.log.length > 12) this.log.shift();
  }

  emit(event, ids) {
    const payload = JSON.stringify({ t: 'event', e: event });
    if (ids) {
      for (const id of ids) this.players.get(id)?.send(payload);
    } else {
      for (const p of this.players.values()) p.send(payload);
      for (const tv of this.tvs) {
        try {
          tv.send(payload);
        } catch {
          /* ignore */
        }
      }
    }
  }

  // Coalesce many state changes in one tick into one broadcast.
  sync() {
    if (this._flushScheduled) return;
    this._flushScheduled = true;
    setImmediate(() => {
      this._flushScheduled = false;
      this.flush();
    });
  }

  flush() {
    if (!this.manager.rooms.has(this.code)) return;
    const ctx = this.ctx();
    for (const p of this.players.values()) {
      if (p.connected) p.send(this.viewFor(p, ctx));
    }
    if (this.tvs.size) {
      const tv = JSON.stringify(this.tvView(ctx));
      for (const ws of this.tvs) {
        try {
          ws.send(tv);
        } catch {
          /* ignore */
        }
      }
    }
  }

  baseView(ctx) {
    const module = getGame(this.settings.gameId);
    return {
      t: 'view',
      now: nowMs(),
      code: this.code,
      phase: this.phase,
      hostId: this.hostId,
      players: [...this.players.values()].map((p) => p.publicInfo()),
      settings: { ...(module?.defaultSettings || {}), ...this.settings },
      catalog: gameCatalog(),
      gamesPlayed: this.gamesPlayed,
      results: this.phase === 'results' ? this.lastResults : null,
      log: this.log.slice(-6),
      game: this.game ? { id: this.game.id, name: this.game.module.name, settings: this.game.settings } : null,
    };
  }

  viewFor(player, ctx = this.ctx()) {
    const v = this.baseView(ctx);
    v.you = { ...player.publicInfo(), isHost: player.id === this.hostId };
    if (this.game) v.game.view = this.game.module.view(this.game.state, ctx, player.id);
    return v;
  }

  tvView(ctx = this.ctx()) {
    const v = this.baseView(ctx);
    v.tv = true;
    if (this.game) {
      const m = this.game.module;
      v.game.view = m.tvView ? m.tvView(this.game.state, ctx) : m.view(this.game.state, ctx, null);
    }
    return v;
  }
}

export class RoomManager {
  constructor() {
    this.rooms = new Map();
    this.emptyTimer = new Map();
    this.gc = setInterval(() => this.collect(), 60 * 1000);
    this.gc.unref?.();
  }

  createRoom() {
    const code = randomCode(4, new Set(this.rooms.keys()));
    const room = new Room(this, code);
    this.rooms.set(code, room);
    return room;
  }

  getRoom(code) {
    if (typeof code !== 'string') return null;
    return this.rooms.get(code.trim().toUpperCase()) || null;
  }

  deleteRoom(code) {
    const room = this.rooms.get(code);
    if (!room) return;
    room.clearTimer();
    if (room.hostTimer) clearTimeout(room.hostTimer);
    for (const p of room.players.values()) {
      try {
        p.ws?.close(4002, 'room closed');
      } catch {
        /* ignore */
      }
    }
    for (const tv of room.tvs) {
      try {
        tv.close(4002, 'room closed');
      } catch {
        /* ignore */
      }
    }
    this.rooms.delete(code);
  }

  scheduleEmptyCheck(room) {
    if (this.emptyTimer.has(room.code)) return;
    const t = setTimeout(() => {
      this.emptyTimer.delete(room.code);
      if (![...room.players.values()].some((p) => p.connected)) this.deleteRoom(room.code);
    }, LIMITS.emptyRoomMs);
    t.unref?.();
    this.emptyTimer.set(room.code, t);
  }

  collect() {
    const now = nowMs();
    for (const room of this.rooms.values()) {
      if (now - room.lastActivity > LIMITS.roomIdleMs) this.deleteRoom(room.code);
    }
  }

  stats() {
    let players = 0;
    for (const r of this.rooms.values()) players += r.players.size;
    return { rooms: this.rooms.size, players };
  }
}

# CONTRABAND

**Sneak the word. Steal the laugh. Don't get caught.**

A room-code party pack for 3–12 people. Everyone plays on their own phone, nobody installs anything, nobody logs in. One person creates a room, everyone else types the four-letter code (or scans the QR), and the night starts. Tap the **?** on any screen for the rules of the game you are in.

Three games share the room and the scoreboard:

| Game | One line | Modes / settings |
|---|---|---|
| **Contraband** | Everyone answers the same ridiculous prompt. A secret few are **smugglers** whose answer must hide an assigned word. Vote for the funniest, then accuse the smugglers. | Classic · Blitz (30 s rounds, mild words) · Hardcore (spicy words, six rounds, the smuggler count is never announced) |
| **Cardsmith** | A fill-in-the-blank card game where the room writes its own deck. The host types a theme, everyone writes their own answer cards (10 each with 3 players, down to 3 each with a full room), the server tops up the deck with AI-written cards on that theme, and a rotating judge crowns the funniest card each round. Your cards can win in other people's hands. | Theme · rounds · rotating judge or everyone votes |
| **Imposter** | Everyone secretly gets the same short prompt, except one player who gets a slightly different one and does not know it. Answer in a word or two, then vote out whoever does not fit. A caught imposter can guess the crew's prompt to steal points. | Rounds |

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/samarthpaliwal/Coding_Game_Project)
[![Deploy to Koyeb](https://www.koyeb.com/static/images/deploy/button.svg)](https://app.koyeb.com/deploy?type=git&repository=github.com/samarthpaliwal/Coding_Game_Project&branch=main&name=contraband&builder=dockerfile&ports=3000;http;/)

## How a night goes

1. **Brief.** Every phone flips a card: green *YOU'RE CLEAN*, or red *SMUGGLER — contraband: LASAGNA*. Round 1 tells you exactly how many smugglers there are. Later rounds only give a range ("between 0 and 3 of you"), and from round 3 there might be none at all.
2. **Write** (60 s). Answer the prompt in up to 70 characters. Smugglers cannot submit until the word is in there. Prompts often name someone in the room ("The text Priya would send at 3 a.m."); that person's vote counts double.
3. **Wiretap.** Once per round, if you have a token, watch another player's draft appear letter by letter. Their phone screams *SOMEONE IS TAPPING YOUR LINE* but never says who. Last place gets a fresh token every round.
4. **Vote.** Answers go up anonymously. Tap the funniest. +100 per vote you receive (+200 in the final).
5. **Accuse.** Names come out. Tap up to N suspects, or *NOBODY*. Heat bars race live on every phone as the room turns on someone. +100 per correct pick, −50 per wrong one, +100 bonus for a clean sweep.
6. **Reveal.** Cards flip in sync on every phone and the TV: CLEAN or BUSTED, and the hidden word ignites inside the answer you already laughed at. Getting away clean is +250, untouched by anyone is +350.
7. **Final round: EVERYONE'S DIRTY.** The prompt is built from the night's funniest answer. Everyone smuggles. You score by guessing which word each friend hid, and by fooling them with yours.
8. **Podium and awards.** Crowd Favorite, Ghost, Bloodhound, Most Fooled, Master of Disguise, and the Word of the Night. Copy the recap to the group chat. *Play again* never repeats a prompt or a word.

About 15 minutes at 6 players. Best with 5–8.

## AI-written cards (optional)

Cardsmith asks Claude to write extra prompt and answer cards on the room's theme when the server has an API key. Set `ANTHROPIC_API_KEY` in the environment (Render: *Environment* tab; locally: `ANTHROPIC_API_KEY=sk-... npm start`). Without a key the game uses its built-in bank of 80 prompt cards and 145 answer cards, and everything else works the same. Generation runs while players write their own cards, so it never slows the game down. Set `CONTRABAND_AI_MODEL` to change the model (default `claude-opus-5`).

## Run it locally

```bash
npm install
npm start          # http://localhost:3000
```

Open the address on a phone on the same Wi-Fi (use your computer's LAN IP instead of localhost). Open `/tv` on a laptop or TV to mirror the room on a big screen.

```bash
npm test           # unit tests: rules, scoring, secrecy leak test, full games over WebSockets
npm run test:e2e   # headless Chromium: phones + a TV play every game, screenshots in test/e2e/artifacts
```

## Put it on the internet (free)

Any host that runs a Node server with WebSockets works. Memory is the only state, so a redeploy ends live rooms (fine for a party game; say so to your friends).

**Render** (free plan, sleeps when idle, wakes in ~30 s): click the *Deploy to Render* button above, sign in with GitHub, accept the blueprint in `render.yaml`. Your URL will be `https://contraband-xxxx.onrender.com`.

**Koyeb** (free plan): click *Deploy to Koyeb*. It builds the `Dockerfile` and exposes port 3000.

**Anything with Docker** (Railway, Fly.io, Cloud Run, a $4 VPS):

```bash
docker build -t contraband .
docker run -p 3000:3000 contraband
```

The server reads `PORT` from the environment and answers `GET /healthz` for health checks.

## How it works

```
server/
  index.js            HTTP static server + WebSocket endpoint, message routing, heartbeat
  room.js             Rooms: 4-letter codes, seat tokens for refresh/reconnect, host migration,
                      spectators, one timer per room, coalesced per-player views, TV feeds
  games/contraband.js The rules: roles, word tiers, validation, scoring, awards, per-player secrecy
  games/cardsmith.js  Theme, player-written cards, AI/bank top-up, hands, rotating judge or vote
  games/imposter.js   Prompt pairs, one-word answers, vote, the imposter's guess
  games/phases.js     Timed phase helpers with early-advance when everyone is done
  ai.js               Optional card generation through the Anthropic SDK
  content/            340 prompts, 450 contraband words, 170 imposter prompt pairs, 225 cards, stamps, fillers
public/
  js/app.js           Phone app: home, lobby (QR + invite link), game screens, results podium
  js/games/contraband.js  Every phase screen for phones and TV, server-timed reveal choreography
  js/net.js           WebSocket with auto-reconnect and a clock-offset estimate (ping burst)
  js/tv.js            Big-screen page: code + QR, roll call, heat grid, podium
```

Design decisions that matter:

- **The server is the only authority.** Phones send intents (`submit`, `vote`, `accuse`, `lock`, `guess`, `wiretap`); the server validates and broadcasts each player a view that contains only what that player may know. Roles, words, drafts and votes never reach other phones before the reveal; a unit test asserts it.
- **Refresh-proof.** A seat token in `localStorage` re-attaches you to the same seat with your draft, role, vote and wiretap intact. Disconnected players never block a phase; missed inputs get fillers.
- **Timers live on the server.** Clients only render a countdown from `endsAt` using a clock offset measured with a ping burst, so the reveal flips land on every screen in the same beat.
- **No build step, no framework, one dependency** (`ws`). Deploy anywhere Node runs.

## Adding another game

The room layer is game-agnostic. A game is a module in `server/games/` exporting `{ id, name, minPlayers, maxPlayers, settingsSchema, init, start, action, view, tvView }`, registered in `server/games/index.js`, plus a renderer in `public/js/games/` exporting `{ rules, render, tv, renderSummary, renderHowTo }`. The lobby picker, settings controls, help overlay, scoreboard and podium come for free. Imposter is the smallest example (about 300 lines of server code).

## Credits

Built with Claude Code. QR codes by [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) (MIT). Fonts: Bungee and Nunito via Google Fonts.

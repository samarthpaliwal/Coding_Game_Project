# CONTRABAND — Final Design Spec (v1.0)

> Build target: the Node 22 + `ws` scaffold already in this repo (`server/index.js`, `server/room.js`, `server/games/phases.js`, `server/util.js`, `public/js/app.js`, `public/js/net.js`, `public/js/ui.js`, `public/js/tv.js`, `test/`). Deliverable = one server game module, one client renderer, content banks, four small scaffold edits (Appendix A). Everything below is normative unless marked *(stretch)*. Tuning constants are listed in §3.12 so playtest changes are one-line edits.

---

## 1. The game

**Name:** CONTRABAND
**Tagline:** Sneak the word. Steal the laugh. Don't get caught.
**Rules in one breath:** Everyone answers the same ridiculous prompt on their phone. A secret few are Smugglers who must sneak an assigned word into their answer without it looking forced. Vote for the funniest answer, then accuse the smugglers. Getting the laugh and getting away are both worth points.

**Pitch.** Every round, every phone shows the same prompt ("The worst thing to whisper during a wedding ceremony", or "The text Priya would send at 3 a.m." using a name from the room). Everyone types a 70-character answer. But a few phones also flashed a red card: *SMUGGLER — Contraband: LASAGNA. It must appear in your answer.* Answers go up anonymously and the room votes for the funniest, Quiplash-style. Then the names come out and everyone accuses: tap the people you think were smuggling while a live heat bar on every screen shows suspicion piling up. Nobody knows exactly how many smugglers there are (the phone only says "between 0 and 3 of you"), so a confident wrong accusation costs you. The reveal flips each card in sync on every phone and the TV, stamps it CLEAN or SMUGGLER, and lights up the hidden word inside a sentence the whole room already read and laughed at. Once per game (more if you're losing) you can Wiretap another player and watch their draft appear letter by letter while their phone screams *SOMEONE IS TAPPING YOUR LINE*. The final round quotes the night back at the group: the prompt is built from the night's top-voted answer, everyone is a smuggler, and you score by guessing which word each friend was hiding.

**Why this beats the alternatives (judge summary).** Contraband was the combined winner (142 vs SWARM 135, FAUX 135, Loaded Words 131, Partyline 113) and was picked first by two of three judges. The fun judge: it stacks the two loops that never fail at a table (write-and-vote comedy, accuse-and-reveal deduction) so every round has a built-in punchline *and* a built-in reveal laugh, plus a minute of real table talk that a public constraint (Loaded Words) never produces. The engineer judge: one repeated loop with discrete inputs, every shared state is latest-wins, secrets live only in a per-player `view()` with an obvious leak test, and it maps directly onto the scaffold's module contract, so reconnect, host migration, TV and tests are inherited. The demo judge preferred SWARM's no-explanation demo, but SWARM's showcase depends on sub-100 ms cross-device simultaneity that cellular phones cannot guarantee (engineer's fatal flaw) and has no player-authored content (fun judge's fatal flaw). This spec fixes every weakness the judges named in Contraband and grafts only the ideas at least two judges recommended:

| Graft | Source | Why |
|---|---|---|
| Uncertain smuggler count shown as a range, NOBODY option, wrong picks cost points | FAUX | Accuse phase never resolves for free (fun, engineer) |
| Callback finale built from the night's top answer; Most Wanted strip; Word of the Night award | Loaded Words | The game quotes the group back to itself (all three judges) |
| `{p}` name-slot prompts; the named player's vote is a double-weight gold vote | Partyline | Jokes are about people in the room (all three judges) |
| Clock-offset sampling + server-timestamped reveal timeline | SWARM | Reveal lands on every phone and the TV in the same beat (fun, engineer) |
| 70-char answers, one big card per answer, staggered deal, TV roll call | fun judge's fix | Removes the reading-load weakness |
| Wiretap tokens recharge (last place, clean busts) + round-1 nudge | demo judge's fix | The signature moment is not gated behind a once-per-game token |

Deliberately **not** grafted: player-planted words (a second round format), live position streaming (a second sync engine), doodles (a second input engine). Each would add a whole engine to a game whose strength is one loop done perfectly.

---

## 2. Players, session and structure

### 2.1 Player counts
- **3–10 players** (server cap 12; the lobby shows "best with 5–8" and allows 11–12 with a yellow "crowded" note). Sweet spot 5–8.
- 3 players: exactly 1 smuggler every round, 2-card votes, 1 accusation pick. Works, thin; the UI never pretends otherwise ("Sole juror" style copy is not needed here, the flow is identical).
- Mid-game joiners spectate and are dealt in at the next round (§6.3).

### 2.2 Session length
- Default **4 normal rounds + 1 final round**. Host setting `rounds` = 3–6 normal rounds.
- Measured: ~135–150 s per normal round at 6 players, ~170 s at 10; final ~3 min; lobby ~2 min. **≈15 min at 6 players, ≈18 min at 10** with the default settings.
- Host settings (scaffold `settingsSchema`):
  - `rounds`: number, 3–6, default 4, label "Rounds before the final".
  - `words`: choice, `mild` / `normal` / `spicy`, default `normal`, label "Contraband". Sets the word-tier schedule (§3.1).

### 2.3 Round structure
- **Round 1 — "Teaching round".** The exact smuggler count is announced ("There are 2 smugglers among you"). Tier-1 words (common nouns).
- **Rounds 2..R — "Uncertain rounds".** The count is drawn from a range; phones show only the range ("Somewhere between 0 and 3 of you are smuggling"). From round 3 on, with 5+ players, there is a 15% chance of a **Clean Round** with zero smugglers. Word tiers escalate by round.
- **Final round — "EVERYONE'S DIRTY".** Everyone is a smuggler with a distinct word. The prompt is a callback template applied to the night's top-voted answer. The Accuse phase is replaced by a **Lineup**: for each other player's answer, pick which of four words was their contraband. Funny votes pay double; fooling people pays the writer.
- Then the scaffold's results screen: podium + awards (§3.10). Host taps **Play again** (same room, no repeated content) or **Back to lobby**.

### 2.4 Phase-by-phase: timers and what each screen shows

"Player phone" is what everyone sees. "Host extras" are added on the host's phone only (the scaffold already renders `Skip phase` / `End game` tiny buttons for the host during play). "TV" is the optional `/tv` page.

| Phase | Timer (s) | Early end | Player phone | Host extras | TV |
|---|---|---|---|---|---|
| LOBBY | none | — | Room code (tap = copy invite link), Show QR toggle, player list with avatars popping in live, 3-line how-to card, settings (read-only), "Waiting for {host} to start…", Leave | `rounds` stepper, `words` segmented control, **Start Contraband** (enabled at ≥3 connected), kick × per player | Giant code + `join at <host>` + QR, avatar wall, "Up next: Contraband", 3-line how-to |
| WAITING | none | — | "Waiting for players (2 of 3)…" with the code and QR to invite | End game | Same, giant |
| BRIEFING | 8 (final: 10) | no | Full-screen role card flips in: green **YOU'RE CLEAN** or red **SMUGGLER / Contraband: LASAGNA**; prompt below; count banner; a rotating tip line; card auto-hides after 4 s, tap-and-hold to peek | Skip | Prompt huge, count banner, "Smugglers are being briefed…" with a redacted-document animation. Never the words. |
| WRITE | 60 | all eligible writers submitted | Prompt pinned at top (name in `{p}` prompts bold), textarea (max 70, counter), for smugglers a pill `must include: lasagna` that turns green when present, **SUBMIT** at thumb height, **Wiretap** button with token count bottom-left, tapped-line panel above the keyboard when tapping someone, red **SOMEONE IS TAPPING YOUR LINE** banner when tapped, avatar strip with typing dots / check marks | Skip | Prompt, avatar strip with typing dots and checks, "4 of 6 in", pulsing **LINE TAPPED** icon while any wiretap is active this round (never who) |
| VOTE | clamp(15 + 3·A, 20, 45), A = votable answers | all eligible voters voted | Anonymous answer cards dealt in with a 120 ms stagger, big type, one card per answer; own card dimmed "yours"; filler cards greyed and unvotable; tap to select, **VOTE** to confirm (final); subject of a `{p}` prompt sees "Your GOLD vote counts double"; "3 of 6 voted" | Skip | **Roll call**: each card full-screen for 2.5 s in order (so someone can read aloud), then the whole wall; vote counter only |
| ACCUSE (normal rounds) | 25 (≤7 players) / 30 (≥8) | all eligible accusers locked | Rows in the same order as the vote wall: avatar, name, answer (2-line clamp), SUSPECT toggle (red ring), live **heat bar** under each row; "2 of 3 picks used"; **NOBODY** tile shown only when the range's low end is 0; **LOCK IN** | Skip | Avatar grid with answers and heat bars racing; "4 of 6 locked" |
| LINEUP (final only) | clamp(12 + 6·L, 20, 60), L = other votable answers | all locked | For each other answer: text + four word tiles, tap one; progress "3 of 5 guessed"; **LOCK IN** | Skip | Each answer with its four options (no picks shown) |
| REVEAL | 4 + 1.5·A (+4 in the final) | no | Cards flip in the same order 1.1 s apart on a server timestamp: name, **CLEAN** or **SMUGGLER** stamp slams down, contraband word glows inside the answer, voter avatars line up under the card, accuser avatars appear on the right; then points toasts, then a personal verdict banner (**CLEAN GETAWAY +250** / **BUSTED** / **You nailed 2 of 2 smugglers +300** / **You accused Sam for nothing**), then the stamp line; wiretapped players now see who tapped them | Skip | Same choreography full-width; stamp lines in a marquee; nobody-voters row on clean rounds |
| SCOREBOARD | 8 | no | Ranked rows re-sort with animated deltas and rank arrows; **Most Wanted** strip (every word smuggled so far, GOT AWAY / BUSTED, by whom); underdog toast "Priya got an extra Wiretap"; "Round 3 of 4 next" | Skip | Bar race + persistent Most Wanted side strip |
| RESULTS | none | — | Podium (scaffold), award cards flipping in one by one, **Word of the Night**, full standings, "Waiting for the host…", Leave | **Play again**, **Back to lobby** | Podium, awards, confetti |

---

## 3. Rules and scoring

### 3.1 Roles, smuggler count, word tiers
Let `n` = participants of this round: active (non-spectator), connected, non-AFK players at the moment BRIEFING starts.

```
k0 = n <= 4 ? 1 : n <= 7 ? 2 : 3
Round 1:   count = k0; range = {lo: k0, hi: k0}                      // announced exactly
Round >=2: hi = min(k0 + 1, n - 2, 3)
           loNonZero = max(1, k0 - 1)
           zeroAllowed = (round >= 3 && n >= 5)
           lo = zeroAllowed ? 0 : loNonZero
           count = (zeroAllowed && rng() < P_CLEAN_ROUND) ? 0 : randomInt(loNonZero, hi)   // inclusive
Final:     count = n (everyone), range = {lo: n, hi: n}
```
Examples: n=3 → always 1 (range shows "1 smuggler"); n=4 → 1–2; n=6 → 1–3 (0–3 from round 3); n=8..10 → 2–3 (0–3 from round 3). If `lo == hi` the banner uses the exact form.

**Smuggler assignment (normal rounds):** least-smuggled-first. Sort participants by `timesSmuggled` ascending with random ties, exclude players dealt in this round, take the first `count`. Increment `timesSmuggled` for each.

**Words:** each smuggler gets a distinct word from the round's tier, never reused within the room (across Play-again games too). Tier schedule by round index (clamped to the last entry), plus the final's tier:

| `words` setting | R1 | R2 | R3 | R4 | R5 | R6 | Final |
|---|---|---|---|---|---|---|---|
| mild | 1 | 1 | 1 | 2 | 2 | 2 | 1 |
| normal | 1 | 1 | 2 | 2 | 3 | 3 | 2 |
| spicy | 1 | 2 | 2 | 3 | 3 | 3 | 3 |

Roles and words never leave the server except in that player's own view (§5.6).

### 3.2 Writing
- Answer = `cleanText(text, 70)`; must be 2–70 characters. URLs are stripped (`/https?:\/\/\S+/gi` → "").
- Smuggler submits are rejected with an inline error unless `norm(answer).includes(norm(word))`, where `norm` = lowercase + collapse whitespace. Substring on purpose: "lasagnas" and "lasagna-flavored" pass.
- Drafts stream to the server every 250 ms while changed (silent, §5.4). At WRITE end, a player without a submission gets their draft auto-submitted if valid (`auto: true`), otherwise a **filler** line from the bank (`filler: true`). Filler cards are greyed, cannot be voted for or accused. A smuggler who ends with a filler is **voided**: treated as clean for scoring, their word returns to nobody (still counted as used).
- `{p}` prompts: the subject is drawn uniformly from participants with the fewest times-as-subject this game. The subject writes normally.

### 3.3 Voting
- Everyone with ≥1 votable answer other than their own votes for exactly one funniest answer. One vote, final on confirm.
- **+100 per vote received** (normal rounds), **+200** in the final. Everyone scores votes, smugglers included.
- **Gold vote:** on a `{p}` prompt the subject's vote counts as 2 votes (the card shows a gold voter avatar at reveal).
- If fewer than 2 votable answers exist, VOTE is skipped (straight to ACCUSE).

### 3.4 Accusing (normal rounds)
- Everyone (smugglers too; they don't know each other) picks up to `hi` suspects among accusable players (participants with a non-filler answer, not yourself), **or** taps NOBODY (only offered when `lo == 0`). LOCK IN is final. Unlocked picks at the deadline count as locked.
- Per accuser: `correct` = picks that were real (non-voided) smugglers, `wrong` = the rest.
  - `accusePoints = max(0, 100·correct − 50·wrong)`
  - **Full bust +100** if `correct == count` and `wrong == 0` and `count ≥ 1` (also refunds one Wiretap token, cap 2).
  - NOBODY: **+200** if the effective count (after voiding) is 0; otherwise 0.
- Live **heat**: the anonymous count of current picks per player (locked or not) is in every view during ACCUSE, plus the NOBODY count. Never who.

### 3.5 Smuggler outcomes (normal rounds)
`accusers` = participants other than this smuggler who registered any accusation (≥1 pick or NOBODY). `accusedBy` = how many of them picked this smuggler.
```
threshold = max(1, ceil(BUST_FRACTION * accusers))        // BUST_FRACTION = 0.4
busted    = accusers >= 1 && accusedBy >= threshold
```
- BUSTED: +0 smuggling points (keeps all funny-vote points).
- CLEAN GETAWAY: **+250**.
- GHOST: getaway with `accusedBy == 0` and `accusers ≥ 3`: **+100 more** (350 total).
- Voided smugglers score nothing here and appear as "(went for snacks)" cards.
- Clean Round (effective count 0): no smuggler outcomes; NOBODY voters get +200; everyone who accused someone gets the floored 0 and a stamp line ("There were no smugglers. Look what you've done.").

### 3.6 Wiretap
- Every player starts each game with **1 token**. Tokens do not score.
- During WRITE, tap Wiretap → avatar sheet → pick one other participant (not yourself, once per round). The target's current draft is relayed to you live for the rest of the phase; a panel above your keyboard shows it with a blinking caret. The target's phone immediately shows **SOMEONE IS TAPPING YOUR LINE** (count only, never who); the TV shows LINE TAPPED. Multiple people may tap the same target. At REVEAL the target learns who tapped them.
- Recharge: after every normal-round SCOREBOARD the lowest-scoring participant(s) get **+1** (cap 2), announced publicly as the Underdog; a Full bust refunds **+1** (cap 2).
- Round 1: the Wiretap button pulses and its first-tap tooltip reads "Watch someone type. They'll know, but not who." so demos show the moment early.
- A reconnecting tapper resumes the stream (the target's latest draft is in the view).

### 3.7 Final round — EVERYONE'S DIRTY
- Prompt: the top-voted non-filler answer from normal rounds (gold counts 2; ties → earlier round) fed into a callback template: `The Yelp review for "a chiropractor who only works on stepdads"`. Skip answers longer than 50 characters; if no answer qualifies, use a fallback finale prompt. The card shows "callback: Round 2, by Priya".
- Everyone gets a distinct final-tier word. WRITE and VOTE as normal (votes pay **+200**).
- **LINEUP** replaces ACCUSE: for each other non-filler answer, four word tiles: the real word + 3 decoys. Decoys: up to 2 drawn from words smuggled earlier this game (not any finalist's current word), the rest from the final tier bank, shuffled. Same tile set for every guesser (public).
- Scoring: **+100 per correct guess** (guesser); **+100 per wrong guess received** (writer, "fooled"). No-guess earns nobody anything.
- REVEAL shows each card with its word glowing, who guessed right, how many were fooled.

### 3.8 Comeback mechanics
1. **Underdog Wiretap:** last place gets an information edge every round, announced so it becomes a story.
2. **Final swing:** with 7 opponents the final pays up to 1,400 for votes + 700 for fooling; typical totals entering the final are 600–1,000, so last place can win with one great disguised answer.
3. **Least-smuggled-first** assignment: nobody misses the high-upside role.
4. **Smugglers keep their laughs:** a busted smuggler still banks their funny votes, so a round is never a zero.
5. **Clean-round and NOBODY** turn a bad accusation streak into a possible +200 for the cautious player.

### 3.9 Tie-breaks
Standings sort by total score, then funny votes received, then clean getaways, then earlier `joinedAt`. Equal scores are displayed as a shared rank ("1st (tie)"); the tie-break only orders the list and the podium slots.

### 3.10 End of game: podium and awards
`ctx.end(results)` with `results = { awards, mostWanted, wordOfTheNight, topAnswer }`. The scaffold shows the podium; `renderSummary` shows awards as cards flipping in 500 ms apart:

| Award | Computed from | Blurb |
|---|---|---|
| Crowd Favorite | most funny votes received (ties: all) | "{n} laughs. The people have spoken." |
| Ghost | most clean getaways (min 1) | "{n} clean getaways. Never seen, never caught." |
| Bloodhound | most correct accusations (min 1) | "{n} correct accusations. Trusts nobody." |
| Most Fooled | most wrong accusations (min 1) | "Accused {n} innocent people. Apologize." |
| Word of the Night | the smuggled word whose answer got the most votes (ties: earliest) | "“{word}”, smuggled by {name}, {n} votes, {outcome}." |

The lobby feed also gets a note: "Word of the Night: moist (Priya)".

### 3.11 Worked example (6 players, round 2, range 1–3, actual 2)
Prompt: "A rejected name for a new energy drink". Smugglers: Ben ("gravy"), Eve ("cousin").
Votes: Ana 2, Ben 2, Cy 1, Eve 1 → Ana +200, Ben +200, Cy +100, Eve +100.
Accusations (max 3 picks): Ana → Ben, Eve; Cy → Ben, Dee; Dee → Ana, Fox; Fox → Eve; Ben → Cy; Eve → Ana.
- Ana: 2 correct, 0 wrong → 200 + Full bust 100 = **+300**, +1 Wiretap.
- Cy: 1 correct, 1 wrong → 100 − 50 = **+50**. Dee: 0 correct, 2 wrong → **0**. Fox: **+100**. Ben, Eve: **0**.
- Ben: accusers = 5, threshold = ceil(0.4·5) = 2, accusedBy = 2 → **BUSTED**, +0 (keeps +200).
- Eve: accusedBy = 1 → **CLEAN GETAWAY +250** (total +350 this round).
Round deltas: Ana 500, Eve 350, Ben 200, Cy 150, Fox 100, Dee 0. Dee is last → Underdog, +1 Wiretap.

### 3.12 Tuning constants (one place in `contraband.js`)
```
ANSWER_MAX 70 · WRITE_SECONDS 60 · BRIEF_SECONDS 8 (final 10) · ACCUSE_SECONDS 25 (30 if n>=8)
VOTE_SECONDS(A) = clamp(15+3A, 20, 45) · LINEUP_SECONDS(L) = clamp(12+6L, 20, 60)
REVEAL_SECONDS(A) = 4 + 1.5A (+4 final) · SCOREBOARD_SECONDS 8 · CARD_STEP_MS 1100 · REVEAL_LEAD_MS 400
FUNNY_VOTE 100 · FINAL_FUNNY_VOTE 200 · GOLD_WEIGHT 2 · CORRECT_PICK 100 · WRONG_PICK 50 · FULL_BUST 100
NOBODY_RIGHT 200 · GETAWAY 250 · GHOST 100 · LINEUP_CORRECT 100 · FOOLED 100
BUST_FRACTION 0.4 · P_CLEAN_ROUND 0.15 · WIRETAP_START 1 · WIRETAP_CAP 2 · AFK_STRIKES 2
DRAFT_INTERVAL_MS 250 · TIER_SCHEDULE (table §3.1)
```

---

## 4. Content banks

All banks are plain ES modules under `server/content/` exporting arrays (no JSON import assertions needed). Voice everywhere: deadpan, specific, present tense, 13+ safe. Never: real people, brands, politics, religion, slurs, jokes about a player's body, money or relationships, anything that needs fact-checking.

### 4.1 `prompts.js` — target 320 (about 110 with a `{p}` slot)
Style: a one-line setup that invites a full sentence or a noun phrase; ≤ 60 characters; must tolerate any noun crammed in (so every contraband word can hide); at most one `{p}` slot; no question marks needed. Tag each prompt `{ text, p: boolean }`.
1. The worst thing to whisper during a wedding ceremony
2. A rejected name for a new energy drink
3. The first line of a breakup text written by a robot
4. Something you should never say to your barber
5. The last thing you want to hear from your pilot
6. What is actually behind the STAFF ONLY door at the zoo
7. A motivational poster that motivates nobody
8. A review of Earth left by an alien tourist
9. The text {p} would send at 3 a.m.
10. A warning label for {p}
11. The real reason {p} got banned from the aquarium
12. {p}'s autobiography is titled...

### 4.2 `words_tier1.js` — target 150
Style: common concrete nouns, 3–9 letters, fit almost any sentence, slightly noticeable in a joke. Single word, lowercase (proper nouns capitalized).
1. soup 2. cousin 3. Tuesday 4. elbow 5. pickle 6. homework 7. ketchup 8. penguin 9. sandwich 10. umbrella 11. yogurt 12. goose

### 4.3 `words_tier2.js` — target 150
Style: odd, texture-heavy words that make people snicker and are hard to place naturally; 4–12 letters; a few proper-noun-ish phrases allowed.
1. moist 2. kneecaps 3. gluten 4. podcast 5. lukewarm 6. seagull 7. cardigan 8. notarized 9. accordion 10. gravy 11. chiropractor 12. mayonnaise

### 4.4 `words_tier3.js` — target 120
Style: two- or three-word phrases, bureaucratic or intimate fragments, ≤ 20 characters, very hard to disguise.
1. tax season 2. emotional support 3. gently used 4. no refunds 5. lightly toasted 6. my therapist 7. room temperature 8. in this economy 9. group project 10. free trial 11. customer service 12. per my last email

### 4.5 `callbacks.js` — 30 templates with `{answer}` + 10 fallback finale prompts
Style: templates must tolerate awkward grammar (that is the joke); the answer is inserted in curly quotes. Fallbacks are self-contained prompts used only when no answer qualifies.
1. The Yelp review for “{answer}”
2. The sequel to “{answer}” is called...
3. Explain “{answer}” to a toddler
4. The warning label on “{answer}”
5. “{answer}”: the documentary is titled...
6. The text message that led to “{answer}”
7. What the judge said after hearing “{answer}”
8. Grandma's reaction to “{answer}”
9. The secret ingredient in “{answer}”
10. The 1-star review of “{answer}”
11. *(fallback)* The last text message humanity ever sends
12. *(fallback)* The first thing the robots say when they take over

### 4.6 `stamps.js` — 50 reveal lines, grouped by outcome, placeholders `{word}` `{name}` `{n}`
Groups: `getaway` (12), `ghost` (6), `busted` (12), `full_bust` (6), `clean_round` (8), `fooled` (6). One line is chosen per card (and one per clean round); lines never repeat within a game until the group is exhausted.
1. getaway: Nobody suspected the {word}.
2. getaway: {name} walked out with “{word}” in broad daylight.
3. getaway: Zero suspicion. Full {word}.
4. ghost: A ghost. {name} and the {word} were never here.
5. busted: Caught red-handed, {word} and all.
6. busted: {name} tried to sneak “{word}” past {n} detectives. Bold.
7. busted: The {word} never stood a chance.
8. full_bust: {name} caught every smuggler. Somebody check {name}'s search history.
9. clean_round: There were no smugglers. Look what you've done.
10. clean_round: Everyone was innocent. {name} accused {n} people anyway.
11. fooled: {name} hid “{word}” from {n} people.
12. fooled: Nobody fell for {name}'s “{word}”. Not one person.

### 4.7 `fillers.js` — 30 lines shown on the card of a player who submitted nothing
Style: obviously not a real answer, self-aware, ≤ 50 characters; greyed, unvotable, unaccusable.
1. (went to get snacks) 2. I plead the fifth 3. *dial-up noises* 4. my phone died, blame the phone 5. this answer left to spend more time with its family 6. (stared at the wall for 60 seconds) 7. buffering… 8. [redacted by my lawyer] 9. no comment, next question 10. (was definitely not smuggling anything) 11. brb 12. typing… typing… gone

### 4.8 `copy.js` — about 45 UI strings: role cards, count banners, how-to, tips, awards
Style: big-font friendly, ≤ 90 characters, no exclamation-mark spam.
1. Clean card: YOU'RE CLEAN. Write something funny. Spot the smugglers.
2. Smuggler card: SMUGGLER. Contraband: {word}. It must appear in your answer. Make it look natural.
3. Final card: EVERYONE'S DIRTY. You are ALL smugglers tonight. They will be guessing your word.
4. Banner (exact): There are {k} smugglers among you.
5. Banner (range): Somewhere between {lo} and {hi} of you are smuggling.
6. How-to line 1: Everyone answers the same prompt. A few of you must sneak a secret word into your answer.
7. Tip: Innocents: a weird answer is a decoy. Suspicion is a resource.
8. Tip: Smugglers keep their laugh points even when busted.
9. Tip: Wrong accusations cost 50. Confidence costs nothing.
10. Wiretap tooltip: Watch someone type. They'll know, but not who.
11. Tapped banner: SOMEONE IS TAPPING YOUR LINE
12. Award, Crowd Favorite: {n} laughs. The people have spoken.

### 4.9 Avatars — 24 emoji (scaffold has 16; add 8)
🦊 🐸 🐙 🦄 🐝 🦖 🐼 🦩 🐨 🦑 🐧 🦔 🐲 🦜 🐺 🦋 🐢 🦥 🐳 🦉 🐷 🦁 🐮 🦎 (must be distinct at 32 px; duplicate picks in one room are allowed, names disambiguate).

### 4.10 Selection and rotation
- **Per-room cursors, persistent across games.** `ctx.store.banks` (new `room.store`, Appendix A) lazily holds a `BankCursor` (already in `util.js`: shuffled order + cursor + reshuffle on exhaustion) for prompts and each word tier. "Play again" continues the cursor, so a room never sees a prompt or word twice until the bank is exhausted.
- **Cross-room variety.** A process-wide ring of the last 80 prompt ids used by any room; when a cursor yields a prompt in the ring, skip it (up to 20 tries, then accept). Cheap, and groups on the same instance rarely share a prompt on the same night.
- **Words** additionally go into `ctx.store.usedWords` (a Set) and are never dealt again in that room; final-round decoys prefer this game's used words (callback value) before bank words.
- **`{p}` prompts** are drawn at the natural rate of the bank (~35%) but never two `{p}` prompts about the same subject in one game while another subject is available.
- **Stamps** use a small cursor per group per game.
- **Callback templates** cursor lives in the store too, so successive games in one room get different finale framings.

---

## 5. Server state machine

### 5.1 Module contract and state shape
`server/games/contraband.js` implements the scaffold contract exactly: `{ id, name, tagline, minPlayers: 3, maxPlayers: 12, minutes: 16, settingsSchema, defaultSettings, silentActions, init, start, action, view, tvView, skip, playerJoined, playerReconnected, playerDisconnected, playerLeft }`. It uses `enterPhase / finishPhase / everyoneDone` from `phases.js`; the room's single timer, coalesced `sync()`, `emit()`, `award()`, `end()` and `now()` come from `ctx`.

```js
state = {
  phase: 'briefing'|'write'|'vote'|'accuse'|'lineup'|'reveal'|'scoreboard'|'waiting',
  phaseId, endsAt, duration,                 // maintained by phases.js
  round: 0, totalRounds: settings.rounds, isFinal: false,
  settings: { rounds, words },
  players: { [id]: { timesSmuggled, subjectCount, wiretaps, strikes, afk, joinedRound } },
  pendingJoiners: Set<id>,                   // spectators to deal in at the next round
  rounds: [],                                // finished RoundRecords (history for callbacks and awards)
  cur: RoundRecord|null,
  stats: { votes:{}, getaways:{}, busts:{}, correct:{}, wrong:{}, fooled:{}, wiretapsUsed:{}, mostWanted:[] },
  waiting: { have, need } | null
}
RoundRecord = {
  round, isFinal, tier, n, participants: [ids],
  prompt: { id, text, subjectId|null, callback: {round, authorId}|null },
  range: { lo, hi }, count, smugglers: { [id]: word }, voided: Set<id>,
  drafts: { [id]: text }, answers: { [id]: { text, filler, auto } }, fillerLines: { [id]: text },
  wiretaps: { [tapperId]: targetId }, tappedBy: { [targetId]: [tapperIds] },
  votes: { [voterId]: authorId },
  accusations: { [id]: { picks: [ids], nobody: bool, locked: bool } },
  lineupOptions: { [authorId]: [w1,w2,w3,w4] }, guesses: { [guesserId]: { [authorId]: word } }, lineupLocked: Set<id>,
  order: [authorIds],                        // shuffled once at closeWrite; used by VOTE, ACCUSE, REVEAL
  revealAt, results: { cards:[...], cleanRound, nobodyVoters, fullBusters, deltas:{} } | null
}
```
`Player.score` (scaffold) is the only score of record; the module writes it through `ctx.award`.

### 5.2 States and transitions

| State | Enter when | Timer | Ends by | Next |
|---|---|---|---|---|
| `waiting` | a round would start with < 3 eligible players | none | `playerReconnected` / `playerJoined` makes it ≥3, or host `end` | `briefing` |
| `briefing` | `beginRound` | 8 s (10 final) | timer, host skip | `write` |
| `write` | | 60 s | timer, all eligible submitted, host skip | `closeWrite` → `vote` (or `accuse`/`lineup` if < 2 votable) |
| `vote` | | clamp(15+3A,20,45) | timer, all eligible voted, host skip | `accuse` (normal) / `lineup` (final) |
| `accuse` | normal rounds | 25/30 s | timer, all eligible locked, host skip | `scoreRound` → `reveal` |
| `lineup` | final round | clamp(12+6L,20,60) | timer, all locked, host skip | `scoreFinal` → `reveal` |
| `reveal` | | 4+1.5A (+4 final) | timer, host skip | `scoreboard` (normal) / `ctx.end()` (final) |
| `scoreboard` | | 8 s | timer, host skip | `beginRound(round+1)` |

The room-level phase is `playing` throughout; `ctx.end(results)` moves the room to `results` (podium), and the host's Play again calls `init` afresh with the same `room.store`.

### 5.3 Pseudo-code

```js
init(ctx, settings) {
  const store = ctx.store; store.banks ??= makeCursors(); store.usedWords ??= new Set();
  const state = { ...fresh, totalRounds: clamp(settings.rounds, 3, 6), settings };
  for (const p of ctx.players()) state.players[p.id] = { timesSmuggled: 0, subjectCount: 0, wiretaps: WIRETAP_START, strikes: 0, afk: false, joinedRound: 0 };
  return state;
}
start(state, ctx) { beginRound(state, ctx, 1); }

eligible(state, ctx) = ctx.players().filter(p => p.connected && !state.players[p.id].afk).map(p => p.id)
live(state, cur, ctx) = cur.participants.filter(id => ctx.isConnected(id) && !state.players[id].afk)   // used by early-advance

beginRound(state, ctx, r) {
  dealInJoiners(state, ctx, r);                       // spectator -> player, score untouched (0), wiretaps 1, timesSmuggled = max of others, joinedRound = r
  const ids = eligible(state, ctx);
  if (ids.length < 3) { state.phase = 'waiting'; state.waiting = { have: ids.length, need: 3 }; state.endsAt = null; ctx.clearTimer(); return; }
  state.waiting = null; state.round = r; state.isFinal = r > state.totalRounds;
  const cur = state.cur = { round: r, isFinal: state.isFinal, n: ids.length, participants: ids, ... };
  cur.tier = tierFor(state.settings.words, r, state.isFinal);
  if (state.isFinal) {
    cur.prompt = finalePrompt(state, ctx);            // top answer + callback template, or fallback
    cur.range = { lo: ids.length, hi: ids.length }; cur.count = ids.length;
    for (const id of ids) cur.smugglers[id] = nextWord(ctx, cur.tier);
  } else {
    cur.prompt = nextPrompt(state, ctx, ids);         // fills {p} with a subject
    cur.range = rangeFor(r, ids.length); cur.count = drawCount(r, ids.length, ctx.rng);
    for (const id of pickSmugglers(state, ids, cur.count, r)) { cur.smugglers[id] = nextWord(ctx, cur.tier); state.players[id].timesSmuggled++; }
  }
  enterPhase(state, ctx, { phase: 'briefing', seconds: state.isFinal ? 10 : 8, onEnd: () => enterWrite(state, ctx) });
}

enterWrite(state, ctx) { enterPhase(state, ctx, { phase: 'write', seconds: WRITE_SECONDS, onEnd: () => closeWrite(state, ctx) }); }

closeWrite(state, ctx) {
  const cur = state.cur;
  for (const id of cur.participants) if (!cur.answers[id]) {
    const d = validAnswer(cur, id, cur.drafts[id]);
    if (d) cur.answers[id] = { text: d, filler: false, auto: true };
    else { cur.answers[id] = { text: nextFiller(state), filler: true }; if (cur.smugglers[id]) { cur.voided.add(id); delete cur.smugglers[id]; } }
  }
  cur.order = shuffle(cur.participants, ctx.rng);
  const A = votable(cur).length;
  if (A < 2) return enterJudgement(state, ctx);
  enterPhase(state, ctx, { phase: 'vote', seconds: clamp(15 + 3 * A, 20, 45), onEnd: () => enterJudgement(state, ctx) });
}

enterJudgement(state, ctx) {
  const cur = state.cur;
  if (cur.isFinal) { buildLineupOptions(state, ctx); const L = votable(cur).length - 1;
    enterPhase(state, ctx, { phase: 'lineup', seconds: clamp(12 + 6 * Math.max(L, 1), 20, 60), onEnd: () => enterReveal(state, ctx) }); }
  else enterPhase(state, ctx, { phase: 'accuse', seconds: cur.n >= 8 ? 30 : 25, onEnd: () => enterReveal(state, ctx) });
}

enterReveal(state, ctx) {
  const cur = state.cur; cur.results = cur.isFinal ? scoreFinal(state, ctx) : scoreRound(state, ctx);   // calls ctx.award for every delta
  cur.revealAt = ctx.now() + REVEAL_LEAD_MS;
  const A = votable(cur).length;
  enterPhase(state, ctx, { phase: 'reveal', seconds: 4 + 1.5 * A + (cur.isFinal ? 4 : 0), onEnd: () => cur.isFinal ? finishGame(state, ctx) : enterScoreboard(state, ctx) });
}

enterScoreboard(state, ctx) {
  applyStrikes(state);                                  // no submit + no vote + no accusation this round -> strikes++, else 0; afk = strikes >= AFK_STRIKES
  grantUnderdog(state, ctx);                            // lowest score among participants: wiretaps = min(cap, +1); public
  state.rounds.push(state.cur);
  enterPhase(state, ctx, { phase: 'scoreboard', seconds: SCOREBOARD_SECONDS, onEnd: () => beginRound(state, ctx, state.round + 1) });
}

finishGame(state, ctx) { state.rounds.push(state.cur); ctx.end({ awards: computeAwards(state), mostWanted: state.stats.mostWanted, wordOfTheNight: ..., topAnswer: ... }); }
```

### 5.4 Player actions by phase
`action(state, ctx, playerId, a)` throws `RoomError('bad_action', msg)` for anything not listed; any accepted action clears the player's AFK strikes (and `afk`, effective for the next round's count/pool).

| Phase | Action `a` | Validation | Effect |
|---|---|---|---|
| write | `{type:'draft', text}` **silent** | participant, not yet submitted; `cleanText(text, 70)` | `cur.drafts[id] = text`; `ctx.emit({type:'draft', from:id, text}, tappersOf(id))`. No `sync()` (Appendix A). |
| write | `{type:'submit', text}` | participant; 2–70 chars after clean; smuggler: word present, else `RoomError('missing_word', 'Your answer must include "lasagna".')` | `cur.answers[id] = {text, filler:false}`; if `everyoneDone(ctx, live, cur.answers)` → `finishPhase` |
| write | `{type:'wiretap', targetId}` | participant; `wiretaps > 0`; no wiretap this round yet; target ≠ self and is a participant | `wiretaps--`; `cur.wiretaps[id] = targetId`; `tappedBy[target].push(id)`; `stats.wiretapsUsed[id]++`; immediately `emit` the target's current draft to the tapper; `sync` (target sees `tappedBy` count) |
| vote | `{type:'vote', authorId}` | eligible voter; not already voted; author votable and ≠ self | `cur.votes[id] = authorId`; early-advance when all eligible voters voted |
| accuse | `{type:'accuse', picks:[ids]}` | participant, not locked; ids accusable, ≠ self, unique, `length ≤ range.hi` | replace picks, `nobody=false` |
| accuse | `{type:'accuse', nobody:true}` | `range.lo == 0`, not locked | `picks=[]`, `nobody=true` |
| accuse / lineup | `{type:'lock'}` | participant | `locked=true`; early-advance when all live participants locked |
| lineup | `{type:'guess', authorId, word}` | participant, not locked, author ≠ self and votable, `word ∈ lineupOptions[authorId]` | `guesses[id][authorId] = word` |
| any | anything else | — | `bad_action` |

Host commands (scaffold): `skip` → `module.skip` = `finishPhase` unless `waiting`; `end` → `ctx.end({aborted:true})` handled by the room; `kick` → `playerLeft`.

### 5.5 Auto-advance, timers, grace
- Timers are server-owned via `enterPhase` (one `setTimeout` per room, guarded by `phaseId`). Clients only render `endsAt`.
- Early advance is immediate (no grace) the moment the predicate holds; predicates count only **live** participants (connected, non-AFK), so a disconnected phone never blocks the room. `playerDisconnected` and `playerLeft` re-check the predicate.
- Deadline behaviour: WRITE → auto-submit/filler (§3.2); VOTE → non-voters simply don't count; ACCUSE/LINEUP → unlocked picks count as locked.
- BRIEFING and REVEAL never end early on their own (people are reading); host skip is allowed.
- Scoring happens exactly once, at `enterReveal`, so a late message after the deadline can never change points.

### 5.6 Per-role views (secrecy discipline)
`view(state, ctx, playerId)` returns only what that player may know:
- Own `role`, `word`, `draft`, `answer`, `wiretaps`, `wiretap: {targetId, text}` (latest draft of the target, so a refresh resumes the stream), `tappedBy: count` (ids only from REVEAL on), `vote`, `picks/nobody/locked`, `guesses`.
- Public per phase: `prompt`, `range`, `done: [ids]` (submitted / voted / locked), `afk: [ids]`, `answers` (from VOTE on, anonymous until ACCUSE), `heat` (ACCUSE only, aggregate), `lineupOptions` (LINEUP on), `reveal` (REVEAL on: everything), `scoreboard`.
- Never before REVEAL: other players' roles, words, drafts, votes, individual accusations, guesses. Never in `tvView`: drafts, roles, words (before reveal), `you`.
- Spectators get the public view with `role: 'spectator'`.
- **Leak test (write first):** in BRIEFING and WRITE, `JSON.stringify(view)` for every non-smuggler and for the TV must not contain any live contraband word; in no phase before REVEAL may a view contain the key `smugglers`, another player's `draft`, or `votes`.

---

## 6. Edge cases

- **Disconnect / refresh mid-phase.** The scaffold stores `{code, token, playerId}` in `localStorage` and sends `resume` on every (re)connect, including `visibilitychange` (iOS kills background sockets). The room re-attaches the seat, `playerReconnected` fires, and the next `view` contains the complete phase: draft text (server-side), submitted answer, wiretap target and their latest draft, vote, picks, lock state, guesses, `revealAt`. `render()` is idempotent, so a refreshed phone is just another snapshot receiver; choreography past `revealAt` renders instantly. While away the avatar shows greyed on the strip. If away at a deadline: draft auto-submit or filler, missed vote, picks-as-is.
- **Host leaves.** Host is an ordinary player with a crown. The scaffold waits 12 s (`hostGraceMs`) then moves the crown to the longest-connected active player, and moves it back if the original host returns first. The game never depends on the host: all transitions are server timers; the host only has Start, Skip, End, Kick, Play again.
- **Player joins mid-game.** The scaffold marks them `spectator`; they see the public phase views with a banner "You're watching. You're in from the next round." and cannot act. At the next `beginRound` they are dealt in with score 0, 1 Wiretap, `timesSmuggled = max(others)` (so they are not immediately a smuggler), and appear in the scoreboard as "new".
- **Minimum players not met.** Start requires 3 connected (scaffold). If a round would start with fewer than 3 eligible players, state = `waiting` (no timer) showing the code and QR; a reconnect or a new joiner resumes; the host can End game. A phase already running always completes with fillers/auto-locks.
- **Idle players.** A participant who ends a round with no submit, no vote and no accusation gets a strike; two consecutive strikes = AFK: excluded from `n`, the smuggler pool and all early-advance predicates, card shown as filler with a zzz badge. Any action clears it. AFK players still receive every view and may act at once.
- **Leaving / kicked mid-round.** Removed from participants; if they were this round's smuggler, voided; predicates re-checked. Their answer card, if already public, stays with "(left)".
- **Duplicate names.** Scaffold suffixes ("Sam 2"); names are 1–16 characters after `cleanText`.
- **Profanity in names.** Scaffold `cleanName` blocklist rejects slurs; everything else is allowed. Answers are unfiltered (a party game among friends); the host can kick.
- **Room expiry.** Scaffold: codes are 4 letters from a 24-letter alphabet (no I/O); a room with nobody connected for 10 min or no activity for 3 h is deleted; disconnected lobby ghosts drop after 60 s; 12 seats max. Memory-only state: a redeploy ends live rooms (stated in the README).
- **Two tabs / two devices on one seat.** The newer socket replaces the older (`close 4000`).
- **3 players.** Count is always 1; VOTE has 2 cards; ACCUSE has 1 pick; final LINEUP has 2 answers. Everything else identical.
- **Fewer than 2 votable answers.** VOTE is skipped; if 0 votable answers, ACCUSE is skipped too and the round is scored as a clean round with no stamps.
- **Clock skew.** Clients estimate the server clock offset (§8.4) so timers and the reveal choreography agree; a phone whose offset is badly wrong still works (it only shifts its local animation).
- **Free-tier cold start.** After 3 s of connecting, the home screen says "Waking up the server (free hosting, ~30 s)…" and keeps retrying with the scaffold's backoff.
- **Cheating via devtools.** Nothing to find: roles, words, drafts and votes are absent from other players' payloads (§5.6 leak test).

---

## 7. Client screens (vertical phone, vanilla CSS/JS)

Shared rules: `100dvh` layouts with safe-area insets (scaffold), `visualViewport` listener keeps SUBMIT/LOCK IN above the keyboard, every tap target ≥ 48 px, primary button pinned in the bottom third, `touch-action: manipulation`, `autocomplete=off autocapitalize=sentences enterkeyhint=done` on the textarea, `prefers-reduced-motion` disables stagger and flips. Theme: scaffold palette (plum ground, coral = smuggler/danger, mint = clean/ok, gold = gold vote). Sounds are the scaffold's WebAudio `beep` presets plus two new ones (`stamp`: 90 Hz square 60 ms; `flip`: 520→780 Hz sweep 90 ms). All screens live in `public/js/games/contraband.js` as `render(view, api)` branches on `view.game.view.phase`.

| # | Screen | Key elements | Signature moment |
|---|---|---|---|
| 1 | Home (scaffold, rebranded) | Logo CONTRA**BAND**, name field, avatar grid (24), code field (auto-uppercase), Join, Create | A red **CLASSIFIED** stamp slams onto the logo on load (scale 3→1, −8° rotate, 250 ms) |
| 2 | Lobby (scaffold) | Code, Copy link, Show QR, player list, 3-line how-to card, settings, Start / waiting line, feed | Each joining avatar pops in with a bounce and a soft chime on every phone and the TV at once |
| 3 | Briefing | Full-screen role card, prompt, count banner, tip line | Card flip (rotateY 0→180, 500 ms); smuggler: coral card + `vibrate([40,60,40])` + word revealed letter by letter; clean: mint card + single 20 ms buzz. Auto-hides at 4 s; press-and-hold peeks |
| 4 | Write | Pinned prompt (subject name bold), textarea `id="answer"` (scaffold `render` preserves caret), counter `12/70`, contraband pill, SUBMIT, Wiretap button with token pips, avatar strip | The **tapped-line panel**: target's draft appears above your keyboard with a blinking caret, backspaces visible; on the other phone the **SOMEONE IS TAPPING YOUR LINE** banner slides down in coral with a heartbeat pulse |
| 5 | Vote | Answer cards (min-height 84 px, 1.15 rem), "yours" dim, filler grey, selection lift, VOTE, counter | Cards deal in from the bottom 120 ms apart with a flip sound per card; the selected card lifts 6 px with a mint outline |
| 6 | Accuse | Named rows: avatar, name, answer, SUSPECT toggle (56 px), heat bar (height 6 px, `width` transition 300 ms), picks counter, NOBODY tile (when offered), LOCK IN | **Heat bars race** live as the room accuses; your locked picks get a red wax-seal stamp |
| 7 | Lineup (final) | Accordion of other answers; four word tiles each; progress; LOCK IN | Tapping a tile stamps it; the accordion auto-advances to the next unguessed answer |
| 8 | Reveal | Cards in order; name; CLEAN / SMUGGLER stamp; word glow (`text-shadow` pulse, gold underline); voter avatars; accuser avatars; points toasts; personal verdict banner; stamp line | Server-timed choreography: card `i` flips at `revealAt + i·1100 ms`, stamp slams 500 ms later with `vibrate(30)` and the `stamp` sound; the contraband word ignites inside the sentence |
| 9 | Scoreboard | Rows (rank, avatar, name, score, delta), Most Wanted strip (chips: word, name, GOT AWAY/BUSTED), underdog toast, next-round line | Rows re-sort with a FLIP transform animation; deltas count up over 800 ms; rank arrows |
| 10 | Results (scaffold + `renderSummary`) | Podium, award cards, Word of the Night, standings, Play again / Back to lobby | Award cards flip in 500 ms apart; Word of the Night card glows gold; confetti (scaffold) |
| 11 | Waiting | Code + QR + "Waiting for players (2 of 3)…" | The missing seats pulse as empty avatar rings |

Implementation notes: the choreography is a 100 ms `setInterval` (kept via `api.keep('revealTick')`) that computes `elapsed = api.now() − revealAt` and toggles classes by threshold; because every `view` re-render recomputes classes from the same elapsed time, re-renders during the reveal are safe. The wiretap panel and draft throttle live in `api.keep('write')`. Draft sending: `input` handler stores text; a 250 ms timer sends `{type:'draft'}` only if the text changed. `onEvent({type:'draft'})` updates the panel without a full re-render.

---

## 8. Message protocol

Transport is the scaffold's: one WebSocket per client, JSON messages with a `t` field, 64 KB max payload, 40 msg/s flood guard.

### 8.1 Client → server (scaffold, unchanged)
```
{t:'ping', at:<localMs>}
{t:'create', name, avatar}            {t:'join', code, name, avatar}
{t:'resume', code, token}             {t:'watch', code}            // TV
{t:'rename', name, avatar}            {t:'leave'}
{t:'host', cmd:'settings'|'start'|'skip'|'end'|'lobby'|'reset_scores'|'kick', settings?, playerId?}
{t:'action', a:<GameAction>}
```
### 8.2 Game actions (`a`)
```
{type:'draft',   text}                      // WRITE, silent (no view broadcast)
{type:'submit',  text}                      // WRITE
{type:'wiretap', targetId}                  // WRITE
{type:'vote',    authorId}                  // VOTE
{type:'accuse',  picks:[playerId]}          // ACCUSE
{type:'accuse',  nobody:true}               // ACCUSE (only when range.lo == 0)
{type:'guess',   authorId, word}            // LINEUP
{type:'lock'}                               // ACCUSE / LINEUP
```
### 8.3 Server → client
```
{t:'pong', now:<serverMs>, echo:<at>}
{t:'joined', code, token, playerId, resumed?:true}
{t:'error', code, message}                  // codes used by the game: bad_action, missing_word, no_tokens, not_now
{t:'kicked', reason:'kicked'|'left'}
{t:'event', e:{type:'draft', from:<playerId>, text}}      // only to players tapping `from`
{t:'view', now, code, phase:'lobby'|'playing'|'results', hostId, players:[{id,name,avatar,connected,spectator,score}],
           settings, catalog, gamesPlayed, results, log, you:{...,isHost}, game:{id:'contraband', name, settings, view:<GameView>}}
```
### 8.4 `GameView` (per player; TV gets the same without `you` and without any draft text)
```
{
  phase, phaseId, endsAt, duration, round, totalRounds, isFinal,
  waiting: {have, need} | null,
  prompt: { text, subjectId, callback:{round, authorId}|null } | null,
  range: { lo, hi } | null,
  done: [playerId], afk: [playerId], tappedAny: bool,             // tappedAny drives the TV "LINE TAPPED" pulse
  you: { role:'clean'|'smuggler'|'spectator', word|null, draft, answer:{text, filler}|null,
         wiretaps, wiretap:{targetId, text}|null, tappedBy:number, tappedByIds:[..] (REVEAL+),
         vote|null, picks:[..], nobody, locked, guesses:{authorId: word} },
  answers: [ { id:<authorId>, text, filler, mine } ] | null,      // VOTE+: same order every phase; names via `id` only from ACCUSE on (client hides them in VOTE)
  heat: { [authorId]: count, nobody: count } | null,              // ACCUSE only
  lineup: { [authorId]: [w1,w2,w3,w4] } | null,                   // LINEUP+ (final)
  reveal: { revealAt, cleanRound, nobodyVoters:[..], fullBusters:[..], wiretaps:[{tapperId,targetId}],
            cards: [ { id, text, filler, role:'clean'|'smuggler'|'voided', word|null,
                       votes:[voterId], goldVoterId|null, accusedBy:[..],
                       outcome:'clean'|'getaway'|'ghost'|'busted'|'voided'|'final', stamp,
                       delta:{funny, smuggle, accuse, lineup},
                       guesses:{guesserId: word}|null, fooled:[..]|null } ] } | null,
  scoreboard: { rows:[{id, score, delta, rank, prevRank, isNew}], mostWanted:[{word, name, outcome, round, votes}], underdog:{id, wiretaps}|null } | null
}
```
In VOTE the server sends `answers` with `id` set, but the client must not display names before ACCUSE; anonymity is a rendering rule, not a secret (the vote closes before names matter). Names are never needed to cheat because votes are for humour, not identity.

### 8.5 Clock sync (SWARM graft, `net.js`)
On open send 5 pings 150 ms apart; for each pong compute `rtt = now − echo` and `offset = pong.now − (echo + rtt/2)`; adopt the sample with the smallest rtt. Then one ping every 20 s; adopt a new sample only if its rtt ≤ 1.5 × best rtt or the estimate differs by > 400 ms. `net.now()` = `Date.now() + offset` feeds the scaffold ticker (`data-ends`) and the reveal choreography.

---

## 9. TV mode

- URL: `/tv` (enter the code on a keyboard) or `/tv?room=ABCD`. Sends `{t:'watch', code}`; receives `tvView` only (no seat, no secrets, no inputs). Any number of TVs may connect or drop; nothing depends on them. The scaffold renderer hook is `tv(view, api)` in the game renderer.
- **Join:** the lobby shows the code in 160 px type, "Join at `<host>`" and a QR of `https://<host>/r/ABCD` (vendored `qrcode.js`, `qrSvg(url, 8)`), plus the avatar wall and the 3-line how-to. Phones open the site and type the code, or scan.
- **Playing:** per §2.4: BRIEFING prompt + redacted-doc animation; WRITE avatar strip with typing dots, checks and the LINE TAPPED pulse; VOTE roll call (one card at a time, 2.5 s each, from `endsAt − duration`) then the wall and a vote counter; ACCUSE avatar grid with heat bars racing and a lock counter; LINEUP answers with their four options; REVEAL the same server-timed choreography at 2× scale with stamp lines in a marquee; SCOREBOARD bar race + persistent **Most Wanted** side strip (the room's running joke lives here); RESULTS podium, awards, confetti.
- Sound: the TV plays the flip/stamp/tick sounds and a drumroll (oscillator sweep) before the podium; phones keep their own beeps with a mute toggle (scaffold prefs).
- The TV never shows: roles, words before reveal, drafts, who accused whom before reveal, `you`.
- Landscape layout: stage 70% left, side strip 30% right; falls back to a single column below 900 px so a laptop on the couch works.

---

## 10. Stretch list (ranked by value ÷ effort)

1. **Emoji reactions** (🔥 💀 😂) during VOTE and REVEAL: `{type:'react', e}` → `ctx.emit` to everyone + TV, floating up from the bottom; server rate-limit 1/s per player. ~60 lines.
2. **TV read-aloud:** during the roll call the TV speaks each card with `speechSynthesis` (built-in, no API), toggle on the TV. ~25 lines.
3. **Copy recap:** on RESULTS a button copies a text recap (winner, awards, Word of the Night, the finale prompt) for the group chat. ~30 lines.
4. **Lobby liveness:** join chime + avatar pop on every screen, "ready" wave when the host presses Start, TV keep-alive ping every 10 min so free hosting does not sleep mid-lobby. ~30 lines.
5. **Haptic language:** distinct `vibrate` patterns per beat (role card, tapped banner, stamp, underdog) and a 5-seconds-left tick. ~15 lines.

---

## Appendix A — File map and required scaffold edits

New files
```
server/games/contraband.js          game module (~550 lines): rounds, roles, validation, scoring, views
server/content/{prompts,words_tier1,words_tier2,words_tier3,callbacks,stamps,fillers,copy}.js
public/js/games/contraband.js       renderer (~650 lines): phase screens, wiretap panel, choreography, tv(), renderSummary()
test/unit/contraband.test.js        leak test, count/range table, scoring worked example, early-advance, reconnect mid-WRITE
test/e2e/contraband.mjs             3 phones + TV through one full round and the final; screenshots per phase
```
Registration: `server/games/index.js` → `registerGame(contraband)`; `public/js/games/index.js` → `registerRenderer('contraband', renderer)`.

Scaffold edits (small, all backward compatible)
1. `server/room.js` `playerAction`: after `module.action(...)`, `if (!this.game.module.silentActions?.has(action.type)) this.sync();` so drafts do not trigger a full-view broadcast per keystroke batch. Add `this.store = {}` in the `Room` constructor and `store: room.store` in `ctx()` (per-room content cursors that survive Play again). Change the default `settings.rounds` from 3 to 4.
2. `server/index.js`: extend `AVATARS` to the 24 emoji in §4.9 (mirror the list in `app.js`).
3. `public/js/net.js`: clock sync per §8.4 (burst of 5 pings, min-rtt selection, guarded refresh).
4. `public/js/app.js`, `index.html`, `tv.html`, `manifest.webmanifest`: rebrand to CONTRABAND (logo, titles, session key `contraband.session`); hide the game picker when `catalog.length === 1` and show the how-to card instead; after 3 s of connecting show the "Waking up the server" copy.

## Appendix B — Acceptance checklist
- Leak test passes in every pre-reveal phase for innocents and the TV.
- Count/range table (§3.1) verified for n = 3..10 and rounds 1..6 by a unit test with a seeded rng.
- Worked example (§3.11) reproduces exactly from a scripted round.
- Refresh a phone in every phase (8 phases × player/host/smuggler) and land on the same screen with state intact; refresh during a wiretap resumes the stream.
- Host closes the tab mid-WRITE: crown moves after 12 s, round completes on time.
- Everyone submits → VOTE starts within one tick; a disconnected player never blocks any phase.
- Reveal choreography starts within ±300 ms across three phones and the TV on the same Wi-Fi (measured with timestamps in the e2e run).
- 10 phones at 360 px width: vote wall, accuse rows and lineup accordion have no horizontal scroll and every control is ≥ 48 px.
- Play again in the same room never repeats a prompt or a word.
# Plan

How the game gets built: the technical approach, then milestones in order. Each milestone ends with
something you can play and a **Done when** list. Tick a box only after it has been verified (a test,
an e2e screenshot, or a measured number), and write down how it was verified.

Rules of the game: [GAME_DESIGN.md](GAME_DESIGN.md). Rules for working in this repo: [../CLAUDE.md](../CLAUDE.md).

---

## Status (2026-10-14)

Work ran ahead of the milestone order during the first autonomous sessions, so most of Phases 1–4
exists in some form. Boxes below are ticked only where a test or a measurement proves them.

**Built and playable:** title screen with a live AI demo; skirmish setup (map type, size, seed,
players, teams, colors, AI difficulty and personality, presets, win conditions, fog, weather,
crates, starting money); online lobby and matches over Trystero (room code and link, chat, ready,
host start, snapshots, AI takeover on drop, rejoin by token, host pause); the whole sim (economy,
construction, production, combat with abilities and veterancy, cities with growth, specialties and
militia, 29 techs in 4 eras, doctrines with perks in every era, Command Powers, crates, weather and
day/night, all win conditions, government in exile, the exchange); AI with four personalities and
three difficulties, including naval landings; imported PixelLab art for every unit, building, city
level and deposit, plus scenery props (peaks, trees, farmland, boulders, ruins) and city
landmarks; synthesized audio and music; HUD with victory tracker, getting-started checklist and a
friend-or-foe color mode.

**Our twists added in the latest pass (critic-driven):** lend-lease Supply Drop (pays the income
gap to the leader), Resistance (partisans rise in a conquered city for 2 minutes), Coalition (the
others gang up on a team close to supremacy), supremacy share by player count, Era III/IV doctrine
perks, fair starts (mirrored neutral cities per start), and Call for Help (a team-only flare that
allied AIs answer and fire).

**Fourth critic pass:** Insurgency (knocked-out players fight on with partisan drops and can
re-found their government), named Aces (three-star units with a name and a 10% aura), the Field
Manual (one-time tip cards for each twist), counter hints in tooltips, early AI raids that hurt
instead of ending a learner's game, FFA AIs that gang up on a runaway leader and spare a
struggling player, island AIs that land on a held beachhead, capture rings that grow with city
size, and art passes (snowy-peak mountains, dashed Home Front borders, ship pennants, wheat).

**Fifth critic pass:** contract tenders and liberation bounties, insurgent cells (banked squads
and a war chest), wanted aces (one per player, a bounty on its head), team-game and 1v1 pacing
(supremacy later with more players, a fleeing government in exile, AIs that leave bases alone
until 20:00 on Normal), fighters and navies that fit the enemy, dithered fog and night, frontier
borders, softer mountains, and a HUD column that keeps clear of the powers.

**Sixth critic pass:** Last Stand (a cityless player fights from the HQ), a siege rule and AI
surrender so decided matches end, an Auto time limit for big and naval games, alerts only where
they matter, tenders as real auctions, the naval triangle (depth charges, a sub armor class,
tougher battleships), a field promotion for aces, a Random AI style and a richer Hard, cities as
public landmarks under the fog, dithered smoke, small-screen HUD fixes, and new PixelLab art
(heavy tank, rocket and flak troopers). After it (`pass5.ts`, 6 seeds): 1v1 Small median 18.0 min,
2v2 Medium 17.5, FFA4 Medium 28.6, Easy-vs-Normal (Easy never surrendering) 16.5.

**Measured:** sim tick with 1,000 units 3.1–3.2 ms (was 5.5). AI-vs-AI Normal, after the third
critic pass: 1v1 Small pangaea 11–27 min (mean 17, seeds 1–6); 2v2 Medium pangaea 13–19 min before
it. After the fourth (early raids, prey, insurgency, contracts), 4-way Medium FFA over seeds 1–24:
median 30.9 min, 23–50, all finished (target 30–45), and no seat or start bias over 96 rotated
games; continents 19 to over 60 min. After the fifth (`scripts/dev/pass5.ts`): 1v1 Small median
19.0 min (19.0–20.6), Easy-vs-Normal 19.0, 2v2 Medium 22.6, FFA4 Medium 32.2 (24.0–59.3, all 24
finished: 17 by supremacy, 4 by conquest, 3 by science); 4 Medium island games all end by science
at 46–57 min. Era II at about 6–7 min. Start fairness: the city-count gap between seats is ≤ 1.3 on average in each map
type (`mapgen.test`).

**Live:** https://ycgnem.github.io/pixel-rts/ (every push to `main` redeploys).

**Next:** cross-network online test (M7), a real new player through Boot Camp and First Orders
(M14), and the seventh critic pass (started, stopped before it reported).

---

## Technical approach

### Stack
The same stack as Sprocket & Sprout: **TypeScript (strict), Vite, Vitest, Playwright e2e scripts,
a single Canvas 2D, and our own small engine. No game framework.** Hosted on GitHub Pages and
deployed by GitHub Actions.

Proven pieces are copied from `sprocket-and-sprout` and adapted, never imported across repos: the
fixed-step loop, the seeded RNG and noise, rebindable input, the sprite atlas and pixel helpers,
the bitmap font, jsfxr audio, the e2e harness (`window.__app` hook plus screenshots), the art
pipeline (generate → snap to palette → build sheets), and the Pages workflow.

### How the pieces fit

```
 mouse / keys ──► ui ──► Command ──► transport ──────► HOST: sim.step(state, commands) ──► MatchState
                                    (local, loopback,           ▲                              │
                                     or WebRTC)                 └── AI players emit Commands   │
                                                                                               ▼
 screen ◄── render ◄── view of the state (local state, or interpolated network snapshots) ◄────┘
```

- **`src/sim` holds every game rule, as pure TypeScript.** It never touches the DOM, the
  network, timers, `Math.random`, or the clock. `createMatch(setup)` builds a `MatchState`, and
  `step(state, commands)` advances it one tick and returns events (shots, deaths, alerts).
  `tests/sim-boundary.test.ts` enforces this.
- **`MatchState` is plain data** (objects, arrays, numbers, strings), so it can be cloned,
  snapshotted, sent over the network, and saved as JSON.
- **The sim runs at a fixed 20 ticks per second.** Rendering runs at display rate and
  interpolates between ticks.
- **Deterministic.** The seeded RNG lives inside `MatchState`, and iteration order is stable.
  Networking doesn't need this (the host is authoritative), but it gives us reproducible tests,
  bug reports that are just a seed plus a command log, replays later, and a fallback to lockstep
  networking if bandwidth ever forces it.
- **Commands are the only way to change the game.** A command is a plain object like
  `{ t: 'train', player: 2, building: 41, unit: 'lightTank', count: 5 }`. Human input, AI, and
  remote players all produce the same commands, and the sim checks each one (ownership, cost,
  unlocks, placement).
- **Single-player is a host with no remote peers.** It runs the exact same code path as online play.

### Networking (host-authoritative, peer-to-peer)
- **Transport interface** (`src/net/transport.ts`) with three implementations:
  - `LocalTransport`: single-player, in-memory, no serialization.
  - `LoopbackTransport`: for development. Host and client run in one tab with real serialization
    and fake latency and jitter (`?net=loopback&lag=150`). It catches network bugs from M2 on,
    long before WebRTC exists.
  - `TrysteroTransport`: WebRTC through [Trystero](https://github.com/dmotz/trystero). Signaling
    goes over public Nostr relays by default (the strategy can be swapped), so no server of our
    own is needed. Game data travels directly between browsers and is encrypted end to end.
    Chosen over PeerJS because PeerJS signals through one free public server and is updated less often.
- **Room codes:** the host creates a room with a 6-character code and a join link (`?room=CODE`).
  The code also serves as the room password, so strangers can't read the traffic.
- **Messages:** `hello` (build version and player identity) · lobby state · `cmd`
  (client → host) · `snap` (host → client: a full snapshot on join, deltas after that, 10 per
  second) · `evt` (sounds, effects, alerts, chat) · `ping`.
- **Clients never run game rules.** They render the two latest snapshots about 100 ms behind,
  interpolating between them, and react instantly in the UI (move markers, sounds) while the
  command travels to the host.
- **Bandwidth budget:** no more than 30 KB/s per client in late game. Start with JSON deltas
  (only the fields that changed), quantize positions, and measure with the net overlay. Move to a
  binary format, or filter by what each player can see, only if the numbers call for it.
- **Version check:** Vite puts the git commit into the build. A client whose version doesn't
  match the host's sees "Refresh to update". Every push to main redeploys, so this will happen.
- **NAT traversal:** public STUN by default. An optional TURN server can be set in config for
  friends whose networks block direct connections (see Risks).

### Rendering (Canvas 2D)
- The camera uses integer zoom. Terrain is pre-drawn into chunk canvases (32×32 tiles) that are
  redrawn only when something changes. Sprites are culled to the view and sorted by y. Sprite
  sheets are packed into atlas pages, and team-color variants are made once at load. Fog of war
  is a low-resolution canvas scaled up. The minimap is pre-drawn and refreshed about once a second.
- The UI is drawn on the canvas with a bitmap font, as in Sprocket & Sprout. Join links mean
  hardly anyone has to type a room code.

### Testing
- **Vitest (headless):** sim rules, data validation (every reference resolves), determinism (same
  seed and commands give the same state hash), and scripted mini-matches.
- **Playwright e2e scripts** (`e2e/*.mjs`): drive the real game, take screenshots, and fail on
  console errors.
- **Perf overlay:** fps, sim ms per tick, entity count, and network KB/s.

---

## Milestones

The order is **single-player prototype → AI opponent → online → full feature set → polish.**
Online comes before the tech tree and air/naval on purpose. It is the riskiest part, and it is
the reason the game exists. Any feature added after M8 works online automatically because of
the architecture above.

### Phase 1 — Playable single-player prototype

#### M0 · Project skeleton ✅
Folder layout, TypeScript + Vite + Vitest, the sim boundary test, the Pages workflow, and these docs.
- [x] `npm run dev` shows the placeholder screen
- [x] `npm test`, `npm run typecheck` and `npm run build` pass
- [x] GitHub repo created, Pages source set to "GitHub Actions", and a push to `main` publishes the
      game at `https://<user>.github.io/<repo>/` — `ycgNem/pixel-rts`, live at
      https://ycgnem.github.io/pixel-rts/ (2026-10-14: the workflow's test, build and deploy jobs
      passed; a Playwright check loaded the title, the setup and a match with no console errors)

#### M1 · Engine core, map & camera
Port the engine pieces from Sprocket & Sprout (loop, input, RNG, atlas, font). App shell with a
title screen. `MatchState` and the seeded map generator (terrain, ore, oil, cities, start spots)
for 2–6 players and all 3 sizes. Chunked terrain renderer with placeholder tiles. Camera pan and
integer zoom. Minimap. `e2e/smoke.mjs` and `window.__app`.
- [x] The same seed and settings produce an identical map (test, by hashing the map)
      — `mapgen.test: is deterministic`
- [x] Every start has the same resources within the same distance (test, 50 seeds × all map types)
      — `mapgen.test: gives every start the same resources nearby`
- [x] A Large map pans and zooms at 60 fps (perf overlay) — `node e2e/perf.mjs`, headless Chrome on the dev machine (not capped at 60 Hz): panning and
  switching zoom, a frame every 4.3 ms (p95); ticks plus drawing 0.95 ms a frame (p95 1.3 ms)
- [x] Clicking the minimap jumps the camera; the e2e smoke test passes with no console errors
      — `npm run e2e` (`e2e/smoke.mjs`, 2026-10-14). It caught a real bug: a quick tap on the
      minimap was released before the next frame and never moved the camera.

#### M2 · Units, selection & movement
Entity model. The command pipeline (ui → Command → LocalTransport → sim). Move and stop. Tile
pathfinding on the ground, naval, and air layers (A* with a path cache, group paths with
formation slots, local separation). Selection (click, box, shift, double-click) and control
groups. Render interpolation. Placeholder unit sprites with team-color swap. `LoopbackTransport`
and the net overlay.
- [x] 100 selected units cross a Large map around mountains and lakes without getting stuck
      (headless test, 5 seeds) — `battle.test: 100 units cross a large map`: at least 95 of 100
      arrive on every seed
- [x] 500 moving units render at 60 fps — `node e2e/perf.mjs`, headless Chrome on the dev machine (not capped at 60 Hz): 512 units marching across a
  Medium map, a frame every 4.3 ms (p95); ticks plus drawing 1.9 ms a frame (p95 3.1 ms)
- [x] One sim tick takes ≤ 4 ms with 1,000 units (benchmark test) — 2026-10-14: 3.1–3.2 ms for
      `battle.test` benchmark run alone (4.3 ms while the whole suite runs in parallel), 2.9 ms in
      `scripts/dev/simbench.ts` after warm-up; was 5.5 ms. Separation grid, open-ground shortcut in
      `lineWalkable`, remembered flow-field steps, enemy searches that skip friendly cells
      (`nav.test` proves the shortcuts give the same answers)
- [x] The same session plays correctly in Loopback mode with 150 ms lag — `net.test: plays
      correctly with 150 ms of lag each way` (2026-10-14): `LoopbackHub(auto, lag)` delays every
      message 150 ms on a virtual clock; the start arrives a trip late, the client trails the host
      by 2–4 ticks, an order lands on the host exactly 3 ticks later, and once the network goes
      quiet the client's units, cash, tick and event list match the host's

#### M3 · Economy, construction & production
First slice of `src/data` (units, buildings, economy). Builders place buildings (placement rules,
ghost preview), construct, and repair. Income from mines, derricks, and the HQ. Barracks and
Factory queues with rally points. Supply cap. HUD: resources, selection panel, build and
production buttons with hotkeys and cost tooltips.
- [x] Starting from the opening state, a player can build a mine, derrick, barracks and factory,
      then train Riflemen and Light Tanks — `sim.test` (mine, barracks, riflemen) and headless AI
      matches, which do all of it through the same commands (`scripts/aimatch.ts` logs)
- [x] Changing a cost or build time in `src/data` changes the game with no code edits — the
      2026-10-14 balance pass (city levels, era costs, damage, HQ HP, rocket cost) touched only
      `src/data`, and `scripts/dev/datadump.ts` and the AI match lengths showed the change
- [x] Tests: income over 60 s matches the data; building or training is refused without enough
      money, supply, or the required unlock; the data validation test passes — `sim.test`,
      `data.test`

#### M4 · Combat, vision & victory
Weapons and the damage table from data. Units pick targets automatically. Attack, attack-move,
hold, and stop. Death and destruction. Gun Turret. Fog of war (a visibility grid per team, with
explored memory). HQ destroyed → eliminated → victory or defeat screen. Health bars, hit flash,
placeholder explosions.
- [x] A Small-map sandbox match can be won by destroying a passive enemy HQ, and lost by losing yours
      — `battle.test: destroying the enemy HQ eliminates them and wins` (since the exile rule, only
      when the loser has no city of level 2+)
- [x] Fog hides enemy units outside sight (test and screenshot) — `battle.test: fog: an enemy is
  hidden outside your sight and seen inside it`; the renderer's fog reads the same sim `vision()`
  and skips unseen units (`world.ts`); fog shows in `e2e/out/smoke/02-match.png`
- [x] Damage-table and elimination tests pass — `battle.test: follows the damage table`,
      `destroying the enemy HQ`, `government in exile`

#### M5 · Cities & capture → **prototype complete**
Neutral cities from the map generator. Infantry capture (contest, decay). Levels and growth.
City income, science, and supply. City panel. Level 3+ cities train Riflemen. Science builds up
(it gets spent from M10 on).
- [x] Capturing a city raises income by the amount in the data (test) and the HUD shows it —
  `battle.test: a captured city adds exactly its level's income from the data`; the top bar's
  "+$/m" is `incomeOf` (`hud.ts` topBar)
- [x] Contested captures freeze, and a captured city drops a level (tests) — `battle.test: enemy
      ground units in the circle freeze the capture`, `a city taken from another player drops a level`
- [ ] **Phase check:** a friend plays a 15-minute Small-map match against a scripted enemy base
      and understands what to do without being told

### Phase 2 — AI opponent

#### M6 · Skirmish setup & AI
Skirmish setup screen (map type, size, seed, 1–6 slots as Human, AI or Closed, teams, colors,
starting cash, fog). AI in `src/sim/ai`, issuing normal commands: a build order from data,
expansion to cities, army composition based on what it has seen, attack waves, base defense,
pulling back damaged units. Difficulty levels. A headless AI-vs-AI match runner.
- [x] 20 headless AI-vs-AI matches on fixed seeds all finish with a winner within 60 game-minutes,
      with no crashes — 2026-10-14, `scripts/aimatch.ts`: pangaea small seeds 1–10 (12.6–19.4 min),
      continents small 1–5 (19.0–55.5 min), islands medium 1–5 (19.0–53.2 min)
- [ ] Normal AI beats a passive player and loses to a competent one (playtest notes)
- [x] 5 AIs and 1 human on a Large map stay at ≥ 55 fps — `node e2e/perf.mjs`, headless Chrome on the dev machine (not capped at 60 Hz): minute 20,
  243 units, fog on, a frame every 4.3 ms (p95); ticks plus drawing 0.97 ms (p95 2.0 ms)

### Phase 3 — Online co-op

#### M7 · Rooms & lobby
`TrysteroTransport`. Host creates a room (code plus link). Lobby: slots, teams, colors, ready
button, host settings, chat. `hello` handshake with a version check. STUN, plus an optional TURN
config. Connection status in the UI.
- [ ] Two players on different networks (for example home Wi-Fi and a phone hotspot) join one
      lobby, both by link and by typed code
- [ ] Slot and team changes show up for everyone within 1 s
- [x] A client on an old version gets a clear "refresh to update" message — `net.test: a client on
      an old version is told to refresh` (loopback); the lobby screen shows the reason in red
- [x] Leaving and rejoining the lobby works — `net.test: leaving and rejoining the lobby works`
      (loopback: the seat goes away for everyone, a new connection gets a seat and can change it)

#### M8 · Networked matches
The host runs the sim and sends snapshots (full, then deltas) and events. Clients send commands,
render interpolated snapshots, and show ping. The host validates every command. If a client
disconnects, an AI takes over its side, and reloading the page restores the slot (using a
private rejoin token kept per tab in `sessionStorage`). If the host leaves, everyone gets a clean
"host left" screen. Host pause. Chat and map pings.
- [ ] 2 humans co-op against 2 AIs through a full Medium-map match to victory, with no stalls
- [ ] Late-game download averages ≤ 30 KB/s per client (net overlay)
- [ ] A client can reload mid-match and get its slot back — the protocol is tested over loopback
      (`net.test: a player who reloads (new peer id, same token) gets their side back from the AI`,
      plus a wrong token and a copied token are both refused); not yet tried in two real browsers
- [ ] Orders feel as responsive as local play plus ping (< 250 ms on the test pair)

#### M9 · Teams, free-for-all & 6 players
Mode presets (Solo vs AI, Co-op vs AI, Teams, FFA). Shared vision and ally colors on the minimap.
Sending resources to allies. Allied victory. Spectating after elimination.
- [ ] A 6-way FFA (≥ 3 humans, rest AI) and a 3v3 both play to a finish
- [ ] With 6 players the host stays at ≥ 50 fps and each client at ≤ 40 KB/s at peak — host fps
  measured (see M6); client bandwidth still to measure online

### Phase 4 — Full feature set

#### M10 · Tech tree & science victory
All techs in data (4 eras). Research panel (tree view and queue). Era gating. A generic modifier
system (stat changes defined in data). Research Lab. Launch Site, with a countdown everyone can
see. AI research paths by personality.
- [x] Every tech in `src/data` can be researched, and a test checks its effect — `techs.test`: each
      of the 29 techs is researched by command; its units and buildings go from "needs …" to
      allowed, its stat bonuses switch on, Satellites reveals the map in its window; every stat
      key is read by the sim; Deep Mining measurably raises a mine's pay
- [x] A science victory can be won in a test match, and every player is told when the countdown starts
      — `wins.test: science: a finished launch site starts a countdown everyone hears about, then
      wins` (builders put it up by command); the `launch` event goes to every peer and the HUD
      announces it to all (`hud.ts`, red for enemies, with an alert ping)
- [x] AIs research along their personality's path — `ai.test: researches along its personality's
      path` (4 personalities, 7 min: each player's techs match its plan's order, and they open
      differently)

#### M11 · Air & naval
Airfield, and Dock (must touch water). Aircraft (fly over everything, circle targets). Ships on
water. Transports (load and unload). Submarine detection. AA units and buildings. Coastal Battery.
AI uses air and sea on Islands and Continents maps.
- [x] On an Islands map you can win by invading with transports — `wins.test: islands: an
      invasion by transport ships takes out the enemy HQ` (2026-10-14): two Transports load a
      Heavy Tank, an Artillery and two Rocket Troopers each from our beach, sail to the enemy
      island, land all 8, and the HQ falls at 4:19 of match time with 2 of them left (four
      Heavy Tanks alone do not crack an HQ: it takes siege guns). AI-vs-AI island matches
      still rarely end by 50 min
- [x] AI builds a navy on water maps — `ai.test: crosses water`, and continents AI matches
      (docks, transports and ferried waves; `scripts/dev/ferrytrace.ts`)
- [x] Counters follow the damage table (fighters and AA beat bombers; tests) — `battle.test: air
      counters` (2 fighters, 2 AA guns or 2 flak trucks each kill a bomber of about the same cost)
      and `follows the damage table`

#### M12 · All win conditions & match options
Supremacy. Science (from M10). Time limit with score. Surrender vote. End-of-match stats screen
(army, income, cities, and techs over time). Every lobby option from the design.
- [x] Each win condition ends a scripted test match correctly — `wins.test` (science, launch site
      destroyed, time limit, allied conquest) and `battle.test` (HQ conquest, exile, supremacy)
- [ ] Each one can be toggled in the lobby, and the toggle is respected online — the sim respects
      the toggles (`wins.test: science off`, `supremacy off`) and only the host runs it; conquest
      is always on so a match can end. Not yet checked in a real online match

### Phase 5 — Polish

#### M13 · Art & audio
`docs/STYLE.md` (palette, sizes, outline, team key ramp, facings). Final terrain, units (8 facings),
buildings, a look for each city level, effects. Strategic-view icons. UI skin. Sound effects and
music.
- [ ] **Readability check:** in a screenshot of 300 units from 6 teams fighting at default zoom, a
      tester can name each unit's team and type — `node e2e/readability.mjs` makes the shot
      (`e2e/out/readability/battle.png`, 6 teams × 50 units of 11 kinds, zoom 2). Self-check
      2026-10-14: the six team colours are told apart and the kinds by silhouette; burnt hulls
      looked like a seventh, dark team, so wrecks now have holes, a scorch mark and 80% opacity.
      Still needs a human tester
- [x] No placeholder art left (the art test lists 0 missing sprites) — `art.test`: every unit
  facing (and infantry walk frame), building, city level and deposit is in the imported sheets

#### M14 · UX, onboarding & settings
Tooltips everywhere. Alerts (under attack, city lost, research done) that jump the camera to the
event. A how-to-play / tutorial match. Rebindable keys. Settings (edge scroll, volume, UI scale).
Colorblind-safe team palette option.
- [ ] A new player finishes the tutorial and beats an Easy AI without outside help (playtest) —
  Boot Camp is built (`src/ui/tutorial.ts`); `npm run e2e:tutorial` plays all 10 steps with
  normal commands and checks each ticks off. First Orders guide every newcomer's ordinary match
  too; `npm run e2e:orders` follows them with real clicks on what they point at (passed 4 of 4
  random maps on 2026-10-14). Still needs a real new player.

#### M15 · Performance, balance & saves
Profiling pass. Balance from AI-vs-AI stats (unit trade efficiency, match length per mode).
Single-player save and load. The host can save an online match and re-host it later, and friends
rejoin their old slots.
- [ ] Late game on a Large map with 6 players runs at ≥ 50 fps on a mid-range laptop — on the
  dev machine a 6-player Large match at minute 20 needs about 2 ms a frame (p95); still to try on
  a mid-range laptop
- [ ] Median AI-vs-AI match length is 30–45 min for 4+ players
- [x] Save → load gives an identical state (test, state hash) — `save.test: save → load gives an
  identical state that plays on identically`; `npm run e2e` saves, quits and clicks Continue
  ("save and continue { tick: 92 } -> MatchScreen tick 109")

#### M16 · 1.0
Play link in the README, patch notes, a known-issues list, and a tagged release.
- [ ] 4 friends play a full match from a link with no help

---

## Risks

| Risk | Mitigation |
|---|---|
| Some friends' networks block direct WebRTC (strict NAT, school or work networks) | Public STUN by default. An optional TURN server can be configured (Cloudflare and Open Relay have free tiers). Test across different networks in M7, not at the end. |
| Public signaling relays are flaky | Trystero can switch strategy (Nostr, MQTT, BitTorrent) through config. The transport interface also makes PeerJS a drop-in fallback. |
| Too much upload from the host with 6 players | Deltas, quantized positions, and a 200 supply cap. Measured from M2 through Loopback. If needed: binary encoding, or sending each player only what they can see. Last resort: lockstep, which the deterministic sim already supports. |
| Pathfinding gets slow on 256² maps with hundreds of units | Group paths with formation slots, a path cache, path requests spread across ticks. Hierarchical pathing or flow fields if the M2 benchmark fails. |
| Canvas 2D can't keep up with many units | Chunk-baked terrain, culling, atlas pages, and the strategic view when zoomed out. Measured in M2. A WebGL sprite layer can replace the world draw inside `src/render` if needed, without touching the sim. |
| Pixel art stops being readable at scale | Team-color and outline rules from the start (M2 placeholders already use them). Strategic icons. The readability check in M13. |
| Version mismatch, because every push to main redeploys | Version check in the `hello` handshake (M7). |
| Scope creep | Every milestone ends playable. Anything not in this plan goes in the Later list in GAME_DESIGN §15. |

---

## Decisions log

| Date | Decision | Why |
|---|---|---|
| 2026-10-14 | Same stack as Sprocket & Sprout: TypeScript, Vite, Vitest, Canvas 2D, own engine. **No Phaser or other framework.** | It's what we already use. The proven engine and art pipeline pieces carry over. |
| 2026-10-14 | Host-authoritative state sync over WebRTC (Trystero). No game server. | GitHub Pages hosting. A simple model that is hard to desync. |
| 2026-10-14 | Deterministic sim (seeded RNG, fixed 20 Hz tick, no wall clock) even though networking doesn't need it | Reproducible tests and bugs, replays later, lockstep as a fallback |
| 2026-10-14 | Extractors produce on their own (no worker shuttling) | Fewer entities, less network traffic, and mines become raid targets |
| 2026-10-14 | Online before the tech tree and air/naval | The riskiest system goes first, and later features inherit it for free |
| 2026-10-14 | 32 px tiles in a high top-down ¾ view (not 16 px) | PixelLab units and buildings carry enough detail to read at a glance; integer zoom still applies |
| 2026-10-14 | Buildings from PixelLab `create_object_pro_flash` with a "straight front view" prompt | The isometric and map-object tools gave the wrong angle; Pro Flash matched the ¾ view |
| 2026-10-14 | Added `trystero@0.25.4` (planned in CLAUDE.md); audio is synthesized, so `jsfxr` isn't needed | Planned dependency; Web Audio synthesis covers our sounds without another package |
| 2026-10-14 | Snapshots: compact unit and building rows, one encoder per peer, only changed rows and changed lists, rejects only to their player, a full resync on rejoin | Keeps bandwidth low without a binary format; each peer can be at a different point |
| 2026-10-14 | A dropped player is taken over by a Normal AI (not a held slot) | Teams aren't left a player short; a reconnecting peer gets their side back |
| 2026-10-14 | Rejoin by a private per-tab token (`sessionStorage`), sent in `hello`; never to a seat whose player is still connected | A reload gets a new peer id; per-tab storage lets two local tabs test online play without sharing a seat |
| 2026-10-14 | Speed-ups must give the same answers: derived caches (separation grid, clearance maps, flow-field steps, team masks) only skip work whose result is known | Determinism and JSON round-trips stay intact; `nav.test` checks the shortcuts against the slow way |
| 2026-10-14 | Every command's shape is checked in the sim (`src/sim/validate.ts`) before it is applied | Remote peers are untrusted; a malformed command must never crash the host |
| 2026-10-14 | Stat bonuses to the same key add up instead of multiplying, with a floor | Stacks of techs and doctrines were running away |
| 2026-10-14 | Islands and continents give every start its own landmass (Voronoi sea channels around a neutral middle island) | Fair naval maps: the critic found starts sharing or missing land |
| 2026-10-14 | Government in exile, city militia, the exchange, doctrine perks | Critic pass: comebacks, costly expansion, a sink for lopsided economies, doctrines that change play |
| 2026-10-14 | AI treats start spots as public and must see enemy buildings to target them; scouts unchecked starts | Removes the AI's HQ omniscience without making it blind on the first wave |
| 2026-10-14 | Comeback and anti-snowball twists live in data: lend-lease drop, Resistance, Coalition, supremacy share by player count | Critic pass: leaders ran away with AI-vs-AI games; each twist has its own numbers in `src/data/rules.ts` or `powers.ts` |
| 2026-10-14 | Fair starts: mirrored neutral-city slots per start (rotated frame), random fill only as a fallback | `seatbias`/`startfair` showed some seats with 2+ more nearby cities |
| 2026-10-14 | A research order starts at once only when nothing is researching or queued | An order arriving on the tick a tech completed jumped the queue |
| 2026-10-14 | Scenery props are render-only: a hash of the tile picks them, nothing in `MatchState` | Free variety with no network or determinism cost; props skip tiles under buildings |
| 2026-10-14 | Friend-or-foe colors are a viewer setting (`src/render/colors.ts`), not state | It changes only how one player sees teams |
| 2026-10-14 | Saves are the whole `MatchState` as JSON in one localStorage slot (`src/app/saves.ts`); `SAVE_VERSION` refuses saves from an older state shape | Rule 7 makes state plain JSON, so a save is free and exact; AIs restart their short-term memory on load |
| 2026-10-14 | Third critic pass: a launch can be scrubbed by infantry, repairs are capped and stop under fire, AIs guard their own site and paradrop onto a rival's | All six launches in the critic's runs won exactly 240 s after starting; nobody could stop one |
| 2026-10-14 | The assault ring is a sim rule (any group move onto a city), not AI or UI logic | Players and AIs get the same behavior from the same command; the city and its fight stay readable |
| 2026-10-14 | Oil made scarce (derricks 1 oil/s, vehicle and ship oil costs up 30–70%) and Rocket Troopers buffed against armor | The critic found 1,000–1,500 oil banked with cash near zero, and rockets losing to Light Tanks cost for cost |
| 2026-10-14 | Home Front territory is worked out from cities and HQs (render caches its own tile map); it heals, and the auto-dig half is off by data | No new state or protocol; auto-dig at home made AI 1v1s shorter (11.7 vs 14.1 min mean over 6 seeds) |
| 2026-10-14 | Merchant convoys are ordinary units (kind `merchant`, never trained) driven by a sim step, with no per-city state | Reuses movement, combat and snapshots; a per-player cap stands in for per-city bookkeeping |
| 2026-10-14 | End-of-match chronicle and strategic-zoom badges are UI-only | They read events and state; nothing new to send or save |
| 2026-10-14 | Call for Help is a power (an effect in state) rather than a chat ping | The AI reads state, not chat, so the same flare works for humans and AIs, online and off |
| 2026-10-14 | `LoopbackHub` takes a one-way lag on a virtual clock (`advance(ms)`) instead of real timers | Lag tests stay deterministic and fast; the real lobby, host and client code runs unchanged |
| 2026-10-14 | AI sea landings hold a beachhead (one beach per wave, out of known gun range) and fall back to it when thinned out | Ferried troops used to walk into the enemy one boat at a time; island 1v1s often had no winner by 60 min |
| 2026-10-14 | The supremacy clock opens 5 min later per team beyond two, and FFA AIs prefer targets of a runaway leader by public score | FFA4 AI games ended at 20–30 min (median 25) by one early snowball; the leader rule uses the Stats panel score, so the AI stays fair |
| 2026-10-14 | AI think ticks are evenly spread over the think interval (`player × think / players`) | The old `player × 7` offsets let one seat always think just before its neighbour |
| 2026-10-14 | Extra ore and oil are placed per start beside its own slot cities, at one shared angle | They used to go round a list of cities in turn, so in 4-player games start 1 averaged 6.3 ore deposits on its side and start 0 had 5.4 (odd seats won 16 of 24 AI FFAs); `mapgen.test: favours no start on average` |
| 2026-10-14 | Early AI waves prefer economy targets and are capped in size (`AiLevel.hqFrom`, `earlyUntil`, `earlyWave`); before 20:00 FFA AIs leave a struggling player alone | The fourth critic pass found a new player's first loss was one early wave on the HQ; an Easy AI standing in for a learner now lasts 11–16 min against Normal (was 10–12) |
| 2026-10-14 | AI coastal buildings must face the largest sea, and ferries and warships come only from docks on it | On islands the AI built docks on inland lakes and its invasions never sailed |
| 2026-10-14 | Counter hints ("Beats / Countered by / Can't hit") are computed in the UI from unit data (`src/ui/counters.ts`) | They stay right whenever balance changes, with no hand-written table to drift |
| 2026-10-14 | The Field Manual (one-time tip cards for each twist) is UI-only, remembered per browser in localStorage | It reads events, so it needs no state, works online, and never repeats once read |
| 2026-10-14 | Capture radius and the assault ring grow with city level (`CAPTURE.radiusPerLevel`, `ASSAULT.holePerLevel`) | Bigger cities are drawn bigger; a fixed ring put attackers on top of large cities' art |
| 2026-10-14 | Aces (three-star units) are derived from `vet`, with names hashed from the unit id; the aura is a per-tick derived cache | No new state or protocol: every peer computes the same aces and names; `wins.test: aces` |
| 2026-10-14 | Insurgency: a knocked-out player keeps three small state fields (`insurgeAt`, `rising`, `risingAt`) plus `held` cities, commands only their own units, and drops partisans with an `insurge` command; capture counts their units, the economy pays them nothing (`PROTOCOL_VERSION` 5, `SAVE_VERSION` 3) | The critic found first-out players spectating for 25–45 min. Over 24 4-way AI FFAs (seeds 1–24, Medium) the median length went 30.6 → 32.6 min, every match finished (one hit the 60-min cap before), and 3 knocked-out AIs re-founded and fought on; `insurgency.test` |
| 2026-10-14 | A knocked-out player with no teammate left sees the whole map (render-side fog only) | They could not find a city to drop partisans at under fog; a team that still has a player keeps its normal vision, so no extra intel reaches a live team |
| 2026-10-14 | Mountains use a new PixelLab "pro" tileset (snowy peaks, shaded slopes); Home Front borders are dashed lines over a shadow | The critic read the old mountains as cobblestone walls and the solid borders as noise; a second standard-mode tileset came out blocky again, so the pro pipeline (15 generations) was worth it |
| 2026-10-14 | City contracts: one public job at a time in `MatchState.contract` (plain data), posted at one of the 3 neutral cities most evenly placed between the living players (seeded pick); a supply job is filled by a `contract` command and hands the city over through the normal `capture()`; AIs hold cash back for a supply job near home (`AI_CONTRACT`) | FFAs needed a focal point and new players a goal. Over 24 4-way AI FFAs (seeds 1–24, Medium, with insurgency): 27 jobs filled in 17 games (22 supply, 5 hold), median length 30.9 min (23–50, all finished). Before the cash hold-back, AIs filled no supply job in 8 1v1s; after it, 9 in 6 of 8; `contracts.test` |
| 2026-10-14 | Contract tenders replace first-come supply jobs: the first bid (at least 2 minutes of the city's cash) opens a 30 s tender, each bid tops the last by 15%, the highest that can still pay buys the city through `capture()`, and a city taking bids can't be captured meanwhile; jobs post only where the living HQs are within 25% of the mean distance, hold jobs only at cities of level 2 or less; with no fair neutral city left, a **liberation bounty** goes on a runaway leader's city (score over 1.3× the average) and its taker is paid and keeps the city's level (`PROTOCOL_VERSION` 6: the contract rides in snapshots, which also fixes online clients never seeing contracts) | The fifth critic found supply jobs an AI reflex race (23 of 25 filled, median 24 s), hold jobs at L4 cities nobody could take, 1v1 posts up to 2.6× nearer one side, and no jobs at all once the map filled; `contracts.test` |
| 2026-10-14 | Insurgent cells: drops bank as charges (one per 90 s, up to 3) and a drop sends them all; the knocked-out player's frozen cash is a war chest that buys a Rocket Trooper per squad ($250); a cell lands hidden for 15 s or until it fires (`Unit.hide`, carried in snapshots; one `stealthy()` check replaces the submarine-only ones); the AI drops only where its bank can take the city or when the bank is full, and avoids cities with enemy units (`AI_INSURGENCY.danger` 4, counting every unit when it has no teammate left, as a knocked-out human sees the whole map); one comeback per player per match (`INSURGENCY.comebacks`) | One squad every 90 s mostly landed on armies and died (83 drops, 8 captures in the critic's runs); the cash sat unused ($2,300 in one seat). With hidden landing, players re-founded and fell again in a loop (one FFA hit the 60-min cap with 3 comebacks). Over 24 FFAs 33 of 118 drops took a city (28%; the rest include reinforcing a city already held); counting attacks only, 13 of 28 took one (46%) in 9 traced FFAs (scripts/dev/drops.ts); 10 comebacks; `insurgency.test` |
| 2026-10-14 | Wanted aces: at most one ace per player, kept on the player (`ace`, `aceNames`: names unique in the match and per player), promoted once a second from the most experienced three-star unit; aura +15% within 5 tiles; killing an ace pays $300 + 2 CP (`aceDown` event); ground and sea units earn half veterancy from aircraft (`VETERANCY.vsAir`); `PROTOCOL_VERSION` 7, `SAVE_VERSION` 5 | Aces had stopped being special: 8–52 per match, up to 13 alive at once, two of one owner sharing a name, and flak 7 of 8 of them. Now 1–20 aces per FFA, one at a time per player, 81% of them killed for the bounty; `aces.test` |
| 2026-10-14 | Team pacing: the supremacy clock opens at 15:00 plus the larger of 5 min per team beyond two and 2.5 min per player beyond two (2v2: 20:00), and two teams of 4+ players need 75% of the cities | 2v2s ended at the first legal moment (supremacy at 19.0 and 20.4 min, conquest at 18.8); `wins.test: a 2v2 opens later` |
| 2026-10-14 | Government in exile flees: a new capital is the largest city with no enemy fighting unit within 10 tiles (else the largest, farthest from them), and an exiled capital takes 2.5× as long to capture (was 1.5×) | The capital used to be the largest city even with the attacking army on it (23 s of exile in a critic duel); `battle.test: the government flees` |
| 2026-10-14 | AIs leave enemy bases alone until `AiLevel.hqFrom` (Easy 25:00, Normal 20:00, Hard 8:00): no wave targets anything within 12 tiles of an enemy HQ, a wave with nothing left to hit goes home, and wave units that pick an HQ on the way walk on | The HQ used to die as collateral of raids on nearby cities and derricks (traced in `scripts/dev/hqtrace.ts`), so `hqFrom` as a mere target weight changed nothing: an Easy seat lasted 10.8–13.6 min against Normal. Measured (`scripts/dev/pass5.ts`): Normal 1v1 Small median 16.6 → 19.0 min (19.0–20.6, 11 of 12 by supremacy at the first legal moment), Easy-vs-Normal 16.1 → 19.0, 2v2 Medium 19.6 → 22.6; `ai.test: leaves an enemy base alone` |
| 2026-10-14 | AI air and sea: fighters keep to their share of the whole army (a producer with one unit to offer used to train it forever), get the anti-air boost only while enemy bombers were seen lately (`AI_ANTI_AIR.enough` 0.1); island AIs build 2 docks, and a loaded ferry waits up to 90 s for 2 warships per ferry at sea | Pangaea had 74 fighters against 12 bombers, a 1v1 12 fighters against no aircraft at all; islands had 11 destroyers and 133 fighters across four AIs. Now FFAs build about as many fighters as bombers, and a 1v1 1–3 fighters. 4 Medium island games all end by science at 46–57 min, with 128 warships and 176 transports built |
| 2026-10-14 | Fog edges and night are dithered: zoomed in, both are drawn on a world-anchored grid of 4-art-pixel cells with a 4×4 Bayer pattern between a few alpha levels (`render/dither.ts`); the strategic view keeps the smooth tile map | The critic found fog and night the only non-pixel layers (smoothed upscale, radial gradients) |
| 2026-10-14 | Art: Home Front borders only where two teams' claims meet; the snowy mountain tileset one ramp step softer (no white, no near-black), no peak props on top of it; wheat and hay recoloured off the team ramps (olive and tan); an ace wears a gold star | The critic read borders as circuit traces across fields, mountains as the loudest texture on the map, and Gold's army as standing in a wheat field |
| 2026-10-14 | HUD left column stops above the powers strip: Field Manual cards wait while a doctrine is being chosen or there is no room, and hide (with the objectives) on the end screen; the doctrine card is 200 px wide with three lines per perk | The column covered the Recon/Drop power buttons and cut doctrine perks off; `e2e:readability` screenshot |
| 2026-10-14 | FFA (24 seeds, Medium, 4 Normal AIs) after the fifth pass: median 32.2 min (24.0–59.3), all 24 finished (17 by supremacy, 4 by conquest, 3 by science) | Target 30–45 min |
| 2026-10-14 | Last Stand: a player who held cities and lost them all but keeps the HQ gets a supply floor of 40, Riflemen and Rocket Troopers from the HQ, and a free defender every 30 s (up to 6); `Player.lastStand` | 1v1s had dead minutes between the last city falling and supremacy; now the loser fights at the gates, and the siege rule lets AIs finish them |
| 2026-10-14 | Siege rule and AI surrender: from `AiLevel.siegeFrom` (Easy 25:00, Normal 15:00, Hard 8:00) early-raid sparing no longer protects a player in a last stand; an AI with no city, no ally and under a tenth of the strongest army for 60 s after 12:00 surrenders | Matches no longer wait out a decided ending. A first version (sparing only players who own a city) cut Easy-vs-Normal games from 19.0 to 11.5 min: a learner who lost or never took a city lost the HQ at once |
| 2026-10-14 | Cities are public landmarks: unexplored cities draw a grey pin and name over the fog, a grey minimap dot, and can be selected (the panel says only "unexplored") | The critic's new players had no idea where to go; names are public in every real map |
| 2026-10-14 | `AiLevel.income` (Hard 1.1) multiplies an AI's cash, oil and science income in `incomeOf` | Hard beat Normal only 12 of 28 times; +15% income won 19 of 24 in the critic's probe |
| 2026-10-14 | A Random AI style is settled in `createMatch` from `hash2(seat, 7, seed)` into a copy of the setup (the caller's setup is left alone); new AI seats default to it, and the end screen reveals the styles | Every preset gave Balanced AIs; the hash keeps every machine and a replay in agreement without touching the sim RNG |
| 2026-10-14 | Tenders open at posting for 90 s; a bid with under 15 s left pushes the close to 15 s; borders (a Home Front claim reaching the city) count as presence; holds up to level 4 pay +$100 per level; bounties need 3+ teams | The 30 s tender opened by the first bid was easily sniped; 2-team bounties were 0 for 51 |
| 2026-10-14 | Naval triangle: a `sub` armor class, a destroyer depth charge (hitscan, 45 dmg, ×1.6 vs subs only), torpedo ×1.5 vs ships, shell ×1.0, battleship 2,400 HP for $1,000 + 200 oil; heavy tank 820 HP; transports 600 HP | Equal-value duels (critic probe, at a budget both sides can spend): battleship > destroyer 83–0%, destroyer > sub 40–0%, sub > battleship 57–0%; heavy tank beats light tanks 20–9%, rockets still beat it 27–5%. A projectile depth charge missed moving subs, so it is hitscan |
| 2026-10-14 | Time limit "Auto" (`timeLimit: -1`, the lobby default): 45 min with 5+ players or on Continents and Islands, none otherwise (`timeLimitOf`); the tracker shows the score race in a limit's last 10 min | FFA6 Large had no winner at 60 min in 3 of 4 runs and naval 4p ended by science in 7 of 8 |
| 2026-10-14 | Aces get a field promotion (healed, +25% max HP while the ace, in `unitMaxHp`), a star twice the pip size, and the AI pulls its ace home under 40% HP | Aces died within seconds of their naming; the AI threw its ace away |
| 2026-10-14 | AI production saves for big-ticket units (cost ≥ $800) for up to 2 min: that producer goes first and its price is kept back; Rotorcraft moved up the AI research lists | 0 battleships in all critic runs and 4 helicopters on islands; after: 2 battleships and 6 helicopters in 3 island games, Rotorcraft at 14–17 min on pangaea |
| 2026-10-14 | UI scale floor 600 × 320 (was 340): a 1366 × 768 laptop with browser chrome (1366 × 657) gets scale 2; F1 help pages when it doesn't fit; the message feed drops below the tracker when they would overlap; the start camera frames the HQ and nearest ore clear of the bottom panels | Critic shots at 640 × 360 and 1366 × 657 |
| 2026-10-14 | Smoke screens are dithered cells on the world grid (`WorldRenderer.smoke`, `SMOKE_LEVELS`), and the bars of units inside are drawn again on top | The old translucent vector circles broke the pixel rule, and smoke hid the HP bars |
| 2026-10-14 | Terrain: a cell where a grass-based terrain (mountain, forest, hills, road) meets water or sand also paints the sand and grass it stands on under it | The mountain tile's transparent fringe showed open water as holes along mountain coasts |
| 2026-10-14 | Terrain is painted per pixel (`src/render/painter.ts`) instead of from Wang tilesets: bilinear terrain fields plus noise give organic edges; water depth from a chamfer distance field; south faces (cliffs, banks) drawn inside the higher tile; forests and mountain ranges baked as y-sorted PixelLab tree and peak sprites; per-chunk animated wave layer; strategic-zoom chunk copies at ¼ size, baked a few per frame with a coarse map in the gaps. `src/art/terrain.*` removed (`scripts/import-terrain.mjs` kept for reference) | The user asked for a map people enjoy looking at: the tile grid showed as stair-step coasts and roads, hedge-block forests and flat slabs for mountains. Painting costs 25–60 ms per 512 px chunk in headless Chrome; `e2e/perf.mjs` still 190–240 fps |
| 2026-10-14 | WASD pans the camera; card hotkeys moved off W/A/S/D: attack-move Q, stop X, first ability E (second F), Drop V, Airfield E, Dock N, Scout Car C, Artillery R, Destroyer R, Submarine U. Wheel zoom: one step per notch (deltas add up to a notch, then 130 ms pause) and eased over a few frames (`Camera.zt`, `Camera.update`) | The user asked for WASD and found the zoom odd: trackpads sent a burst of events that skipped several zoom levels; `e2e/controls.mjs` |
| 2026-10-14 | Render-only ambience (`src/render/ambient.ts`): a tileable dithered cloud-shadow pattern drifting with the wind, and bird flocks with ground shadows (Math.random is fine here: nothing reaches the sim) | Life on the map without touching determinism |
| 2026-10-14 | Map critic pass (subagent comparing before/after screenshots; first verdict 5/10 → 7/10): hills repainted as pale plateaus with a contour and lip; solid rock under every mountain cell and denser peaks; farmland moved to `src/render/farmland.ts` (varied plots, ring grows with city level, tilled only where all of a plot is plains); rich-ore ground textured; deeper blue sea and fewer sparkles; scarecrows, deer, goats and ponds dropped (read as units or impassable water); clouds fainter and off in the strategic view | The critic found hills had vanished (they give sight), thin ridges looked walkable, fields reintroduced the tile grid, and props were misread |
| 2026-10-14 | Scenery never overlaps: props test their opaque sprite box against baked trees and peaks (`TerrainLayer.blocks`) and crops; the painter tests every tree and peak box against roads, cities, deposits, bases and the beach | `e2e/overlap.mjs` found 338 overlaps on 4 maps; now 0 of ~108k sprites. Props build in 76 ms on a Large map |
| 2026-10-14 | Scenery props are hidden on and next to building footprints (render only) | A tree beside a building was drawn over it |
| 2026-10-14 | New PixelLab art: Heavy Tank at 56 px in the Light Tank's style (long barrel, skirts), Rocket and Flak Troopers at the Rifleman's size, told apart by helmet colour; 30 generations | Infantry types and the two tanks were near-identical at zoom 1–2 (critic six) |
| 2026-10-14 | One guide engine for Boot Camp and **First Orders** (every newcomer's skirmish or online match): each step returns a hint for the current selection and open panels, pointing at a map spot or a HUD button the HUD records each frame (`Hud.marks`); replaces the hover-only "Getting started" checklist | Playtest: in a Quick battle a newcomer saw five tiny lines and had to hover to learn what to click; research and mining were not self-explanatory. Still UI only (rules 3, 6) |
| 2026-10-14 | Field Guide on the title screen (`src/ui/guide.ts`): units and buildings from the data files, with turning sprites and team-colour swatches; weapon names moved to `ui/counters.ts` to share with the HUD | A newcomer had no way to look units up outside a match; UI only, so it can't drift from balance |
| 2026-10-14 | Busy crews: a human player's idle Builders auto-join unfinished buildings (fewest Builders first, then nearest, within `PRODUCTION.autoRadius` 60 tiles, every `autoEvery` 10 ticks; `stepCrews`); a placement with several Builders selected goes to one (`leadBuilder`: idle → from a crowded project → least busy), the rest join only if idle, and Shift-queued placements spread over Builders. AI excluded (it places its own crews) | User: "the builders are idle while one works … one builder per project". Tests: `sim.test.ts` "idle Builders join…", "queued buildings go to different Builders" |
| 2026-10-14 | Maps grew: Small 144, Medium 224, Large 288 (were 128/192/256). Medium is 224 not 216: 216 put the continents 4p city-gap metric at 1.37 (limit 1.3), 224 at 1.17, and 224 is a whole number of 16-tile render chunks | User: "expand the map a little, felt a bit easy to get tanks and kill everyone". `node scripts/run.mjs scripts/dev/cityfair.ts` |
| 2026-10-14 | A procedural river with two bridges on Pangaea and Lakes (`MAPGEN.river`, `carveRiver` in mapgen): a quadratic curve from the edge through the middle, each half along a gap between neighbouring starts, fbm meander tapering to zero in the middle; bridges `bridgeAt` 0.2 × size from the middle on each half, squared to the river's course over ±2 tiles; new terrain `T.BRIDGE` (ground 1.3, naval, not buildable); roads routed over both bridges; bridges stored as decks on `GameMap.bridges` for the painter (cobbled deck, stone parapets, face and drop shadow) | User asked for a river through the map with 2 bridges, procedural or PixelLab: procedural keeps it seeded and free. `mapgen.test.ts`: exactly 2 bridges, every start reachable, without bridges the sides split as evenly as the player count allows (20 maps); `e2e/bridges.mjs` screenshots |
| 2026-10-14 | Moves give up only after 6 s without progress **along the path** (flow-field distance), and while pressed against moving friendlies a tick counts 0.2 (`SEPARATION.queuePatience`) | With a river, columns detour away from the goal toward a bridge and queue to cross; straight-line progress made them quit (100-unit cross: 12/100 arrived on one seed). Now 100/100 on all 5 seeds (`scripts/dev/bridgecross.ts`) |
| 2026-10-14 | Tanks later and dearer: Factory needs a finished Barracks (`BuildingDef.needs`, `missingBuilding`) and costs $700 / 50 s; Light Tank $300 + 55 oil, 18 s, 380 HP (was $250 + 45, 14 s, 320); start oil 100 (was 200) | User found tanks too easy. The HP bump keeps the Light Tank the Rifleman's counter in the cost-for-cost estimate (edge 1.37; at 320 HP it fell to 1.10) |
| 2026-10-14 | Oil explained in place: top bar "N oil" plus a gold "build a Derrick" while no oil comes in; oil prices on every button (`ButtonOpts.oil`); hover tips on open oil wells and ore fields; specific shortfall rejects (`shortfall`: "need 20 more oil (Oil Derricks on oil wells make oil)") | User: "I didn't realize what oil did for a good min" |
| 2026-10-14 | City specialty chooser as a panel like the doctrines (every option with its effect, one click, Show button, shrinks to fit above the powers) and a blinking "pick a specialty!" under the city | User: took 5 minutes to find out what the specialty prompt was |
| 2026-10-18 | Building cap: `BUILD_CAP` 21 + 4 per city held (first 15 + 3, then 20 + 3, raised at the user's request) (HQ excluded, unfinished buildings count); the `build` command rejects past it, the AI stops planning new buildings, the build menu greys out and shows "Buildings n/cap" | User: spamming AA Guns was too strong; asked for a total building cap that scales with cities. Hard AI peaks around 23 buildings with 3–6 cities (`scripts/dev/buildcap.ts`, seeds 1–3, 30 min), so the cap doesn't cramp a normal build. `tests/buildcap.test.ts` |
| 2026-10-18 | Selling troops: a `sellUnits` command (Delete twice, like a building's Sell) pays `PRODUCTION.unitSellRefund` (50%) of the cash and oil cost times the unit's HP share (`unitSellValue`); merchant ships (not trainable) and loaded transports can't be sold; a sale doesn't count in `unitsLost`. `PROTOCOL_VERSION` 10 | User asked to sell buildings and troops (buildings already sold for 50% cash). HP scaling keeps selling a dying unit from being a free refund. `tests/sell.test.ts`; sold 4 Riflemen through the real button in the dev build |
| 2026-10-21 | A harsher economy: Buy Oil $1,250 per 100 (`EXCHANGE.trades.buyOil.pay`, 5× the old $250; heat and cooling unchanged), and the AI buys only with $4,000 spare (`AI_TRADE.buyOilCash`). Launch Site $100,000 + 5,000 oil; the AI builds one only with the money in hand and never saves for it (it used to save for its next planned building, which at $100k would have frozen its army) | User: "the economy needs to be more brutal" (asked 10×, then settled on 5× with the same scaling), and a rocket that costs 100k and 5k oil. `sim.test` exchange case; `wins.test` budgets raised |
| 2026-10-21 | Ground units +7.5% HP and damage (every `layer: 'ground'` unit, the numbers rewritten in `src/data/units.ts`, rounded to a whole HP and a tenth of damage); Bomber damage 120 → 108 | User asked for the buff (infantry and vehicles) and a 10% bomber nerf; damage, not HP, for the nerf, so the buff touches both for the ground |
| 2026-10-21 | Mega Tank (Factory, Composite Armor) and Mega Plane (Airfield, Jet Engines): $1,000 + 1,500 oil, supply 8, `UnitDef.limit` 3 each (living plus queued: `unitCount` / `limitReached`, checked by the `train` command, the train button and the AI). Their own abilities: Steamroller (`STEAMROLL`: ×1.4 speed, 90 dps to enemy infantry under the tracks) and Carpet Bomb (`CARPET`: a bomb every 0.4 s for 4 s under the plane), both in `stepMegaAbilities` every 4 ticks. Art: PixelLab 8-direction objects, no style reference (`a69afafe…` 88 px, `ac8186cc…` 112 px; 30 generations), kept at the generated size (about 2× a Heavy Tank and 1.7× a Bomber by area: the user said that difference is fine) | User asked for a mega plane and tank at 1,500 oil, 3 at a time, made with PixelLab and "unique as hell". The first two jobs (styled on the Heavy Tank and Bomber) were cancelled unbilled. The $1,000 cash on top of the oil is our call. `tests/mega.test.ts`. AI-vs-AI (4 Normal AIs, Medium Pangaea, seeds 1-3, `scripts/aimatch.ts`): supremacy wins at 39.9, 31.6 and 32.6 min with normal armies; no AI banked 1,500 oil, so none built a mega unit |
| 2026-10-21 | Builder work zones: a `zone` command sets `Unit.post` ({x, y, r, leg, wait}; `WORK_ZONE`); `stepCrews` gives a zoned idle Builder only sites and repairs inside it (`zoneWork`), walks it back when it strays and around six edge stops otherwise; Move and Stop clear it, Build keeps it. Sent in snapshots as a unit row field | User: Builders "continuously sprint around"; asked to post one to a perimeter. `tests/zone.test.ts` |
| 2026-10-21 | Sell hotkey Z (twice) on units, buildings and Cancel; Delete and Backspace as `ButtonOpts.altKeys`. Selling with several buildings selected sells them all | User asked for a sell hotkey: Delete existed but never showed on the button and many laptops hide it behind Fn |
| 2026-10-21 | Slimmer snapshots (`PROTOCOL_VERSION` 11): move rows for units whose only changes are position, facing, HP, flags, fire and target; players' and cities' fast numbers (`pv`, `cv`) apart from the full objects, which go only when something else changes; one `snapshotFrame` per tick shared by every peer's encoder | User: 4-player games got laggy. `scripts/dev/netbench.ts` (4 Normal AIs, Medium, minute 25): 22.6 → 7.4 KB per snapshot, host upload 677 → 223 KB/s for 3 peers, encoding for 3 peers 1.11 → 0.43 ms. `net.test` streams a 4-minute AI match through JSON and compares the client's state |
| 2026-10-21 | Terrain chunks paint a slice at a time (`Painter.paintSteps`, 16 rows a step) within 8 ms a frame for chunks on screen and 4 ms for the ones ahead of the camera's motion; a chunk still painting shows its quarter-size copy or the coarse map; only the first frame paints all it shows; the cache keeps at least the view plus a ring | The open perf item from the river patch, and part of the lag report. `e2e/perf.mjs` large-pan-zoom: work p95 59.6 → 12.1 ms, frame gap p95 58.3 → 12.5 ms (worst frame 18 ms); the static late-game cases' p95 rose from 5 to about 12 ms because painting ahead now spreads over frames instead of landing in rare 40 ms spikes; no painting step is over 4.6 ms (`e2e/out/slices.mjs`) |
| 2026-10-21 | Rocket countdown banner (`Hud.launchBanner`) and pad beacon; the science finale (`src/render/finale.ts`, render only): liftoff, flash, then a ragged ring of fire over every land tile joined to the pad, scorched overlay kept behind the end screen; the fanfare waits for it; any key skips | User asked for a much more visible rocket timer and an animation that blows the whole island up. Screenshots: `node e2e/mega.mjs` |
| 2026-10-21 | `MatchSetup.river` (on unless false): River On/Off in the setup for Pangaea and Lakes | User asked for maps with no river. `mapgen.test`: river off gives no bridges and every start reached by land (10 seeds, both map types) |

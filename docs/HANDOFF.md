# Handoff

Running notes for whoever (human or AI session) picks this up next. Newest status first.

## Status

**2026-10-14 (latest) — sixth critic pass: endings, auctions, the naval triangle, small screens.**
Everything below still holds; this session added (nothing committed yet):

- **Endings:** *Last Stand* (`src/sim/laststand.ts`, `LAST_STAND`): a player who lost every city
  but keeps the HQ gets a supply floor of 40, HQ-trained Riflemen and Rocket Troopers and a free
  defender every 30 s. *Siege*: from `AiLevel.siegeFrom` (Normal 15:00) AIs stop sparing the
  base of a player in a last stand. *AI surrender* (`AI_SURRENDER`): hopeless, alone and cityless
  after 12:00 for a minute. *Time limit Auto* (`timeLimit: -1`, `timeLimitOf()` in `victory.ts`):
  45 min with 5+ players or on Continents/Islands; the tracker shows the score race at the end.
- **Alerts** only for hits on your buildings or on your units on your own ground, one per 20-tile
  area per 20 s (`ALERTS`, `Player.alerts`); new sounds (contract bell, HQ fall, outbid, unrest).
- **Tenders are auctions:** open from the posting for 90 s, a late bid pushes the close to 15 s,
  borders reaching the city count as presence (`bordersReach`); holds up to level 4 pay +$100 a
  level; no bounties with two teams.
- **Units:** naval triangle (`sub` armor class, destroyer depth charges, torpedo ×1.5 vs ships,
  battleship 2,400 HP for $1,000 + 200 oil), heavy tank 820 HP, transports 600 HP. Aces get a
  field promotion (+25% HP, healed) and a bigger star; the AI pulls a hurt ace home.
- **AI:** Hard +10% income (`AiLevel.income`); a *Random* style (default for new AI seats,
  settled from the seed in `createMatch`, revealed on the end screen); it saves for big-ticket
  units (battleships) and researches Rotorcraft earlier.
- **Readability:** cities are public landmarks (grey pin and name over the fog, selectable);
  smoke is dithered pixel cells and units in it keep their bars on top; insurgents see their
  hidden squad faded; the drop odds count enemy units in the ring.
- **Small screens:** UI scale floor 600 × 320 (1366 × 657 gets scale 2), F1 help pages, the
  message feed drops below the tracker, the Field Manual waits during a specialty choice, the
  Boot Camp edge arrow sits above the panels with a smaller click box, the start camera frames the
  HQ and the nearest ore above the panels.
- **Art (PixelLab):** new Heavy Tank (56 px, long barrel with a muzzle brake, skirted hull), and
  Rocket and Flak Troopers whose helmets set them apart from the team-blue Rifleman (dark olive
  with a rocket pack; light tan with yellow goggles). `assets/units.json` points at the new
  PixelLab ids; the old downloads were moved out of the repo. PixelLab: 2,485 of the 2,694
  generations allowed now used (30 this pass).
- **Field Guide** (`src/ui/guide.ts`; title screen G, and the in-match menu): every unit and
  building with a turning sprite in any team colour, numbers, weapons, ability and matchups.
- **Render fixes:** mountains (and forest, hills, road) beside water stand on a painted sand and
  grass shore (no water holes through their fringe); props are hidden next to buildings; health
  bars clamp at full.
- `PROTOCOL_VERSION` 8 (Auto time limit and Random style in setups, new armor and weapon classes).
- **Measured** (`scripts/dev/pass5.ts`, Normal AIs, 6 seeds): 1v1 Small median 18.0 min
  (14.2–20.6, all by conquest), 2v2 Medium 17.5 (16.4–19.3), FFA4 Medium 28.6 (26.1–37.7);
  Easy-vs-Normal with the Easy seat never surrendering (`--human 0`, a stand-in for a person)
  16.5 (16.2–17.0). Naval duels at equal value: battleship > destroyer 83–0%, destroyer > sub
  40–0%, sub > battleship 57–0%. Island AIs: 2 battleships and 6 helicopters in 3 games (were 0
  and 4).
- Things to watch: 2v2 is now shorter than the fifth pass (17.5 vs 22.6 min) because the siege
  finishes a beaten team. Seats 0–1 won 5 of 6 2v2 seeds; swapping the team labels gives the same
  results (it's the seats, not the team id), and allies at seats 0 and 2 instead split 4–2 with
  longer games (median 21.0 min). Six seeds each: not enough to call it a bias yet.
  Battleships are still rare (their 200 oil competes with tanks).

**2026-10-14 (earlier) — fifth critic pass: tenders, insurgent cells, wanted aces, pacing.**
Everything below still holds; this session added (nothing committed yet):

- **Contract tenders and bounties** (`src/sim/contracts.ts`): supply jobs are a 30 s tender (Bid
  button, P; +15% per raise, the top bid that can still pay buys the city; no capture while
  bidding), posted only where the HQs are evenly far; hold jobs only at small cities; with no fair
  neutral city left, a **liberation bounty** on a runaway leader's city. `PROTOCOL_VERSION` 6 put
  the contract in snapshots (online clients never saw one before).
- **Insurgent cells** (`src/sim/insurgency.ts`): squads bank as charges (up to 3) and a drop sends
  them all; the frozen cash is a war chest (a Rocket Trooper per squad, $250); a cell lands hidden
  for 15 s or until it fires (`Unit.hide`, `stealthy()` in `vision.ts`). HUD: charges on the Drop
  button and panel, odds for the whole bank. AI waits for a takeable bank, avoids armies.
  One comeback (re-founding) per player per match: knocked out twice is out for good.
- **Wanted aces** (`src/sim/aces.ts`): one ace per player, stored on the player (`ace`,
  `aceNames`), unique names, +15% within 5 tiles, a $300 + 2 CP bounty, a gold star over it
  always; flak earns half veterancy from aircraft. `PROTOCOL_VERSION` 7, `SAVE_VERSION` 5.
- **Pacing:** supremacy opens later with more players (2v2: 20:00) and a 2-team game of 4+ needs
  75%; the exiled government flees the attackers and its capital takes 2.5× as long to capture;
  AIs leave enemy bases alone until `hqFrom` (Easy 25:00, Normal 20:00, Hard 8:00).
- **AI air and sea:** fighters capped at their army share and boosted only against bombers;
  island AIs build 2 docks and escort ferries.
- **Art and HUD:** dithered fog edges and night (`src/render/dither.ts`), borders only where
  claims meet, softer mountains without peak props, wheat and hay off the team ramps, a smoke
  burst where partisans land; the HUD left column stops above the powers strip, Field Manual
  cards wait during a doctrine choice and hide on the end screen; doctrine card 200 px.
- **Measured** (`scripts/dev/pass5.ts`, Normal AIs): 1v1 Small median 19.0 min (was 16.6),
  Easy-vs-Normal 19.0 (was about 12), 2v2 Medium 22.6 (was 18–20), FFA4 Medium 32.2 (24.0–59.3,
  all 24 finished: 17 by supremacy, 4 by conquest, 3 by science). Insurgency: 33 of 118 drops
  took a city (28%; the rest include reinforcing a city already held); counting attacks only, 13
  of 28 (46%) in 9 traced FFAs; 10 comebacks. Aces: 1–20 a match, 81% killed for the bounty.
  Islands: all 4 end by science at 46–57 min, with 128 warships and 176 transports built.
- Probes added in `scripts/dev`: `pass5.ts` (match stats), `drops.ts` (what each partisan drop
  achieved), `duelstory.ts` (how a duel ends), `hqtrace.ts` (who damages an HQ).
- Everything on the fifth critic's list is in (hidden landing works by time, not "until the
  capture bar starts": partisans land inside the capture ring, so that would end it at once).
  1v1s now mostly end by supremacy at 19:00, the first legal moment; FFAs often end at 29:00, the
  first legal moment there. Worth a look if matches feel decided too early.
- PixelLab: still 2,455 of 2,694 generations used (this pass needed none).

**2026-10-14 (earlier) — fourth critic pass: insurgency, aces, newcomers.** Everything below still
holds; this session added (nothing committed yet: the repo has no commits):

- **Insurgency** (`src/sim/insurgency.ts`, `INSURGENCY` in `data/rules.ts`, a lobby option): a
  knocked-out player drops 3 partisans every 90 s at a neutral city or one they once held, and
  re-founds their government by holding a level-2+ city for 3 min. `squadProgress()` estimates
  whether one squad takes a city past its militia (shared by the HUD and the AI). HUD: a status
  panel, a Drop button (D) on a selected city, a "rising m:ss" clock on the city for everyone, and
  two Field Manual cards. A knocked-out player with no living teammate sees the whole map.
  `PROTOCOL_VERSION` 5, `SAVE_VERSION` 3. `tests/insurgency.test.ts` (6 tests).
- **City contracts** (`src/sim/contracts.ts`, `CONTRACTS` in `data/rules.ts`, a lobby option):
  from 5:00 a neutral city evenly placed between the players posts one public job at a time:
  **supply** (a ground unit in its ring + $150/50 oil per level, via the Pay button or the
  `contract` command, and the city joins peacefully) or **hold** (hold it 60 s for $400+ and 2 CP).
  Tracker line, gold map label with a clock, messages, a Field Manual card. AIs walk a unit in and
  hold back cash for a supply job near home (`AI_CONTRACT`), and send capture squads to a hold job.
  `tests/contracts.test.ts` (6 tests). `SAVE_VERSION` 4.
- **Named aces** (`src/sim/aces.ts`): a three-star unit gets a name and gives allies within 4
  tiles +10% damage (no stacking, not itself); announced, shown in the panel and chronicle, with
  a gold ring when selected. `wins.test: aces`.
- **Newcomers:** early AI waves hit the economy and are capped (`AiLevel.hqFrom/earlyUntil/
  earlyWave`); FFA AIs spare a struggling player before 20:00 (`AI_RESPONSE.prey*`); counter hints
  in tooltips (`src/ui/counters.ts`); the **Field Manual** tip cards (`src/ui/manual.ts`); Boot
  Camp centres on off-screen targets and is gold on the title until started; a first skirmish is
  against an Easy AI.
- **Islands:** AI docks and ferries use the open sea only; a landing gives up a beach it can't
  reach. **Cities:** capture radius and assault ring grow with level.
- **Art:** snowy-peak mountain tileset (PixelLab pro, `grass-mountain3`), new wheat prop, dashed
  Home Front borders, planes 80% opaque over ground units, merchant trade flag, White last in
  the team colors, neutral UI colour (taupe). Roads now tuck one tile under the HQ.
- **Measured:** seat bias is noise (96 rotated 4-player FFAs: wins by seat 20/24/20/28, by start
  22/27/21/22, expected 23); FFA4 medium median over seeds 1–24: 30.6 min before this pass, 32.6
  with insurgency, 30.9 with insurgency and contracts (27 jobs filled in 17 games, 6 comebacks).
- PixelLab: 2,455 of the 2,694 generations allowed for this run are used (the cap is 600 from 2,094).
- Not done from the critic's list: winter crossings, hearts and minds. A fifth critic pass was
  started at the end of this session (report in the session scratchpad, `critic5/`).

**2026-10-14 (earlier) — islands, free-for-alls, lag test.** Everything below still holds; this
session added:

- **Lag test:** `LoopbackHub(auto, lag)` delays messages on a virtual clock (`advance(ms)`);
  `net.test: plays correctly with 150 ms of lag each way` ticks the M2 box.
- **Islands:** `wins.test` scripts a two-ship invasion that takes an HQ (M11 box ticked). AI
  landings now hold one beach out of gun range until 60% of the wave is ashore, aircraft wait for
  that, and a thinned-out landing falls back to its beach (`AI_NAVAL.beach*`). The AI no longer
  rebuilds on a deposit it just lost (`AI_SITES`). AI island 1v1s used to run past 60 min with
  no winner; now small ones end at 19–56 min, medium 45–54, 4-player islands 44–55.
- **Free-for-all:** the supremacy clock opens 5 min later per team beyond two
  (`VICTORY.supremacyFromPerTeam`), shares are a little higher, and AIs prefer targets of a
  runaway leader by public score (`AI_RESPONSE.leader*`). FFA4 medium median went from about 25
  to about 27–30 min. AI think ticks are evenly spread. Investigated a 4-player seat bias
  (start 1 won 8 of 12): combat is fair (`scripts/dev/brawl.ts`), maps are fair on average
  (`startfair.ts`), and the gap looks like snowball noise plus an AI-order effect; see the PLAN
  decisions log.
- **Readability:** `npm run e2e:readability` makes a 6-team, 300-unit battle shot; wrecks now
  have holes, a scorch mark and 80% opacity so they don't read as a dark seventh team.
- New debug probes in `scripts/dev/`: `islandtrace`, `beachtrace`, `lostsite`, `whoattacks`,
  `seatstats` (with `--rot`), `brawl`.

**2026-10-14 (earlier) — second critic pass, scenery and speed.** Everything below still holds;
this session added:

- Speed: one tick with 1,000 units 5.5 → 3.1 ms (separation grid, clearance maps, flow-field step
  cache, team masks in the spatial grid). All derived caches; `nav.test` checks them against the
  slow way.
- Online: rejoin by a per-tab token, a lobby that survives leave/rejoin, a clear message for old
  clients (`PROTOCOL_VERSION` 4: the merchant ship joined the unit list).
- Twists: lend-lease Supply Drop, Resistance, Coalition, supremacy share by player count, Era
  III/IV doctrine perks, and **Call for Help** (a team-only flare; allied AIs answer it and fire it
  when their base is overrun).
- Maps: fair starts (mirrored city slots per start; `mapgen.test` checks the gap) and a start
  nudge bug fixed. AI: transports on continents (no more deadlocks), garrisons, helping allies,
  anti-air memory, coastal guns, spending surplus cash, racing a supremacy clock.
- Art: 17 PixelLab scenery props (trees, peaks, boulders, farmland, ruins, city-specialty
  landmarks), a new mountain tileset, deep-water texture, team ramps fixed, friend-or-foe colors.
- A research-queue bug (an order on the tick a tech finished jumped the queue) is fixed and tested.
- Save and Continue: one localStorage slot, autosaved every game minute, "Save game" in the menu,
  "Continue" on the title (`src/app/saves.ts`, `save.test`, and an e2e step).
- Boot Camp tutorial on the title screen (`src/ui/tutorial.ts`, checked by `npm run e2e:tutorial`).
- Wrecks: destroyed vehicles and aircraft leave a charred, smoking hull for 20 s; ships sink
  (render-only, `Fx.wrecks`).
- Third critic pass (report in the session scratchpad, `critic3/`), done so far:
  - **Scrub**: enemy infantry beside a Launch Site delay it 60 s; repairs capped at 3 Builders and
    40 HP/s each, none under fire; AIs guard their own site with 6 infantry and paradrop onto a rival's.
  - AI air: fighters only against bombers and helicopters, counted as anti-air, kept out of
    ground waves; the paradrop vision bug fixed.
  - Balance: Rocket Troopers beat Light Tanks cost for cost (`battle.test` duel); oil is scarce
    (derricks 1/s, oil costs up).
  - **Assault ring** around cities; city labels drawn above units; strategic-zoom shapes and
    count badges; **Home Front** territory (heal on your own ground, borders drawn).
  - End-of-match **chronicle**, MVP, **Rematch** and **New map**.
  - Quick wins: exchange buttons, second ability on F, F1 help, units walk clear of the factory
    door, the stats columns, Total War's text, README.
  - **Neutral cities keep growing** (a level every 4 min away from the starts) and the militia
    hits harder: AI 1v1s now 11–27 min (mean 17), FFA4 medium 18–34 min.
  - **Merchant convoys** from coastal cities to your Dock (new PixelLab merchant ship); AI island
    matches see 30–100 arrivals per player in 50 min and a few sinkings.
  - Idle planes circle over their spot (render only); idle AI warships raid enemy merchants
    they can see (rarely fires: warships are usually in waves).
- Checks: `npx vitest run` 90/90, `npx tsc --noEmit` clean, `npm run e2e` "smoke ok".

**Not done / next:** the GitHub repo and Pages deploy (**ask the owner first**), a
cross-network online test, a playtest of Boot Camp, FFA length (4-way Medium AI games end at
19–29 min against a 30–45 target), a favicon.

**2026-10-14 (later) — critic pass implemented.** The game is playable end to end in the
browser (skirmish and online). This session worked through the game critic's top 10:

- Balance data pass (slower city growth and eras, tech cost escalation within an era, additive
  bonuses, combat tweaks, HQ 9,000 HP, scaling supply drops and crates, supremacy from 15:00).
- Islands and continents now give every start its own landmass around a neutral middle island
  (tested on 100 maps); the AI ferries waves and expeditions across.
- New rules: **government in exile**, **city militia**, **the exchange**, **doctrine perks**
  (Entrenchment auto-dig, Blitzkrieg all-weather). Command shapes are validated in the sim.
- AI: no HQ omniscience (start spots are public, scouting), proportional defense, a gentler Easy,
  no early supply drops, exchange use, working ferries.
- HUD: victory tracker, getting-started checklist, compact powers grid with a CP meter, no empty
  command box, message plates with de-duplication, research details and unlock icons, exchange
  and gift buttons.
- Readability: grass tufts instead of yellow patches, slim building footings with contact
  shadows, travelling tracers, lighter smoke, brown debris, health bars only when relevant,
  outlined city labels, muted rich-ore ground, 2v2 colors.
- Art: ships (transport, destroyer, submarine, battleship), rocket and flak walk cycles, city
  levels 3–5 (1–2 imported too), ore / oil / rich deposits.
- Docs: GAME_DESIGN rewritten to match the game; PLAN has a status section, verified ticks and
  new decisions.

**Not done / next (then):** see the latest entry above. Pangaea 1v1 AI mirror matches still end at 12–19 min; human games run longer.

Handy: `window.__quick({ fog: 'off', seed: 5 })` in the dev console starts a skirmish at once.
`node scripts/run.mjs scripts/aimatch.ts --seeds 1,2,3 --type continents --minutes 60` plays
headless AI matches; `scripts/dev/ferrytrace.ts` traces AI ferries; `scripts/dev/datadump.ts`
prints the balance data.

## Decisions made during the sessions

- **Tiles are 32 px** (was 16). PixelLab's minimum sizes and the owner's wish for rich art.
- **Art view: "high top-down"** (¾ view). Buildings via `create_object_pro_flash` with "straight
  front view (not isometric)"; a style image only works on canvases of 128 px or more.
- **Team colors:** art is generated with bright blue team parts, snapped onto the key ramp
  (palette 44–48). Ships were drawn with a red waterline, so their manifest entries set
  `teamHue: 'red'` and the importer keys red too.
- **Twists** (owner: "for every bit you copy, create a uniqueness"): see the tables at the top of
  GAME_DESIGN.md.
- Writing scripts: the Bash tool's heredocs eat backslashes on this machine. Write script files
  with the editor tool instead of `python - <<EOF` when the content has `\n` or `\\`.

## PixelLab ledger

Budget: 600 generations from the first autonomous session. `generations_used` was **2094** at
the start → stop at **2694**. **Used 2436 on 2026-10-14 (258 left).** Check with `get_balance`.
Every object id in use is in `assets/units.json`, `assets/buildings.json` and
`assets/terrain.json`; the importers re-download from those.

| What | Tool | Id | Cost | Notes |
|---|---|---|---|---|
| Light tank test | create_8_direction_object 40px high top-down | ffa6f7af-0d02-4099-b564-ddfaae9bd0d7 | 10 | good; all blue body |
| Rifleman test | create_character standard 24px 8-dir | 97af975b-b3ad-4b2f-9f2c-933b95e1de74 | 1 | good, 36px canvas |
| Barracks test | create_map_object 96×96 | 01df78fb-3b90-4570-9989-235165c65859 | 1 | isometric-rotated; replaced |
| Water→sand tileset | create_topdown_tileset 32px | 1885ce7b-8632-4506-9f66-f5cbea5d959e | ~4 | good |
| (first session) units, buildings, tilesets, cities 1–2 | various | see the manifests | ~130 | used 2240 at the end of that session |
| Flak trooper walk (8 dir, 1 retried) | animate_character template walking-4-frames | group c3fb820b-97bf-4db1-b788-5394eb831cbe | 9 | |
| Transport ship | create_8_direction_object 64 + style patrol boat | 7bea88d7-a5bc-41fa-85dc-5967139df9a4 | 10 | red waterline → team key |
| Destroyer | create_8_direction_object 80 + style | a5b575cb-5e51-4566-8bb4-04c7674f6547 | 10 | |
| Submarine | create_8_direction_object 64 + style | e8c030ee-e1e5-46d8-8e5b-df4d58246536 | 10 | |
| Battleship | create_8_direction_object 96 + style | dad5a4d4-2080-4c43-847f-b26f42487caf | 15 | |
| City 3 / 4 / 5 | create_object_pro_flash 96 / 112 / 128 + town as style | 36af0926…, 681aac22…, 2e4f71b1… | ~17 | |
| Deposits ore / oil / rich | create_object_pro_flash 64 | e8a8d5b1…, 49319cea…, 9c25e08c… | ~15 | oil is a tar seep now |
| Mountain tileset (grass → mountain) | create_topdown_tileset 32px | 351b6e0a… (dir `grass-mountain2`) | ~4 | greys remapped off the team ramp |
| Merchant ship | create_8_direction_object 64 + style transport | 8aea6fda-72c3-4286-902f-f97b3c5ff7b6 | 10 | red waterline → team key |
| 17 scenery props: oak ×2, pines, bush, boulders, hay, ruin, flowers, crops, wheat, peak, peaks, 5 specialty landmarks | create_map_object | `prop:*` in `assets/buildings.json` | ~17 | peaks, boulders, ruin carry a grey remap |

Downloads: `node scripts/pl-fetch.mjs url <url> <file>` / `tileset <id> <dir>`. Review with
`node scripts/contact.mjs <dir|files> --out <png> --scale 4 --snap`.

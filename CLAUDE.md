# CLAUDE.md

**Pixel RTS** (working title) is a browser pixel-art RTS. It combines The Conquerors 3 (HQ, mines
and oil, barracks, factories, airfields and docks, land, air and sea units, capturing cities,
destroying HQs) with Strategema (tech tree, growing cities, several win conditions). It has 1–6
players with online co-op, teams, or free-for-all over peer-to-peer WebRTC, and it is hosted on
GitHub Pages.

Read first: `README.md` (layout), `docs/GAME_DESIGN.md` (game rules), `docs/PLAN.md` (milestones,
status, decisions log).

## Stack: same as Sprocket & Sprout

- TypeScript (strict), Vite, Vitest, and Playwright e2e scripts. A single Canvas 2D and our own
  small engine.
- **Never use a game engine or rendering/UI framework**: no Phaser, Pixi, Three, Kaplay, React
  and so on.
- Ask before adding any runtime dependency. Planned so far: `trystero` (M7), `jsfxr` (M13).
- Proven code from `C:\Users\jacks\Documents\sprocket-and-sprout` (loop, RNG, input, atlas, bitmap
  font, audio, e2e harness, art pipeline) may be **copied and adapted**. Never import across repos.
- Commands: `npm run dev` · `npm test` · `npm run typecheck` · `npm run build` · `npm run preview`.

## Architecture rules (do not break these)

1. **All game rules live in `src/sim`, as pure TypeScript.** Sim code may import only from
   `src/sim` and `src/data`. No DOM, no browser APIs, no network, no timers, no npm packages.
   `tests/sim-boundary.test.ts` enforces this. Fix violations; never loosen the test.
2. **Commands are the only way to change game state.** UI input, AI (`src/sim/ai`), and remote
   players all produce the same plain command objects. The sim validates every command
   (ownership, cost, unlocks, placement) and never trusts the sender.
3. **One code path.** Single-player is a host with no remote peers. Never write
   "if online" branches inside game rules.
4. **Host-authoritative.** The host's browser runs `step()`. Clients send commands, receive
   snapshots and events, and render. Clients never decide outcomes.
5. **Balance lives in `src/data`.** Units, buildings, techs, costs, build times, damage
   multipliers, city levels, AI build orders. No gameplay magic numbers in sim code: a new
   tunable value gets added to data. Data files contain data only, no logic.
6. **`render` and `ui` read state and never mutate it.** They can only send commands.
7. **`MatchState` is plain data** (objects, arrays, numbers, strings, booleans) and must survive a
   JSON round-trip. No class instances, Maps, Sets, or functions in state.
8. **Determinism.** Fixed 20 Hz tick. The tick count is the sim's only clock. Randomness comes
   only from the seeded RNG stored in state. Iterate in a stable order (arrays, or sorted ids).
9. **Network protocol** messages are defined in `src/net/protocol.ts`. Any breaking change bumps
   `PROTOCOL_VERSION`.

## Pixel art rules

- 32 × 32 tile grid (high top-down ¾ view). Integer zoom only. `imageSmoothingEnabled = false`.
  Round to whole screen pixels when drawing (the sim can use fractional positions; the screen can't).
- One fixed palette; all art is snapped to it. Team colors use a reserved key ramp that is
  recolored per player.
- Readability comes first: dark outline on units, muted terrain, health bars only when damaged,
  selected, or hovered, strategic icons when zoomed out. See GAME_DESIGN §14.
- All art and sound is original. Never copy assets from the Roblox games.

## Hosting

- Static site on GitHub Pages. Every push to `main` runs tests, builds, and deploys
  (`.github/workflows/deploy.yml`).
- No backend: no game server, no database, no accounts. The only outside services are public
  WebRTC signaling (Trystero) and STUN/TURN.
- Vite's `base` is `'./'`, so always use relative asset paths.

## How to work here

- Work in milestone order from `docs/PLAN.md`. Tick a "Done when" box only after verifying it, and
  note how it was verified (test name, e2e screenshot, or measured number). Never tick a box
  based on an assumption.
- Every new sim behavior gets a Vitest test. Prefer headless scripted matches (seed plus a
  command list) over mocks.
- When a game rule changes, update `docs/GAME_DESIGN.md` in the same change. When a significant
  technical decision is made, add it to the decisions log in `docs/PLAN.md`.
- Dev machine is Windows: write scripts as Node (`.mjs` or `.ts`), not bash.

# Pixel RTS (working title)

A top-down pixel-art real-time strategy game for the browser, inspired by **The Conquerors 3** and
**Strategema** (both on Roblox). Start with an HQ, mine ore and pump oil, build barracks,
factories, airfields and docks, capture and grow cities, research a tech tree, and win by
conquest, science, or holding the map. 1–6 players: co-op against AI, teams, or free-for-all,
online peer to peer. Nothing to install.

**Play it:** https://ycgnem.github.io/pixel-rts/

**Status:** playable. Skirmish against 1–5 AIs (four personalities plus Random, three
difficulties), online matches over WebRTC, a Boot Camp tutorial, a Field Guide to every unit and
building, save and Continue, four map types, 29 techs in four eras, land, air and sea units (with
a destroyer–battleship–submarine triangle at sea), and every win condition. Twists of its own
include a government in exile, a last stand at the HQ, insurgency for knocked-out players, city
contract auctions and bounties, resistance, coalitions, wanted aces and the Home Front. The map is
painted pixel by pixel (curving coasts, depth-shaded water with waves, forests of individual
trees, mountain ranges, farmland around towns, scenery and drifting clouds). See
[docs/PATCH_NOTES.md](docs/PATCH_NOTES.md) for what changed lately,
[docs/PLAN.md](docs/PLAN.md) for what is verified and what is next, and
[docs/HANDOFF.md](docs/HANDOFF.md) for the latest session notes.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # Vitest (headless)
npm run build      # typecheck + production build into dist/
npm run preview    # serve the production build
```

The browser checks drive the real game in Chrome with Playwright. They expect the dev server on
port 5180, or take its address as an argument:

```bash
npx vite --port 5180         # in one terminal
npm run e2e                  # smoke test: title, Field Guide, skirmish, panels, save and Continue, an AI match
npm run e2e:tutorial         # plays Boot Camp step by step
npm run e2e:readability      # a 6-team, 300-unit battle screenshot
npm run e2e:twists           # insurgency's Drop and a contract tender's Bid, through the real HUD
node e2e/perf.mjs            # frame times for the PLAN's fps checks
node e2e/controls.mjs        # WASD / arrow panning, card hotkeys, eased wheel zoom
node e2e/overlap.mjs         # no scenery sprite overlaps another, a road, a city, a deposit, a building or a crop
node e2e/mapview.mjs <url> <outDir>   # map screenshots (fog off, two maps, several zooms) for before/after
```

Headless AI matches: `node scripts/run.mjs scripts/aimatch.ts --seeds 1,2 --type pangaea --players 4`.

Needs Node 22.12 or newer. On Windows you can also double-click **Play.bat**, which installs
everything on first run and opens the game in your browser.

## Project layout

```
index.html            page shell: one <canvas id="game">
src/
  main.ts             entry point
  app/                screens and wiring (title, lobby, match); connects sim + net + render + ui
  engine/             browser plumbing with no game rules: fixed-step loop, input and keybinds, audio
  sim/                ALL game rules, as pure TypeScript: no DOM, no network, no clock, seeded RNG only
    ai/               computer players; they issue the same commands humans do
  data/               balance data: units, buildings, techs, costs, city levels, damage table, palette
  render/             Canvas 2D drawing: camera, the painted ground (painter, farmland), scenery,
                      ambience (clouds, birds), sprites, fog, effects, minimap
  net/                peer-to-peer play: transports (local / loopback / WebRTC), lobby, snapshots, protocol
  ui/                 HUD, panels, menus, bitmap font; turns clicks and keys into commands
  art/                (generated) sprite sheets the renderer loads, built from assets/
assets/               art and audio sources, plus the scripts that build them into src/art/
tests/                Vitest tests, run headless (mostly the sim)
e2e/                  Playwright scripts that drive the real game and take screenshots
docs/                 GAME_DESIGN.md (rules), PLAN.md (milestones, risks, decisions),
                      HANDOFF.md (session notes), PATCH_NOTES.md (player-facing changes)
.github/workflows/    deploy.yml: test → build → GitHub Pages on every push to main
```

### How the pieces fit

```
 mouse / keys ──► ui ──► Command ──► transport ──► host: sim.step(state, commands) ──► state
                                                         ▲
                                       AI players ───────┘ (same commands)
 screen ◄── render ◄── local state, or interpolated snapshots from the host ◄──────────┘
```

- **sim** is the whole game. It runs the same way single-player, as the online host, and in tests.
- **Commands** are the only way to change the game. Players, AI, and remote friends all send them.
- **Online:** the host's browser runs the sim. Friends join with a room code over WebRTC, send
  commands, and receive state updates. There is no game server.
- **data** holds every number, so balancing never needs code changes.

`tests/sim-boundary.test.ts` fails the build if `src/sim` or `src/data` imports rendering,
networking, or browser code, or uses `Math.random` or the clock.

## Deploying to GitHub Pages

One-time setup:
1. Create a GitHub repository and push `main`.
2. In the repository, go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**.

After that, every push to `main` runs the tests, builds, and publishes to
`https://<user>.github.io/<repo>/`. Because the build uses relative paths, any repo name works.

## Docs

- [docs/GAME_DESIGN.md](docs/GAME_DESIGN.md): core loop, resources, units, buildings, cities, tech tree, win conditions, modes, controls, art direction
- [docs/PLAN.md](docs/PLAN.md): technical approach, milestones with "done when" checks, risks, decisions log
- [CLAUDE.md](CLAUDE.md): rules for AI-assisted sessions in this repo

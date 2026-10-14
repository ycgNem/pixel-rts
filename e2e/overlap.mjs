// Scenery overlap audit: every standing prop and every tree and peak the painter bakes, measured by
// its sprite's opaque box, against each other, roads, cities, deposits and buildings. Prints the
// counts per map and a few examples; exits 1 if anything overlaps.
// Usage: node e2e/overlap.mjs [baseUrl]   (start `npm run dev` first; uses the installed Chrome)
import { chromium } from 'playwright';

const base = process.argv[2] ?? 'http://127.0.0.1:5180/';
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(base);
await page.waitForTimeout(2500);

const ai = (name, team, color, kind = 'ai') => ({ name, team, color, kind, ...(kind === 'ai' ? { ai: { difficulty: 'normal' } } : {}) });
let total = 0;
for (const [seed, mapType] of [[3, 'pangaea'], [5, 'islands'], [11, 'continents'], [8, 'lakes']]) {
  await page.evaluate(({ seed, mapType, players }) => window.__quick({ seed, mapType, mapSize: 'medium', fog: 'off', players }), {
    seed, mapType, players: [ai('You', 0, 0, 'human'), ai('B', 1, 1), ai('C', 2, 2), ai('D', 3, 3)],
  });
  await page.waitForTimeout(1000);
  // let the AIs build, so buildings count too
  await page.evaluate(() => { const sc = window.__app.screen; for (let i = 0; i < 20 * 240; i++) sc.session.tick(); });
  const r = await page.evaluate(async () => {
    // the very module instance the app loaded (after a hot reload its URL carries a ?t= stamp)
    const url = (f) => performance.getEntriesByType('resource').map((e) => e.name).find((n) => n.includes(f)) ?? f;
    const art = await import(url('/src/render/art.ts'));
    const { opaqueBounds, sprite } = art;
    const { T } = await import(url('/src/data/terrain.ts'));
    const { BUILDINGS } = await import(url('/src/data/buildings.ts'));
    const sc = window.__app.screen, s = sc.session.state, world = sc.world, { w, h, terrain } = s.map;
    const TILE = 32, INSET = 2;
    // opaque box of a sprite drawn with its anchor at world px (x, y)
    const boxOf = (sp, b, x, y) => [x - sp.ox + b.x0 + INSET, y - sp.oy + b.y0 + INSET, x - sp.ox + b.x1 - INSET, y - sp.oy + b.y1 - INSET];
    const nameOf = new Map();
    const box = (name, sp, x, y) => {
      let b = nameOf.get(sp);
      if (!b) {
        // opaqueBounds wants a registered name; baked sprites come from the registry too
        b = opaqueBounds(name);
        nameOf.set(sp, b);
      }
      return b ? boxOf(sp, b, x, y) : null;
    };
    const items = [];
    // standing props
    for (const list of world.props.chunks.values())
      for (const p of list) {
        if (p.flat) continue;
        const sp = sprite(p.name, -1);
        const bx = sp && box(p.name, sp, p.x * TILE, p.y * TILE);
        if (bx) items.push({ what: p.name, src: 'prop', box: bx, tile: p.tile });
      }
    // baked trees and peaks (sprite objects → names via the registry)
    const painter = world.terrain.painter;
    const reg = new Map();
    for (const prefix of ['tree:', 'peak:', 'prop:']) for (const n of art.spriteNames(prefix)) reg.set(sprite(n, -1), n);
    const S = 512;
    for (let cy = 0; cy * S < h * TILE; cy++)
      for (let cx = 0; cx * S < w * TILE; cx++)
        for (const [sp, x, y] of painter.scatter(cx * S, cy * S, S)) {
          const wx = cx * S + x, wy = cy * S + y;
          // a sprite near a chunk edge is listed by both chunks: keep it once, by its anchor's chunk
          if (Math.floor(wx / S) !== cx || Math.floor(wy / S) !== cy) continue;
          const n = reg.get(sp);
          const bx = n && box(n, sp, wx, wy);
          if (bx) items.push({ what: n, src: 'baked', box: bx });
        }
    const hit = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
    const area = (a) => Math.max(0, a[2] - a[0]) * Math.max(0, a[3] - a[1]);
    const inter = (a, b) => area([Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])]);
    // obstacles
    const obstacles = [];
    for (const c of s.cities) {
      const sp = sprite(`city:${c.level}`, -1);
      if (sp) obstacles.push({ what: 'city ' + c.name, box: [(c.x + 0.5) * TILE - sp.w / 2, (c.y + 0.5) * TILE - sp.h / 2, (c.x + 0.5) * TILE + sp.w / 2, (c.y + 0.5) * TILE + sp.h / 2] });
    }
    for (const d of s.map.deposits) obstacles.push({ what: 'deposit', box: [d.x * TILE, d.y * TILE, (d.x + 2) * TILE, (d.y + 2) * TILE] });
    const buildings = Object.values(s.ents).filter((e) => e.t === 'b').map((e) => ({ what: 'building ' + e.kind, box: [e.tx * TILE, (e.ty - 0.5) * TILE, (e.tx + BUILDINGS[e.kind].w) * TILE, (e.ty + BUILDINGS[e.kind].h) * TILE] }));
    const roadIn = (b) => {
      for (let y = b[1]; y < b[3]; y += 4)
        for (let x = b[0]; x < b[2]; x += 4) {
          const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
          // the painted road is about a tile wide around the road tiles' centres: count its core only
          if (tx >= 0 && ty >= 0 && tx < w && ty < h && terrain[ty * w + tx] === T.ROAD && Math.abs(x - (tx + 0.5) * TILE) < 10 && Math.abs(y - (ty + 0.5) * TILE) < 10) return true;
        }
      return false;
    };
    const out = { items: items.length, propProp: [], propBaked: [], road: [], obstacle: [], building: [], crop: [] };
    // nothing stands in the crops (livestock may graze a pasture)
    const farm = await import(url('/src/render/farmland.ts'));
    for (const list of world.props.chunks.values())
      for (const p of list) {
        const sp = sprite(p.name, -1);
        const b = sp && box(p.name, sp, p.x * TILE, p.y * TILE);
        if (!b) continue;
        let bad = false;
        for (let y = b[1]; y <= b[3] && !bad; y += 4)
          for (let x = b[0]; x <= b[2] && !bad; x += 4) {
            const pl = farm.plotAt(Math.floor(x), Math.floor(y));
            if (farm.farmed(pl, s.map) && farm.inCrop(pl) && pl.kind !== farm.CROP.PASTURE) bad = true;
          }
        if (bad) out.crop.push(`${p.name} at ${b.map(Math.round)}`);
      }
    const props = items.filter((i) => i.src === 'prop'), baked = items.filter((i) => i.src === 'baked');
    for (let i = 0; i < props.length; i++)
      for (let j = i + 1; j < props.length; j++)
        if (hit(props[i].box, props[j].box)) out.propProp.push(`${props[i].what} × ${props[j].what} at ${props[i].box.map(Math.round)}`);
    for (const p of props) for (const b of baked) if (inter(p.box, b.box) > 0.15 * Math.min(area(p.box), area(b.box))) out.propBaked.push(`${p.what} × ${b.what} at ${p.box.map(Math.round)}`);
    for (const it of items) if (roadIn(it.box)) out.road.push(`${it.src} ${it.what} at ${it.box.map(Math.round)}`);
    for (const it of items) for (const o of obstacles) if (hit(it.box, o.box)) out.obstacle.push(`${it.src} ${it.what} × ${o.what} at ${it.box.map(Math.round)}`);
    // props next to a building are hidden at draw time (Props.visible); count the ones that would still show
    const shown = new Set(world.props.visible(0, 0, w, h).map((p) => p.tile));
    for (const it of props) if (shown.has(it.tile)) for (const o of buildings) if (hit(it.box, o.box)) out.building.push(`${it.what} × ${o.what}`);
    return out;
  });
  const n = r.propProp.length + r.propBaked.length + r.road.length + r.obstacle.length + r.building.length + r.crop.length;
  total += n;
  console.log(`${mapType} seed ${seed}: ${r.items} sprites; prop×prop ${r.propProp.length}, prop×tree/peak ${r.propBaked.length}, on road ${r.road.length}, on city/deposit ${r.obstacle.length}, on building ${r.building.length}, in crops ${r.crop.length}`);
  for (const k of ['propProp', 'propBaked', 'road', 'obstacle', 'building', 'crop']) for (const e of r[k].slice(0, 4)) console.log('   ', k, e);
}
await browser.close();
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log(total ? `overlap: ${total} found` : 'overlap ok');
process.exit(total ? 1 : 0);

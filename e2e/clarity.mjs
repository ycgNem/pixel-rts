// Clarity check: screenshots of the city-specialty chooser, the oil readout, the build menu
// (oil prices, the Factory waiting on a Barracks) and the hover tip on an oil well.
// Saves to e2e/out/clarity (or the folder given).
// Usage: node e2e/clarity.mjs [baseUrl] [outDir]   (start `npm run dev` first; uses the installed Chrome)
import { chromium } from 'playwright';
import fs from 'node:fs';

const base = process.argv[2] ?? 'http://127.0.0.1:5180/';
const out = process.argv[3] ?? 'e2e/out/clarity';
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(base);
await page.waitForTimeout(2500);
// skip the First Orders guide so the left column is free
await page.evaluate(() => localStorage.setItem('pixel-rts.orders', 'off'));
await page.evaluate(() => window.__quick({ seed: 3, mapType: 'pangaea', mapSize: 'small', fog: 'on', players: [
  { name: 'You', team: 0, color: 0, kind: 'human' }, { name: 'B', team: 1, color: 1, kind: 'ai', ai: { difficulty: 'normal' } },
] }));
await page.waitForTimeout(1500);

const scr = () => window.__app.screen;
// 1. a city of ours reaches Town size and waits for its specialty
await page.evaluate(() => {
  const sc = window.__app.screen, s = sc.session.state;
  const hq = Object.values(s.ents).find((e) => e.t === 'b' && e.kind === 'hq' && e.owner === 0);
  const c = s.cities.slice().sort((a, b) => Math.hypot(a.x - hq.x, a.y - hq.y) - Math.hypot(b.x - hq.x, b.y - hq.y))[0];
  c.owner = 0; c.level = 2; c.specPending = true; c.calm = 0;
  sc.cam.centerOn(c.x, c.y);
});
await page.waitForTimeout(700);
await page.screenshot({ path: `${out}/specialty.png` });

// 2. the build menu with a Builder selected: oil prices, the Factory locked until a Barracks stands
const pos = await page.evaluate(() => {
  const sc = window.__app.screen, s = sc.session.state;
  const b = Object.values(s.ents).find((e) => e.t === 'u' && e.kind === 'builder' && e.owner === 0);
  sc.ctl.selected.clear(); sc.ctl.selected.add(b.id);
  sc.cam.centerOn(b.x, b.y);
  return null;
});
void pos;
await page.waitForTimeout(300);
await page.keyboard.press('b');
await page.waitForTimeout(400);
// hover the Factory button for its tooltip
const fac = await page.evaluate(() => { const m = window.__app.screen.hud.marks['build:factory']; const k = window.__app.ui.s; return m ? [(m.x + m.w / 2) * k, (m.y + m.h / 2) * k] : null; });
if (fac) { await page.mouse.move(fac[0], fac[1]); await page.waitForTimeout(400); }
await page.screenshot({ path: `${out}/build-menu.png` });

// 2b. a finished Factory selected: the tank buttons carry their oil price
await page.keyboard.press('Escape');
await page.evaluate(() => {
  const sc = window.__app.screen, s = sc.session.state;
  const hq = Object.values(s.ents).find((e) => e.t === 'b' && e.kind === 'hq' && e.owner === 0);
  const f = Object.values(s.ents).find((e) => e.t === 'u' && e.owner === 0 && e.kind === 'rifleman');
  void f;
  sc.session.state.players[0].cash += 0;
  window.__devFactory = { x: hq.tx, y: hq.ty + 6 };
});
const placed = await page.evaluate(async () => {
  const sc = window.__app.screen, s = sc.session.state;
  // a Barracks and a Factory, already finished, beside the HQ
  const mod = await import('/src/sim/lifecycle.ts');
  const cmd = await import('/src/sim/commands.ts');
  const hq = Object.values(s.ents).find((e) => e.t === 'b' && e.kind === 'hq' && e.owner === 0);
  const spot = (kind) => { for (let r = 4; r < 20; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (!cmd.placementProblem(s, 0, kind, hq.tx + dx, hq.ty + dy)) return [hq.tx + dx, hq.ty + dy]; return null; };
  const b1 = spot('barracks'); mod.placeBuilding(s, 'barracks', 0, b1[0], b1[1], 1);
  const f1 = spot('factory'); const f = mod.placeBuilding(s, 'factory', 0, f1[0], f1[1], 1);
  sc.ctl.selected.clear(); sc.ctl.selected.add(f.id);
  sc.cam.centerOn(f.x, f.y);
  return true;
});
void placed;
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/factory-card.png` });

// 3. hover an oil well on the map
await page.keyboard.press('Escape');
await page.evaluate(() => { const sc = window.__app.screen; sc.ctl.selected.clear(); });
const oil = await page.evaluate(() => {
  const sc = window.__app.screen, s = sc.session.state;
  const st = s.map.starts[0];
  const d = s.map.deposits.filter((k) => k.kind === 'oil').sort((a, b) => Math.hypot(a.x - st.x, a.y - st.y) - Math.hypot(b.x - st.x, b.y - st.y))[0];
  sc.cam.centerOn(d.x + 1, d.y + 1);
  return [d.x + 1, d.y + 1];
});
await page.waitForTimeout(300);
const px = await page.evaluate(([x, y]) => { const c = window.__app.screen.cam; return [c.sx ? c.sx(x) : null, c.sy ? c.sy(y) : null]; }, oil);
const [mx, my] = px[0] != null ? px : [640, 360];
await page.mouse.move(mx, my);
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/oil-well.png` });

// 4. a small window: the top bar still fits
await page.setViewportSize({ width: 800, height: 600 });
await page.waitForTimeout(600);
await page.screenshot({ path: `${out}/small-window.png` });
await browser.close();
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('clarity ok', out);

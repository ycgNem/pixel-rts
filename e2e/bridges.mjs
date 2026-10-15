// River check: screenshots of both bridges (fog off) on a pangaea and a lakes map, at zoom 1 and 2,
// and a zoomed-out view of the river. Saves to e2e/out/bridges (or the folder given).
// Usage: node e2e/bridges.mjs [baseUrl] [outDir]   (start `npm run dev` first; uses the installed Chrome)
import { chromium } from 'playwright';
import fs from 'node:fs';

const base = process.argv[2] ?? 'http://127.0.0.1:5180/';
const out = process.argv[3] ?? 'e2e/out/bridges';
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(base);
await page.waitForTimeout(2500);

const ai = (name, team, color, kind = 'ai') => ({ name, team, color, kind, ...(kind === 'ai' ? { ai: { difficulty: 'normal' } } : {}) });
for (const [seed, mapType] of [[3, 'pangaea'], [2, 'lakes']]) {
  await page.evaluate(({ seed, mapType, players }) => window.__quick({ seed, mapType, mapSize: 'small', fog: 'off', players }), {
    seed, mapType, players: [ai('You', 0, 0, 'human'), ai('B', 1, 1)],
  });
  await page.waitForTimeout(1200);
  const bridges = await page.evaluate(() => window.__app.screen.session.state.map.bridges ?? []);
  if (bridges.length !== 2) errors.push(`${mapType} ${seed}: ${bridges.length} bridges`);
  for (const [i, b] of bridges.entries()) {
    const x = (b.x0 + b.x1) / 2, y = (b.y0 + b.y1) / 2;
    for (const z of [1, 2]) {
      await page.evaluate(({ x, y, z }) => { const c = window.__app.screen.cam; c.z = z; c.centerOn(x, y); }, { x, y, z });
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${out}/${mapType}-bridge${i}-z${z}.png` });
    }
  }
  const mid = await page.evaluate(() => { const m = window.__app.screen.session.state.map; return [m.w / 2, m.h / 2]; });
  await page.evaluate(({ x, y }) => { const c = window.__app.screen.cam; c.z = 0.5; c.centerOn(x, y); }, { x: mid[0], y: mid[1] });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${out}/${mapType}-river-z0.5.png` });
}
await browser.close();
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('bridges ok', out);

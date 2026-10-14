// Map beauty check: screenshots of the battlefield (fog off) at a few zooms and places, so terrain
// art changes can be compared before and after. Saves to e2e/out/mapview (or the folder given).
// Usage: node e2e/mapview.mjs [baseUrl] [outDir]   (start `npm run dev` first; uses the installed Chrome)
import { chromium } from 'playwright';
import fs from 'node:fs';

const base = process.argv[2] ?? 'http://127.0.0.1:5180/';
const out = process.argv[3] ?? 'e2e/out/mapview';
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(base);
await page.waitForTimeout(2500);

const ai = (name, team, color, kind = 'ai') => ({ name, team, color, kind, ...(kind === 'ai' ? { ai: { difficulty: 'normal' } } : {}) });
for (const [seed, mapType] of [[3, 'pangaea'], [5, 'islands']]) {
  await page.evaluate(({ seed, mapType, players }) => window.__quick({ seed, mapType, mapSize: 'medium', fog: 'off', players }), {
    seed, mapType, players: [ai('You', 0, 0, 'human'), ai('B', 1, 1), ai('C', 2, 2), ai('D', 3, 3)],
  });
  await page.waitForTimeout(1200);
  // let the AIs build for a while so bases and roads show up
  await page.evaluate(() => { const sc = window.__app.screen; for (let i = 0; i < 20 * 150; i++) sc.session.tick(); });
  const spots = await page.evaluate(() => {
    const s = window.__app.screen.session.state, { w, h, terrain } = s.map;
    const find = (ids) => {
      let best = null, bn = -Infinity;
      for (let y = 6; y < h - 6; y += 3) for (let x = 6; x < w - 6; x += 3) {
        let n = 0;
        for (let yy = -5; yy <= 5; yy++) for (let xx = -8; xx <= 8; xx++) if (ids.includes(terrain[(y + yy) * w + x + xx])) n++;
        // a mix scores best: half the window of the wanted terrain
        const sc = -Math.abs(n - 90);
        if (sc > bn) { bn = sc; best = [x, y]; }
      }
      return best;
    };
    const hq = Object.values(s.ents).find((e) => e.t === 'b' && e.kind === 'hq' && e.owner === 0);
    const city = s.cities.slice().sort((a, b) => b.level - a.level)[0];
    return { hq: [hq.tx + 1, hq.ty + 1], city: [city.x, city.y], coast: find([0, 1]), center: [w / 2, h / 2] };
  });
  for (const [name, [x, y]] of Object.entries(spots)) {
    for (const z of name === 'center' ? [0.5, 1] : [1, 2]) {
      await page.evaluate(({ x, y, z }) => { const c = window.__app.screen.cam; c.z = z; c.centerOn(x, y); }, { x, y, z });
      await page.waitForTimeout(350);
      await page.screenshot({ path: `${out}/${mapType}-${name}-z${z}.png` });
    }
  }
}
await browser.close();
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('mapview ok', out);

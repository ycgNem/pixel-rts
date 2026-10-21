// Screenshots of this patch's visible features: the mega units beside the Heavy Tank and Bomber, a
// Builder work zone and its command card, the rocket countdown banner, and the launch finale.
// Usage: node e2e/mega.mjs [baseUrl] [outDir]   (dev server on port 5180 first)
import { chromium } from 'playwright';
import fs from 'node:fs';

const base = process.argv[2] ?? 'http://127.0.0.1:5180/';
const out = process.argv[3] ?? 'e2e/out/mega';
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(base);
await page.waitForTimeout(2500);
const shot = async (name) => { await page.screenshot({ path: `${out}/${name}.png` }); console.log('saved', name); };

await page.evaluate(async () => {
  window.__quick({ seed: 42, mapSize: 'small', fog: 'off', weather: false, players: [{ name: 'You', team: 0, color: 0, kind: 'human' }, { name: 'Rust', team: 1, color: 1, kind: 'passive' }] });
  await new Promise((r) => setTimeout(r, 1500));
  const sc = window.__app.screen, s = sc.session.state;
  sc.session.setPaused(true);
  const hq = Object.values(s.ents).find((e) => e.t === 'b' && e.kind === 'hq' && e.owner === 0);
  const base = Object.values(s.ents).find((e) => e.t === 'u' && e.owner === 0 && e.kind === 'rifleman');
  const add = (kind, x, y, hp) => {
    const u = structuredClone(base);
    Object.assign(u, { id: s.nextId++, kind, x, y, hp, order: null, queue: [], tgt: 0, cd: [0, 0, 0], dir: Math.PI / 2, gx: x, gy: y });
    s.ents[u.id] = u;
    return u;
  };
  add('heavytank', hq.x + 6, hq.y + 1, 882);
  add('megatank', hq.x + 10, hq.y + 1, 3440);
  add('bomber', hq.x + 6, hq.y - 5, 420);
  add('megaplane', hq.x + 11, hq.y - 5, 2000);
  window.__hq = [hq.x, hq.y];
  sc.cam.z = 2;
  sc.cam.centerOn(hq.x + 8, hq.y - 1);
});
await page.waitForTimeout(800);
await shot('1-mega-units');

// a Builder work zone, with the command card showing Zone and Sell (Z)
await page.evaluate(async () => {
  const sc = window.__app.screen, s = sc.session.state, [hx, hy] = window.__hq;
  const builders = Object.values(s.ents).filter((e) => e.t === 'u' && e.owner === 0 && e.kind === 'builder');
  for (const b of builders) b.post = { x: hx - 2, y: hy + 6, r: 7, leg: 0, wait: 0 };
  sc.ctl.selected = new Set(builders.map((b) => b.id));
  sc.cam.z = 1;
  sc.cam.centerOn(hx, hy + 4);
});
await page.waitForTimeout(800);
await shot('2-zone');

// the rocket countdown banner (a rival's launch, 25 s left: red and blinking)
await page.evaluate(async () => {
  const sc = window.__app.screen, s = sc.session.state, [hx, hy] = window.__hq;
  sc.ctl.selected = new Set();
  const hq1 = Object.values(s.ents).find((e) => e.t === 'b' && e.kind === 'hq' && e.owner === 1);
  const site = structuredClone(Object.values(s.ents).find((e) => e.t === 'b' && e.kind === 'hq' && e.owner === 0));
  Object.assign(site, { id: s.nextId++, kind: 'launch', owner: 0, tx: Math.round(hx) + 4, ty: Math.round(hy) + 4, x: Math.round(hx) + 6.5, y: Math.round(hy) + 6.5, hp: 4000, built: 1, prod: [], cd: [] });
  s.ents[site.id] = site;
  s.navVer++;
  s.launch = { id: site.id, done: s.tick + 20 * 25, scrub: 0 };
  window.__site = site.id;
  sc.cam.z = 1;
  sc.cam.centerOn(site.x, site.y);
  void hq1;
});
await page.waitForTimeout(700);
await shot('3-banner');

// the finale: the match ends in a science win, then the island goes up
await page.evaluate(() => {
  const sc = window.__app.screen, s = sc.session.state;
  s.over = { winners: 0, reason: 'science', tick: s.tick };
});
for (const [ms, name] of [[1200, '4-liftoff'], [1700, '5-flash'], [1500, '6-blast'], [2000, '7-firestorm'], [3000, '8-scorched'], [3500, '9-end-screen']]) {
  await page.waitForTimeout(ms);
  await shot(name);
}
await browser.close();
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }

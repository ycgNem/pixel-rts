// The newer twists, driven through the real UI: a knocked-out player drops partisans with the
// Drop button's hotkey (Insurgency), and a player bids on a city's supply tender with Bid.
// Saves screenshots to e2e/out/twists.
// Usage: node e2e/twists.mjs [baseUrl]   (start `npm run dev` first; uses the installed Chrome)
import { chromium } from 'playwright';
import fs from 'node:fs';

const base = process.argv[2] ?? 'http://127.0.0.1:5180/';
const out = 'e2e/out/twists';
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const fail = async (why) => { console.error(why); await browser.close(); process.exit(1); };
await page.goto(base);
await page.waitForTimeout(2000);

// ---- insurgency: knock our HQ out, wait for the first drop, select a village, press D
await page.evaluate(async () => {
  const players = [{ name: 'You', team: 0, color: 0, kind: 'human' }, { name: 'Rust', team: 1, color: 1, kind: 'passive' }, { name: 'Moss', team: 2, color: 2, kind: 'passive' }];
  window.__quick({ seed: 5, mapSize: 'small', fog: 'on', players });
  await new Promise((r) => setTimeout(r, 1200));
  const { removeEnt } = await import('/src/sim/lifecycle.ts');
  const { INSURGENCY } = await import('/src/data/rules.ts');
  const sc = window.__app.screen, s = sc.session.state;
  removeEnt(s, Object.values(s.ents).find((e) => e.t === 'b' && e.kind === 'hq' && e.owner === 0), []);
  for (let i = 0; i < 20 * (INSURGENCY.first + 1); i++) sc.session.tick();
  const st = s.map.starts[0];
  const c = s.cities.filter((k) => k.owner < 0 && k.level === 1).sort((a, b) => Math.hypot(a.x - st.x, a.y - st.y) - Math.hypot(b.x - st.x, b.y - st.y))[0];
  sc.ctl.selected.clear();
  sc.ctl.selCity = c.id;
  sc.cam.centerOn(c.x, c.y);
});
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/01-insurgent-ready.png` });
await page.keyboard.press('KeyD');
await page.waitForTimeout(500);
const ins = await page.evaluate(() => {
  const s = window.__app.screen.session.state;
  return { alive: s.players[0].alive, units: Object.values(s.ents).filter((e) => e.owner === 0).length, nextDrop: s.players[0].insurgeAt - s.tick };
});
console.log('insurgency', ins);
if (ins.alive || ins.units < 3 || ins.nextDrop <= 0) await fail('insurgency: the Drop button did not drop partisans');
await page.screenshot({ path: `${out}/02-partisans-landed.png` });

// ---- contracts: a supply tender at the nearest neutral city, a rifleman inside its ring, press P
await page.evaluate(async () => {
  const players = [{ name: 'You', team: 0, color: 0, kind: 'human' }, { name: 'Rust', team: 1, color: 1, kind: 'passive' }];
  window.__quick({ seed: 12, mapSize: 'small', fog: 'off', players });
  await new Promise((r) => setTimeout(r, 1200));
  const { spawnUnit } = await import('/src/sim/lifecycle.ts');
  const sc = window.__app.screen, s = sc.session.state;
  const hq = Object.values(s.ents).find((e) => e.t === 'b' && e.kind === 'hq' && e.owner === 0);
  const c = s.cities.filter((k) => k.owner < 0).sort((a, b) => Math.hypot(a.x - hq.x, a.y - hq.y) - Math.hypot(b.x - hq.x, b.y - hq.y))[0];
  s.contract = { city: c.id, kind: 'supply', until: s.tick + 3600, holder: -1, since: 0, bids: [], closes: 0, team: -1, level: c.level };
  spawnUnit(s, 'rifleman', 0, c.x + 2.5, c.y + 0.5);
  sc.session.tick();
  sc.ctl.selected.clear();
  sc.ctl.selCity = c.id;
  sc.cam.centerOn(c.x, c.y);
  window.__job = c.id;
});
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/03-supply-contract.png` });
await page.keyboard.press('KeyP');
await page.waitForTimeout(500);
const bids = await page.evaluate(() => window.__app.screen.session.state.contract?.bids ?? []);
console.log('bids', bids);
if (bids.length !== 1 || bids[0].p !== 0) await fail('contracts: Bid did not place a bid');
await page.screenshot({ path: `${out}/04-tender-open.png` });
// the tender closes: the only bid wins
const job = await page.evaluate(async () => {
  const { CONTRACTS } = await import('/src/data/rules.ts');
  const sc = window.__app.screen, s = sc.session.state;
  for (let i = 0; i < 20 * (CONTRACTS.tender + 1); i++) sc.session.tick();
  return { owner: s.cities[window.__job].owner, open: !!s.contract, cash: Math.round(s.players[0].cash) };
});
console.log('contract', job);
if (job.owner !== 0 || job.open) await fail('contracts: the tender did not hand over the city');
await page.screenshot({ path: `${out}/05-city-joined.png` });

await browser.close();
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('twists ok');

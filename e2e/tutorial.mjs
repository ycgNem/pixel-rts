// Playwright check of Boot Camp: start it from the title, then play the steps with the normal
// commands and check each one ticks off. Saves screenshots to e2e/out/tutorial.
// Usage: node e2e/tutorial.mjs [baseUrl]   (start `npm run dev` first; uses the installed Chrome)
import { chromium } from 'playwright';
import fs from 'node:fs';

const base = process.argv[2] ?? 'http://127.0.0.1:5180/';
const out = 'e2e/out/tutorial';
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(`[console] ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}\n${e.stack}`));
const shot = async (name) => { await page.screenshot({ path: `${out}/${name}.png` }); console.log('shot', name); };
const wait = (ms) => page.waitForTimeout(ms);
const step = () => page.evaluate(() => window.__app.screen.hud.d.tutorial?.step ?? -1);

await page.goto(base);
await wait(2500);
// the Boot Camp button is the fourth (no save in a fresh browser)
const ui = await page.evaluate(() => ({ s: window.__app.uiScale / window.__app.dpr, w: window.__app.canvas.width / window.__app.uiScale, h: window.__app.canvas.height / window.__app.uiScale }));
await page.mouse.click(Math.round((ui.w / 2) * ui.s), Math.round((Math.round(ui.h * 0.5) + 72 + 10) * ui.s));
await wait(1500);
const started = await page.evaluate(() => ({ screen: window.__app.screen.constructor.name, tut: !!window.__app.screen.hud?.d.tutorial }));
console.log('started', started);
if (!started.tut) errors.push('Boot Camp did not start a tutorial match');
await shot('01-look-around');

// each step, done the way a player would (commands through the session), then checked
const play = async (name, fn, seconds = 1) => {
  const before = await step();
  await page.evaluate(fn);
  await page.evaluate((n) => { const sc = window.__app.screen; for (let i = 0; i < n; i++) sc.session.tick(); }, Math.round(seconds * 20));
  await wait(400);
  const after = await step();
  console.log(name, before, '->', after);
  if (after <= before) errors.push(`step "${name}" did not tick off (${before} -> ${after})`);
  await shot(name);
};
await play('02-pick-builder', () => { const sc = window.__app.screen; sc.cam.cx += 32 * 10; });
await play('03-mine', () => {
  const sc = window.__app.screen, s = sc.session.state;
  const b = Object.values(s.ents).find((e) => e.t === 'u' && e.owner === 0 && e.kind === 'builder');
  sc.ctl.selected.clear(); sc.ctl.selected.add(b.id);
  const hq = Object.values(s.ents).find((e) => e.t === 'b' && e.owner === 0 && e.kind === 'hq');
  sc.cam.centerOn(hq.x, hq.y);
});
const build = (kind) => page.evaluate((kind) => {
  const sc = window.__app.screen, s = sc.session.state;
  const hq = Object.values(s.ents).find((e) => e.t === 'b' && e.owner === 0 && e.kind === 'hq');
  const ids = Object.values(s.ents).filter((e) => e.t === 'u' && e.owner === 0 && e.kind === 'builder').map((e) => e.id);
  if (kind === 'mine' || kind === 'derrick') {
    const want = kind === 'mine' ? (d) => d.kind !== 'oil' : (d) => d.kind === 'oil';
    const d = s.map.deposits.filter(want).sort((a, b) => Math.hypot(a.x - hq.x, a.y - hq.y) - Math.hypot(b.x - hq.x, b.y - hq.y))[0];
    sc.session.send({ t: 'build', p: 0, ids, kind, tx: d.x, ty: d.y });
    return;
  }
  // the first spot around the HQ where a foundation goes down
  const has = () => Object.values(s.ents).some((e) => e.t === 'b' && e.owner === 0 && e.kind === kind);
  for (let r = 4; r < 14 && !has(); r++) for (let k = 0; k < 16 && !has(); k++) {
    const tx = Math.round(hq.tx + Math.cos(k / 16 * 6.283) * r), ty = Math.round(hq.ty + Math.sin(k / 16 * 6.283) * r);
    sc.session.send({ t: 'build', p: 0, ids, kind, tx, ty });
    sc.session.tick();
  }
}, kind);
/** run the match until a building of this kind is finished (up to three minutes) */
const finish = (kind) => page.evaluate((kind) => {
  const sc = window.__app.screen, s = sc.session.state;
  for (let i = 0; i < 180 * 20; i++) {
    if (Object.values(s.ents).some((e) => e.t === 'b' && e.owner === 0 && e.kind === kind && e.built >= 1)) return true;
    sc.session.tick();
  }
  return false;
}, kind);
// (play's function runs in the page; the builds above are sent first)
await build('mine');
await play('04-derrick', () => {}, 1);
await build('derrick');
await play('05-barracks', () => {}, 1);
await build('barracks');
await shot('06-train');
if (!(await finish('barracks'))) errors.push('the barracks never finished');
await play('07-capture', () => {
  const sc = window.__app.screen, s = sc.session.state;
  const bar = Object.values(s.ents).find((e) => e.t === 'b' && e.owner === 0 && e.kind === 'barracks');
  sc.session.send({ t: 'train', p: 0, at: bar.id, kind: 'rifleman', n: 3 });
});
await play('08-research', () => {
  const sc = window.__app.screen, s = sc.session.state;
  const hq = Object.values(s.ents).find((e) => e.t === 'b' && e.owner === 0 && e.kind === 'hq');
  const city = s.cities.filter((c) => c.owner < 0).sort((a, b) => Math.hypot(a.x - hq.x, a.y - hq.y) - Math.hypot(b.x - hq.x, b.y - hq.y))[0];
  const ids = Object.values(s.ents).filter((e) => e.t === 'u' && e.owner === 0 && e.kind === 'rifleman').map((e) => e.id);
  sc.session.send({ t: 'move', p: 0, ids, x: city.x + 0.5, y: city.y + 1 });
}, 90);
await play('09-tank', () => { window.__app.screen.session.send({ t: 'research', p: 0, tech: 'deepMining' }); });
await build('factory');
if (!(await finish('factory'))) errors.push('the factory never finished');
await play('10-power', () => {
  const sc = window.__app.screen, s = sc.session.state;
  const f = Object.values(s.ents).find((e) => e.t === 'b' && e.owner === 0 && e.kind === 'factory');
  s.players[0].oil += 500; s.players[0].cash += 1000;
  sc.session.send({ t: 'train', p: 0, at: f.id, kind: 'lighttank', n: 1 });
}, 40);
await play('11-win', () => {
  const sc = window.__app.screen, s = sc.session.state;
  s.players[0].cp = 10;
  sc.session.send({ t: 'power', p: 0, power: 'recon', x: s.map.starts[1].x, y: s.map.starts[1].y });
});
await page.evaluate(() => { const sc = window.__app.screen; for (let i = 0; i < 30 * 20; i++) sc.session.tick(); });
await wait(400);
const end = await page.evaluate(() => window.__app.screen.hud.d.tutorial.active);
console.log('tutorial finished', !end);
if (end) errors.push('the last step did not go away');

await browser.close();
if (errors.length) {
  console.error(`${errors.length} error(s):\n` + errors.join('\n'));
  process.exit(1);
}
console.log('tutorial ok');

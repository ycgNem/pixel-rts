// Playwright check of First Orders, the opening guide in a newcomer's ordinary match: start a
// Quick battle in a fresh browser and follow the orders with real clicks on what they point at
// (the highlighted HUD buttons, the arrowed spots on the map), checking each hint along the way.
// Then check the orders remember they were finished, and that Hide turns them off.
// Saves screenshots to e2e/out/orders.
// Usage: node e2e/orders.mjs [baseUrl]   (start `npm run dev` first; uses the installed Chrome)
import { chromium } from 'playwright';
import fs from 'node:fs';

const base = process.argv[2] ?? 'http://127.0.0.1:5180/';
const out = 'e2e/out/orders';
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const errors = [];
const check = (ok, what) => { if (!ok) errors.push(what); console.log(ok ? 'ok  ' : 'FAIL', what); };

async function open() {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`[console] ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}\n${e.stack}`));
  return page;
}
const wait = (page, ms = 350) => page.waitForTimeout(ms);
/** click Quick battle (the left half of the third title row, beside Sandbox; no save in a fresh browser) */
async function quickBattle(page) {
  await page.goto(base);
  await wait(page, 2500);
  const ui = await page.evaluate(() => ({ s: window.__app.uiScale / window.__app.dpr, w: window.__app.canvas.width / window.__app.uiScale, h: window.__app.canvas.height / window.__app.uiScale }));
  // the title buttons are 140 wide; Quick battle is the left 68 of that row
  const at = [Math.round((Math.round(ui.w / 2 - 70) + 34) * ui.s), Math.round((Math.round(ui.h * 0.5) + 48 + 10) * ui.s)];
  await page.mouse.move(at[0], at[1]);
  await wait(page, 100);
  await page.mouse.click(at[0], at[1]);
  await wait(page, 1500);
}
const guide = (page) => page.evaluate(() => {
  const t = window.__app.screen.hud?.d.tutorial;
  return t ? { program: t.program, step: t.step, active: t.active, hint: t.hint && { text: t.hint.text, label: t.hint.label ?? null, mark: t.hint.mark ?? null, at: t.hint.at ?? null } } : null;
});
/** a HUD rect or a world spot, in page pixels */
const markAt = (page, name) => page.evaluate((name) => {
  const a = window.__app, r = a.screen.hud.marks[name], s = a.uiScale / a.dpr;
  return r ? [Math.round((r.x + r.w / 2) * s), Math.round((r.y + r.h / 2) * s)] : null;
}, name);
const worldAt = (page, x, y) => page.evaluate(([x, y]) => {
  const a = window.__app, cam = a.screen.cam;
  return [Math.round(cam.sx(x) / a.dpr), Math.round(cam.sy(y) / a.dpr)];
}, [x, y]);
async function click(page, at, button = 'left') {
  await page.mouse.move(at[0], at[1]);
  await wait(page, 80);
  await page.mouse.click(at[0], at[1], { button });
  await wait(page);
}
const ticks = (page, n) => page.evaluate((n) => { const sc = window.__app.screen; for (let i = 0; i < n; i++) sc.session.tick(); }, n);

// ---------------------------------------------------------------- following the orders
{
  const page = await open();
  const shot = (name) => page.screenshot({ path: `${out}/${name}.png` }).then(() => console.log('shot', name));
  await quickBattle(page);
  let g = await guide(page);
  check(g?.program === 'orders' && g.active && g.step === 0, 'a fresh browser gets First Orders in a Quick battle');
  check(g?.hint?.label === 'Builder', `order 1 starts by pointing at a Builder (${g?.hint?.text})`);
  await shot('01-pick-builder');

  // the Builder under the arrow
  await click(page, await worldAt(page, g.hint.at.x, g.hint.at.y));
  g = await guide(page);
  check(g.hint.mark === 'cmd:Build', `with a Builder picked it lights up Build (${g.hint.text})`);
  await shot('02-build-button');
  await click(page, await markAt(page, 'cmd:Build'));
  g = await guide(page);
  check(g.hint.mark === 'build:mine', `the build menu open, it lights up the Mine (${g.hint.text})`);
  await shot('03-mine-button');
  await click(page, await markAt(page, 'build:mine'));
  g = await guide(page);
  check(g.hint.label === 'Ore' && !!g.hint.at, `placing, it points at the ore (${g.hint.text})`);
  await shot('04-ore');
  // a mine goes on the deposit's top-left tile; the arrow points at the deposit's middle
  await click(page, await worldAt(page, g.hint.at.x - 0.5, g.hint.at.y - 0.5));
  g = await guide(page);
  const mines = await page.evaluate(() => Object.values(window.__app.screen.session.state.ents).filter((e) => e.owner === 0 && e.kind === 'mine').length);
  check(mines === 1 && g.step === 1, 'clicking the arrowed ore put a Mine down and the orders moved on');
  check(g.hint.mark === 'top:Research', `order 2 lights up Research (${g.hint.text})`);
  await shot('05-research-button');

  await click(page, await markAt(page, 'top:Research'));
  g = await guide(page);
  check(/^tech:/.test(g.hint.mark ?? ''), `the tech tree open, it lights up a first tech (${g.hint.text})`);
  await shot('06-pick-tech');
  await click(page, await markAt(page, g.hint.mark));
  const cur = await page.evaluate(() => window.__app.screen.session.state.players[0].research.cur);
  g = await guide(page);
  check(!!cur && g.step === 2, `clicking it started ${cur} and the orders moved on`);
  await page.keyboard.press('Escape');
  await wait(page);
  // nothing selected: it points at the Riflemen
  await page.evaluate(() => window.__app.screen.ctl.selected.clear());
  await wait(page);
  g = await guide(page);
  check(g.hint.label === 'Riflemen', `order 3 points at the Riflemen (${g.hint.text})`);
  await shot('07-riflemen');
  // (a drag box: select them the way the hint says)
  const box = await page.evaluate(() => {
    const a = window.__app, sc = a.screen, rs = Object.values(sc.session.state.ents).filter((e) => e.owner === 0 && e.kind === 'rifleman');
    const xs = rs.map((e) => sc.cam.sx(e.x) / a.dpr), ys = rs.map((e) => sc.cam.sy(e.y) / a.dpr);
    return [Math.min(...xs) - 20, Math.min(...ys) - 20, Math.max(...xs) + 20, Math.max(...ys) + 20];
  });
  await page.mouse.move(box[0], box[1]);
  await page.mouse.down();
  await page.mouse.move((box[0] + box[2]) / 2, (box[1] + box[3]) / 2, { steps: 4 });
  await page.mouse.move(box[2], box[3], { steps: 4 });
  await page.mouse.up();
  await wait(page);
  g = await guide(page);
  check(!!g.hint.label && g.hint.label !== 'Riflemen' && !!g.hint.at, `with Riflemen picked it points at a city (${g.hint.text})`);
  await shot('08-city');
  const city = g.hint.label;
  await click(page, await worldAt(page, g.hint.at.x, g.hint.at.y), 'right');
  await page.evaluate(() => { const sc = window.__app.screen, s = sc.session.state; for (let i = 0; i < 20 * 90 && !s.cities.some((c) => c.owner !== 0 && c.cap > 0.3 && c.capTeam === s.players[0].team && c.capBy === 0); i++) sc.session.tick(); });
  await wait(page);
  g = await guide(page);
  check(g.hint.label === city && /Taking/.test(g.hint.text), `while taking it, it shows the progress (${g.hint.text})`);
  await shot('09-taking');
  await page.evaluate(() => { const sc = window.__app.screen, s = sc.session.state; for (let i = 0; i < 20 * 90 && !s.cities.some((c) => c.owner === 0); i++) sc.session.tick(); });
  await wait(page);
  g = await guide(page);
  check(g.step === 3, `the city taken, the orders moved on to oil (step ${g.step})`);
  await shot('10-oil');

  // the rest by commands: a Derrick, a Barracks, a Factory
  await page.evaluate(() => {
    const sc = window.__app.screen, s = sc.session.state;
    s.players[0].cash += 3000;
    const hq = Object.values(s.ents).find((e) => e.t === 'b' && e.owner === 0 && e.kind === 'hq');
    const ids = Object.values(s.ents).filter((e) => e.t === 'u' && e.owner === 0 && e.kind === 'builder').map((e) => e.id);
    const d = s.map.deposits.filter((d) => d.kind === 'oil').sort((a, b) => Math.hypot(a.x - hq.x, a.y - hq.y) - Math.hypot(b.x - hq.x, b.y - hq.y))[0];
    sc.session.send({ t: 'build', p: 0, ids, kind: 'derrick', tx: d.x, ty: d.y });
    for (const kind of ['barracks', 'factory']) {
      const has = () => Object.values(s.ents).some((e) => e.t === 'b' && e.owner === 0 && e.kind === kind);
      for (let r = 4; r < 14 && !has(); r++) for (let k = 0; k < 16 && !has(); k++) {
        sc.session.send({ t: 'build', p: 0, ids, kind, tx: Math.round(hq.tx + Math.cos(k / 16 * 6.283) * r), ty: Math.round(hq.ty + Math.sin(k / 16 * 6.283) * r) });
        sc.session.tick();
      }
      // a Factory needs a finished Barracks
      const done = () => Object.values(s.ents).some((e) => e.t === 'b' && e.owner === 0 && e.kind === kind && e.built >= 1);
      for (let i = 0; i < 20 * 90 && !done(); i++) sc.session.tick();
    }
    sc.session.tick();
  });
  await wait(page);
  g = await guide(page);
  check(g.step === 6, `oil, Barracks and Factory down: the last card is up (step ${g.step}: ${g.hint?.text})`);
  await shot('11-basics');
  await ticks(page, 30 * 20);
  await wait(page);
  g = await guide(page);
  const stored = await page.evaluate(() => localStorage.getItem('pixel-rts.orders'));
  check(!g.active && stored === 'done', `the orders finish and are remembered (${stored})`);
  // the next match starts without them; the menu brings them back
  await quickBattle(page);
  g = await guide(page);
  check(!g, 'a later match has no orders');
  await page.keyboard.press('Escape');
  await wait(page);
  await shot('12-menu');
  await page.close();
}

// ---------------------------------------------------------------- Hide
{
  const page = await open();
  await quickBattle(page);
  await click(page, await markAt(page, 'guide:close'));
  await wait(page);
  const g = await guide(page);
  const stored = await page.evaluate(() => localStorage.getItem('pixel-rts.orders'));
  check(!g.active && stored === 'off', `Hide turns the orders off for good (${stored})`);
  await page.close();
}

await browser.close();
if (errors.length) {
  console.error(`${errors.length} error(s):\n` + errors.join('\n'));
  process.exit(1);
}
console.log('orders ok');

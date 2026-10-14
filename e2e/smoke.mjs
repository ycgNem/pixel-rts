// Playwright smoke test: title → Field Guide → skirmish → a minute of play → research, help and stats panels →
// save and Continue →
// a fast-forwarded AI match. Saves screenshots to e2e/out/smoke and fails on console errors.
// Usage: node e2e/smoke.mjs [baseUrl]   (start `npm run dev` first; uses the installed Chrome)
import { chromium } from 'playwright';
import fs from 'node:fs';

const base = process.argv[2] ?? 'http://127.0.0.1:5180/';
const out = 'e2e/out/smoke';
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(`[console] ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}\n${e.stack}`));
const shot = async (name) => { await page.screenshot({ path: `${out}/${name}.png` }); console.log('shot', name); };
const wait = (ms) => page.waitForTimeout(ms);

await page.goto(base);
await wait(2500);
await shot('01-title');

// the Field Guide opens with G, turns a page, and closes with Esc
await page.keyboard.press('KeyG');
await wait(400);
await page.mouse.click(640, 80); // somewhere in the unit list
await wait(300);
await shot('01b-guide');
const guideOpen = await page.evaluate(() => !!window.__app.screen.guide);
await page.keyboard.press('Escape');
await wait(400);
const guideClosed = await page.evaluate(() => !window.__app.screen.guide);
console.log('guide', { guideOpen, guideClosed });
if (!guideOpen || !guideClosed) errors.push(`field guide: open ${guideOpen}, closed ${guideClosed}`);

// a 1v1 skirmish, fog on
await page.evaluate(() => window.__quick({ seed: 3, fog: 'on' }));
await wait(2000);
const start = await page.evaluate(() => {
  const s = window.__app.screen.session.state;
  return { screen: window.__app.screen.constructor.name, players: s.players.length, units: Object.values(s.ents).filter((e) => e.t === 'u').length };
});
console.log('match', start);
if (start.screen !== 'MatchScreen' || start.units < 10) errors.push(`match did not start: ${JSON.stringify(start)}`);
await shot('02-match');

// select a builder and open the build menu; pan with the keyboard
await page.evaluate(() => {
  const sc = window.__app.screen, s = sc.session.state;
  const b = Object.values(s.ents).find((e) => e.t === 'u' && e.owner === 0 && e.kind === 'builder');
  sc.ctl.selected.clear();
  sc.ctl.selected.add(b.id);
});
await page.keyboard.press('b');
await wait(300);
await shot('03-build-menu');
await page.keyboard.down('ArrowRight');
await wait(600);
await page.keyboard.up('ArrowRight');

// clicking the minimap moves the camera (the minimap sits in the bottom-left corner)
const camAt = () => page.evaluate(() => { const c = window.__app.screen.cam; return [Math.round(c.cx), Math.round(c.cy)]; });
const before = await camAt();
const ui = await page.evaluate(() => ({ s: window.__app.uiScale / window.__app.dpr, h: window.__app.canvas.height / window.__app.uiScale }));
await page.mouse.click(Math.round(20 * ui.s), Math.round((ui.h - 20) * ui.s));
await wait(300);
const after = await camAt();
console.log('minimap click', before, '->', after);
if (before[0] === after[0] && before[1] === after[1]) errors.push('clicking the minimap did not move the camera');

// the windows
for (const [key, name] of [['F2', '04-research'], ['F1', '05-help'], ['F3', '06-stats']]) {
  await page.keyboard.press(key);
  await wait(300);
  await shot(name);
  await page.keyboard.press(key);
}

// save, quit to the title, and click Continue: the same match comes back
const saved = await page.evaluate(() => {
  const sc = window.__app.screen;
  const ok = sc.save();
  const tick = sc.session.state.tick;
  sc.quit();
  return { ok, tick };
});
await wait(800);
await shot('08-title-continue');
const title = await page.evaluate(() => ({ s: window.__app.uiScale / window.__app.dpr, w: window.__app.canvas.width / window.__app.uiScale, h: window.__app.canvas.height / window.__app.uiScale }));
await page.mouse.click(Math.round((title.w / 2) * title.s), Math.round((Math.round(title.h * 0.5) - 24 + 10) * title.s));
await wait(800);
const resumed = await page.evaluate(() => {
  const sc = window.__app.screen;
  return { screen: sc.constructor.name, tick: sc.session?.state.tick ?? -1, me: sc.session?.me };
});
console.log('save and continue', saved, '->', resumed);
if (!saved.ok || resumed.screen !== 'MatchScreen' || resumed.tick < saved.tick || resumed.tick > saved.tick + 20 * 5) errors.push(`continue did not resume the saved match: ${JSON.stringify({ saved, resumed })}`);

// an all-AI match, fast-forwarded ten minutes, to exercise most of the sim and renderer
const ff = await page.evaluate(async () => {
  const ai = (name, team, color) => ({ name, team, color, kind: 'ai', ai: { difficulty: 'normal' } });
  window.__quick({ seed: 21, fog: 'off', players: [ai('Blue', 0, 0), ai('Rust', 1, 1)] });
  await new Promise((r) => setTimeout(r, 1500));
  const sc = window.__app.screen;
  const t0 = performance.now();
  for (let i = 0; i < 10 * 60 * 20 && !sc.session.state.over; i++) sc.session.tick();
  sc.session.events.length = 0;
  const s = sc.session.state;
  const fight = Object.values(s.ents).find((e) => e.t === 'u' && e.tgt);
  if (fight) sc.cam.centerOn(fight.x, fight.y);
  return { ms: Math.round(performance.now() - t0), tick: s.tick, units: Object.values(s.ents).filter((e) => e.t === 'u').length };
});
console.log('fast-forward', ff);
await wait(1500);
await shot('07-ai-match');

// play the AI match to its end: the end screen tells the story, and Rematch starts the same map
const ended = await page.evaluate(() => {
  const sc = window.__app.screen;
  for (let i = 0; i < 60 * 60 * 20 && !sc.session.state.over; i++) sc.session.tick();
  return { over: sc.session.state.over, seed: sc.session.state.setup.seed };
});
await wait(800);
// the HUD reads the queued events on the next frame
ended.story = await page.evaluate(() => window.__app.screen.hud.chronicle.entries.map((e) => e.text));
await shot('09-end');
console.log('end', ended);
if (!ended.over || ended.story.length < 2) errors.push(`the match did not end with a story: ${JSON.stringify(ended)}`);
// what the end screen's Rematch button calls
const again = await page.evaluate(() => {
  const sc = window.__app.screen;
  sc.hud.d.rematch(true);
  const n = window.__app.screen;
  return { screen: n.constructor.name, tick: n.session.state.tick, seed: n.session.state.setup.seed, fresh: n !== sc };
});
console.log('rematch', again);
if (!again.fresh || again.seed !== ended.seed || again.tick > 5) errors.push(`rematch did not restart the same map: ${JSON.stringify(again)}`);

await browser.close();
if (errors.length) {
  console.error(`${errors.length} error(s):\n` + errors.join('\n'));
  process.exit(1);
}
console.log('smoke ok');

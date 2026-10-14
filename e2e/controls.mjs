// Camera controls check: WASD pans (and never fires a command-card button), the arrows still pan,
// one mouse-wheel notch is one eased zoom step, and a trackpad's stream of small deltas is too.
// Usage: node e2e/controls.mjs [baseUrl]   (start `npm run dev` first; uses the installed Chrome)
import { chromium } from 'playwright';

const base = process.argv[2] ?? 'http://127.0.0.1:5180/';
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(base);
await page.waitForTimeout(2500);
await page.evaluate(() => window.__quick({ seed: 3, mapSize: 'medium', fog: 'off' }));
await page.waitForTimeout(1500);
const cam = () => page.evaluate(() => { const c = window.__app.screen.cam; return { cx: c.cx, cy: c.cy, z: c.z, zt: c.zt }; });
const fails = [];
const check = (ok, msg) => { console.log((ok ? 'ok   ' : 'FAIL ') + msg); if (!ok) fails.push(msg); };

await page.mouse.move(640, 360);
// zoom in to 2 first so there is room to pan every way
await page.evaluate(() => { const c = window.__app.screen.cam; c.z = 2; c.centerOn(96, 96); });
await page.waitForTimeout(200);
for (const [key, axis, sign] of [['KeyD', 'cx', 1], ['KeyS', 'cy', 1], ['KeyA', 'cx', -1], ['KeyW', 'cy', -1], ['ArrowRight', 'cx', 1]]) {
  const a = await cam();
  await page.keyboard.down(key);
  await page.waitForTimeout(400);
  await page.keyboard.up(key);
  const b = await cam();
  check((b[axis] - a[axis]) * sign > 40, `${key} pans ${axis} (${a[axis]} → ${b[axis]})`);
}

// with the starting Builders selected, S/A must not stop or attack-move (they pan); Q/X are the orders now
const sel = await page.evaluate(() => {
  const sc = window.__app.screen, s = sc.session.state;
  const ids = Object.values(s.ents).filter((e) => e.t === 'u' && e.owner === 0).map((e) => e.id);
  sc.ctl.selected = new Set(ids);
  return ids.length;
});
await page.waitForTimeout(100);
await page.keyboard.press('KeyA');
await page.waitForTimeout(100);
const modeA = await page.evaluate(() => window.__app.screen.ctl.mode.m);
check(modeA === 'normal', `A with units selected is not attack-move (mode ${modeA}, ${sel} selected)`);

// one wheel notch: one step, eased (z passes between the steps for a few frames)
await page.evaluate(() => { const c = window.__app.screen.cam; c.z = 1; });
await page.waitForTimeout(100);
await page.mouse.wheel(0, -100);
const mid = await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(window.__app.screen.cam.z)))));
await page.waitForTimeout(500);
const after = await cam();
check(after.z === 2 && after.zt === 2, `one notch zooms 1 → 2 (z ${after.z})`);
check(mid > 1 && mid < 2, `the zoom eases (mid-way z ${mid.toFixed(2)})`);

// trackpad: 30 small deltas in a quick burst make one or two steps, not five
await page.evaluate(() => { const c = window.__app.screen.cam; c.z = 4; });
await page.waitForTimeout(200);
for (let i = 0; i < 30; i++) { await page.mouse.wheel(0, 4); await page.waitForTimeout(8); }
await page.waitForTimeout(500);
const tp = await cam();
check(tp.z >= 2 && tp.z < 4, `a trackpad burst zooms out a step or two (4 → ${tp.z})`);

await browser.close();
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
if (fails.length) process.exit(1);
console.log('controls ok');

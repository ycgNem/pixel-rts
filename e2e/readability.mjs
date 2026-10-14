// Readability check (PLAN M13): 300 units from 6 teams fighting at default zoom. Saves a full
// screenshot and a 2× crop of the middle to e2e/out/readability, plus a key of what is where, so
// a tester can try to name each unit's team and type and then check against the key.
// Usage: node e2e/readability.mjs [baseUrl]   (start `npm run dev` first; uses the installed Chrome)
import { chromium } from 'playwright';
import fs from 'node:fs';

const base = process.argv[2] ?? 'http://127.0.0.1:5180/';
const out = 'e2e/out/readability';
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(base);
await page.waitForTimeout(2500);

const ai = (name, team, color, kind = 'ai') => ({ name, team, color, kind, ...(kind === 'ai' ? { ai: { difficulty: 'normal' } } : {}) });
const players = [ai('You', 0, 0, 'human'), ai('B', 1, 1, 'passive'), ai('C', 2, 2, 'passive'), ai('D', 3, 3, 'passive'), ai('E', 4, 4, 'passive'), ai('F', 5, 5, 'passive')];
await page.evaluate((players) => window.__quick({ seed: 8, mapSize: 'large', fog: 'off', players }), players);
await page.waitForTimeout(1500);

const key = await page.evaluate(async () => {
  // the same module instance the app uses (Vite serves the sources)
  const { spawnUnit } = await import('/src/sim/lifecycle.ts');
  const sc = window.__app.screen, s = sc.session.state;
  // an open patch of ground in the middle of the map
  const { w, h, terrain } = s.map;
  const open = (x, y) => [2, 3, 7, 8].includes(terrain[y * w + x]);
  let cx = Math.floor(w / 2), cy = Math.floor(h / 2);
  search: for (let r = 0; r < w / 2; r++)
    for (let k = 0; k < 24; k++) {
      const x = Math.floor(w / 2 + Math.cos((k / 24) * Math.PI * 2) * r), y = Math.floor(h / 2 + Math.sin((k / 24) * Math.PI * 2) * r);
      let ok = true;
      for (let yy = -9; yy <= 9 && ok; yy++) for (let xx = -14; xx <= 14 && ok; xx++) if (!open(x + xx, y + yy)) ok = false;
      if (ok) { cx = x; cy = y; break search; }
    }
  // six wedges around the middle; each team brings the same mix
  const mix = ['rifleman', 'rifleman', 'rifleman', 'rocket', 'rocket', 'flaktrooper', 'scout', 'lighttank', 'lighttank', 'heavytank', 'artillery', 'flaktruck', 'fighter', 'bomber', 'helicopter'];
  const counts = {};
  for (let p = 0; p < 6; p++) {
    const ang = (p / 6) * Math.PI * 2;
    const ids = [];
    for (let i = 0; i < 50; i++) {
      const kind = mix[i % mix.length];
      const r = 5 + (i % 5) * 0.9, a = ang + (Math.floor(i / 5) - 4.5) * 0.06;
      const u = spawnUnit(s, kind, p, cx + 0.5 + Math.cos(a) * r * 1.4, cy + 0.5 + Math.sin(a) * r);
      ids.push(u.id);
      counts[kind] = (counts[kind] ?? 0) + 1;
    }
    // everyone closes on the middle and fights
    const cmd = { t: 'move', p, ids, x: cx + 0.5, y: cy + 0.5, am: true };
    if (p === 0) sc.session.send(cmd);
    else sc.session.remote.push(cmd);
  }
  // a few seconds of battle, then look at it at the default zoom
  for (let i = 0; i < 20 * 4; i++) sc.session.tick();
  sc.cam.centerOn(cx + 0.5, cy + 0.5);
  const units = Object.values(s.ents).filter((e) => e.t === 'u' && Math.hypot(e.x - cx, e.y - cy) < 14);
  return { center: [cx, cy], zoom: sc.cam.z, counts, onScreen: units.length, teams: s.players.map((p) => `${p.name}: color ${p.color}`) };
});
await page.waitForTimeout(800);
await page.screenshot({ path: `${out}/battle.png` });
await page.screenshot({ path: `${out}/battle-crop.png`, clip: { x: 440, y: 210, width: 400, height: 300 } });
fs.writeFileSync(`${out}/key.json`, JSON.stringify(key, null, 2));
console.log('readability', key);
await browser.close();
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('readability ok');

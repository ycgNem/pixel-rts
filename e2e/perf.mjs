// Frame-rate measurements for the PLAN's fps boxes. Plays a match live in Chrome and records
// the gap between animation frames and the work (ticks + drawing) inside each one.
// Usage: node e2e/perf.mjs [baseUrl]   (start `npm run dev` first; uses the installed Chrome)
// Headless Chrome draws on the CPU, so these numbers are a floor for a real browser with a GPU.
import { chromium } from 'playwright';

const base = process.argv[2] ?? 'http://127.0.0.1:5180/';
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(base);
await page.waitForTimeout(2500);

/** Start a match, fast-forward, then sample `seconds` of live play while `move` runs each frame. */
async function measure(name, setup, ffMinutes, seconds, move) {
  const r = await page.evaluate(async ({ setup, ffMinutes, seconds, move }) => {
    window.__quick(setup);
    await new Promise((r) => setTimeout(r, 1200));
    const app = window.__app, sc = app.screen;
    for (let i = 0; i < ffMinutes * 60 * 20 && !sc.session.state.over; i++) sc.session.tick();
    sc.session.events.length = 0;
    const s = sc.session.state;
    // look at the biggest crowd
    const units = Object.values(s.ents).filter((e) => e.t === 'u');
    const mid = units.reduce((a, u) => [a[0] + u.x / units.length, a[1] + u.y / units.length], [0, 0]);
    sc.cam.centerOn(mid[0], mid[1]);
    const gaps = [], work = [];
    const frame = sc.frame.bind(sc), tick = sc.tick.bind(sc);
    let tickMs = 0;
    sc.tick = () => { const t = performance.now(); tick(); tickMs += performance.now() - t; };
    sc.frame = (dt, a) => {
      const t = performance.now();
      frame(dt, a);
      work.push(performance.now() - t + tickMs);
      tickMs = 0;
    };
    let last = performance.now(), n = 0;
    const move2 = move ? new Function('sc', 'n', move) : null;
    await new Promise((done) => {
      const end = performance.now() + seconds * 1000;
      const f = (now) => {
        gaps.push(now - last);
        last = now;
        if (move2) move2(sc, n++);
        if (now < end) requestAnimationFrame(f); else done();
      };
      requestAnimationFrame(f);
    });
    sc.frame = frame;
    sc.tick = tick;
    const q = (a, p) => [...a].sort((x, y) => x - y)[Math.floor(a.length * p)];
    const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
    return {
      units: Object.values(s.ents).filter((e) => e.t === 'u').length, tick: s.tick, over: !!s.over,
      fps: +(1000 / avg(gaps.slice(5))).toFixed(1), gapP95: +q(gaps.slice(5), 0.95).toFixed(1),
      workAvg: +avg(work).toFixed(2), workP95: +q(work, 0.95).toFixed(2), workP99: +q(work, 0.99).toFixed(2), workMax: +Math.max(...work).toFixed(1),
    };
  }, { setup, ffMinutes, seconds, move });
  console.log(name, JSON.stringify(r));
  return r;
}

const ai = (name, team, color, kind = 'ai') => ({ name, team, color, kind, ...(kind === 'ai' ? { ai: { difficulty: 'normal' } } : {}) });
const six = [ai('You', 0, 0, 'human'), ai('B', 1, 1), ai('C', 2, 2), ai('D', 3, 3), ai('E', 4, 4), ai('F', 5, 5)];

// M1: a Large map, panning and zooming
await measure('large-pan-zoom', { seed: 8, mapSize: 'large', fog: 'off', players: six }, 0.2, 5,
  'sc.cam.cx += 12; if (n % 60 === 0) sc.cam.z = sc.cam.z === 2 ? 1 : 2;');
// M2: 500 moving units on screen
await measure('500-units', { seed: 8, mapSize: 'medium', fog: 'off', startMul: 30, players: [ai('You', 0, 0, 'human'), ai('B', 1, 1)] }, 0, 5,
  // state is plain JSON, so copies of a starting rifleman make a crowd; then they all march
  `if (n === 0) { const s = sc.session.state;
     const t = Object.values(s.ents).find((e) => e.t === 'u' && e.owner === 0 && e.kind === 'rifleman');
     const ids = [];
     for (let i = 0; i < 500; i++) { const u = structuredClone(t); u.id = s.nextId++; u.x = t.x - 12 + (i % 25); u.y = t.y + 3 + Math.floor(i / 25); u.order = null; s.ents[u.id] = u; ids.push(u.id); }
     sc.session.send({ t: 'move', p: 0, ids, x: s.map.w / 2, y: s.map.h / 2 });
     sc.cam.centerOn(t.x, t.y + 12); }
   if (n > 0 && n % 30 === 0) { const s = sc.session.state; const us = Object.values(s.ents).filter((e) => e.t === 'u' && e.owner === 0);
     const m = us.reduce((a, u) => [a[0] + u.x / us.length, a[1] + u.y / us.length], [0, 0]); sc.cam.centerOn(m[0], m[1]); }`);
// M6 / M9 / M15: 5 AIs and a human on a Large map, late game
await measure('large-6p-20min', { seed: 8, mapSize: 'large', fog: 'on', players: six }, 20, 6, '');
await measure('large-6p-35min-zoomed-out', { seed: 8, mapSize: 'large', fog: 'on', players: six }, 35, 6, 'if (n === 0) sc.cam.z = 1;');

await browser.close();
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }

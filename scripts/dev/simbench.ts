// Sim benchmark: 1,000 units from 4 players attack-moving to the middle of a large map, with a
// per-system breakdown of where each tick goes.
//   node scripts/run.mjs scripts/dev/simbench.ts [seconds]
import { createMatch, step } from '../../src/sim/match';
import { spawnUnit } from '../../src/sim/lifecycle';
import { TICK_RATE } from '../../src/sim/types';
import { setup } from '../../tests/helpers';

export async function main(args: string[]) {
  const secs = Number(args[0] ?? 10);
  const s = createMatch(setup({ mapSize: 'large' }, 4));
  for (const id of Object.keys(s.ents)) if (s.ents[+id].t === 'u') delete s.ents[+id];
  for (const p of s.players) p.team = 0;
  const ids: number[][] = [[], [], [], []];
  for (let i = 0; i < 1000; i++) {
    const p = i % 4, st = s.map.starts[p];
    ids[p].push(spawnUnit(s, ['rifleman', 'lighttank', 'scout'][i % 3], p, st.x + ((i >> 2) % 16) - 8 + 0.5, st.y + Math.floor((i >> 2) / 16) - 8 + 0.5).id);
  }
  step(s, []);
  step(s, ids.map((u, p) => ({ t: 'move' as const, p, ids: u, x: s.map.w / 2, y: s.map.h / 2, am: true })));
  // warm up
  for (let i = 0; i < TICK_RATE; i++) step(s, []);
  const t0 = performance.now();
  const ticks = secs * TICK_RATE;
  for (let i = 0; i < ticks; i++) step(s, []);
  const ms = (performance.now() - t0) / ticks;
  console.log(`sim tick with 1000 units: ${ms.toFixed(2)} ms`);
}

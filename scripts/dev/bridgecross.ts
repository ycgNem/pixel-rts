// How long a 100-unit column takes to cross a large lakes map (over a river bridge).
//   node scripts/run.mjs scripts/dev/bridgecross.ts
import { step } from '../../src/sim/match';
import { compOf, nav } from '../../src/sim/nav';
import { TICK_RATE } from '../../src/sim/types';
import { add, clear, match, run } from '../../tests/helpers';

export function main() {
  for (let seed = 1; seed <= 5; seed++) {
    const s = match({ seed, mapSize: 'large', mapType: 'lakes' });
    clear(s);
    for (const p of s.players) p.team = 0;
    const a = s.map.starts[0], b = s.map.starts[1];
    const ids: number[] = [];
    for (let i = 0; i < 100; i++) ids.push(add(s, i % 3 ? 'rifleman' : 'lighttank', 0, a.x + (i % 10) - 5 + 0.5, a.y + Math.floor(i / 10) - 8 + 0.5).id);
    step(s, []);
    void compOf(nav(s), 'ground', b.x, b.y + 6);
    run(s, 0.05, [{ t: 'move', p: 0, ids, x: b.x + 0.5, y: b.y + 6.5 }]);
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    const budget = (dist / 1.5) * 2.2 + 20;
    const marks: string[] = [];
    for (let t = 0; t < budget * 2; t += 10) {
      run(s, 10);
      const arrived = ids.map((id) => s.ents[id]).filter((u) => u && Math.hypot(u.x - b.x - 0.5, u.y - b.y - 6.5) < 9).length;
      if (t % 40 === 0 || arrived >= 99) marks.push(`${t + 10}s:${arrived}`);
      if (arrived >= 99) break;
    }
    console.log(`seed ${seed} dist ${dist.toFixed(0)} budget ${budget.toFixed(0)}s  ${marks.join(' ')}  (tick ${s.tick / TICK_RATE}s)`);
  }
}

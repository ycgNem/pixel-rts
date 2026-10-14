// Debug: the naval components of a map, their sizes, and which landmasses (starts, the middle) each touches.
//   node scripts/run.mjs scripts/dev/seas.ts [--seed 1] [--type islands] [--size medium] [--players 4]
import { createMatch } from '../../src/sim/match';
import { nav, compOf, passable } from '../../src/sim/nav';
import type { MatchSetup } from '../../src/sim/types';
import { setup } from '../../tests/helpers';

export async function main(args: string[]) {
  const opt = (k: string, d: string) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
  const s = createMatch(setup({ seed: +opt('seed', '1'), mapType: opt('type', 'islands') as MatchSetup['mapType'], mapSize: opt('size', 'medium') as MatchSetup['mapSize'] }, +opt('players', '4')));
  const n = nav(s), { w, h } = s.map;
  const size = new Map<number, number>();
  for (let i = 0; i < w * h; i++) if (n.naval[i]) size.set(n.compNaval[i], (size.get(n.compNaval[i]) ?? 0) + 1);
  // landmasses by ground component: each start's, and the middle's
  const groundNear = (x: number, y: number) => { for (let r = 0; r < 6; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (passable(n, 'ground', x + dx, y + dy)) return compOf(n, 'ground', x + dx, y + dy); return -1; };
  const lands = [...s.map.starts.map((st, i) => ['start' + i, groundNear(Math.floor(st.x), Math.floor(st.y) + 3)] as const), ['middle', groundNear(Math.floor(w / 2), Math.floor(h / 2))] as const];
  const touches = new Map<number, Set<string>>();
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      if (!n.naval[y * w + x]) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const g = compOf(n, 'ground', x + dx, y + dy);
        for (const [name, c] of lands) if (g === c && c >= 0) { const set = touches.get(n.compNaval[y * w + x]) ?? new Set(); set.add(name); touches.set(n.compNaval[y * w + x], set); }
      }
    }
  for (const [c, k] of [...size].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`sea ${c}: ${k} tiles, touches ${[...(touches.get(c) ?? [])].join(' ') || '-'}`);
  for (const b of Object.values(s.ents)) void b;
}

// Debug: starts and cities of one generated map.
import { generateMap } from '../../src/sim/mapgen';
import type { MatchSetup } from '../../src/sim/types';
import { setup } from '../../tests/helpers';

export async function main(args: string[]) {
  const m = generateMap(setup({ seed: +(args[0] ?? 1), mapType: (args[2] ?? 'pangaea') as MatchSetup['mapType'], mapSize: (args[3] ?? 'small') as MatchSetup['mapSize'] }, +(args[1] ?? 4)));
  console.log('size', m.w, m.h);
  console.log('starts', m.starts.map((s) => `${s.x},${s.y} mid ${Math.round(Math.hypot(s.x - m.w / 2, s.y - m.h / 2))}`).join(' | '));
  console.log('cities', m.cities.map((c) => `${c.x},${c.y}:${c.level}`).join(' '));
}

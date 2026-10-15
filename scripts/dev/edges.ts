// Cost-for-cost duel edges (the matchup tips' estimate) for one unit against the rest.
//   node scripts/run.mjs scripts/dev/edges.ts rifleman
import { edge } from '../../src/ui/counters';
import { UNITS } from '../../src/data/units';

export function main(args: string[]) {
  const kind = args[0] ?? 'rifleman';
  for (const o of Object.keys(UNITS)) {
    if (o === kind || !UNITS[o].weapons.length) continue;
    const e = edge(o, kind);
    if (e > 1) console.log(`${o} vs ${kind}: ${e === Infinity ? 'inf' : e.toFixed(2)}`);
  }
}

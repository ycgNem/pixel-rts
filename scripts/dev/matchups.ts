// Debug: print the generated matchup lines for every unit, and the duel edge for some pairs.
//   node scripts/run.mjs scripts/dev/matchups.ts [a:b ...]
import { UNITS } from '../../src/data/units';
import { edge, matchupText } from '../../src/ui/counters';

export async function main(args: string[]) {
  for (const k of Object.keys(UNITS)) console.log(`${UNITS[k].name}: ${matchupText(k).join(' | ')}`);
  for (const pair of args) { const [a, b] = pair.split(':'); console.log(`${a} vs ${b}: ${edge(a, b).toFixed(2)}`); }
}

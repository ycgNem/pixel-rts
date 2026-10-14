// Debug: four equal armies at the four sides of an open spot all attack-move to the middle. Each
// arrangement is played in all four rotations, so only the player numbers differ. Prints the
// surviving value per player: a combat-level seat bias shows up as one player always ahead.
//   node scripts/run.mjs scripts/dev/brawl.ts [--seeds 1,2,3] [--kind rifleman] [--n 12]
import { step } from '../../src/sim/match';
import { spawnUnit, armyValue } from '../../src/sim/lifecycle';
import { TICK_RATE, type Command } from '../../src/sim/types';
import { match, openSpot } from '../../tests/helpers';

export async function main(args: string[]) {
  const opt = (k: string, d: string) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
  const kinds = opt('kind', 'rifleman,lighttank').split(',');
  const per = +opt('n', '12');
  const total = [0, 0, 0, 0];
  for (const seed of opt('seeds', '1,2,3').split(',').map(Number))
    for (let rot = 0; rot < 4; rot++) {
      const s = match({ seed, mapSize: 'large' }, 4);
      for (const id of Object.keys(s.ents)) if (s.ents[+id].t === 'u') delete s.ents[+id];
      const c = openSpot(s);
      const cmds: Command[] = [];
      for (let side = 0; side < 4; side++) {
        const p = (side + rot) % 4;
        const a = (side / 4) * Math.PI * 2;
        const ids: number[] = [];
        for (let i = 0; i < per; i++) {
          const along = (i % 6) - 2.5, back = Math.floor(i / 6);
          const x = c.x + Math.cos(a) * (9 + back) - Math.sin(a) * along, y = c.y + Math.sin(a) * (9 + back) + Math.cos(a) * along;
          ids.push(spawnUnit(s, kinds[i % kinds.length], p, x, y).id);
        }
        cmds.push({ t: 'move', p, ids, x: c.x, y: c.y, am: true });
      }
      step(s, cmds);
      for (let t = 0; t < 90 * TICK_RATE; t++) step(s, []);
      const v = [0, 1, 2, 3].map((p) => armyValue(s, p));
      v.forEach((x, p) => (total[p] += x));
      console.log(`seed ${seed} rot ${rot}: left ${v.join(' ')}`);
    }
  console.log(`total by player: ${total.join(' ')}`);
}

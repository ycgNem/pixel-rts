// Average city-count gap between starts (the mapgen fairness test's metric), for map sizes.
//   node scripts/run.mjs scripts/dev/cityfair.ts continents 4 192,208,216,224
import { generateMap } from '../../src/sim/mapgen';
import { MAP_SIZES } from '../../src/data/rules';
import { setup } from '../../tests/helpers';

export function main(args: string[]) {
  const [type = 'continents', np = '4', sizes = '216'] = args;
  for (const size of sizes.split(',').map(Number)) {
    (MAP_SIZES as Record<string, number>).medium = size;
    let gap = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const m = generateMap(setup({ mapType: type as never, mapSize: 'medium', seed }, +np));
      const own = m.starts.map((st) => m.cities.filter((c) => {
        const d = Math.hypot(c.x - st.x, c.y - st.y);
        return m.starts.every((o) => Math.hypot(c.x - o.x, c.y - o.y) >= d);
      }).length);
      gap += Math.max(...own) - Math.min(...own);
    }
    console.log(type, np, size, (gap / 30).toFixed(3));
  }
}

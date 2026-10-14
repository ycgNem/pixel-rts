// Start fairness per seat, averaged over many seeds: distance to the middle, cities that are
// closest to each start, ore and oil nearby, and the walking distance between neighbours.
//   node scripts/run.mjs scripts/dev/startfair.ts [players] [type] [size] [seeds]
import { generateMap } from '../../src/sim/mapgen';
import type { MatchSetup } from '../../src/sim/types';
import { setup } from '../../tests/helpers';

export async function main(args: string[]) {
  const n = +(args[0] ?? 4);
  const type = (args[1] ?? 'pangaea') as MatchSetup['mapType'];
  const size = (args[2] ?? 'small') as MatchSetup['mapSize'];
  const seeds = +(args[3] ?? 60);
  const sum = Array.from({ length: n }, () => ({ mid: 0, cities: 0, lv: 0, ore: 0, oil: 0, near: 0, vore: 0, voil: 0 }));
  // within one map: the gap between the best- and worst-off start
  let citySpread = 0, midSpread = 0, fair = 0;
  for (let seed = 1; seed <= seeds; seed++) {
    const m = generateMap(setup({ seed, mapType: type, mapSize: size }, n));
    const cx = m.w / 2, cy = m.h / 2;
    const own = m.starts.map((st) => m.cities.filter((c) => {
      const d = Math.hypot(c.x - st.x, c.y - st.y);
      return m.starts.every((o) => Math.hypot(c.x - o.x, c.y - o.y) >= d);
    }).length);
    const mids = m.starts.map((st) => Math.hypot(st.x - cx, st.y - cy));
    citySpread += Math.max(...own) - Math.min(...own);
    midSpread += Math.max(...mids) - Math.min(...mids);
    if (Math.max(...own) - Math.min(...own) <= 1) fair++;
    m.starts.forEach((st, i) => {
      const mine = m.cities.filter((c) => {
        const d = Math.hypot(c.x - st.x, c.y - st.y);
        return m.starts.every((o) => Math.hypot(c.x - o.x, c.y - o.y) >= d);
      });
      const r = sum[i];
      r.mid += Math.hypot(st.x - cx, st.y - cy);
      r.cities += mine.length;
      r.lv += mine.reduce((a, c) => a + c.level, 0);
      r.ore += m.deposits.filter((d) => d.kind !== 'oil' && Math.hypot(d.x - st.x, d.y - st.y) < 22).length;
      r.oil += m.deposits.filter((d) => d.kind === 'oil' && Math.hypot(d.x - st.x, d.y - st.y) < 22).length;
      r.near += Math.min(...m.starts.filter((_, j) => j !== i).map((o) => Math.hypot(o.x - st.x, o.y - st.y)));
      // every deposit on this start's side of the map (nearer to it than to any other start)
      const ours = m.deposits.filter((d) => { const dd = Math.hypot(d.x - st.x, d.y - st.y); return m.starts.every((o) => Math.hypot(d.x - o.x, d.y - o.y) >= dd); });
      r.vore += ours.filter((d) => d.kind !== 'oil').length;
      r.voil += ours.filter((d) => d.kind === 'oil').length;
    });
  }
  for (let i = 0; i < n; i++) {
    const r = sum[i];
    const f = (v: number) => (v / seeds).toFixed(2).padStart(6);
    console.log(`P${i}: mid ${f(r.mid)}  cities ${f(r.cities)}  levels ${f(r.lv)}  ore ${f(r.ore)}  oil ${f(r.oil)}  nearest enemy ${f(r.near)}  side: ore ${f(r.vore)} oil ${f(r.voil)}`);
  }
  console.log(`per map: city-count gap ${(citySpread / seeds).toFixed(2)}, distance-to-middle gap ${(midSpread / seeds).toFixed(1)} tiles, maps within 1 city ${fair}/${seeds}`);
}

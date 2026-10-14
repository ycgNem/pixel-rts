// Debug: the terrain around each start (R = road, . = land, ~ = water, H = the HQ footprint).
import { generateMap } from '../../src/sim/mapgen';
import { T } from '../../src/data/terrain';
import { setup } from '../../tests/helpers';

export async function main(args: string[]) {
  const m = generateMap(setup({ seed: +(args[0] ?? 12) }, 2));
  for (const st of m.starts) {
    console.log(`start ${st.x},${st.y}`);
    for (let y = st.y - 8; y <= st.y + 8; y++) {
      let row = '';
      for (let x = st.x - 10; x <= st.x + 10; x++) {
        const t = m.terrain[y * m.w + x];
        row += t === T.ROAD ? 'R' : x >= st.x - 2 && x < st.x + 2 && y >= st.y - 2 && y < st.y + 2 ? 'H' : t === T.WATER || t === T.DEEP ? '~' : '.';
      }
      console.log('  ' + row);
    }
  }
}

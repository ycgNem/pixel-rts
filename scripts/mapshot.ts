// Render generated maps to PNG (one pixel per tile, scaled) to eyeball the map generator.
//   node scripts/run.mjs scripts/mapshot.ts [--seed 1] [--type pangaea] [--size medium] [--players 4] [--out e2e/out/maps]
import fs from 'node:fs';
import path from 'node:path';
import { generateMap } from '../src/sim/mapgen';
import { TERRAIN } from '../src/data/terrain';
import { PALETTE_RGB } from '../src/data/palette';
import type { MatchSetup } from '../src/sim/types';
// @ts-expect-error plain JS helper
import { encodePNG } from './lib/png.mjs';

export function main(args: string[]) {
  const opt = (k: string, d: string) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
  const types = opt('type', 'pangaea,continents,islands,lakes').split(',');
  const seeds = opt('seed', '1,2,3').split(',').map(Number);
  const out = opt('out', 'e2e/out/maps');
  const players = +opt('players', '4');
  fs.mkdirSync(out, { recursive: true });
  for (const type of types)
    for (const seed of seeds) {
      const setup = {
        seed, mapType: type, mapSize: opt('size', 'medium'), fog: 'on', timeLimit: 0, weather: true, crates: true,
        victory: { conquest: true, supremacy: true, science: true },
        players: Array.from({ length: players }, (_, i) => ({ name: 'P' + i, team: i, color: i, kind: 'ai' })),
      } as MatchSetup;
      const t0 = performance.now();
      const m = generateMap(setup);
      const ms = performance.now() - t0;
      const K = 3;
      const data = new Uint8Array(m.w * K * m.h * K * 4);
      const put = (x: number, y: number, rgb: number[]) => {
        for (let yy = 0; yy < K; yy++) for (let xx = 0; xx < K; xx++) {
          const p = ((y * K + yy) * m.w * K + x * K + xx) * 4;
          data[p] = rgb[0]; data[p + 1] = rgb[1]; data[p + 2] = rgb[2]; data[p + 3] = 255;
        }
      };
      for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) put(x, y, PALETTE_RGB[TERRAIN[m.terrain[y * m.w + x]].mini]);
      for (const d of m.deposits) for (let yy = 0; yy < 2; yy++) for (let xx = 0; xx < 2; xx++) put(d.x + xx, d.y + yy, d.kind === 'oil' ? [0, 0, 0] : d.rich ? [255, 220, 0] : [200, 120, 60]);
      for (const c of m.cities) for (let yy = -1; yy <= 1; yy++) for (let xx = -1; xx <= 1; xx++) put(c.x + xx, c.y + yy, c.level >= 3 ? [255, 255, 255] : [230, 80, 200]);
      for (const s of m.starts) for (let yy = -2; yy < 2; yy++) for (let xx = -2; xx < 2; xx++) put(s.x + xx, s.y + yy, [255, 0, 0]);
      const file = path.join(out, `${type}-${seed}.png`);
      fs.writeFileSync(file, encodePNG(m.w * K, m.h * K, data));
      console.log(`${file}  ${m.w}x${m.h}  cities ${m.cities.length}  deposits ${m.deposits.length}  ${ms.toFixed(0)} ms`);
    }
}

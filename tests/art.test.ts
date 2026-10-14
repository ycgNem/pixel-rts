// Art coverage (M13 "no placeholder art left"): every sprite the renderer asks for comes from the
// imported sheets in src/art, not from the procedural placeholders.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { UNITS } from '../src/data/units';
import { BUILDINGS } from '../src/data/buildings';

function sheetKeys(): Set<string> {
  const keys = new Set<string>();
  for (const f of fs.readdirSync('src/art').filter((f) => f.endsWith('.json'))) {
    const j = JSON.parse(fs.readFileSync(`src/art/${f}`, 'utf8'));
    for (const k of Object.keys(j.frames ?? j)) keys.add(k);
  }
  return keys;
}

describe('art', () => {
  it('has imported art for every unit facing, building, city level and deposit', () => {
    const keys = sheetKeys();
    const missing: string[] = [];
    const need = (k: string) => { if (!keys.has(k)) missing.push(k); };
    for (const u of Object.values(UNITS)) {
      for (let d = 0; d < 8; d++) {
        need(`u:${u.id}:${d}`);
        // infantry walk; vehicles, aircraft and ships glide
        if (u.cls === 'infantry') for (let f = 0; f < 4; f++) need(`u:${u.id}:${d}:w${f}`);
      }
    }
    for (const k of Object.keys(BUILDINGS)) need(`b:${k}`);
    for (let l = 1; l <= 5; l++) need(`city:${l}`);
    for (const k of ['ore', 'oil', 'rich']) need(`dep:${k}`);
    expect(missing, `missing sprites: ${missing.join(' ')}`).toEqual([]);
  });
});

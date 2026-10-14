// Insurgent drops: for every partisan drop in 4-way AI FFAs, the city (level, owner), the men, the
// enemy units near it, and what came of it (taken within 2 minutes? men left after 30 s?).
//   node scripts/run.mjs scripts/dev/drops.ts [--seeds 1,2,3,4]
import { createMatch, step } from '../../src/sim/match';
import { createAi } from '../../src/sim/ai';
import { captureRadius } from '../../src/sim/cities';
import { enemies } from '../../src/sim/world';
import { TICK_RATE, type Command } from '../../src/sim/types';
import { setup } from '../../tests/helpers';

interface Drop { p: number; city: number; at: number; level: number; owner: string; men: number; danger: number; left30: number; took: boolean; ids: number[] }

export async function main(args: string[]) {
  const opt = (k: string, d: string) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
  const seeds = opt('seeds', '1,2,3,4').split(',').map(Number);
  const all: Drop[] = [];
  for (const seed of seeds) {
    const st = setup({ seed, mapType: 'pangaea', mapSize: 'medium', weather: true, crates: true }, 4);
    st.players.forEach((p) => { p.kind = 'ai'; p.ai = { difficulty: 'normal' }; });
    const s = createMatch(st);
    const ais = s.players.map((p) => createAi(s, p.id, 'normal'));
    const open: Drop[] = [];
    while (!s.over && s.tick < 60 * 60 * TICK_RATE) {
      const cmds: Command[] = [];
      for (const ai of ais) cmds.push(...ai.think(s));
      const before = new Set(Object.keys(s.ents).map(Number));
      for (const e of step(s, cmds)) {
        if (e.e === 'insurge') {
          const c = s.cities[e.city];
          let danger = 0;
          for (const id in s.ents) {
            const u = s.ents[id];
            if (u.t === 'u' && !u.inside && u.owner >= 0 && enemies(s, e.p, u.owner) && Math.hypot(u.x - c.x - 0.5, u.y - c.y - 0.5) <= captureRadius(c) + 3) danger++;
          }
          const ids = Object.keys(s.ents).map(Number).filter((id) => !before.has(id) && s.ents[id].owner === e.p);
          const d: Drop = { p: e.p, city: e.city, at: s.tick, level: c.level, owner: c.owner < 0 ? 'neutral' : c.owner === e.p ? 'own' : 'enemy', men: e.n, danger, left30: -1, took: false, ids };
          open.push(d);
          all.push(d);
        }
        if (e.e === 'capture') for (const d of open) if (d.city === e.city && e.owner === d.p) d.took = true;
      }
      for (let i = open.length - 1; i >= 0; i--) {
        const d = open[i];
        if (d.left30 < 0 && s.tick - d.at >= 30 * TICK_RATE) d.left30 = d.ids.filter((id) => s.ents[id]).length;
        if (s.tick - d.at >= 120 * TICK_RATE) open.splice(i, 1);
      }
    }
    console.log(`seed ${seed}: ${(s.tick / TICK_RATE / 60).toFixed(1)} min`);
  }
  for (const d of all) console.log(`  P${d.p} ${d.owner} L${d.level} men ${d.men} danger ${d.danger} → ${d.took ? 'TOOK' : 'failed'} (${d.left30} left at 30 s)`);
  const took = all.filter((d) => d.took).length;
  const calm = all.filter((d) => d.danger === 0), calmTook = calm.filter((d) => d.took).length;
  // (a drop at a city the insurgent already holds is a reinforcement, not an attack)
  const attacks = all.filter((d) => d.owner !== 'own'), attTook = attacks.filter((d) => d.took).length;
  console.log(`drops ${all.length}, took ${took} (${Math.round((100 * took) / Math.max(1, all.length))}%); attacks ${attacks.length}, took ${attTook} (${Math.round((100 * attTook) / Math.max(1, attacks.length))}%); with no enemy near ${calm.length}, took ${calmTook}`);
  const byLevel = new Map<number, [number, number]>();
  for (const d of all) { const v = byLevel.get(d.level) ?? [0, 0]; v[0]++; if (d.took) v[1]++; byLevel.set(d.level, v); }
  console.log('by level', [...byLevel].sort((a, b) => a[0] - b[0]).map(([l, [n, t]]) => `L${l} ${t}/${n}`).join(', '));
}

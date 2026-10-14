import { createMatch, step } from '../../src/sim/match';
import { spawnUnit } from '../../src/sim/lifecycle';
import type { MatchSetup, Unit } from '../../src/sim/types';
export function main() {
  const setup = { seed: 7, mapType: 'pangaea', mapSize: 'small', fog: 'on', timeLimit: 0, weather: false, crates: false,
    victory: { conquest: true, supremacy: true, science: true },
    players: [0, 1].map((i) => ({ name: 'P' + i, team: i, color: i, kind: 'passive' })) } as MatchSetup;
  const s = createMatch(setup);
  for (const id of Object.keys(s.ents)) if (s.ents[+id].t === 'u') delete s.ents[+id];
  const p = { x: s.map.w / 2, y: s.map.h / 2 };
  const tank = spawnUnit(s, 'heavytank', 0, p.x, p.y);
  const rs: Unit[] = [];
  for (let i = 0; i < 12; i++) rs.push(spawnUnit(s, 'rifleman', 1, p.x + 3 + (i % 3) * 0.5, p.y - 1 + Math.floor(i / 3) * 0.5));
  for (let t = 0; t < 1200; t++) {
    step(s, []);
    if (t % 100 === 0) console.log(t / 20, 'tank hp', tank.hp.toFixed(0), 'xp', tank.xp.toFixed(2), 'vet', tank.vet, 'riflemen left', rs.filter((r) => s.ents[r.id]).length, 'tgt', tank.tgt, 'over', JSON.stringify(s.over));
  }
}

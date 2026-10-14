// How hard does the AI hit a weak player? P0 is passive, or an Easy AI standing in for a new
// human; P1 is the AI under test. Prints when the first enemy army reaches P0's base, how big it
// was, and when P0's HQ falls.
//   node scripts/run.mjs scripts/dev/newbie.ts --p0 passive|easy|normal --p1 normal|easy|hard --seeds 1,2,3 [--size small] [--minutes 40]
import { createMatch, step } from '../../src/sim/match';
import { createAi } from '../../src/sim/ai';
import { armyValue } from '../../src/sim/lifecycle';
import { AI_LEVELS } from '../../src/data/ai';
import { UNITS } from '../../src/data/units';
import { TICK_RATE, type MatchSetup, type Command, type AiDifficulty } from '../../src/sim/types';

export function main(args: string[]) {
  const opt = (k: string, d: string) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
  const p0 = opt('p0', 'passive'), p1 = opt('p1', 'normal') as AiDifficulty;
  const minutes = +opt('minutes', '40');
  const tw = opt('tweak', '');
  if (tw) for (const kv of tw.split(',')) { const [lvl, k, v] = kv.split(':'); (AI_LEVELS as any)[lvl][k] = +v; console.log('tweak', lvl, k, v); }
  const out: string[] = [];
  for (const seed of opt('seeds', '1,2,3').split(',').map(Number)) {
    const setup: MatchSetup = {
      seed, mapType: opt('type', 'pangaea') as MatchSetup['mapType'], mapSize: opt('size', 'small') as MatchSetup['mapSize'],
      fog: 'on', timeLimit: 0, weather: true, crates: true, victory: { conquest: true, supremacy: true, science: true },
      players: [
        p0 === 'passive' ? { name: 'P0', team: 0, color: 0, kind: 'passive' } : { name: 'P0', team: 0, color: 0, kind: 'ai', ai: { difficulty: p0 as AiDifficulty } },
        { name: 'P1', team: 1, color: 1, kind: 'ai', ai: { difficulty: p1 } },
      ],
    } as MatchSetup;
    const s = createMatch(setup);
    const ais = s.players.filter((p) => setup.players[p.id].kind === 'ai').map((p) => createAi(s, p.id, setup.players[p.id].ai!.difficulty));
    const hq = Object.values(s.ents).find((e) => e.t === 'b' && e.owner === 0 && e.kind === 'hq')!;
    let firstArrive = -1, peakVal = 0, peakAt = 0;
    const log: string[] = [];
    for (let t = 0; t < minutes * 60 * TICK_RATE && !s.over; t++) {
      const cmds: Command[] = [];
      for (const ai of ais) cmds.push(...ai.think(s));
      step(s, cmds);
      if (t % 20 === 0) {
        const near = Object.values(s.ents).filter((e) => e.t === 'u' && e.owner === 1 && UNITS[e.kind].weapons.length && Math.hypot(e.x - hq.x, e.y - hq.y) < 16);
        const v = near.reduce((a, e) => a + UNITS[e.kind].cost.cash + 2 * UNITS[e.kind].cost.oil, 0);
        if (v >= 400 && firstArrive < 0) { firstArrive = s.tick; log.push(`first raid ${(s.tick / 1200).toFixed(1)}m worth ${v}: ${[...new Set(near.map((e) => e.kind))].join(',')}`); }
        if (v > peakVal) { peakVal = v; peakAt = s.tick; }
      }
      if (s.tick % (5 * 60 * TICK_RATE) === 0) {
        const c0 = s.cities.filter((c) => c.owner === 0).length, c1 = s.cities.filter((c) => c.owner === 1).length;
        log.push(`${s.tick / 1200}m army ${Math.round(armyValue(s, 0))} vs ${Math.round(armyValue(s, 1))}, cities ${c0} vs ${c1}, P0 hq ${s.ents[hq.id] ? Math.round((s.ents[hq.id] as { hp: number }).hp) : 'dead'}`);
      }
    }
    const res = s.over ? `team ${s.over.winners} wins by ${s.over.reason} at ${(s.over.tick / 1200).toFixed(1)}m` : `no winner after ${minutes}m`;
    console.log(`seed ${seed} P0 ${p0} vs P1 ${p1}: ${res}; peak raid ${peakVal} at ${(peakAt / 1200).toFixed(1)}m`);
    for (const l of log) console.log('   ' + l);
    out.push(`seed ${seed}: ${res}`);
  }
  console.log(out.join('\n'));
}

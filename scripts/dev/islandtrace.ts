// Debug: why island matches stall. Every few minutes, where each side's units died (at sea, at
// home, on the enemy's island, elsewhere) and what P0's wave is doing.
//   node scripts/run.mjs scripts/dev/islandtrace.ts [--seed 2] [--size small] [--minutes 60] [--every 5]
import { createMatch, step } from '../../src/sim/match';
import { createAi } from '../../src/sim/ai';
import { compOf, nav } from '../../src/sim/nav';
import { TICK_RATE, type Command, type MatchSetup, type Unit } from '../../src/sim/types';
import { UNITS } from '../../src/data/units';

export function main(args: string[]) {
  const opt = (k: string, d: string) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
  const setup: MatchSetup = {
    seed: +opt('seed', '2'), mapType: opt('type', 'islands') as MatchSetup['mapType'], mapSize: opt('size', 'small') as MatchSetup['mapSize'],
    fog: 'on', timeLimit: 0, weather: true, crates: true, victory: { conquest: true, supremacy: true, science: true },
    players: [0, 1].map((i) => ({ name: `P${i}`, team: i, color: i, kind: 'ai' as const, ai: { difficulty: 'normal' as const } })),
  };
  const s = createMatch(setup);
  const ais = s.players.map((p) => createAi(s, p.id, 'normal'));
  const n = nav(s);
  const isle = (p: number) => {
    const u = Object.values(s.ents).find((e): e is Unit => e.t === 'u' && e.owner === p && e.kind === 'builder')!;
    return compOf(n, 'ground', Math.floor(u.x), Math.floor(u.y));
  };
  const home = [isle(0), isle(1)];
  const every = +opt('every', '5');
  // deaths per player: [sea, home, enemy island, elsewhere], and kinds lost on the enemy island
  let deaths = [[0, 0, 0, 0], [0, 0, 0, 0]];
  let lostThere: Record<string, number>[] = [{}, {}];
  let bdead: string[] = [];
  for (let t = 0; t < +opt('minutes', '60') * 60 * TICK_RATE && !s.over; t++) {
    const cmds: Command[] = [];
    for (const ai of ais) cmds.push(...ai.think(s));
    const ev = step(s, cmds);
    for (const e of ev) {
      if (e.e !== 'die' || e.owner < 0 || e.owner > 1) continue;
      if (e.b) { bdead.push(`P${e.owner}:${e.kind}`); continue; }
      if (UNITS[e.kind].layer === 'air') continue;
      const c = compOf(n, 'ground', Math.floor(e.x), Math.floor(e.y));
      const k = UNITS[e.kind].layer === 'naval' || c < 0 ? 0 : c === home[e.owner] ? 1 : c === home[1 - e.owner] ? 2 : 3;
      deaths[e.owner][k]++;
      if (k === 2) lostThere[e.owner][e.kind] = (lostThere[e.owner][e.kind] ?? 0) + 1;
    }
    if (s.tick % (every * 60 * TICK_RATE) === 0) {
      const b = ais[0] as unknown as { wave: { target: { x: number; y: number; id: number; city: boolean; spot?: boolean; help?: number }; ids: number[]; value0: number; go: boolean } | null; ferries: Map<number, { phase: string; ids: number[] }> };
      console.log(`${(s.tick / 1200).toFixed(0)}m deaths [sea, home, there, else] P0 ${deaths[0]} P1 ${deaths[1]}`);
      console.log(`   P0 lost there ${JSON.stringify(lostThere[0])}  P1 lost there ${JSON.stringify(lostThere[1])}  buildings ${bdead.join(' ')}`);
      const tgt = b.wave?.target;
      const tk = !tgt ? '-' : tgt.city ? `city ${s.cities[tgt.id].name} (P${s.cities[tgt.id].owner})` : tgt.spot ? 'start' : tgt.help ? 'flare'
        : s.ents[tgt.id] ? (s.ents[tgt.id] as { kind: string }).kind : 'gone';
      console.log(`   P0 wave ${b.wave ? `${tk}@${Math.round(tgt!.x)},${Math.round(tgt!.y)} n=${b.wave.ids.length} v0=${Math.round(b.wave.value0)} ${b.wave.go ? 'go' : 'beach'}` : '-'} ferries ${JSON.stringify([...b.ferries].map(([, f]) => [f.phase, f.ids.length]))}`);
      deaths = [[0, 0, 0, 0], [0, 0, 0, 0]];
      lostThere = [{}, {}];
      bdead = [];
    }
  }
  console.log(s.over ? `over: ${JSON.stringify(s.over)} at ${(s.tick / 1200).toFixed(1)}m` : 'no winner');
}

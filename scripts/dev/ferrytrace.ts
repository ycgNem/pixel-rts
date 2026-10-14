// Debug: trace the AI's waves and ferries on a separated map.
//   node scripts/run.mjs scripts/dev/ferrytrace.ts [--seed 3] [--type continents] [--minutes 20]
import { createMatch, step } from '../../src/sim/match';
import { createAi } from '../../src/sim/ai';
import { TICK_RATE, type Command, type MatchSetup, type Unit } from '../../src/sim/types';

export function main(args: string[]) {
  const opt = (k: string, d: string) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
  const setup: MatchSetup = {
    seed: +opt('seed', '3'), mapType: opt('type', 'continents') as MatchSetup['mapType'], mapSize: 'small',
    fog: 'on', timeLimit: 0, weather: true, crates: true, victory: { conquest: true, supremacy: true, science: true },
    players: [0, 1].map((i) => ({ name: `P${i}`, team: i, color: i, kind: 'ai' as const, ai: { difficulty: 'normal' as const } })),
  };
  const s = createMatch(setup);
  const ais = s.players.map((p) => createAi(s, p.id, 'normal'));
  for (let t = 0; t < +opt('minutes', '20') * 60 * TICK_RATE && !s.over; t++) {
    const cmds: Command[] = [];
    for (const ai of ais) cmds.push(...ai.think(s));
    const ev = step(s, cmds);
    for (const e of ev) if (e.e === 'reject' && e.p === 0) console.log(`  ${(s.tick / 1200).toFixed(2)}m reject: ${e.why}`);
    if (s.tick % (30 * TICK_RATE) === 0) {
      const b = ais[0] as unknown as { wave: { target: unknown; ids: number[] } | null; ferries: Map<number, { phase: string; ids: number[]; dest: number[] }>; island: boolean; unchecked: number[] };
      const tr = Object.values(s.ents).filter((e): e is Unit => e.t === 'u' && e.owner === 0 && e.kind === 'transport');
      console.log(`${(s.tick / 1200).toFixed(1)}m island=${b.island} unchecked=${JSON.stringify(b.unchecked)} wave=${b.wave ? JSON.stringify(b.wave.target) + ' n=' + b.wave.ids.length : '-'} ferries=${JSON.stringify([...b.ferries].map(([id, f]) => [id, f.phase, f.ids.length, f.dest.map(Math.round)]))} transports=${tr.map((u) => `${u.id}@${u.x.toFixed(0)},${u.y.toFixed(0)} cargo ${u.cargo.length} ${u.order?.o ?? 'idle'}`).join('; ')}`);
    }
  }
}

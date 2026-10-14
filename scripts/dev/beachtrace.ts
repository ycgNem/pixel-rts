// Debug: while an AI landing holds its beach, which wave units ashore are far from it, and why.
//   node scripts/run.mjs scripts/dev/beachtrace.ts [--seed 2] [--minutes 25]
import { createMatch, step } from '../../src/sim/match';
import { createAi } from '../../src/sim/ai';
import { compOf, nav } from '../../src/sim/nav';
import { TICK_RATE, type Command, type Unit } from '../../src/sim/types';
import { setup } from '../../tests/helpers';

export async function main(args: string[]) {
  const opt = (k: string, d: string) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
  const st = setup({ seed: +opt('seed', '2'), mapType: 'islands', weather: true, crates: true }, 2);
  st.players.forEach((p) => { p.kind = 'ai'; p.ai = { difficulty: 'normal' }; });
  const s = createMatch(st);
  const ais = s.players.map((p) => createAi(s, p.id, 'normal'));
  const n = nav(s);
  type W = { ids: number[]; go: boolean; beach: [number, number] | null; landed: number; regroup?: boolean; target: { x: number; y: number } };
  const brain = ais[0] as unknown as { wave: W | null };
  let lastLog = 0;
  while (s.tick < +opt('minutes', '25') * 60 * TICK_RATE && !s.over) {
    const c: Command[] = [];
    for (const a of ais) c.push(...a.think(s));
    step(s, c);
    if (s.tick % TICK_RATE) continue;
    const w = brain.wave;
    if (!w || w.go || !w.beach || w.landed < 0) continue;
    const land = compOf(n, 'ground', Math.floor(w.beach[0]), Math.floor(w.beach[1]));
    const far = w.ids.map((id) => s.ents[id] as Unit | undefined).filter((u): u is Unit => !!u && !u.inside && compOf(n, 'ground', Math.floor(u.x), Math.floor(u.y)) === land && Math.hypot(u.x - w.beach![0], u.y - w.beach![1]) > 13);
    if (far.length && s.tick - lastLog > 20 * TICK_RATE) {
      lastLog = s.tick;
      console.log(`${(s.tick / 1200).toFixed(2)}m regroup=${!!w.regroup} beach ${w.beach.map(Math.round)} target ${Math.round(w.target.x)},${Math.round(w.target.y)} far: ${far.slice(0, 6).map((u) => `${u.kind}@${u.x.toFixed(0)},${u.y.toFixed(0)} d${Math.hypot(u.x - w.beach![0], u.y - w.beach![1]).toFixed(0)} ${u.order?.o ?? '-'}${u.tgt ? ' tgt' : ''}`).join(' | ')}`);
    }
  }
}

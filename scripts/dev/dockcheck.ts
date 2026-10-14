// Debug: what a player's docks are doing at a given minute of an AI match.
//   node scripts/run.mjs scripts/dev/dockcheck.ts [--seed 2] [--type continents] [--minute 24] [--p 0]
import { createMatch, step } from '../../src/sim/match';
import { createAi } from '../../src/sim/ai';
import { TICK_RATE, type Command, type MatchSetup } from '../../src/sim/types';
import { supplyCap, supplyUsed } from '../../src/sim/economy';
import { setup } from '../../tests/helpers';

export async function main(args: string[]) {
  const opt = (k: string, d: string) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
  const st = setup({ seed: +opt('seed', '2'), mapType: opt('type', 'continents') as MatchSetup['mapType'], weather: true, crates: true }, 2);
  st.players.forEach((p) => { p.kind = 'ai'; p.ai = { difficulty: 'normal' }; });
  const s = createMatch(st);
  const ais = s.players.map((p) => createAi(s, p.id, 'normal'));
  const me = +opt('p', '0');
  const end = +opt('minute', '24') * 60 * TICK_RATE;
  const rejects = new Map<string, number>();
  while (s.tick < end && !s.over) {
    const cmds: Command[] = [];
    for (const ai of ais) cmds.push(...ai.think(s));
    for (const e of step(s, cmds)) if (e.e === 'reject' && e.p === me) rejects.set(e.why, (rejects.get(e.why) ?? 0) + 1);
    if (s.tick % (60 * TICK_RATE) === 0) {
      const docks = Object.values(s.ents).filter((e) => e.t === 'b' && e.owner === me && e.kind === 'dock');
      const ships = Object.values(s.ents).filter((e) => e.t === 'u' && e.owner === me && ['transport', 'destroyer', 'patrolboat', 'submarine', 'battleship'].includes(e.kind)).map((e) => e.kind);
      const p = s.players[me];
      console.log(`${s.tick / TICK_RATE / 60}m $${Math.round(p.cash)} oil ${Math.round(p.oil)} sup ${supplyUsed(s, me)}/${supplyCap(s, me)} docks ${docks.map((d) => d.t === 'b' ? `${d.built.toFixed(1)}:[${d.prod.map((q) => q.kind).join(',')}]` : '').join(' ')} ships ${ships.join(',')}`);
    }
  }
  console.log('rejects', [...rejects]);
}

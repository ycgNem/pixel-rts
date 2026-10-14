// Fifth-pass probe: AI matches with the stats the fifth critic pass changed: match length, aces
// and bounties, insurgent drops that capture, contracts, fighters against warships.
//   node scripts/run.mjs scripts/dev/pass5.ts [--seeds 1,2,3] [--teams 0,1,2,3] [--type pangaea] [--size medium]
//     [--levels easy,normal] (one per seat, default normal) [--cap 60] (minutes)
//     [--human 0] (seats that never surrender, standing in for a person)
import { createMatch, step } from '../../src/sim/match';
import { createAi } from '../../src/sim/ai';
import { insurgent } from '../../src/sim/world';
import { TICK_RATE, type AiDifficulty, type Command, type MatchSetup } from '../../src/sim/types';
import { setup } from '../../tests/helpers';

export async function main(args: string[]) {
  const opt = (k: string, d: string) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
  const seeds = opt('seeds', '1,2,3,4,5,6').split(',').map(Number);
  const teams = opt('teams', '0,1,2,3').split(',').map(Number);
  const levels = opt('levels', '').split(',').filter(Boolean) as AiDifficulty[];
  const cap = +opt('cap', '60');
  const human = opt('human', '').split(',').filter(Boolean).map(Number);
  const n = teams.length;
  const lengths: number[] = [];
  const total = { aces: 0, bounties: 0, drops: 0, dropCaps: 0, refound: 0, jobs: 0, fighters: 0, bombers: 0, warships: 0, transports: 0 };
  for (const seed of seeds) {
    const st = setup({ seed, mapType: opt('type', 'pangaea') as MatchSetup['mapType'], mapSize: opt('size', 'medium') as MatchSetup['mapSize'], weather: true, crates: true }, n);
    st.players.forEach((p, i) => { p.kind = 'ai'; p.team = teams[i]; p.ai = { difficulty: levels[i] ?? 'normal' }; });
    const s = createMatch(st);
    const ais = s.players.map((p) => createAi(s, p.id, levels[p.id] ?? 'normal'));
    let aces = 0, bounties = 0, drops = 0, dropCaps = 0, refound = 0, fighters = 0, bombers = 0, warships = 0, transports = 0;
    const jobs: string[] = [];
    const out: string[] = [];
    while (!s.over && s.tick < cap * 60 * TICK_RATE) {
      const cmds: Command[] = [];
      for (const ai of ais) cmds.push(...ai.think(s).filter((c) => !(c.t === 'surrender' && human.includes(c.p))));
      for (const e of step(s, cmds)) {
        if (e.e === 'ace') aces++;
        if (e.e === 'aceDown' && e.by >= 0) bounties++;
        if (e.e === 'insurge') drops++;
        if (e.e === 'capture' && insurgent(s, s.players[e.owner])) dropCaps++;
        if (e.e === 'refound') refound++;
        if (e.e === 'contractDone') jobs.push(`${e.kind[0]}${e.kind === 'supply' ? '$' + e.cash : ''}`);
        if (e.e === 'eliminated') out.push(`P${e.p}@${(s.tick / TICK_RATE / 60).toFixed(1)}`);
        if (e.e === 'trained') {
          if (e.kind === 'fighter') fighters++;
          else if (e.kind === 'bomber') bombers++;
          else if (e.kind === 'transport') transports++;
          else if (['patrolboat', 'destroyer', 'submarine', 'battleship'].includes(e.kind)) warships++;
        }
      }
    }
    const min = s.tick / TICK_RATE / 60;
    lengths.push(min);
    const who = s.over ? (s.over.winners >= 0 ? `team ${s.over.winners} by ${s.over.reason}` : 'draw') : 'no winner';
    console.log(`seed ${seed}: ${min.toFixed(1)} min, ${who}; out ${out.join(' ') || '-'}; aces ${aces} (bounties ${bounties}); drops ${drops} (captures ${dropCaps}, back ${refound}); jobs ${jobs.join(' ') || '-'}; air F${fighters}/B${bombers}; sea W${warships}/T${transports}`);
    Object.assign(total, {
      aces: total.aces + aces, bounties: total.bounties + bounties, drops: total.drops + drops, dropCaps: total.dropCaps + dropCaps,
      refound: total.refound + refound, jobs: total.jobs + jobs.length, fighters: total.fighters + fighters, bombers: total.bombers + bombers,
      warships: total.warships + warships, transports: total.transports + transports,
    });
  }
  const sorted = [...lengths].sort((a, b) => a - b);
  const med = sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
  console.log(`median ${med.toFixed(1)} min (${sorted[0].toFixed(1)}-${sorted[sorted.length - 1].toFixed(1)}); totals ${JSON.stringify(total)}`);
}

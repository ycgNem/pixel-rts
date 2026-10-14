// Seat-bias probe: 4-player AI matches with fixed team layouts; prints which team won.
//   node scripts/run.mjs scripts/dev/seatbias.ts [--seeds 1,2,3] [--teams 0,0,1,1] [--type pangaea] [--size small] [--rot 0]
// --rot k gives player i the start spot of player (i + k) % n (geography moves, seat logic stays).
import { createMatch, step } from '../../src/sim/match';
import { createAi } from '../../src/sim/ai';
import { TICK_RATE, type Command, type MatchSetup } from '../../src/sim/types';
import { setup } from '../../tests/helpers';

export async function main(args: string[]) {
  const opt = (k: string, d: string) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
  const seeds = opt('seeds', '1,2,3,4,5,6').split(',').map(Number);
  const teams = opt('teams', '0,0,1,1').split(',').map(Number);
  const rot = +opt('rot', '0');
  const n = teams.length;
  const wins: string[] = [];
  for (const seed of seeds) {
    const st = setup({ seed, mapType: opt('type', 'pangaea') as MatchSetup['mapType'], mapSize: opt('size', 'small') as MatchSetup['mapSize'], weather: true, crates: true }, n);
    st.players.forEach((p, i) => { p.kind = 'ai'; p.team = teams[i]; p.ai = { difficulty: 'normal' }; });
    const s = createMatch(st);
    if (rot) {
      // player i takes over what stands on start (i + rot) % n
      for (const e of Object.values(s.ents)) if (e.owner >= 0) e.owner = (e.owner - rot + n) % n;
      s.map.starts = s.map.starts.map((_, i) => s.map.starts[(i + rot) % n]);
    }
    const ais = s.players.map((p) => createAi(s, p.id, 'normal'));
    const first: number[] = [];
    // insurgency: partisan drops, and players back in the match (who, when)
    let drops = 0;
    // city contracts filled (who, which kind)
    const jobs: string[] = [];
    const back: string[] = [];
    while (!s.over && s.tick < 60 * 60 * TICK_RATE) {
      const cmds: Command[] = [];
      for (const ai of ais) cmds.push(...ai.think(s));
      for (const e of step(s, cmds)) {
        if (e.e === 'eliminated') first.push(e.p);
        if (e.e === 'insurge') drops++;
        if (e.e === 'contractDone') jobs.push(`P${e.p}:${e.kind}`);
        if (e.e === 'refound') back.push(`P${e.p}@${(s.tick / TICK_RATE / 60).toFixed(1)}m`);
      }
    }
    const w = s.over ? s.over.winners : -1;
    const withP1 = teams[1];
    wins.push(`seed ${seed}: team ${w} wins (${s.over?.reason ?? 'none'}, ${(s.tick / TICK_RATE / 60).toFixed(1)}m), P1's team ${w === withP1 ? 'WON' : 'lost'}, out: ${first.map((p) => 'P' + p).join(' ')}${drops ? `, ${drops} drops` : ''}${back.length ? `, back: ${back.join(' ')}` : ''}${jobs.length ? `, jobs: ${jobs.join(' ')}` : ''}`);
    console.log(wins[wins.length - 1]);
  }
}

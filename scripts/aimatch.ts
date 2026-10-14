// Headless AI-vs-AI matches: plays whole games with no browser and prints how they went.
//   node scripts/run.mjs scripts/aimatch.ts [--seeds 1,2] [--type pangaea] [--size small]
//       [--players 2] [--diff normal,normal] [--pers balanced,militarist] [--minutes 30] [--every 2]
import { createMatch, step } from '../src/sim/match';
import { createAi } from '../src/sim/ai';
import { TICK_RATE, type AiDifficulty, type AiPersonality, type MatchSetup, type Command } from '../src/sim/types';
import { armyValue } from '../src/sim/lifecycle';
import { supplyUsed, supplyCap, incomeOf } from '../src/sim/economy';

export function main(args: string[]) {
  const opt = (k: string, d: string) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
  const seeds = opt('seeds', '1').split(',').map(Number);
  const n = +opt('players', '2');
  const diffs = opt('diff', 'normal').split(',') as AiDifficulty[];
  const pers = opt('pers', 'balanced').split(',');
  const minutes = +opt('minutes', '30');
  const every = +opt('every', '2');
  const teams = opt('teams', '');
  const results: string[] = [];
  for (const seed of seeds) {
    const setup: MatchSetup = {
      seed, mapType: opt('type', 'pangaea') as MatchSetup['mapType'], mapSize: opt('size', 'small') as MatchSetup['mapSize'],
      fog: 'on', timeLimit: 0, weather: true, crates: true, victory: { conquest: true, supremacy: true, science: true },
      players: Array.from({ length: n }, (_, i) => ({
        name: `P${i}`, team: teams ? +teams.split(',')[i] : i, color: i, kind: 'ai' as const,
        ai: { difficulty: diffs[i % diffs.length], personality: (pers[i % pers.length] === 'balanced' ? undefined : pers[i % pers.length]) as AiPersonality | undefined },
      })),
    };
    const s = createMatch(setup);
    const ais = s.players.map((p) => createAi(s, p.id, setup.players[p.id].ai!.difficulty, setup.players[p.id].ai!.personality));
    const t0 = performance.now();
    let rejects = new Map<string, number>();
    // merchant convoys: arrived and sunk, per player
    const convoys = new Map<number, [number, number]>();
    console.log(`\n=== seed ${seed} ${setup.mapType} ${setup.mapSize}: ${setup.players.map((p) => `${p.name}(${p.ai!.difficulty}/${p.ai!.personality ?? 'balanced'} t${p.team})`).join(' vs ')}`);
    for (let t = 0; t < minutes * 60 * TICK_RATE && !s.over; t++) {
      const cmds: Command[] = [];
      for (const ai of ais) cmds.push(...ai.think(s));
      const ev = step(s, cmds);
      for (const e of ev) if (e.e === 'convoy') { const c = convoys.get(e.p) ?? [0, 0]; c[e.by < 0 ? 0 : 1]++; convoys.set(e.p, c); }
      for (const e of ev) if (e.e === 'reject') rejects.set(`P${e.p}: ${e.why}`, (rejects.get(`P${e.p}: ${e.why}`) ?? 0) + 1);
      const when = () => `${(s.tick / TICK_RATE / 60).toFixed(1)}m`;
      for (const e of ev) {
        if (e.e === 'era') console.log(`  ${when()} P${e.p} enters era ${e.era + 1}`);
        else if (e.e === 'exile') console.log(`  ${when()} P${e.p} HQ fell: government flees to ${s.cities[e.city].name} (level ${s.cities[e.city].level})`);
        else if (e.e === 'eliminated') console.log(`  ${when()} P${e.p} eliminated (best city level ${Math.max(0, ...s.cities.filter((c) => c.owner === e.p).map((c) => c.level))})`);
        else if (e.e === 'die' && e.kind === 'hq') console.log(`  ${when()} P${e.owner} HQ destroyed`);
        else if (e.e === 'launch') console.log(`  ${when()} P${e.p} starts a launch at (${Math.round(e.x)}, ${Math.round(e.y)})`);
        else if (e.e === 'scrub') console.log(`  ${when()} P${e.by} scrubs P${e.p}'s launch (now at ${(e.done / TICK_RATE / 60).toFixed(1)}m)`);
        else if (e.e === 'die' && e.kind === 'launch') console.log(`  ${when()} P${e.owner} launch site destroyed`);
        else if (e.e === 'power' && e.power === 'help') console.log(`  ${when()} P${e.p} calls for help at (${Math.round(e.x)}, ${Math.round(e.y)})`);
        else if (e.e === 'coalition') console.log(`  ${when()} coalition ${e.team >= 0 ? 'against team ' + e.team : 'breaks up'}`);
      }
      if (s.tick % (every * 60 * TICK_RATE) === 0) {
        console.log(`  ${s.tick / TICK_RATE / 60}m`);
        for (const p of s.players) {
          const units = Object.values(s.ents).filter((e) => e.owner === p.id && e.t === 'u');
          const bs = Object.values(s.ents).filter((e) => e.owner === p.id && e.t === 'b');
          const kinds = new Map<string, number>();
          for (const u of units) kinds.set(u.kind, (kinds.get(u.kind) ?? 0) + 1);
          const bk = new Map<string, number>();
          for (const b of bs) bk.set(b.kind, (bk.get(b.kind) ?? 0) + 1);
          const inc = incomeOf(s, p.id);
          console.log(`    P${p.id} ${p.alive ? '' : '(dead) '}$${Math.round(p.cash)} oil ${Math.round(p.oil)} inc $${Math.round(inc.cash * 60)}/m sup ${supplyUsed(s, p.id)}/${supplyCap(s, p.id)} army ${Math.round(armyValue(s, p.id))} cities ${s.cities.filter((c) => c.owner === p.id).map((c) => c.level).join('')} era ${p.era} techs ${p.techs.length} kills ${p.stats.kills} lost ${p.stats.unitsLost}`);
          console.log(`       units ${[...kinds].map(([k, v]) => `${k}:${v}`).join(' ')} | bld ${[...bk].map(([k, v]) => `${k}:${v}`).join(' ')}`);
        }
      }
    }
    const ms = performance.now() - t0;
    const res = s.over ? `team ${s.over.winners} wins by ${s.over.reason} at ${(s.over.tick / TICK_RATE / 60).toFixed(1)}m` : `no winner after ${minutes}m`;
    console.log(`  RESULT: ${res}  (${(ms / 1000).toFixed(1)}s, ${(ms / Math.max(1, s.tick)).toFixed(2)} ms/tick)`);
    if (convoys.size) console.log('  convoys (arrived/sunk):', [...convoys].sort((a, b) => a[0] - b[0]).map(([p, c]) => `P${p} ${c[0]}/${c[1]}`).join('  '));
    if (rejects.size) console.log('  rejects:', [...rejects].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => `${k} x${v}`).join('; '));
    results.push(`seed ${seed}: ${res}`);
    rejects = new Map();
  }
  console.log('\n' + results.join('\n'));
}

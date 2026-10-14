// Debug: what the AI builds near a deposit right after losing its building there.
import { createMatch, step } from '../../src/sim/match';
import { createAi } from '../../src/sim/ai';
import { TICK_RATE, type Building, type Command } from '../../src/sim/types';
import { setup } from '../../tests/helpers';
import { hurt, spawnUnit } from '../../src/sim/lifecycle';

export async function main() {
  const st = setup({ seed: 1, weather: true, crates: true }, 2);
  st.players.forEach((p) => { p.kind = 'ai'; p.ai = { difficulty: 'normal' }; });
  const s = createMatch(st);
  const ais = s.players.map((p) => createAi(s, p.id, 'normal'));
  const play = (sec: number) => { const end = s.tick + sec * TICK_RATE; while (s.tick < end) { const c: Command[] = []; for (const a of ais) c.push(...a.think(s)); step(s, c); } };
  let d: Building | undefined;
  const from = +(process.argv.find((a) => a.startsWith('--from='))?.slice(7) ?? '0');
  play(from * 60);
  for (let i = 0; i < 60 && !d; i++) { play(10); d = Object.values(s.ents).find((e): e is Building => e.t === 'b' && e.owner === 0 && e.kind === 'derrick' && e.built >= 1); }
  console.log('derrick', d!.id, d!.x, d!.y, 'at', s.tick / 1200);
  const at = { x: d!.x, y: d!.y };
  const gun = spawnUnit(s, 'artillery', 1, at.x, at.y + 10);
  hurt(s, d!, 1e6, 'shell', gun, []);
  delete s.ents[gun.id];
  for (let t = 0; t < 120; t++) {
    play(1);
    const near = Object.values(s.ents).filter((e) => e.t === 'b' && e.owner === 0 && Math.hypot(e.x - at.x, e.y - at.y) < 6);
    if (near.some((e) => e.kind === 'derrick')) { console.log(t, 's:', near.map((e) => `${e.kind}#${e.id}@${e.x},${e.y} built ${(e as Building).built.toFixed(2)}`).join(' ')); }
    const brain = ais[0] as unknown as { losses: unknown[] };
    if (t === 2) console.log('losses', JSON.stringify(brain.losses));
  }
}

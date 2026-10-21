// Online cost of a 4-player match: plays AIs to a given minute, then measures per snapshot what the
// host spends (sim tick, AI think, encoding for each of 3 peers, JSON) and how many bytes go out.
//   node scripts/run.mjs scripts/dev/netbench.ts [minute] [players] [size]
import { createMatch, step } from '../../src/sim/match';
import { createAi } from '../../src/sim/ai';
import { TICK_RATE, type Command, type MatchSetup } from '../../src/sim/types';
import { SNAP_EVERY, SnapshotEncoder, applySnapshot, snapshotFrame } from '../../src/net/protocol';

export function main(args: string[]) {
  const minute = Number(args[0] ?? 15), n = Number(args[1] ?? 4), size = (args[2] ?? 'medium') as MatchSetup['mapSize'];
  const setup: MatchSetup = {
    seed: 3, mapType: 'pangaea', mapSize: size, fog: 'on', timeLimit: 0, weather: true, crates: true,
    victory: { conquest: true, supremacy: true, science: true },
    players: Array.from({ length: n }, (_, i) => ({ name: `P${i}`, team: i, color: i, kind: 'ai' as const, ai: { difficulty: 'normal' as const } })),
  };
  const s = createMatch(setup);
  const ais = s.players.map((p) => createAi(s, p.id, 'normal'));
  const peers = n - 1;
  const encs = Array.from({ length: peers }, () => new SnapshotEncoder());
  const client = createMatch(setup);
  let simMs = 0, aiMs = 0, encMs = 0, jsonMs = 0, applyMs = 0, bytes = 0, snaps = 0, ticks = 0;
  const parts: Record<string, number> = {};
  const end = minute * 60 * TICK_RATE, from = end - 60 * TICK_RATE;
  for (let t = 0; t < end && !s.over; t++) {
    const measure = t >= from;
    let a = performance.now();
    const cmds: Command[] = [];
    for (const ai of ais) cmds.push(...ai.think(s));
    let b = performance.now();
    if (measure) aiMs += b - a;
    const ev = step(s, cmds);
    a = performance.now();
    if (measure) { simMs += a - b; ticks++; }
    if (s.tick % SNAP_EVERY) continue;
    a = performance.now();
    const frame = snapshotFrame(s);
    if (measure) encMs += performance.now() - a;
    if (!measure) { for (const e of encs) e.encode(s, ev, false, frame); continue; }
    for (const [i, e] of encs.entries()) {
      a = performance.now();
      const snap = e.encode(s, ev, false, frame);
      b = performance.now();
      const json = JSON.stringify({ t: 'snap', s: snap });
      const c = performance.now();
      encMs += b - a;
      jsonMs += c - b;
      if (i === 0) {
        bytes += json.length;
        for (const [k, v] of Object.entries(snap)) parts[k] = (parts[k] ?? 0) + JSON.stringify(v ?? null).length;
        const d = performance.now();
        applySnapshot(client, JSON.parse(json).s);
        applyMs += performance.now() - d;
      }
    }
    snaps++;
  }
  const units = Object.values(s.ents).filter((e) => e.t === 'u').length;
  console.log(`${n} players, ${size}, minute ${minute}${s.over ? ' (ended early)' : ''}: ${units} units, ${Object.keys(s.ents).length} entities`);
  console.log(`per tick: sim ${(simMs / ticks).toFixed(2)} ms, AI think ${(aiMs / ticks).toFixed(2)} ms`);
  console.log(`per snapshot (${snaps} in the last minute): encode ${(encMs / snaps).toFixed(2)} ms and JSON ${(jsonMs / snaps).toFixed(2)} ms for ${peers} peers; client apply ${(applyMs / snaps).toFixed(2)} ms`);
  console.log(`host work per second: ${((simMs / ticks) * TICK_RATE + (aiMs / ticks) * TICK_RATE + ((encMs + jsonMs) / snaps) * (TICK_RATE / SNAP_EVERY)).toFixed(0)} ms`);
  console.log('bytes per snapshot by part: ' + Object.entries(parts).sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k} ${(v / snaps / 1024).toFixed(2)}K`).join(', '));
  console.log(`upload: ${(bytes / snaps / 1024).toFixed(1)} KB per snapshot per peer, ${((bytes / snaps) * (TICK_RATE / SNAP_EVERY) * peers / 1024).toFixed(0)} KB/s for ${peers} peers`);
}

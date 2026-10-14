// Shared test helpers: quick setups and running the sim headless.
import type { Command, MatchSetup, MatchState, PlayerSetup, SimEvent, Unit } from '../src/sim/types';
import { createMatch, step } from '../src/sim/match';
import { spawnUnit } from '../src/sim/lifecycle';
import { TICK_RATE } from '../src/sim/types';

export function setup(over: Partial<MatchSetup> = {}, players = 2): MatchSetup {
  const ps: PlayerSetup[] = Array.from({ length: players }, (_, i) => ({ name: 'P' + i, team: i, color: i, kind: 'passive' }));
  return {
    seed: 7, mapType: 'pangaea', mapSize: 'small', players: ps, fog: 'on', timeLimit: 0, weather: false, crates: false,
    victory: { conquest: true, supremacy: true, science: true },
    ...over,
  };
}

export function match(over: Partial<MatchSetup> = {}, players = 2): MatchState {
  return createMatch(setup(over, players));
}

/** Run n seconds; commands are applied on the first tick. Returns all events. */
export function run(s: MatchState, seconds: number, cmds: Command[] = []): SimEvent[] {
  const ev: SimEvent[] = [];
  const ticks = Math.round(seconds * TICK_RATE);
  for (let i = 0; i < ticks; i++) ev.push(...step(s, i === 0 ? cmds : []));
  return ev;
}

export function unitsOf(s: MatchState, p: number, kind?: string): Unit[] {
  return Object.values(s.ents).filter((e): e is Unit => e.t === 'u' && e.owner === p && (!kind || e.kind === kind));
}

/** Remove everything but HQs, then add units for a controlled fight. */
export function clear(s: MatchState) {
  for (const id of Object.keys(s.ents)) if (s.ents[+id].t === 'u') delete s.ents[+id];
}

export function add(s: MatchState, kind: string, owner: number, x: number, y: number): Unit {
  return spawnUnit(s, kind, owner, x, y);
}

/** A walkable open spot well away from every HQ. */
export function openSpot(s: MatchState): { x: number; y: number } {
  const { w, h, terrain } = s.map;
  for (let r = 0; r < w / 2; r++)
    for (let k = 0; k < 16; k++) {
      const x = Math.floor(w / 2 + Math.cos((k / 16) * Math.PI * 2) * r), y = Math.floor(h / 2 + Math.sin((k / 16) * Math.PI * 2) * r);
      let ok = true;
      for (let yy = -4; yy <= 4 && ok; yy++) for (let xx = -4; xx <= 4 && ok; xx++) if (![2, 3, 7, 8].includes(terrain[(y + yy) * w + x + xx])) ok = false;
      if (ok && s.map.starts.every((st) => Math.hypot(st.x - x, st.y - y) > 15) && s.cities.every((c) => Math.hypot(c.x - x, c.y - y) > 8)) return { x: x + 0.5, y: y + 0.5 };
    }
  throw new Error('no open spot');
}

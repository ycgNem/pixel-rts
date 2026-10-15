// A match: creating it from a setup, and advancing it one tick. This is the whole game; render, UI,
// net and AI only read the state and send commands.
import { START } from '../data/rules';
import { BUILDINGS } from '../data/buildings';
import { CONTRACTS, CRATES } from '../data/rules';
import { COMMAND } from '../data/powers';
import type { City, Command, MatchSetup, MatchState, Player, SimEvent } from './types';
import { TICK_RATE } from './types';
import { generateMap } from './mapgen';
import { hash2 } from './rng';
import { AI_RANDOM_STYLES } from '../data/ai';
import { placeBuilding, spawnUnit, removeEnt, armyValue } from './lifecycle';
import { sec } from './world';
import { applyCommand } from './commands';
import { stepIncome, stepResearch, stepConstruction, stepCrews, stepTraining, incomeOf } from './economy';
import { stepCities, stepPartisans, stepResistance } from './cities';
import { acquireTargets, fireWeapons, stepShots, cityGuns, stepFires } from './combat';
import { stepMovement } from './move';
import { stepEffects, stepCrates, stepAutoDig } from './powers';
import { stepHomeFront } from './territory';
import { stepConvoys } from './convoys';
import { stepVictory, stepCoalition } from './victory';
import { stepWeather } from './weather';
import { stepTransports } from './transport';
import { stepExchange } from './exchange';
import { stepInsurgency } from './insurgency';
import { stepContracts } from './contracts';
import { stepAces } from './aces';
import { stepLastStand } from './laststand';

export function createMatch(setup: MatchSetup): MatchState {
  // a 'random' AI style is settled from the seed, so every machine (and a replay) agrees on it
  setup = { ...setup, players: setup.players.map((ps, i) => ps.ai?.personality !== 'random' ? ps : {
    ...ps, ai: { ...ps.ai, personality: AI_RANDOM_STYLES[Math.floor(hash2(i, 7, setup.seed) * AI_RANDOM_STYLES.length)] },
  }) };
  const map = generateMap(setup);
  const s: MatchState = {
    v: 1, setup, map, tick: 0, rng: (setup.seed * 2654435761) >>> 0, nextId: 1,
    players: [], ents: {}, cities: [], shots: [], effects: [], crates: [],
    nextCrate: sec(CRATES.firstAt), weather: { rain: 0, storm: 0, frontUntil: 0 },
    supremacy: {}, launch: null, coalition: -1, navVer: 0, over: null,
    contract: null, nextContract: sec(CONTRACTS.first),
  };
  const mul = setup.startMul ?? 1;
  setup.players.forEach((ps, i) => {
    const p: Player = {
      id: i, name: ps.name, team: ps.team, color: ps.color, kind: ps.kind,
      cash: START.cash * mul, oil: START.oil * mul, science: 0, cp: COMMAND.start, alive: true,
      techs: [], doctrines: [], era: 0, doctrinePending: 0, research: { cur: null, prog: 0, queue: [] },
      powerReady: {}, surrendered: false, alerts: [], capital: -1, capitalAt: 0, market: {},
      held: [], insurgeAt: 0, rising: -1, risingAt: 0, comebacks: 0, lastStand: false, ace: -1, aceNames: [],
      stats: { unitsBuilt: 0, unitsLost: 0, kills: 0, valueDestroyed: 0, cashEarned: 0, citiesCaptured: 0, history: [] },
    };
    s.players.push(p);
  });
  s.cities = map.cities.map((c, id): City => ({
    id, name: c.name, x: c.x, y: c.y, level: c.level, grow: 0, owner: -1, coastal: c.coastal, spec: null,
    specPending: false, capTeam: -1, cap: 0, capBy: -1, calm: 0, resistFor: -1, resistUntil: 0, risen: 0, prod: [], rally: null, cd: [0], tgt: 0, contested: false,
  }));
  setup.players.forEach((_, i) => {
    const st = map.starts[i];
    const hq = BUILDINGS.hq;
    const b = placeBuilding(s, 'hq', i, st.x - hq.w / 2, st.y - hq.h / 2, 1);
    b.rally = null;
    let k = 0;
    for (const [kind, count] of START.units)
      for (let j = 0; j < count; j++, k++) {
        const a = (k / 6) * Math.PI * 2 + Math.PI / 2;
        spawnUnit(s, kind, i, st.x + Math.cos(a) * 3.2, st.y + Math.sin(a) * 3.2);
      }
  });
  return s;
}

/** Advance the match one tick (1/20 s), applying these commands first. Returns what happened. */
export function step(s: MatchState, cmds: Command[]): SimEvent[] {
  const ev: SimEvent[] = [];
  if (s.over) {
    s.tick++;
    return ev;
  }
  for (const c of cmds) applyCommand(s, c, ev);
  stepWeather(s, ev);
  stepIncome(s);
  stepExchange(s);
  stepResearch(s, ev);
  stepConstruction(s, ev);
  stepCrews(s);
  stepTraining(s, ev);
  stepCities(s, ev);
  stepPartisans(s);
  stepResistance(s, ev);
  stepInsurgency(s, ev);
  stepHomeFront(s, ev);
  stepConvoys(s, ev);
  acquireTargets(s);
  stepMovement(s);
  stepTransports(s, ev);
  fireWeapons(s, ev);
  cityGuns(s, ev);
  stepShots(s, ev);
  stepEffects(s, ev);
  stepFires(s, ev);
  stepCrates(s, ev);
  stepContracts(s, ev);
  stepAutoDig(s);
  // remove the dead
  for (const id of Object.keys(s.ents)) {
    const e = s.ents[+id];
    if (e && e.hp <= 0) removeEnt(s, e, ev);
  }
  stepAces(s, ev);
  stepLastStand(s, ev);
  stepVictory(s, ev);
  stepCoalition(s, ev);
  if (s.tick % (30 * TICK_RATE) === 0) {
    for (const p of s.players) {
      const inc = incomeOf(s, p.id);
      const cities = s.cities.filter((c) => c.owner === p.id).length;
      p.stats.history.push([Math.round(armyValue(s, p.id)), Math.round(inc.cash * 60), cities, p.techs.length]);
    }
  }
  s.tick++;
  return ev;
}

/** Hash of the whole state (for determinism tests and desync checks). */
export function stateHash(s: MatchState): number {
  const json = JSON.stringify(s, (k, v) => (k === 'map' ? undefined : v));
  let h = 2166136261;
  for (let i = 0; i < json.length; i++) {
    h ^= json.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

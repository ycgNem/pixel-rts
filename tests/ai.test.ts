// Computer players: they build an economy, capture cities, fight, and finish games — and they do it
// deterministically, so a seed replays the same match.
import { describe, expect, it } from 'vitest';
import { createMatch, step, stateHash } from '../src/sim/match';
import { createAi, type Ai } from '../src/sim/ai';
import type { AiPersonality, Building, Command, MatchSetup, MatchState, Unit } from '../src/sim/types';
import { TICK_RATE } from '../src/sim/types';
import { match, setup } from './helpers';
import { AI_LEVELS, AI_NAVAL, AI_PLANS, AI_RESPONSE, AI_SITES } from '../src/data/ai';
import { compOf, nav } from '../src/sim/nav';
import { VICTORY } from '../src/data/rules';
import { placementProblem } from '../src/sim/commands';
import { hurt, placeBuilding, spawnUnit } from '../src/sim/lifecycle';
import { incomeOf } from '../src/sim/economy';

function aiMatch(seed: number, personalities: (AiPersonality | undefined)[] = [undefined, undefined], type: MatchSetup['mapType'] = 'pangaea') {
  const st = setup({ seed, mapType: type, weather: true, crates: true }, personalities.length);
  st.players.forEach((p, i) => { p.kind = 'ai'; p.ai = { difficulty: 'normal', personality: personalities[i] }; });
  const s = createMatch(st);
  const ais: Ai[] = s.players.map((p) => createAi(s, p.id, 'normal', personalities[p.id]));
  return { s, ais };
}

function play(s: MatchState, ais: Ai[], seconds: number, rejects?: string[]) {
  const end = s.tick + seconds * TICK_RATE;
  while (s.tick < end && !s.over) {
    const cmds: Command[] = [];
    for (const ai of ais) cmds.push(...ai.think(s));
    for (const e of step(s, cmds)) if (e.e === 'reject' && rejects) rejects.push(e.why);
  }
}

const count = (s: MatchState, p: number, kind: string) => Object.values(s.ents).filter((e) => e.owner === p && e.kind === kind).length;

describe('AI', () => {
  it('builds an economy and an army, and captures cities, in the first five minutes', () => {
    const { s, ais } = aiMatch(1);
    const rejects: string[] = [];
    play(s, ais, 300, rejects);
    for (const p of s.players) {
      expect(count(s, p.id, 'mine'), `P${p.id} mines`).toBeGreaterThanOrEqual(2);
      expect(count(s, p.id, 'barracks'), `P${p.id} barracks`).toBeGreaterThanOrEqual(1);
      expect(s.cities.filter((c) => c.owner === p.id).length, `P${p.id} cities`).toBeGreaterThanOrEqual(2);
      // techs are paced so Era II arrives after about six minutes: two by five minutes
      expect(p.techs.length, `P${p.id} techs`).toBeGreaterThanOrEqual(2);
    }
    // the AI checks what it can afford; a few races with income are fine, a flood is a bug
    expect(rejects.length).toBeLessThan(40);
  });

  it('finishes a 1v1 within 35 minutes', () => {
    const { s, ais } = aiMatch(2, ['militarist', 'expansionist']);
    play(s, ais, 35 * 60);
    expect(s.over).not.toBeNull();
  });

  it('is deterministic: the same seed replays the same match', () => {
    const a = aiMatch(3), b = aiMatch(3);
    play(a.s, a.ais, 120);
    play(b.s, b.ais, 120);
    expect(stateHash(a.s)).toBe(stateHash(b.s));
  });

  it('researches along its personality’s path', () => {
    const styles: (AiPersonality | undefined)[] = [undefined, 'militarist', 'expansionist', 'scientist'];
    const { s, ais } = aiMatch(3, styles);
    play(s, ais, 420);
    const firsts = new Set<string>();
    for (const p of s.players) {
      const path = AI_PLANS[styles[p.id] ?? 'balanced'].research;
      expect(p.techs.length, `P${p.id} techs`).toBeGreaterThanOrEqual(2);
      // the techs come in the order the personality lists them (none were blocked this early)
      expect(p.techs, `P${p.id} (${styles[p.id] ?? 'balanced'})`).toEqual(path.slice(0, p.techs.length));
      firsts.add(p.techs.slice(0, 2).join());
    }
    // and the personalities really do open differently
    expect(firsts.size).toBeGreaterThanOrEqual(3);
  });

  it('drops everything to stop an enemy launch', () => {
    const st = setup({ seed: 2, weather: false, crates: false }, 2);
    st.players[0].kind = 'ai';
    st.players[0].ai = { difficulty: 'normal' };
    const s = createMatch(st);
    const ai = createAi(s, 0, 'normal');
    // the AI has an army at home; the enemy has just finished a launch site
    const home = s.map.starts[0], foe = s.map.starts[1];
    for (let i = 0; i < 10; i++) spawnUnit(s, i < 6 ? 'lighttank' : 'heavytank', 0, home.x + (i % 5) - 2, home.y + 4 + Math.floor(i / 5));
    s.players[0].techs.push('heavyArmor');
    let site: Building | undefined;
    for (let r = 4; !site && r < 30; r++)
      for (let dy = -r; dy <= r && !site; dy++)
        for (let dx = -r; dx <= r && !site; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const tx = Math.floor(foe.x) + dx, ty = Math.floor(foe.y) + dy;
          if (!placementProblem(s, 1, 'launch', tx, ty)) site = placeBuilding(s, 'launch', 1, tx, ty, 1);
        }
    expect(site).toBeTruthy();
    s.launch = { id: site!.id, done: s.tick + VICTORY.launchTime * TICK_RATE, scrub: 0 };
    play(s, [ai], VICTORY.launchTime - 5);
    expect(s.ents[site!.id], 'the launch site still stands').toBeUndefined();
    expect(s.over?.reason).not.toBe('science');
  });

  it('answers an ally’s Call for Help flare, which needs an ally to fire', () => {
    const go = (flare: boolean) => {
      const st = setup({ seed: 3, mapSize: 'medium' }, 3);
      st.players[1].team = 0;
      st.players[1].kind = 'ai';
      st.players[1].ai = { difficulty: 'normal' };
      const s = createMatch(st);
      const ai = createAi(s, 1, 'normal');
      const home = s.map.starts[1], spot = s.map.starts[0];
      const ids = Array.from({ length: 8 }, (_, i) => spawnUnit(s, 'rifleman', 1, home.x + (i % 4) - 2, home.y + 4 + Math.floor(i / 4)).id);
      s.players[0].cp = 10;
      if (flare) {
        const ev = step(s, [{ t: 'power', p: 0, power: 'help', x: spot.x, y: spot.y + 4 }]);
        expect(ev.some((e) => e.e === 'reject')).toBe(false);
      }
      play(s, [ai], 25);
      // the riflemen marching on the flare (it is across the map, so none are there yet)
      return ids.filter((id) => {
        const o = (s.ents[id] as Unit | undefined)?.order;
        return o?.o === 'move' && Math.hypot(o.x - spot.x, o.y - spot.y - 4) < 3;
      }).length;
    };
    expect(go(false)).toBe(0);
    expect(go(true)).toBeGreaterThanOrEqual(4);
    // with nobody on your team, there is no one to call
    const s = match({}, 2);
    s.players[0].cp = 10;
    expect(step(s, [{ t: 'power', p: 0, power: 'help', x: 10, y: 10 }]).some((e) => e.e === 'reject')).toBe(true);
  });

  it('in a free-for-all, turns on a runaway leader even when another rival is nearer', () => {
    const pick = (lead: boolean) => {
      const st = setup({ seed: 5, mapSize: 'medium' }, 4);
      st.players[0].kind = 'ai';
      st.players[0].ai = { difficulty: 'normal' };
      const s = createMatch(st);
      const ai = createAi(s, 0, 'normal');
      const home = s.map.starts[0];
      const byDist = [...s.cities].sort((a, b) => Math.hypot(a.x - home.x, a.y - home.y) - Math.hypot(b.x - home.x, b.y - home.y));
      // P1 holds the nearest city; P2 the next one, and (when it leads) most of the map
      byDist[0].owner = 1;
      byDist[1].owner = 2;
      if (lead) for (const c of byDist.slice(2)) c.owner = 2;
      ai.think(s);
      const t = (ai as unknown as { chooseTarget(s: MatchState, from: [number, number]): { id: number; city: boolean } }).chooseTarget(s, [home.x, home.y]);
      return t.city ? s.cities[t.id].owner : -1;
    };
    expect(pick(false)).toBe(1);
    expect(pick(true)).toBe(2);
  });

  it('leaves an enemy base alone until its HQ time comes (or a siege: a last stand from siegeFrom), then goes for it', () => {
    const st = setup({ seed: 2, fog: 'off', weather: false, crates: false }, 2);
    st.players[0].kind = 'ai';
    st.players[0].ai = { difficulty: 'normal' };
    const s = createMatch(st);
    const ai = createAi(s, 0, 'normal');
    const foe = s.map.starts[1];
    // the enemy has its base and one city far from it; every other city is P0's
    const far = [...s.cities].sort((a, b) => Math.hypot(b.x - foe.x, b.y - foe.y) - Math.hypot(a.x - foe.x, a.y - foe.y))[0];
    for (const c of s.cities) c.owner = c === far ? 1 : 0;
    // (asked from just outside the enemy base, so the base would be the obvious pick)
    const pick = () => {
      ai.think(s);
      return (ai as unknown as { chooseTarget(s: MatchState, from: [number, number]): { x: number; y: number; id: number; city: boolean } | null }).chooseTarget(s, [foe.x + AI_RESPONSE.baseRadius, foe.y]);
    };
    s.tick = (AI_LEVELS.normal.hqFrom - 60) * TICK_RATE;
    const early = pick();
    expect(!early || Math.hypot(early.x - foe.x, early.y - foe.y) >= AI_RESPONSE.baseRadius, 'nothing in the base before hqFrom').toBe(true);
    // no city left but never in a last stand (a player who never took one): still spared
    far.owner = 0;
    const none = pick();
    expect(!none || Math.hypot(none.x - foe.x, none.y - foe.y) >= AI_RESPONSE.baseRadius, 'no siege without a last stand').toBe(true);
    // a siege: a last stand (cities held and lost) from siegeFrom on, the base is fair game
    s.players[1].lastStand = true;
    const siege = pick();
    expect(siege && Math.hypot(siege.x - foe.x, siege.y - foe.y)).toBeLessThan(AI_RESPONSE.baseRadius);
    // ...but not before siegeFrom (a learner who lost their first cities gets time to fight back)
    s.tick = (AI_LEVELS.normal.siegeFrom - 60) * TICK_RATE;
    const soon = pick();
    expect(!soon || Math.hypot(soon.x - foe.x, soon.y - foe.y) >= AI_RESPONSE.baseRadius, 'no siege before siegeFrom').toBe(true);
    s.players[1].lastStand = false;
    far.owner = 1;
    s.tick = (AI_LEVELS.normal.hqFrom + 1) * TICK_RATE;
    const late = pick();
    expect(late && Math.hypot(late.x - foe.x, late.y - foe.y)).toBeLessThan(AI_RESPONSE.baseRadius);
  });

  it('in an early free-for-all, leaves a struggling rival alone', () => {
    const st = setup({ seed: 5, mapSize: 'medium' }, 4);
    st.players[0].kind = 'ai';
    st.players[0].ai = { difficulty: 'normal' };
    const s = createMatch(st);
    const ai = createAi(s, 0, 'normal');
    const home = s.map.starts[0];
    const byDist = [...s.cities].sort((a, b) => Math.hypot(a.x - home.x, a.y - home.y) - Math.hypot(b.x - home.x, b.y - home.y));
    // P1 holds just the nearest city; P0, P2 and P3 share the rest evenly (so nobody runs away)
    byDist[0].owner = 1;
    byDist.slice(1).forEach((c, i) => (c.owner = [0, 2, 3][i % 3]));
    ai.think(s);
    const t = (ai as unknown as { chooseTarget(s: MatchState, from: [number, number]): { id: number; city: boolean } }).chooseTarget(s, [home.x, home.y]);
    expect(t.city && s.cities[t.id].owner).not.toBe(1);
  });

  it('does not rebuild on a deposit where it just lost a building', () => {
    const { s, ais } = aiMatch(1);
    // by minute 3 it has a barracks and wants its derrick back at once (without the memory it
    // starts a new one there within seconds)
    play(s, ais, 180);
    let d: Building | undefined;
    for (let i = 0; i < 60 && !d; i++) {
      play(s, ais, 10);
      d = Object.values(s.ents).find((e): e is Building => e.t === 'b' && e.owner === 0 && e.kind === 'derrick' && e.built >= 1);
    }
    expect(d, 'a derrick by 10 minutes').toBeTruthy();
    const at = { x: d!.x, y: d!.y };
    // shelled from out of sight
    const gun = spawnUnit(s, 'artillery', 1, at.x, at.y + 10);
    hurt(s, d!, 1e6, 'shell', gun, []);
    delete s.ents[gun.id];
    play(s, ais, 1);
    expect(s.ents[d!.id], 'the derrick is gone').toBeUndefined();
    // watch the whole wait: not even a foundation goes down there
    let again = false;
    for (let t = 0; t < AI_SITES.lostWait - 30 && !again; t++) {
      play(s, ais, 1);
      again = Object.values(s.ents).some((e) => e.t === 'b' && e.owner === 0 && (e.kind === 'derrick' || e.kind === 'mine') && Math.hypot(e.x - at.x, e.y - at.y) < 2);
    }
    expect(again).toBe(false);
  });

  it('lands overseas troops on one beach and holds it until the landing is strong enough', () => {
    const { s, ais } = aiMatch(2, [undefined, undefined], 'islands');
    const n = nav(s);
    type W = { ids: number[]; go: boolean; beach: [number, number] | null; landed: number; regroup?: boolean; target: { x: number; y: number } };
    const brain = ais[0] as unknown as { wave: W | null };
    let held = 0, worst = 0;
    while (s.tick < 25 * 60 * TICK_RATE && !s.over && held < 60) {
      play(s, ais, 1);
      const w = brain.wave;
      // (after a fall back the survivors are still walking to the beach)
      if (!w || w.go || !w.beach || w.landed < 0 || w.regroup) continue;
      held++;
      // everyone ashore on the far island stays near the beach (fighting may pull them a little away)
      const land = compOf(n, 'ground', Math.floor(w.beach[0]), Math.floor(w.beach[1]));
      for (const id of w.ids) {
        const u = s.ents[id] as Unit | undefined;
        if (!u || u.inside || compOf(n, 'ground', Math.floor(u.x), Math.floor(u.y)) !== land) continue;
        worst = Math.max(worst, Math.hypot(u.x - w.beach[0], u.y - w.beach[1]));
      }
    }
    expect(held, 'a landing held its beach').toBeGreaterThan(0);
    expect(worst).toBeLessThan(AI_NAVAL.beachRadius + 8);
  });

  it('crosses water: on an island map it researches ships and builds a dock', () => {
    const { s, ais } = aiMatch(4, [undefined, undefined], 'islands');
    play(s, ais, 12 * 60);
    const ships = s.players.some((p) => p.techs.includes('shipbuilding'));
    expect(ships).toBe(true);
    expect(s.players.some((p) => count(s, p.id, 'dock') > 0) || !!s.over).toBe(true);
  });
});

describe('ai difficulty and style', () => {
  it('a Random style is settled from the seed: the same every time, and a mix across seeds', () => {
    const styles = new Set<string>();
    for (let seed = 1; seed <= 12; seed++) {
      const st = setup({ seed }, 3);
      st.players.forEach((p, i) => { if (i) { p.kind = 'ai'; p.ai = { difficulty: 'normal', personality: 'random' }; } });
      const a = createMatch(st), b = createMatch(st);
      for (const i of [1, 2]) {
        const got = a.setup.players[i].ai!.personality;
        expect(got).not.toBe('random');
        expect(b.setup.players[i].ai!.personality).toBe(got);
        styles.add(got ?? 'balanced');
      }
      // the setup that was passed in is left alone
      expect(st.players[1].ai!.personality).toBe('random');
    }
    expect(styles.size).toBeGreaterThanOrEqual(3);
  });

  it('a Hard AI earns more than a Normal one from the same holdings', () => {
    const s = match({}, 2);
    s.players.forEach((p, i) => { p.kind = 'ai'; s.setup.players[i].kind = 'ai'; s.setup.players[i].ai = { difficulty: i ? 'hard' : 'normal' }; });
    s.cities[0].owner = 0;
    s.cities[1].owner = 1;
    s.cities[1].level = s.cities[0].level;
    const [n, h] = [incomeOf(s, 0), incomeOf(s, 1)];
    expect(h.cash).toBeCloseTo(n.cash * AI_LEVELS.hard.income, 5);
    expect(AI_LEVELS.hard.income).toBeGreaterThan(1);
  });
});

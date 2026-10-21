// Creating and removing entities, and dealing damage.
import { UNITS } from '../data/units';
import { BUILDINGS } from '../data/buildings';
import { DAMAGE, VETERANCY, type ArmorClass } from '../data/damage';
import { ALERTS, COALITION, COMBAT, CONVOY } from '../data/rules';
import { RALLY } from '../data/powers';
import type { Building, Ent, MatchState, SimEvent, Unit } from './types';
import { buildingMaxHp, sec, unitCost, unitMaxHp } from './world';
import { hasPerk, modMul } from './mods';
import { PERKS } from '../data/techs';
import { nav, nearestReachable, compOf, passable } from './nav';
import { gridAdd } from './spatial';
import { aceAura, aceDown, isAce } from './aces';
import { onHomeGround } from './territory';

/** `free`: it cost nothing (partisans, paradrops, rallies), so it can't be sold. */
export function spawnUnit(s: MatchState, kind: string, owner: number, x: number, y: number, free = false): Unit {
  const d = UNITS[kind];
  const u: Unit = {
    id: s.nextId++, kind, owner, hp: 1, x, y, t: 'u', dir: Math.PI / 2, order: null, queue: [], tgt: 0,
    cd: d.weapons.map(() => 0), hold: false, dug: false, xp: 0, vet: 0, abReady: 0, abUntil: 0, cargo: [],
    inside: 0, fired: -100000, hide: 0, gx: x, gy: y, mv: false, _stuck: 0, _best: 1e9, _grp: -1,
  };
  u.hp = unitMaxHp(s, u);
  if (free) u.free = true;
  s.ents[u.id] = u;
  gridAdd(s, u);
  return u;
}

export function placeBuilding(s: MatchState, kind: string, owner: number, tx: number, ty: number, built = 0, dep = -1): Building {
  const d = BUILDINGS[kind];
  const b: Building = {
    id: s.nextId++, kind, owner, hp: 1, x: tx + d.w / 2, y: ty + d.h / 2, t: 'b', tx, ty, built, prod: [],
    rally: null, dep, cd: (d.weapons ?? []).map(() => 0), tgt: 0, blocked: false,
  };
  const max = buildingMaxHp(s, b);
  b.hp = built >= 1 ? max : Math.max(1, Math.round(max * 0.1));
  s.ents[b.id] = b;
  s.navVer++;
  gridAdd(s, b);
  evictUnits(s, b);
  return b;
}

/** Push ground units standing on a new footprint to the nearest free tile. */
function evictUnits(s: MatchState, b: Building) {
  const d = BUILDINGS[b.kind];
  const n = nav(s);
  for (const id in s.ents) {
    const u = s.ents[id];
    if (u.t !== 'u' || u.inside || UNITS[u.kind].layer !== 'ground') continue;
    if (u.x < b.tx - 0.3 || u.x > b.tx + d.w + 0.3 || u.y < b.ty - 0.3 || u.y > b.ty + d.h + 0.3) continue;
    unstick(s, u, n);
  }
}

/** Move a unit off a blocked tile to the closest passable one (after a building lands on it). */
export function unstick(s: MatchState, u: Unit, n = nav(s)) {
  const layer = UNITS[u.kind].layer;
  const tx = Math.floor(u.x), ty = Math.floor(u.y);
  if (passable(n, layer, tx, ty)) return;
  for (let r = 1; r < 12; r++) {
    let best: [number, number] | null = null, bd = Infinity;
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r || !passable(n, layer, tx + dx, ty + dy)) continue;
        const dd = (tx + dx + 0.5 - u.x) ** 2 + (ty + dy + 0.5 - u.y) ** 2;
        if (dd < bd) { bd = dd; best = [tx + dx, ty + dy]; }
      }
    if (best) {
      u.x = best[0] + 0.5;
      u.y = best[1] + 0.5;
      return;
    }
  }
}

/** A free tile next to a building's footprint for a new unit, closest to (px, py). */
export function exitTile(s: MatchState, b: Building, layer: 'ground' | 'naval' | 'air', px: number, py: number): [number, number] | null {
  const d = BUILDINGS[b.kind];
  if (layer === 'air') return [b.x, b.y];
  const n = nav(s);
  let best: [number, number] | null = null, bd = Infinity;
  for (let r = 1; r <= 3 && !best; r++)
    for (let y = b.ty - r; y < b.ty + d.h + r; y++)
      for (let x = b.tx - r; x < b.tx + d.w + r; x++) {
        if (x > b.tx - r && x < b.tx + d.w + r - 1 && y > b.ty - r && y < b.ty + d.h + r - 1) continue;
        if (!passable(n, layer, x, y)) continue;
        const dd = (x + 0.5 - px) ** 2 + (y + 0.5 - py) ** 2;
        if (dd < bd) { bd = dd; best = [x + 0.5, y + 0.5]; }
      }
  if (!best && layer === 'ground') {
    const near = nearestReachable(n, layer, Math.floor(b.x), b.ty + d.h, compOf(n, layer, b.tx, b.ty + d.h), 10);
    if (near) best = [near[0] + 0.5, near[1] + 0.5];
  }
  return best;
}

export function armorOf(e: Ent): ArmorClass {
  return e.t === 'u' ? UNITS[e.kind].armor : 'structure';
}

/**
 * Deal damage of a weapon class to an entity. Applies the damage table, dig-in, smoke,
 * veterancy and doctrine bonuses; credits the attacker with veterancy XP.
 */
export function hurt(s: MatchState, target: Ent, raw: number, cls: keyof typeof DAMAGE, attacker: Ent | undefined, ev: SimEvent[], ranged = true) {
  if (target.hp <= 0) return;
  let dmg = raw * DAMAGE[cls][armorOf(target)];
  if (dmg <= 0) return;
  if (attacker && attacker.t === 'u') {
    dmg *= 1 + attacker.vet * VETERANCY.damagePerStar;
    const ad = UNITS[attacker.kind];
    const ap = s.players[attacker.owner];
    if (ad.cls === 'infantry') dmg *= modMul(ap, 'infantryDamage');
    if (ad.cls === 'vehicle') dmg *= modMul(ap, 'vehicleDamage');
    if (ad.id === 'fighter') dmg *= modMul(ap, 'fighterDamage');
    for (const fx of s.effects) if (fx.k === 'rally' && fx.owner === attacker.owner && Math.hypot(fx.x - attacker.x, fx.y - attacker.y) <= fx.r) { dmg *= RALLY.damage; break; }
    // an ace nearby lifts everyone around it
    dmg *= aceAura(s, attacker);
  }
  // the coalition hits whoever is about to win harder
  if (s.coalition >= 0 && attacker && attacker.owner >= 0 && target.owner >= 0
    && s.players[target.owner].team === s.coalition && s.players[attacker.owner].team !== s.coalition) dmg *= COALITION.damageVs;
  if (target.t === 'u') {
    if (target.dug) dmg *= 1 - COMBAT.digIn;
    if (ranged) for (const fx of s.effects) if (fx.k === 'smoke' && Math.hypot(fx.x - target.x, fx.y - target.y) <= fx.r) { dmg *= 1 - COMBAT.smoke; break; }
  }
  const before = target.hp;
  target.hp -= dmg;
  const done = Math.min(before, dmg);
  if (target.owner >= 0) alertHit(s, target, attacker, ev);
  if (attacker && attacker.t === 'u' && attacker.owner >= 0 && target.owner >= 0) {
    const max = target.t === 'u' ? unitMaxHp(s, target) : buildingMaxHp(s, target);
    const tCost = target.t === 'u' ? UNITS[target.kind].cost.cash + UNITS[target.kind].cost.oil * 2 : BUILDINGS[target.kind].cost.cash;
    const aCost = Math.max(1, UNITS[attacker.kind].cost.cash + UNITS[attacker.kind].cost.oil * 2);
    const flak = target.t === 'u' && UNITS[target.kind].layer === 'air' && UNITS[attacker.kind].layer !== 'air';
    attacker.xp += (done / max) * (tCost / aCost) * (flak ? VETERANCY.vsAir : 1);
    const stars = VETERANCY.thresholds.filter((t) => attacker.xp >= t).length;
    if (stars > attacker.vet) {
      const oldMax = unitMaxHp(s, attacker);
      attacker.vet = stars;
      attacker.hp += unitMaxHp(s, attacker) - oldMax;
      ev.push({ e: 'vet', id: attacker.id, owner: attacker.owner, stars });
    }
    s.players[attacker.owner].stats.valueDestroyed += (done / max) * tCost;
    if (target.hp <= 0 && target.t === 'u') s.players[attacker.owner].stats.kills++;
    // Total War: a kill patches the killer up
    if (target.hp <= 0 && before > 0 && hasPerk(s.players[attacker.owner], 'warSpoils')) {
      const m = unitMaxHp(s, attacker);
      attacker.hp = Math.min(m, attacker.hp + m * PERKS.warSpoils);
    }
  }
  // a wanted ace's killer collects the bounty
  if (target.t === 'u' && target.hp <= 0 && before > 0 && isAce(s, target)) aceDown(s, target, attacker ? attacker.owner : -1, ev);
  // a sunk merchant's cargo goes to whoever sank it (a ship, a plane or a coastal gun)
  if (target.t === 'u' && target.kind === CONVOY.kind && target.hp <= 0 && before > 0 && attacker && attacker.owner >= 0 && attacker.owner !== target.owner) {
    const cash = Math.round(CONVOY.cash * CONVOY.loot), oil = Math.round(CONVOY.oil * CONVOY.loot);
    const p = s.players[attacker.owner];
    p.cash += cash;
    p.oil += oil;
    p.stats.cashEarned += cash;
    ev.push({ e: 'convoy', p: target.owner, by: attacker.owner, x: target.x, y: target.y, cash, oil });
  }
}

/**
 * An 'attacked' alert for the target's owner: a hit on a building, or on a unit on its own team's
 * ground by another player's unit; one per area at a time (ALERTS).
 */
function alertHit(s: MatchState, target: Ent, attacker: Ent | undefined, ev: SimEvent[]) {
  const p = s.players[target.owner];
  const fresh = (a: [number, number, number]) => s.tick - a[2] < sec(ALERTS.every);
  if (p.alerts.some((a) => fresh(a) && Math.hypot(a[0] - target.x, a[1] - target.y) < ALERTS.area)) return;
  if (target.t === 'u' && (!attacker || attacker.owner < 0 || attacker.owner === target.owner || !onHomeGround(s, p.team, target.x, target.y))) return;
  p.alerts = p.alerts.filter(fresh);
  p.alerts.push([target.x, target.y, s.tick]);
  ev.push({ e: 'attacked', p: target.owner, x: target.x, y: target.y });
}

/** Remove a dead entity (and anything it carried). */
/** `lost` = false for a unit its owner sold: it doesn't count as lost in the stats */
export function removeEnt(s: MatchState, e: Ent, ev: SimEvent[], lost = true) {
  delete s.ents[e.id];
  ev.push({ e: 'die', id: e.id, kind: e.kind, owner: e.owner, x: e.x, y: e.y, b: e.t === 'b', dir: e.t === 'u' ? e.dir : 0 });
  if (e.owner >= 0) {
    const st = s.players[e.owner].stats;
    if (e.t === 'u' && lost) st.unitsLost++;
    // an ace lost without a killing blow (sunk in its transport, disbanded): no bounty
    if (e.t === 'u' && isAce(s, e)) aceDown(s, e, -1, ev);
  }
  if (e.t === 'b') {
    s.navVer++;
    if (e.kind === 'derrick' && e.built >= 1) {
      s.effects.push({ k: 'fire', team: -1, owner: -1, x: e.x, y: e.y, r: 1.4, until: s.tick + sec(COMBAT.burnTime) });
    }
    if (s.launch && s.launch.id === e.id) s.launch = null;
  } else {
    for (const c of e.cargo) {
      const cu = s.ents[c];
      if (cu) removeEnt(s, cu, ev);
    }
  }
}

/** Value of an army (for stats): cost of living units. */
export function armyValue(s: MatchState, p: number): number {
  let v = 0;
  for (const id in s.ents) {
    const e = s.ents[id];
    if (e.t === 'u' && e.owner === p && !UNITS[e.kind].builds) {
      const c = unitCost(s, p, e.kind);
      v += c.cash + c.oil * 2;
    }
  }
  return v;
}

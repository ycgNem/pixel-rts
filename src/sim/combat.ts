// Combat: picking targets, firing weapons, projectiles in flight, splash.
import { UNITS, type WeaponDef } from '../data/units';
import { BUILDINGS } from '../data/buildings';
import { DAMAGE, type Layer } from '../data/damage';
import { COMBAT } from '../data/rules';
import { FORTRESS_GUN, MILITIA } from '../data/cities';
import type { City, Ent, MatchState, SimEvent, Unit } from './types';
import { TICK_RATE } from './types';
import { distTo, enemies, sec, layerOf, allied, teamOf } from './world';
import { near, nearEnemies } from './spatial';
import { hurt, armorOf } from './lifecycle';
import { detected, stealthy } from './vision';
import { hasPerk, modMul } from './mods';
import { stormy } from './weather';
import { rand } from './rng';

const SCAN = Math.max(1, Math.round(COMBAT.scan * TICK_RATE));

export function weaponsOf(e: Ent): WeaponDef[] {
  return e.t === 'u' ? UNITS[e.kind].weapons : BUILDINGS[e.kind].weapons ?? [];
}

/** Effective range of a weapon for this owner (techs and doctrines). */
export function weaponRange(s: MatchState, owner: number, kind: string, w: WeaponDef): number {
  const p = s.players[owner];
  let r = w.range;
  if (kind === 'artillery') r *= modMul(p, 'artilleryRange');
  if (kind === 'battleship') r *= modMul(p, 'navalRange');
  return r;
}

export function canHit(w: WeaponDef, t: Ent): boolean {
  return w.hits.includes(layerOf(t) as Layer) && DAMAGE[w.cls][armorOf(t)] > 0;
}

/** Can this attacker see/target this entity (stealth)? */
function targetable(s: MatchState, owner: number, t: Ent): boolean {
  if (t.t === 'u') {
    if (t.inside) return false;
    if (stealthy(s, t) && !detected(s, s.players[owner].team, t)) return false;
  }
  return t.hp > 0;
}

export function inRange(s: MatchState, a: Ent, w: WeaponDef, t: Ent): boolean {
  const d = distTo(t, a.x, a.y) - (a.t === 'b' ? Math.max(BUILDINGS[a.kind].w, BUILDINGS[a.kind].h) / 2 : 0);
  if (w.minRange && d < w.minRange) return false;
  return d <= weaponRange(s, a.owner, a.kind, w) + (t.t === 'u' ? UNITS[t.kind].radius : 0);
}

/** Is any weapon of `a` able to hit `t` from where it stands? */
export function canFireAt(s: MatchState, a: Ent, t: Ent): boolean {
  return weaponsOf(a).some((w) => canHit(w, t) && inRange(s, a, w, t));
}

/** Does this unit want to pick its own targets right now (not on a plain move or a build job)? */
function autoTargets(u: Unit): 'sight' | 'range' | 'none' {
  if (u.inside) return 'none';
  const o = u.order;
  if (!o) return u.hold || u.dug ? 'range' : 'sight';
  if (o.o === 'move') return o.am ? 'sight' : 'range';
  if (o.o === 'patrol') return 'sight';
  if (o.o === 'attack') return 'none';
  return 'range';
}

function score(s: MatchState, a: Ent, t: Ent): number {
  let sc = -distTo(t, a.x, a.y);
  if (t.t === 'u') {
    sc += 20;
    // prefer things that can shoot back at us
    if (UNITS[t.kind].weapons.some((w) => canHit(w, a))) sc += 10;
    if (UNITS[t.kind].builds) sc -= 4;
  } else {
    sc += BUILDINGS[t.kind].weapons ? 12 : 0;
    if (t.built < 1) sc -= 2;
  }
  return sc;
}

/** Find the best enemy for `a` within `r` that some weapon can hit. */
function findTarget(s: MatchState, a: Ent, r: number, onlyInRange: boolean): number {
  const ws = weaponsOf(a);
  let best = 0, bs = -Infinity;
  nearEnemies(s, a.owner, a.x, a.y, r, (t) => {
    if (!enemies(s, a.owner, t.owner)) return;
    if (distTo(t, a.x, a.y) > r) return;
    if (!ws.some((w) => canHit(w, t))) return;
    if (!targetable(s, a.owner, t)) return;
    if (onlyInRange && !canFireAt(s, a, t)) return;
    const sc = score(s, a, t);
    if (sc > bs) { bs = sc; best = t.id; }
  });
  return best;
}

/** Pick targets for every armed unit and building. */
export function acquireTargets(s: MatchState) {
  for (const id in s.ents) {
    const e = s.ents[id];
    const ws = weaponsOf(e);
    if (!ws.length) continue;
    if (e.t === 'b' && e.built < 1) continue;
    // drop dead or invalid targets
    if (e.tgt) {
      const t = s.ents[e.tgt];
      if (!t || t.hp <= 0 || !targetable(s, e.owner, t) || allied(s, e.owner, t.owner)) e.tgt = 0;
    }
    if (e.t === 'u') {
      if (e.order?.o === 'attack') {
        e.tgt = e.order.t;
        continue;
      }
      const mode = autoTargets(e);
      if (mode === 'none') { e.tgt = 0; continue; }
      if (e.tgt) {
        const t = s.ents[e.tgt]!;
        // keep chasing within the leash; drop targets that slipped out of range when holding
        const range = mode === 'range' ? !canFireAt(s, e, t) : Math.hypot(e.gx - t.x, e.gy - t.y) > COMBAT.leash + UNITS[e.kind].sight;
        if (range) e.tgt = 0;
      }
      if (!e.tgt && (s.tick + e.id) % SCAN === 0) {
        const r = mode === 'range' ? Math.max(...ws.map((w) => weaponRange(s, e.owner, e.kind, w))) + 0.5 : UNITS[e.kind].sight;
        e.tgt = findTarget(s, e, r, mode === 'range');
      }
    } else {
      if (e.tgt && !canFireAt(s, e, s.ents[e.tgt]!)) e.tgt = 0;
      if (!e.tgt && (s.tick + e.id) % SCAN === 0) {
        const r = Math.max(...ws.map((w) => weaponRange(s, e.owner, e.kind, w))) + Math.max(BUILDINGS[e.kind].w, BUILDINGS[e.kind].h) / 2;
        e.tgt = findTarget(s, e, r, true);
      }
    }
  }
}

/** Fire every weapon that is ready and has something in range. */
export function fireWeapons(s: MatchState, ev: SimEvent[]) {
  const storm = stormy(s);
  for (const id in s.ents) {
    const e = s.ents[id];
    const ws = weaponsOf(e);
    if (!ws.length) continue;
    if (e.t === 'b' && e.built < 1) continue;
    if (e.t === 'u' && (e.inside || (storm && UNITS[e.kind].layer === 'air' && !hasPerk(s.players[e.owner], 'stormFlight')))) continue;
    const main = e.tgt ? s.ents[e.tgt] : undefined;
    for (let i = 0; i < ws.length; i++) {
      if (e.cd[i] > 0) { e.cd[i]--; continue; }
      const w = ws[i];
      let t = main && canHit(w, main) && inRange(s, e, w, main) ? main : undefined;
      // secondary weapons (and the main one while moving) pick their own target in range
      if (!t && (s.tick + e.id) % SCAN === 0) {
        const r = weaponRange(s, e.owner, e.kind, w) + 1;
        let best: Ent | undefined, bd = Infinity;
        nearEnemies(s, e.owner, e.x, e.y, r, (c) => {
          if (!enemies(s, e.owner, c.owner) || !canHit(w, c) || !targetable(s, e.owner, c) || !inRange(s, e, w, c)) return;
          const d = distTo(c, e.x, e.y);
          if (d < bd) { bd = d; best = c; }
        });
        t = best;
      }
      if (!t) continue;
      fire(s, e, w, i, t, ev);
    }
  }
}

function fire(s: MatchState, a: Ent, w: WeaponDef, i: number, t: Ent, ev: SimEvent[]) {
  a.cd[i] = Math.max(1, Math.round(w.cd * TICK_RATE));
  if (a.t === 'u') {
    a.fired = s.tick;
    a.hide = 0;
    a.dir = Math.atan2(t.y - a.y, t.x - a.x);
    if (UNITS[a.kind].ability === 'barrage' && s.tick < a.abUntil) a.cd[i] = Math.round(TICK_RATE * 0.6);
  }
  // aim at the nearest point of a building
  let tx = t.x, ty = t.y;
  if (t.t === 'b') {
    const d = BUILDINGS[t.kind];
    tx = Math.max(t.tx + 0.3, Math.min(t.tx + d.w - 0.3, a.x));
    ty = Math.max(t.ty + 0.3, Math.min(t.ty + d.h - 0.3, a.y));
  }
  ev.push({ e: 'shot', src: a.id, owner: a.owner, x0: a.x, y0: a.y, x1: tx, y1: ty, w: w.cls, kind: a.kind });
  if (!w.speed) {
    hurt(s, t, w.dmg, w.cls, a, ev, true);
    return;
  }
  const dist = Math.hypot(tx - a.x, ty - a.y);
  // artillery-type shots scatter a little around the aim point
  let ax = tx, ay = ty;
  if (w.splash) {
    const spread = Math.min(1, dist * 0.06);
    ax += (rand(s) - 0.5) * spread;
    ay += (rand(s) - 0.5) * spread;
  }
  s.shots.push({
    owner: a.owner, src: a.id, kind: a.kind, w: i, x0: a.x, y0: a.y, x: ax, y: ay,
    t: w.splash ? 0 : t.id, t0: s.tick, land: s.tick + Math.max(1, Math.round((dist / w.speed) * TICK_RATE)),
    dmg: w.dmg, splash: w.splash ?? 0, cls: w.cls, hits: w.hits,
  });
}

/** Land projectiles whose time has come. */
export function stepShots(s: MatchState, ev: SimEvent[]) {
  if (!s.shots.length) return;
  const keep = [];
  for (const sh of s.shots) {
    if (sh.t) {
      const t = s.ents[sh.t];
      if (t) { sh.x = t.x; sh.y = t.y; }
    }
    if (s.tick < sh.land) { keep.push(sh); continue; }
    const attacker = s.ents[sh.src];
    land(s, sh.x, sh.y, sh.dmg, sh.splash, sh.cls as keyof typeof DAMAGE, sh.hits as Layer[], sh.owner, attacker, sh.t, ev);
  }
  s.shots = keep;
}

/** Apply a landing shell/rocket/bomb at a point. Direct hits need the target still near the point. */
export function land(s: MatchState, x: number, y: number, dmg: number, splash: number, cls: keyof typeof DAMAGE, hits: Layer[], owner: number, attacker: Ent | undefined, target: number, ev: SimEvent[]) {
  ev.push({ e: 'hit', x, y, cls, big: splash > 1 });
  if (!splash) {
    const t = s.ents[target];
    if (t && distTo(t, x, y) < 0.8) hurt(s, t, dmg, cls, attacker, ev, true);
    return;
  }
  near(s, x, y, splash, (t) => {
    if (owner >= 0 && allied(s, owner, t.owner)) return;
    if (!hits.includes(layerOf(t) as Layer)) return;
    const d = distTo(t, x, y);
    if (d > splash) return;
    hurt(s, t, dmg * (1 - 0.75 * (d / splash)), cls, attacker, ev, true);
  });
}

/** Fortress cities shoot at nearby enemies. */
/** City militia, and the fortress city's heavier guns. */
/** The gun a city fights with now (null in unrest): a fortress city's or exiled capital's, else its militia. */
export function cityGun(s: MatchState, c: City): Pick<WeaponDef, 'cls' | 'dmg' | 'range' | 'cd' | 'hits'> | null {
  // a city in unrest won't fight for its new owner
  if (c.owner >= 0 && s.tick < c.calm) return null;
  const fortress = c.owner >= 0 && (c.spec === 'fortress' || s.players[c.owner].capital === c.id);
  return fortress ? FORTRESS_GUN : { ...MILITIA, dmg: MILITIA.dmg + MILITIA.dmgPerLevel * c.level };
}

export function cityGuns(s: MatchState, ev: SimEvent[]) {
  for (const c of s.cities) {
    if (c.cd[0] > 0) { c.cd[0]--; continue; }
    // a neutral city fights only its capturers
    if (c.owner < 0 && c.capTeam < 0) continue;
    const gun = cityGun(s, c);
    if (!gun) continue;
    let best: Ent | undefined, bd = Infinity;
    near(s, c.x + 0.5, c.y + 0.5, gun.range + 1, (t) => {
      if (!canHit(gun, t)) return;
      if (c.owner >= 0 ? !enemies(s, c.owner, t.owner) || !targetable(s, c.owner, t) : t.t !== 'u' || t.inside || t.owner < 0 || stealthy(s, t) || teamOf(s, t.owner) !== c.capTeam) return;
      const d = distTo(t, c.x + 0.5, c.y + 0.5);
      if (d <= gun.range && d < bd) { bd = d; best = t; }
    });
    if (!best) continue;
    c.cd[0] = sec(gun.cd);
    ev.push({ e: 'shot', src: -1 - c.id, owner: c.owner, x0: c.x + 0.5, y0: c.y + 0.5, x1: (best as Ent).x, y1: (best as Ent).y, w: 'gun', kind: 'city' });
    hurt(s, best, gun.dmg, 'gun', undefined, ev, true);
  }
}

/** Burning oil hurts whatever stands in it. */
export function stepFires(s: MatchState, ev: SimEvent[]) {
  for (const fx of s.effects) {
    if (fx.k !== 'fire' || s.tick % 10 !== 0) continue;
    near(s, fx.x, fx.y, fx.r, (t) => {
      if (t.t !== 'u' || UNITS[t.kind].layer !== 'ground' || Math.hypot(t.x - fx.x, t.y - fx.y) > fx.r) return;
      hurt(s, t, (COMBAT.burnDps / 2) / Math.max(0.01, DAMAGE.shell[armorOf(t)]), 'shell', undefined, ev, false);
    }, 0);
  }
}


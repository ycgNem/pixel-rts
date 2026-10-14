// Matchups in plain words ("Beats Light Tanks, Heavy Tanks; can't hit aircraft; countered by
// Riflemen"), worked out from the unit data and the damage table, so the tips never drift from
// the balance. UI only.
//
// The estimate is a cost-for-cost duel: a side's strength is its damage a second times its hit
// points, both per unit of cost (Lanchester's square law). Range, speed and splash are left out,
// so it's a rule of thumb, which is what a tooltip needs.
import { DAMAGE, type Layer } from '../data/damage';
import { UNITS, type UnitDef } from '../data/units';

const LAYER_WORDS: Record<Layer, string> = { ground: 'ground units', naval: 'ships', air: 'aircraft' };
/** what each weapon class is called on screen */
export const WEAPON_NAMES: Record<string, string> = { gun: 'Guns', cannon: 'Cannon', rocket: 'Rockets', flak: 'Flak', shell: 'Shells', missile: 'Missiles', bomb: 'Bombs', torpedo: 'Torpedoes', depth: 'Depth charges' };
/** one side must be this many times stronger, cost for cost, to "beat" the other */
const BEATS = 1.3;

const price = (d: UnitDef) => Math.max(1, d.cost.cash + 2 * d.cost.oil);

function power(a: UnitDef, b: UnitDef): number {
  let dps = 0;
  for (const w of a.weapons) if (w.hits.includes(b.layer)) dps += (w.dmg * DAMAGE[w.cls][b.armor]) / w.cd;
  return ((dps / price(a)) * a.hp) / price(a);
}

/** How many times stronger `a` is than `b`, cost for cost (Infinity: `b` can't hurt `a`). */
export function edge(a: string, b: string): number {
  const pa = power(UNITS[a], UNITS[b]), pb = power(UNITS[b], UNITS[a]);
  return pb > 0 ? pa / pb : pa > 0 ? Infinity : 1;
}

export interface Matchups { beats: string[]; counters: string[]; cantHit: string[] }

const cache = new Map<string, Matchups>();
/**
 * armed units a player can train (not builders, transports or merchant ships), and not siege guns
 * with a minimum range: they never fight a duel, so the estimate says nothing about them
 */
const fighters = () => Object.values(UNITS).filter((o) => o.at.length && o.weapons.length && !o.weapons.some((w) => w.minRange));
export const plural = (name: string) => (name.endsWith('man') ? name.slice(0, -3) + 'men' : name.endsWith('ery') ? name : name + 's');

export function matchups(kind: string): Matchups {
  const hit = cache.get(kind);
  if (hit) return hit;
  const d = UNITS[kind];
  const others = fighters().filter((o) => o.id !== kind);
  // fights that happen: land against land, sea against sea, and aircraft against everyone
  const meet = (o: UnitDef) => o.layer === d.layer || o.layer === 'air' || d.layer === 'air';
  const both = (o: UnitDef) => power(d, o) > 0 && power(o, d) > 0;
  // real fights (both sides shoot) first; one-sided ones ("can't hit aircraft") only fill the gaps
  const rank = (f: (o: UnitDef) => number) => {
    const list = others.filter((o) => meet(o) && f(o) >= BEATS);
    const by = (a: UnitDef, b: UnitDef) => Math.min(f(b), 99) - Math.min(f(a), 99) || a.id.localeCompare(b.id);
    return [...list.filter(both).sort(by), ...list.filter((o) => !both(o)).sort(by)].slice(0, 2).map((o) => plural(o.name));
  };
  const beats = rank((o) => edge(kind, o.id));
  const counters = rank((o) => edge(o.id, kind));
  const layers = new Set(d.weapons.flatMap((w) => w.hits));
  const cantHit = d.weapons.length ? (['ground', 'air', 'naval'] as Layer[]).filter((l) => !layers.has(l)).map((l) => LAYER_WORDS[l]) : [];
  const out = { beats, counters, cantHit };
  cache.set(kind, out);
  return out;
}

/** Short lines for a tooltip or the selection panel: what it beats, what it can't hit, what beats it. */
export function matchupText(kind: string): string[] {
  const m = matchups(kind);
  return [
    m.beats.length ? `Beats ${m.beats.join(', ')}` : '',
    m.cantHit.length ? `Can't hit ${m.cantHit.join(' or ')}` : '',
    m.counters.length ? `Countered by ${m.counters.join(', ')}` : '',
  ].filter(Boolean);
}

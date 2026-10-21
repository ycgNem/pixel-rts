// Stat modifiers from techs and doctrines. Results are cached per player and rebuilt when the
// player's tech or doctrine list grows (the cache is derived data, not match state).
import { DOCTRINES, MOD_FLOOR, TECHS, type ModKey, type Perk } from '../data/techs';
import type { Player } from './types';

const TECH_BY_ID = new Map(TECHS.map((t) => [t.id, t]));
const DOC_BY_ID = new Map(DOCTRINES.map((d) => [d.id, d]));

interface ModCache { techs: string[]; nTechs: number; docs: string[]; nDocs: number; mul: Map<ModKey, number>; add: Map<ModKey, number> }
const cache = new WeakMap<Player, ModCache>();

function get(p: Player): ModCache {
  let c = cache.get(p);
  // techs and doctrines are only ever added to (or the lists replaced)
  if (c && c.techs === p.techs && c.nTechs === p.techs.length && c.docs === p.doctrines && c.nDocs === p.doctrines.length) return c;
  c = { techs: p.techs, nTechs: p.techs.length, docs: p.doctrines, nDocs: p.doctrines.length, mul: new Map(), add: new Map() };
  const apply = (mods: { key: ModKey; mul?: number; add?: number }[] | undefined) => {
    for (const m of mods ?? []) {
      // bonuses to the same stat add up (+25% and +25% is +50%), so stacks can't run away
      if (m.mul !== undefined) c!.mul.set(m.key, (c!.mul.get(m.key) ?? 1) + (m.mul - 1));
      if (m.add !== undefined) c!.add.set(m.key, (c!.add.get(m.key) ?? 0) + m.add);
    }
  };
  for (const t of p.techs) apply(TECH_BY_ID.get(t)?.mods);
  for (const d of p.doctrines) apply(DOC_BY_ID.get(d)?.mods);
  cache.set(p, c);
  return c;
}

/** All multipliers on this stat, combined additively: 1 + the sum of each bonus (1 when none). */
export function modMul(p: Player | undefined, key: ModKey): number {
  return p ? Math.max(MOD_FLOOR, get(p).mul.get(key) ?? 1) : 1;
}

/** Does one of this player's doctrines grant this perk? */
export function hasPerk(p: Player | undefined, perk: Perk): boolean {
  return !!p && p.doctrines.some((id) => DOC_BY_ID.get(id)?.perk === perk);
}

/** Sum of all additions to this stat (0 when none). */
export function modAdd(p: Player | undefined, key: ModKey): number {
  return p ? get(p).add.get(key) ?? 0 : 0;
}

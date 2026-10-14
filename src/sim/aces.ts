// Wanted aces (our twist on veterancy): each player has at most one ace, the most experienced of
// their units with every veteran star. It has a name, allied units near it fight harder, and
// whoever kills it collects a bounty (ACES). A new ace is healed and gets more HP. The ace and its name live on the player, so every
// peer agrees on them; the ace keeps the title until it falls, and then the next in line steps up.
import { ACES, ACE_NAMES } from '../data/rules';
import { COMMAND } from '../data/powers';
import { VETERANCY } from '../data/damage';
import type { Ent, MatchState, Player, SimEvent, Unit } from './types';
import { TICK_RATE } from './types';
import { allied, unitMaxHp } from './world';

/** Has this unit earned every veteran star (so it can become its owner's ace)? */
export const fullStars = (u: Unit) => u.vet >= VETERANCY.thresholds.length;

/** Is this unit its owner's ace? */
export const isAce = (s: MatchState, u: Pick<Unit, 'id' | 'owner'>) => u.owner >= 0 && s.players[u.owner]?.ace === u.id;

/** The ace's name ('' for a unit that isn't one). */
export function aceName(s: MatchState, u: Pick<Unit, 'id' | 'owner'>): string {
  const p = isAce(s, u) ? s.players[u.owner] : undefined;
  return p ? p.aceNames[p.aceNames.length - 1] : '';
}

/** Player p's ace, if it is on the map (not riding in a transport). */
function aceOf(s: MatchState, p: Player): Unit | undefined {
  const u = p.ace >= 0 ? s.ents[p.ace] : undefined;
  return u && u.t === 'u' && !u.inside ? u : undefined;
}

/** The damage multiplier an attacker gets from an allied ace nearby (not from itself). */
export function aceAura(s: MatchState, attacker: Ent): number {
  if (attacker.owner < 0) return 1;
  const team = s.players[attacker.owner].team;
  for (const p of s.players) {
    if (p.team !== team) continue;
    const a = aceOf(s, p);
    if (!a || a.id === attacker.id || a.hp <= 0) continue;
    if (Math.hypot(a.x - attacker.x, a.y - attacker.y) <= ACES.radius) return 1 + ACES.aura;
  }
  return 1;
}

/**
 * The ace died: announce it, and pay the bounty to whoever killed it (`by`, -1 for no one, such as
 * a unit lost with its sunk transport). Called once, by the killing blow or by the removal.
 */
export function aceDown(s: MatchState, u: Unit, by: number, ev: SimEvent[]) {
  const p = s.players[u.owner];
  if (!p || p.ace !== u.id) return;
  p.ace = -1;
  const paid = by >= 0 && by !== u.owner && !allied(s, by, u.owner) && !!s.players[by];
  const cash = paid ? ACES.bountyCash : 0, cp = paid ? ACES.bountyCp : 0;
  if (paid) {
    const k = s.players[by];
    k.cash += cash;
    k.cp = Math.min(COMMAND.max, k.cp + cp);
    k.stats.cashEarned += cash;
  }
  ev.push({ e: 'aceDown', p: u.owner, by: paid ? by : -1, id: u.id, kind: u.kind, name: p.aceNames[p.aceNames.length - 1], x: u.x, y: u.y, cash, cp });
}

/** A name for player p's next ace: one no ace in the match wears now, and p hasn't used before. */
function nextName(s: MatchState, p: Player): string {
  const taken = new Set<string>(p.aceNames);
  for (const o of s.players) if (o.ace >= 0) taken.add(o.aceNames[o.aceNames.length - 1]);
  const from = (s.setup.seed + p.id * Math.floor(ACE_NAMES.length / 6)) % ACE_NAMES.length;
  for (let i = 0; i < ACE_NAMES.length; i++) {
    const n = ACE_NAMES[(from + i) % ACE_NAMES.length];
    if (!taken.has(n)) return n;
  }
  return `${ACE_NAMES[(from + p.aceNames.length) % ACE_NAMES.length]} II`;
}

/** Once a second: a player with no ace promotes their most experienced unit with every star. */
export function stepAces(s: MatchState, ev: SimEvent[]) {
  if (s.tick % TICK_RATE !== 0) return;
  for (const p of s.players) {
    if (p.ace >= 0) {
      const u = s.ents[p.ace];
      if (u && u.t === 'u' && u.owner === p.id) continue;
      p.ace = -1; // changed hands
    }
    let best: Unit | undefined;
    for (const id in s.ents) {
      const e = s.ents[id];
      if (e.t === 'u' && e.owner === p.id && e.hp > 0 && fullStars(e) && (!best || e.xp > best.xp)) best = e;
    }
    if (!best) continue;
    const name = nextName(s, p);
    p.ace = best.id;
    p.aceNames.push(name);
    // a field promotion: patched up, and tougher while it wears the name
    best.hp = unitMaxHp(s, best);
    ev.push({ e: 'ace', p: p.id, id: best.id, kind: best.kind, name, x: best.x, y: best.y });
  }
}

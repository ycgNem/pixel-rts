// The exchange (our twist): spare cash buys oil or science, spare oil sells for cash. Every trade
// heats that market (the next one costs more), and markets cool down over time, so the exchange
// is a pressure valve for a lopsided economy, not a second income.
import { EXCHANGE, type TradeId } from '../data/rules';
import type { MatchState, Player } from './types';
import { TICK_RATE } from './types';
import { exileCapital, hqOf } from './world';
import { modMul } from './mods';

/** What one trade costs and gives right now. */
export function tradeQuote(s: MatchState, p: Player, id: TradeId): { pay: number; get: number } {
  const t = EXCHANGE.trades[id];
  const heat = p.market[id] ?? 0;
  return { pay: Math.round(t.pay * (1 + heat)), get: Math.round(t.get * modMul(p, 'tradeRate')) };
}

/** Why this player can't make this trade now (null = they can). */
export function tradeBlocked(s: MatchState, p: Player, id: TradeId): string | null {
  const t = EXCHANGE.trades[id];
  if (!t) return 'unknown trade';
  if (!hqOf(s, p.id) && !exileCapital(s, p.id)) return 'you need a Headquarters';
  if (t.needs && !Object.values(s.ents).some((e) => e.t === 'b' && e.owner === p.id && e.kind === t.needs && e.built >= 1)) return `needs a finished ${t.needsName}`;
  const { pay } = tradeQuote(s, p, id);
  if (p[t.payWith] < pay) return `not enough ${t.payWith === 'cash' ? 'cash' : t.payWith}`;
  return null;
}

/** Make the trade (the caller checked tradeBlocked). */
export function trade(s: MatchState, p: Player, id: TradeId) {
  const t = EXCHANGE.trades[id];
  const q = tradeQuote(s, p, id);
  p[t.payWith] -= q.pay;
  p[t.gets] += q.get;
  p.market[id] = (p.market[id] ?? 0) + EXCHANGE.heat;
}

/** Markets cool down a little every second. */
export function stepExchange(s: MatchState) {
  if (s.tick % TICK_RATE !== 0) return;
  for (const p of s.players)
    for (const id in p.market) {
      const k = id as TradeId;
      p.market[k] = Math.max(0, (p.market[k] ?? 0) - EXCHANGE.cool / 60);
    }
}

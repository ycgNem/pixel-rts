// Which colors players are drawn in. Normally each player's own color; with "friend or foe"
// colors on, you are blue, your allies teal and every enemy red. A render-only preference kept
// in this browser: it never touches the match state.
import { C, PALETTE, TEAM_COLORS } from '../data/palette';
import type { MatchState } from '../sim/types';

/** TEAM_COLORS indices for friend-or-foe mode */
const FRIEND_FOE = { me: 0, ally: 4, enemy: 1 };
const KEY = 'pixel-rts.friendFoe';

function load(): boolean {
  try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
}

/** who is looking (-1 = nobody, e.g. the title-screen demo) and the preference */
export const viewer = { me: -1, friendFoe: load() };

export function setFriendFoe(on: boolean) {
  viewer.friendFoe = on;
  try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* no storage: just this session */ }
}

/** The TEAM_COLORS index to draw this owner in (-1 = neutral). */
export function viewColor(s: MatchState, owner: number): number {
  if (owner < 0 || !s.players[owner]) return -1;
  if (!viewer.friendFoe || viewer.me < 0 || !s.players[viewer.me]) return s.players[owner].color;
  if (owner === viewer.me) return FRIEND_FOE.me;
  return s.players[owner].team === s.players[viewer.me].team ? FRIEND_FOE.ally : FRIEND_FOE.enemy;
}

/**
 * Nobody's (neutral cities): an earthy taupe that no team uses. It used to be near-white, which
 * the White team's flags and names looked just like.
 */
export const NEUTRAL_UI = PALETTE[C.taupe];

/** An owner's bright UI color as CSS (`neutral` for nobody). */
export function viewUi(s: MatchState, owner: number, neutral = NEUTRAL_UI): string {
  const c = viewColor(s, owner);
  return c >= 0 ? PALETTE[TEAM_COLORS[c].ui] : neutral;
}

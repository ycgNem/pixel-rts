// Saved games: one slot in localStorage. A save is the whole MatchState (plain JSON by design,
// CLAUDE.md rule 7) plus whose seat was playing; loading resumes it as an offline host with fresh
// AIs (their short-term memory, such as squads and waves, starts again).
import type { MatchState } from '../sim/types';
import { TICK_RATE } from '../sim/types';

const KEY = 'pixel-rts.save';
/** bump when MatchState changes shape, so old saves are refused instead of breaking a match */
export const SAVE_VERSION = 5;
/** the match saves itself this often (game seconds) */
export const AUTOSAVE_SECONDS = 60;

export interface SaveFile {
  v: number;
  /** the seat that was playing */
  me: number;
  /** when it was saved (ms since 1970) */
  at: number;
  state: MatchState;
}

export function encodeSave(state: MatchState, me: number, at: number): string {
  const f: SaveFile = { v: SAVE_VERSION, me, at, state };
  return JSON.stringify(f);
}

/** The save, or null for anything that isn't a whole save from this version. */
export function decodeSave(raw: string | null): SaveFile | null {
  if (!raw) return null;
  let f: SaveFile;
  try { f = JSON.parse(raw); } catch { return null; }
  if (!f || typeof f !== 'object' || f.v !== SAVE_VERSION || typeof f.me !== 'number') return null;
  const s = f.state;
  if (!s || typeof s.tick !== 'number' || !Array.isArray(s.players) || !s.players[f.me] || typeof s.ents !== 'object' || !s.map || !s.setup) return null;
  return f;
}

/** Save to the slot; false when storage is full or unavailable. */
export function writeSave(state: MatchState, me: number): boolean {
  try {
    localStorage.setItem(KEY, encodeSave(state, me, Date.now()));
    return true;
  } catch {
    return false;
  }
}

export function readSave(): SaveFile | null {
  try { return decodeSave(localStorage.getItem(KEY)); } catch { return null; }
}

export function clearSave() {
  try { localStorage.removeItem(KEY); } catch { /* no storage */ }
}

/** "12:34 into a Small pangaea match, 1 vs 3" */
export function describeSave(f: SaveFile): string {
  const s = f.state, sec = Math.floor(s.tick / TICK_RATE);
  const clock = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  const size = s.setup.mapSize.charAt(0).toUpperCase() + s.setup.mapSize.slice(1);
  const team = s.players[f.me].team;
  const rivals = s.players.filter((p) => p.team !== team).length;
  return `${clock} into a ${size} ${s.setup.mapType} match against ${rivals} rival${rivals === 1 ? '' : 's'}`;
}

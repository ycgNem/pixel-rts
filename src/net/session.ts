// Sessions. The UI talks to a Session; it never steps the sim itself (CLAUDE.md rules 3-4).
// - HostSession runs the match: single-player is a host with no remote peers; online, the host
//   also takes remote players' commands and sends snapshots (see ./host.ts).
// - ClientSession (./client.ts) mirrors the host's state from snapshots.
import type { Command, MatchState, SimEvent } from '../sim/types';
import { step } from '../sim/match';

export interface AiPlayer {
  readonly player: number;
  /** Called every tick on the host; returns commands for this tick. */
  think(s: MatchState): Command[];
}

/** a chat line from a player */
export interface ChatMsg { name: string; text: string }

export interface Session {
  /** the local player's id */
  me: number;
  state: MatchState;
  /** unit positions and facings at the previous tick, for interpolation */
  prev: Map<number, [number, number, number]>;
  /** events since the UI last drained them */
  events: SimEvent[];
  /** runs the sim locally (host) */
  readonly host: boolean;
  send(cmd: Command): void;
  /** host: advance one tick */
  tick(): void;
  /** client: called every frame with real seconds; returns the interpolation alpha */
  frame(dt: number): number;
  paused: boolean;
  /** pause or resume the match (host only; online, everyone pauses) */
  setPaused(on: boolean): void;
  /** human-readable connection status for the HUD ('' when local) */
  status(): string;
  /** chat lines (including our own) since the UI last drained them */
  chat: ChatMsg[];
  /** send a chat line to everyone in the match (does nothing offline) */
  say(text: string): void;
  dispose(): void;
}

export class HostSession implements Session {
  readonly host = true;
  prev = new Map<number, [number, number, number]>();
  events: SimEvent[] = [];
  chat: ChatMsg[] = [];
  paused = false;
  private queue: Command[] = [];
  /** extra command sources (remote players) */
  remote: Command[] = [];
  /** called after every tick (online hosts send snapshots from here) */
  onTick: ((ev: SimEvent[]) => void) | null = null;

  constructor(public state: MatchState, public me: number, public ais: AiPlayer[] = []) {}

  send(cmd: Command) {
    this.queue.push(cmd);
  }

  tick() {
    if (this.paused) return;
    const s = this.state;
    this.prev.clear();
    for (const id in s.ents) {
      const e = s.ents[id];
      if (e.t === 'u') this.prev.set(e.id, [e.x, e.y, e.dir]);
    }
    const cmds = this.queue.splice(0);
    if (this.remote.length) cmds.push(...this.remote.splice(0));
    for (const ai of this.ais) cmds.push(...ai.think(s));
    const ev = step(s, cmds);
    if (ev.length) this.events.push(...ev);
    this.onTick?.(ev);
  }

  frame(): number {
    return 0;
  }

  setPaused(on: boolean) {
    this.paused = on;
  }

  status(): string {
    return '';
  }

  /** offline there's nobody to talk to; an online host replaces this (see NetHost) */
  say(_text: string) {}

  dispose() {}
}

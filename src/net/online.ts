// Online play: the lobby (host and client sides), the host's network wrapper around HostSession,
// and ClientSession, which mirrors the host's match from snapshots (CLAUDE.md rules 3-4: the same
// sim and the same commands; only the host steps it).
import { TEAM_COLORS } from '../data/palette';
import type { AiDifficulty, Command, MatchSetup, MatchState, PlayerSetup, SimEvent } from '../sim/types';
import { TICK_RATE } from '../sim/types';
import { createMatch } from '../sim/match';
import { createAi } from '../sim/ai';
import { HostSession, type ChatMsg, type Session } from './session';
import { PROTOCOL_VERSION, SNAP_EVERY, SnapshotEncoder, applySnapshot, snapshotFrame, type LobbyState, type NetMsg } from './protocol';
import type { Transport } from './transport';

export const MAX_PLAYERS = 6;

// ---------------------------------------------------------------- lobby

export interface ChatLine { name: string; text: string; t: number }

/** Shared by both sides: the lobby as last known, chat, and status. */
export abstract class Lobby {
  lobby: LobbyState | null = null;
  chat: ChatLine[] = [];
  status = '';
  /** set when the match starts */
  onStart: ((session: Session) => void) | null = null;
  abstract readonly isHost: boolean;
  constructor(public t: Transport, public name: string) {}

  get seatIndex(): number {
    return this.lobby?.seats.findIndex((s) => s.peer === this.t.self) ?? -1;
  }

  say(text: string) {
    const line = { t: 'chat' as const, name: this.name, text: text.slice(0, 120) };
    this.chat.push({ name: this.name, text: line.text, t: performance.now() });
    this.t.send(line);
  }

  protected heard(m: NetMsg) {
    if (m.t === 'chat') this.chat.push({ name: m.name.slice(0, 16), text: m.text.slice(0, 120), t: performance.now() });
    if (this.chat.length > 50) this.chat.shift();
  }

  leave() {
    this.t.leave();
  }
}

export class LobbyHost extends Lobby {
  readonly isHost = true;
  private host: NetHost | null = null;
  /** each peer's private rejoin token (never sent to anyone) */
  private tokens = new Map<string, string>();

  constructor(t: Transport, name: string, code: string, setup: MatchSetup) {
    super(t, name);
    const players: PlayerSetup[] = [{ name, team: 0, color: 0, kind: 'human' }, ...setup.players.filter((p) => p.kind === 'ai').slice(0, MAX_PLAYERS - 1)];
    this.lobby = {
      code, host: t.self, started: false,
      setup: { ...setup, players },
      seats: players.map((p, i) => ({ peer: i === 0 ? t.self : '', name: p.name, team: p.team, color: p.color, ready: i === 0 })),
    };
    t.onMessage = (m, from) => this.onMsg(m, from);
    t.onPeerLeave = (id) => this.left(id);
  }

  /** Push the lobby to everyone (call after any change). */
  publish() {
    if (!this.lobby) return;
    const l = this.lobby;
    // keep setup.players in step with the seats
    l.setup.players = l.seats.map((s, i) => ({
      ...(l.setup.players[i] ?? { kind: 'ai', ai: { difficulty: 'normal' as AiDifficulty, personality: 'random' as const } }),
      name: s.name, team: s.team, color: s.color, kind: s.peer ? 'human' : 'ai',
    }));
    this.t.send({ t: 'lobby', lobby: l });
  }

  private onMsg(m: NetMsg, from: string) {
    const l = this.lobby!;
    if (m.t === 'hello') {
      if (m.v !== PROTOCOL_VERSION) return this.t.send({ t: 'refuse', why: 'different game version - refresh the page' }, from);
      if (typeof m.id === 'string' && m.id) this.tokens.set(from, m.id.slice(0, 64));
      if (l.started) {
        this.host?.rejoin(from, this.tokens.get(from));
        return;
      }
      if (!l.seats.some((s) => s.peer === from)) {
        if (l.seats.length >= MAX_PLAYERS) {
          // replace an AI seat if there is one
          const ai = l.seats.findIndex((s) => !s.peer);
          if (ai < 0) return this.t.send({ t: 'refuse', why: 'the game is full' }, from);
          l.seats.splice(ai, 1);
          l.setup.players.splice(ai, 1);
        }
        const used = new Set(l.seats.map((s) => s.color));
        const color = TEAM_COLORS.findIndex((_, i) => !used.has(i));
        l.seats.push({ peer: from, name: cleanName(m.name), team: 0, color: Math.max(0, color), ready: false });
        this.chat.push({ name: '', text: `${cleanName(m.name)} joined`, t: performance.now() });
      }
      this.publish();
      return;
    }
    if (m.t === 'seat') {
      const seat = l.seats.find((s) => s.peer === from);
      if (!seat || l.started) return;
      if (m.name !== undefined) seat.name = cleanName(m.name);
      if (m.team !== undefined) seat.team = Math.max(0, Math.min(5, m.team | 0));
      if (m.ready !== undefined) seat.ready = !!m.ready;
      if (m.color !== undefined && !l.seats.some((s) => s !== seat && s.color === m.color) && m.color >= 0 && m.color < TEAM_COLORS.length) seat.color = m.color;
      this.publish();
      return;
    }
    if (m.t === 'chat') {
      this.heard(m);
      if (l.started) this.host?.heardChat(m.name, m.text);
      return;
    }
    if (l.started) this.host?.onMsg(m, from);
  }

  private left(id: string) {
    const l = this.lobby!;
    if (l.started) { this.host?.dropped(id); return; }
    const i = l.seats.findIndex((s) => s.peer === id);
    if (i < 0) return;
    this.chat.push({ name: '', text: `${l.seats[i].name} left`, t: performance.now() });
    l.seats.splice(i, 1);
    l.setup.players.splice(i, 1);
    this.publish();
  }

  /** Start the match: everyone gets the final setup and their player number. */
  start(): HostSession {
    const l = this.lobby!;
    this.publish();
    l.started = true;
    const setup = l.setup;
    for (const [i, seat] of l.seats.entries()) if (seat.peer && seat.peer !== this.t.self) this.t.send({ t: 'start', setup, me: i }, seat.peer);
    const s = createMatch(setup);
    const ais = s.setup.players.map((p, i) => (p.kind === 'ai' ? createAi(s, i, p.ai?.difficulty ?? 'normal', p.ai?.personality) : null)).filter((a) => a !== null);
    const session = new HostSession(s, 0, ais);
    const seats = new Map<string, number>();
    const byToken = new Map<string, number>();
    l.seats.forEach((seat, i) => {
      if (!seat.peer || seat.peer === this.t.self) return;
      seats.set(seat.peer, i);
      const token = this.tokens.get(seat.peer);
      if (token) byToken.set(token, byToken.has(token) ? -1 : i);
    });
    // two seats with one token (two tabs sharing storage) can't be told apart: neither rejoins by token
    for (const [token, i] of [...byToken]) if (i < 0) byToken.delete(token);
    this.host = new NetHost(session, this.t, seats, this, byToken);
    return session;
  }
}

export class LobbyClient extends Lobby {
  readonly isHost = false;
  hostId = '';
  refused = '';
  private greeted = new Set<string>();
  private started = false;

  /** `token`: a private id kept in this browser, so reloading the page gets the same seat back */
  constructor(t: Transport, name: string, private token = '') {
    super(t, name);
    this.status = 'Looking for the host...';
    t.onPeerJoin = (id) => this.hello(id);
    t.onPeerLeave = (id) => { if (id === this.hostId) this.status = 'The host left'; };
    t.onMessage = (m, from) => this.onMsg(m, from);
    // greet peers already here on the next microtask, so the caller can attach onStart first
    // (a rejoining player gets 'start' straight back)
    queueMicrotask(() => { for (const p of t.peers()) this.hello(p); });
  }

  /** say hello to each peer once */
  private hello(id: string) {
    if (this.greeted.has(id)) return;
    this.greeted.add(id);
    this.t.send({ t: 'hello', v: PROTOCOL_VERSION, name: this.name, id: this.token }, id);
  }

  seat(change: { color?: number; team?: number; ready?: boolean; name?: string }) {
    if (this.hostId) this.t.send({ t: 'seat', ...change }, this.hostId);
  }

  private onMsg(m: NetMsg, from: string) {
    if (m.t === 'lobby') {
      if (m.lobby.host !== from) return;
      this.hostId = from;
      this.lobby = m.lobby;
      this.status = '';
    } else if (m.t === 'refuse') {
      this.refused = m.why;
      this.status = `Can't join: ${m.why}`;
    } else if (m.t === 'chat') this.heard(m);
    else if (m.t === 'start' && from === this.hostId && !this.started) {
      this.started = true;
      const session = new ClientSession(m.setup, m.me, this.t, this.hostId, this.name);
      this.onStart?.(session);
    }
  }
}

function cleanName(n: string): string {
  return (n || 'Player').replace(/[^\w .'-]/g, '').trim().slice(0, 16) || 'Player';
}

// ---------------------------------------------------------------- host in a match

/** Wraps the host's session: takes remote commands, sends snapshots. */
export class NetHost {
  private enc = new Map<string, SnapshotEncoder>();
  private pending: SimEvent[] = [];

  constructor(private session: HostSession, private t: Transport, private seats: Map<string, number>, private lobby: LobbyHost, private byToken = new Map<string, number>()) {
    for (const peer of seats.keys()) this.enc.set(peer, new SnapshotEncoder());
    session.onTick = (ev) => {
      this.pending.push(...ev);
      if (session.state.tick % SNAP_EVERY === 0) this.flush();
    };
    session.status = () => `Online ${[...this.seats.keys()].filter((p) => this.t.peers().includes(p)).length + 1}p`;
    session.say = (text) => {
      const line = text.trim().slice(0, 120);
      if (!line) return;
      this.lobby.say(line);
      session.chat.push({ name: this.lobby.name, text: line });
    };
    const pause = session.setPaused.bind(session);
    session.setPaused = (on: boolean) => {
      pause(on);
      this.t.send({ t: 'pause', on });
    };
  }

  private flush(fullFor?: string) {
    const ev = this.pending.splice(0);
    const shared = ev.filter((e) => e.e !== 'reject');
    // the rows are worked out once for every peer
    const frame = snapshotFrame(this.session.state);
    for (const [peer, p] of this.seats) {
      if (fullFor && peer !== fullFor) continue;
      const enc = this.enc.get(peer)!;
      const mine = ev.filter((e) => e.e === 'reject' && e.p === p);
      const snap = enc.encode(this.session.state, mine.length ? [...shared, ...mine] : shared, peer === fullFor, frame);
      this.t.send({ t: 'snap', s: snap }, peer);
    }
  }

  /** a chat line from a peer during the match */
  heardChat(name: string, text: string) {
    this.session.chat.push({ name: String(name).slice(0, 16), text: String(text).slice(0, 120) });
  }

  onMsg(m: NetMsg, from: string) {
    if (m.t !== 'cmd') return;
    const p = this.seats.get(from);
    if (p === undefined || !m.c || typeof m.c !== 'object') return;
    // never trust the sender about who they are
    const c = { ...m.c, p } as Command;
    this.session.remote.push(c);
  }

  /** A player who dropped is taken over by a normal AI, so the team isn't left a player short. */
  dropped(peer: string) {
    const p = this.seats.get(peer);
    if (p === undefined) return;
    const s = this.session.state;
    if (!s.players[p]?.alive) return;
    this.session.ais.push(createAi(s, p, 'normal'));
    this.lobby.chat.push({ name: '', text: `${s.players[p].name} disconnected - the AI takes over`, t: performance.now() });
    this.pending.push({ e: 'reject', p: 0, why: `${s.players[p].name} disconnected - the AI takes over` });
  }

  /** A known player reconnected (same peer, or a new peer with their token): send them everything again. */
  rejoin(peer: string, token?: string) {
    let p = this.seats.get(peer);
    if (p === undefined && token) {
      p = this.byToken.get(token);
      // a seat whose player is still connected is never handed to someone else
      const live = new Set(this.t.peers());
      if (p !== undefined && [...this.seats].some(([old, seat]) => seat === p && live.has(old))) p = undefined;
      if (p !== undefined) {
        // the same player on a new peer id (they reloaded the page): move the seat over
        for (const [old, seat] of [...this.seats]) if (seat === p) { this.seats.delete(old); this.enc.delete(old); }
        this.seats.set(peer, p);
        this.enc.set(peer, new SnapshotEncoder());
      }
    }
    if (p === undefined) return this.t.send({ t: 'refuse', why: 'the match already started' }, peer);
    const ai = this.session.ais.findIndex((a) => a.player === p);
    if (ai >= 0) this.session.ais.splice(ai, 1);
    if (this.lobby.lobby) this.t.send({ t: 'lobby', lobby: this.lobby.lobby }, peer);
    this.t.send({ t: 'start', setup: this.session.state.setup, me: p }, peer);
    this.enc.get(peer)!.reset();
    this.flush(peer);
  }
}

// ---------------------------------------------------------------- client in a match

export class ClientSession implements Session {
  readonly host = false;
  state: MatchState;
  prev = new Map<number, [number, number, number]>();
  events: SimEvent[] = [];
  chat: ChatMsg[] = [];
  paused = false;
  private lastSnap = 0;
  private lost = false;
  private gotFull = false;

  constructor(setup: MatchSetup, public me: number, private t: Transport, private hostId: string, private name = 'Player') {
    // the same start as the host (map generation is deterministic); snapshots take it from here
    this.state = createMatch(setup);
    t.onMessage = (m, from) => {
      // chat comes straight from whoever said it
      if (m.t === 'chat') { this.chat.push({ name: String(m.name).slice(0, 16), text: String(m.text).slice(0, 120) }); return; }
      if (from !== this.hostId) return;
      if (m.t === 'snap') {
        if (!this.gotFull && !m.s.full) return;
        this.gotFull = true;
        this.prev = applySnapshot(this.state, m.s);
        this.events.push(...m.s.ev);
        this.lastSnap = performance.now();
      } else if (m.t === 'pause') this.paused = m.on;
    };
    t.onPeerLeave = (id) => { if (id === this.hostId) this.lost = true; };
  }

  send(cmd: Command) {
    this.t.send({ t: 'cmd', c: cmd }, this.hostId);
  }

  say(text: string) {
    const line = text.trim().slice(0, 120);
    if (!line) return;
    this.t.send({ t: 'chat', name: this.name, text: line });
    this.chat.push({ name: this.name, text: line });
  }

  tick() {}

  setPaused() {}

  frame(): number {
    const interval = (SNAP_EVERY / TICK_RATE) * 1000;
    return Math.max(0, Math.min(1, (performance.now() - this.lastSnap) / interval));
  }

  status(): string {
    if (this.lost) return 'Host disconnected';
    if (!this.gotFull) return 'Connecting...';
    return performance.now() - this.lastSnap > 2000 ? 'Lagging...' : 'Online';
  }

  dispose() {
    this.t.leave();
  }
}

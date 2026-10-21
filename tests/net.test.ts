// Online play over an in-memory network: lobby, start, snapshots, commands, drops.
import { describe, expect, it } from 'vitest';
import { LoopbackHub } from '../src/net/transport';
import { LobbyClient, LobbyHost, type ClientSession } from '../src/net/online';
import type { Session } from '../src/net/session';
import { PROTOCOL_VERSION, SNAP_EVERY, SnapshotEncoder, applySnapshot, type NetMsg } from '../src/net/protocol';
import { createMatch } from '../src/sim/match';
import { TICK_RATE, type Unit } from '../src/sim/types';
import { setup } from './helpers';

const flush = () => new Promise((r) => setTimeout(r, 0));

async function lobbyWith(clients: number) {
  const hub = new LoopbackHub();
  const st = setup({ seed: 11 }, 2);
  st.players = [st.players[0]];
  const ht = hub.connect();
  const host = new LobbyHost(ht, 'Hosty', 'ABCDE', st);
  const cs: LobbyClient[] = [];
  for (let i = 0; i < clients; i++) cs.push(new LobbyClient(hub.connect(), 'Guest' + i));
  await flush();
  await flush();
  return { hub, host, cs };
}

describe('online', () => {
  it('clients join the lobby and see each other', async () => {
    const { host, cs } = await lobbyWith(2);
    expect(host.lobby!.seats.map((s) => s.name)).toEqual(['Hosty', 'Guest0', 'Guest1']);
    for (const c of cs) {
      expect(c.lobby?.seats.length).toBe(3);
      expect(c.hostId).toBe(host.t.self);
    }
    cs[0].seat({ team: 1, ready: true });
    await flush();
    expect(host.lobby!.seats[1].team).toBe(1);
    expect(cs[1].lobby!.seats[1].ready).toBe(true);
  });

  it('seats six humans with their own colors, turns a seventh away, and starts the match for all', async () => {
    const { hub, host, cs } = await lobbyWith(5);
    expect(host.lobby!.seats.length).toBe(6);
    expect(new Set(host.lobby!.seats.map((s) => s.color)).size).toBe(6);
    const late = new LobbyClient(hub.connect(), 'Late');
    await flush();
    await flush();
    expect(late.refused).toMatch(/full/);
    expect(host.lobby!.seats.length).toBe(6);
    const sessions: (Session | null)[] = cs.map(() => null);
    cs.forEach((c, i) => {
      c.seat({ team: i + 1 });
      c.onStart = (s) => (sessions[i] = s);
    });
    await flush();
    const hs = host.start();
    await flush();
    expect(hs.state.players.length).toBe(6);
    expect(new Set(hs.state.players.map((p) => p.team)).size).toBe(6);
    for (let i = 0; i < 40; i++) hs.tick();
    await flush();
    sessions.forEach((s, i) => {
      const cl = s as ClientSession;
      expect(cl.me).toBe(i + 1);
      expect(cl.state.tick).toBe(hs.state.tick);
    });
  });

  it('a client on an old version is told to refresh', async () => {
    const { hub, host } = await lobbyWith(0);
    const old = hub.connect();
    const got: NetMsg[] = [];
    old.onMessage = (m) => got.push(m);
    old.send({ t: 'hello', v: PROTOCOL_VERSION - 1, name: 'Old' }, host.t.self);
    await flush();
    const r = got.find((m) => m.t === 'refuse');
    expect(r && r.t === 'refuse' && r.why).toMatch(/refresh/);
    expect(host.lobby!.seats.map((s) => s.name)).toEqual(['Hosty']);
  });

  it('leaving and rejoining the lobby works', async () => {
    const { hub, host, cs } = await lobbyWith(2);
    cs[0].leave();
    await flush();
    expect(host.lobby!.seats.map((s) => s.name)).toEqual(['Hosty', 'Guest1']);
    expect(cs[1].lobby!.seats.map((s) => s.name)).toEqual(['Hosty', 'Guest1']);
    const back = new LobbyClient(hub.connect(), 'Guest0');
    await flush();
    await flush();
    expect(host.lobby!.seats.map((s) => s.name)).toEqual(['Hosty', 'Guest1', 'Guest0']);
    expect(back.lobby?.seats.length).toBe(3);
    expect(cs[1].lobby!.seats.length).toBe(3);
    // and the new seat can be changed like any other
    back.seat({ team: 1 });
    await flush();
    expect(host.lobby!.seats[2].team).toBe(1);
  });

  it('starts a match: clients mirror the host from snapshots and their commands reach the sim', async () => {
    const { host, cs } = await lobbyWith(1);
    cs[0].seat({ team: 1 });
    await flush();
    let client: Session | null = null;
    cs[0].onStart = (s) => (client = s);
    const hs = host.start();
    await flush();
    expect(client).not.toBeNull();
    const cl = client! as ClientSession;
    expect(cl.me).toBe(1);
    for (let i = 0; i < 40; i++) hs.tick();
    await flush();
    // same tick, same units, same places
    expect(cl.state.tick).toBe(hs.state.tick);
    const hostUnits = Object.values(hs.state.ents).filter((e) => e.t === 'u').length;
    expect(Object.values(cl.state.ents).filter((e) => e.t === 'u').length).toBe(hostUnits);
    // the client orders its rifleman somewhere; pretending to be player 0 doesn't work
    const mine = Object.values(cl.state.ents).find((e): e is Unit => e.t === 'u' && e.owner === 1 && e.kind === 'rifleman')!;
    const theirs = Object.values(cl.state.ents).find((e): e is Unit => e.t === 'u' && e.owner === 0 && e.kind === 'rifleman')!;
    const startX = mine.x;
    cl.send({ t: 'move', p: 1, ids: [mine.id], x: mine.x + 4, y: mine.y });
    cl.send({ t: 'move', p: 0, ids: [theirs.id], x: theirs.x + 4, y: theirs.y });
    await flush();
    const x0 = (hs.state.ents[theirs.id] as Unit).x;
    for (let i = 0; i < 60; i++) hs.tick();
    await flush();
    expect((hs.state.ents[mine.id] as Unit).x).toBeGreaterThan(startX + 2);
    expect(Math.abs((hs.state.ents[theirs.id] as Unit).x - x0)).toBeLessThan(0.5);
    expect((cl.state.ents[mine.id] as Unit).x).toBeCloseTo((hs.state.ents[mine.id] as Unit).x, 1);
  });

  it('plays correctly with 150 ms of lag each way', async () => {
    const LAG = 150, TICK_MS = 1000 / TICK_RATE, LAG_TICKS = LAG / TICK_MS;
    const hub = new LoopbackHub(true, LAG);
    const st = setup({ seed: 11 }, 2);
    st.players = [st.players[0]];
    const host = new LobbyHost(hub.connect(), 'Hosty', 'ABCDE', st);
    const guest = new LobbyClient(hub.connect(), 'Guest');
    const wait = async (ms: number) => { for (let t = 0; t < ms; t += TICK_MS) { await flush(); hub.advance(TICK_MS); } };
    await wait(1000);
    guest.seat({ team: 1 });
    await wait(1000);
    expect(host.lobby!.seats[1].team).toBe(1);
    let client: Session | null = null;
    guest.onStart = (sess) => (client = sess);
    const hs = host.start();
    // the host plays in real time: one tick per 50 ms of network clock
    const play = async (ticks: number) => { for (let i = 0; i < ticks; i++) { hs.tick(); await flush(); hub.advance(TICK_MS); } };
    await play(LAG_TICKS - 1);
    expect(client, 'the start message is still on its way').toBeNull();
    await play(40);
    const cl = client! as ClientSession;
    expect(cl.me).toBe(1);
    // the client sees the match one trip (plus up to one snapshot) behind the host; the host's
    // newest tick was made a tick's time ago, hence the - 1
    const behind = hs.state.tick - cl.state.tick;
    expect(behind).toBeGreaterThanOrEqual(LAG_TICKS - 1);
    expect(behind).toBeLessThanOrEqual(LAG_TICKS - 1 + SNAP_EVERY);
    // an order reaches the host one trip later, and the client sees it a trip after that
    const mine = Object.values(cl.state.ents).find((e): e is Unit => e.t === 'u' && e.owner === 1 && e.kind === 'rifleman')!;
    const x0 = (hs.state.ents[mine.id] as Unit).x;
    cl.send({ t: 'move', p: 1, ids: [mine.id], x: mine.x + 5, y: mine.y });
    await play(LAG_TICKS);
    expect((hs.state.ents[mine.id] as Unit).x, 'not there yet').toBe(x0);
    await play(1);
    await play(8);
    expect((hs.state.ents[mine.id] as Unit).x).toBeGreaterThan(x0);
    expect((cl.state.ents[mine.id] as Unit).x).toBeGreaterThan(x0);
    // let the match run, then let the network go quiet: the client ends up where the host is
    await play(200);
    // stop on a snapshot tick, so the last events have been sent
    await play((SNAP_EVERY - (hs.state.tick % SNAP_EVERY)) % SNAP_EVERY);
    await wait(LAG * 2);
    expect(cl.state.tick).toBe(hs.state.tick);
    const hostUnits = Object.values(hs.state.ents).filter((e): e is Unit => e.t === 'u');
    expect(Object.values(cl.state.ents).filter((e) => e.t === 'u').length).toBe(hostUnits.length);
    for (const u of hostUnits) {
      const c = cl.state.ents[u.id] as Unit;
      expect(c, 'unit ' + u.id).toBeTruthy();
      expect(c.x).toBeCloseTo(u.x, 1);
      expect(c.y).toBeCloseTo(u.y, 1);
    }
    expect(cl.state.players.map((p) => Math.round(p.cash))).toEqual(hs.state.players.map((p) => Math.round(p.cash)));
    // every shared event arrived once, in order
    const sent = hs.events.filter((e) => e.e !== 'reject' || e.p === 1).map((e) => e.e);
    expect(cl.events.map((e) => e.e)).toEqual(sent);
  });

  it('carries chat both ways during a match', async () => {
    const { host, cs } = await lobbyWith(1);
    cs[0].seat({ team: 1 });
    await flush();
    let client: Session | null = null;
    cs[0].onStart = (s) => (client = s);
    const hs = host.start();
    await flush();
    client!.say('gg');
    hs.say('wp');
    await flush();
    expect(hs.chat.map((c) => c.name + ':' + c.text)).toEqual(['Guest0:gg', 'Hosty:wp']);
    expect(client!.chat.map((c) => c.name + ':' + c.text)).toEqual(['Guest0:gg', 'Hosty:wp']);
  });

  it('hands a dropped player to the AI', async () => {
    const { host, cs } = await lobbyWith(1);
    cs[0].seat({ team: 1 });
    await flush();
    const hs = host.start();
    await flush();
    cs[0].leave();
    await flush();
    expect(hs.ais.some((a) => a.player === 1)).toBe(true);
  });

  it('a player who reloads (new peer id, same token) gets their side back from the AI', async () => {
    const hub = new LoopbackHub();
    const st = setup({ seed: 11 }, 2);
    st.players = [st.players[0]];
    const host = new LobbyHost(hub.connect(), 'Hosty', 'ABCDE', st);
    const guest = new LobbyClient(hub.connect(), 'Guest', 'secret-token');
    await flush();
    await flush();
    guest.seat({ team: 1 });
    await flush();
    const hs = host.start();
    await flush();
    guest.leave();
    await flush();
    expect(hs.ais.some((a) => a.player === 1)).toBe(true);
    // the page reloads: a new transport (new peer id), the same token
    const back = new LobbyClient(hub.connect(), 'Guest', 'secret-token');
    let session: Session | null = null;
    back.onStart = (sess) => (session = sess);
    await flush();
    await flush();
    expect(session).not.toBeNull();
    expect((session! as ClientSession).me).toBe(1);
    expect(hs.ais.some((a) => a.player === 1)).toBe(false);
    // someone without the token can't take the seat
    const stranger = new LobbyClient(hub.connect(), 'Mallory', 'guess');
    await flush();
    await flush();
    expect(stranger.refused).toBeTruthy();
    // nor can a copy of the token while the player is still connected
    const copycat = new LobbyClient(hub.connect(), 'Guest', 'secret-token');
    await flush();
    await flush();
    expect(copycat.refused).toBeTruthy();
  });

  it('snapshot deltas rebuild the same state', () => {
    const st = setup({ seed: 5 }, 2);
    const a = createMatch(st), b = createMatch(st);
    const enc = new SnapshotEncoder();
    applySnapshot(b, enc.encode(a, [], true));
    const d = enc.encode(a, []);
    expect(d.u.length + d.b.length).toBe(0); // nothing changed
    const u = Object.values(a.ents).find((e): e is Unit => e.t === 'u')!;
    u.x += 1;
    const d2 = enc.encode(a, []);
    expect(d2.u.length).toBe(1);
    applySnapshot(b, d2);
    expect((b.ents[u.id] as Unit).x).toBeCloseTo(u.x, 2);
  });

  it('snapshots carry the open city contract and a knocked-out player\'s insurgency', () => {
    const st = setup({ seed: 5 }, 3);
    const a = createMatch(st), b = createMatch(st);
    const enc = new SnapshotEncoder();
    applySnapshot(b, enc.encode(a, [], true));
    a.contract = { city: 2, kind: 'supply', until: 9000, holder: -1, since: 0, bids: [{ p: 1, cash: 300 }], closes: 800, team: -1, level: 2 };
    a.players[2].alive = false;
    a.players[2].insurgeAt = 1234;
    a.players[2].rising = 3;
    a.players[2].held = [3, 4];
    applySnapshot(b, enc.encode(a, []));
    expect(b.contract).toEqual(a.contract);
    expect(b.players[2]).toMatchObject({ alive: false, insurgeAt: 1234, rising: 3, held: [3, 4] });
    a.contract = null;
    applySnapshot(b, enc.encode(a, []));
    expect(b.contract).toBe(null);
  });
});

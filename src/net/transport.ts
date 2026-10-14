// Transports carry NetMsgs between peers. TrysteroTransport uses WebRTC data channels with public
// Nostr relays for signaling (no server of our own); LoopbackHub links transports in memory for
// tests and for trying a "remote" player in the same tab.
import type { NetMsg } from './protocol';
import { PROTOCOL_VERSION } from './protocol';

export interface Transport {
  readonly self: string;
  send(msg: NetMsg, to?: string): void;
  onMessage: ((msg: NetMsg, from: string) => void) | null;
  onPeerJoin: ((id: string) => void) | null;
  onPeerLeave: ((id: string) => void) | null;
  peers(): string[];
  leave(): void;
}

/** Room codes: 5 letters without look-alikes. */
export function newRoomCode(): string {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let s = '';
  for (let i = 0; i < 5; i++) s += A[Math.floor(Math.random() * A.length)];
  return s;
}

export async function joinOnline(code: string): Promise<Transport> {
  const { joinRoom, selfId } = await import('trystero');
  const room = joinRoom({ appId: `pixel-rts-v${PROTOCOL_VERSION}` }, code.toUpperCase());
  const action = room.makeAction<string>('m');
  const peers = new Set<string>();
  const t: Transport = {
    self: selfId,
    onMessage: null,
    onPeerJoin: null,
    onPeerLeave: null,
    send(msg, to) {
      void action.send(JSON.stringify(msg), to ? { target: to } : undefined);
    },
    peers: () => [...peers],
    leave() {
      void room.leave();
    },
  };
  action.onMessage = (data, ctx) => {
    let msg: NetMsg;
    try { msg = JSON.parse(data); } catch { return; }
    t.onMessage?.(msg, ctx.peerId);
  };
  room.onPeerJoin = (id) => { peers.add(id); t.onPeerJoin?.(id); };
  room.onPeerLeave = (id) => { peers.delete(id); t.onPeerLeave?.(id); };
  return t;
}

/** In-memory network: every transport made by one hub can reach the others. */
export class LoopbackHub {
  private nodes = new Map<string, Transport & { inbox: [NetMsg, string, number][] }>();
  private n = 0;
  /** the hub's own clock in ms, moved on by `advance` (only used for lag) */
  private clock = 0;
  /**
   * `auto`: deliver as soon as sent (tests flush by hand when false). `lag`: one-way delay in ms;
   * a message arrives once `advance` has moved the clock past it, in the order it was sent.
   */
  constructor(public auto = true, public lag = 0) {}

  connect(): Transport {
    const id = 'peer' + ++this.n;
    const hub = this;
    const node = {
      self: id,
      inbox: [] as [NetMsg, string, number][],
      onMessage: null as Transport['onMessage'],
      onPeerJoin: null as Transport['onPeerJoin'],
      onPeerLeave: null as Transport['onPeerLeave'],
      send(msg: NetMsg, to?: string) {
        // round-trip through JSON like the real thing
        const copy = JSON.parse(JSON.stringify(msg)) as NetMsg;
        for (const [pid, other] of hub.nodes) {
          if (pid === id || (to && pid !== to)) continue;
          other.inbox.push([copy, id, hub.clock + hub.lag]);
        }
        if (hub.auto && !hub.lag) hub.flush();
      },
      peers: () => [...hub.nodes.keys()].filter((p) => p !== id),
      leave() {
        hub.nodes.delete(id);
        for (const o of hub.nodes.values()) o.onPeerLeave?.(id);
      },
    };
    const existing = [...this.nodes.values()];
    this.nodes.set(id, node);
    // tell everyone about each other once handlers are attached
    queueMicrotask(() => {
      for (const o of existing) {
        o.onPeerJoin?.(id);
        node.onPeerJoin?.(o.self);
      }
    });
    return node;
  }

  /** Deliver everything that is due. */
  flush() {
    let busy = true;
    while (busy) {
      busy = false;
      for (const node of this.nodes.values()) {
        // messages are queued in send order and share one lag, so the due ones are at the front
        let k = 0;
        while (k < node.inbox.length && node.inbox[k][2] <= this.clock) k++;
        for (const [m, from] of node.inbox.splice(0, k)) { busy = true; node.onMessage?.(m, from); }
      }
    }
  }

  /** Move the clock on by `ms` and deliver what has arrived. */
  advance(ms: number) {
    this.clock += ms;
    this.flush();
  }
}

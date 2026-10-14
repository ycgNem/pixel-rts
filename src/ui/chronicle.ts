// The match chronicle: the story of a match told from its key events, for the end screen. UI
// only (CLAUDE.md rule 6): it reads events and state and keeps its own notes.
import type { MatchState, SimEvent } from '../sim/types';
import { TICK_RATE } from '../sim/types';
import { ERAS } from '../data/techs';
import { UNITS } from '../data/units';

export interface Entry { tick: number; text: string; owner: number }

/** the name the local player goes by in a skirmish */
const YOU = 'You';

export class Chronicle {
  entries: Entry[] = [];
  /** the unit that earned the most veteran stars (the first to get there wins a tie) */
  mvp: { kind: string; owner: number; stars: number; tick: number } | null = null;
  private firstCapture = false;
  private contracted = false;
  /** players whose first partisan drop is told already */
  private rebels = new Set<number>();
  private eras = new Set<number>();
  private clocks = new Set<number>();

  record(s: MatchState, ev: SimEvent[]) {
    const name = (p: number) => s.players[p]?.name ?? '?';
    // the local player is called "You": "You are", "your launch"
    const you = (p: number) => name(p) === YOU;
    const verb = (p: number, one: string, more: string) => (you(p) ? more : one);
    const whose = (p: number, start = false) => (you(p) ? (start ? 'Your' : 'your') : `${name(p)}'s`);
    const team = (t: number, start = true) => s.players.filter((p) => p.team === t).map((p) => (p.name === YOU && !start ? 'you' : p.name)).join(' & ');
    const many = (t: number) => s.players.filter((p) => p.team === t).length > 1 || s.players.some((p) => p.team === t && p.name === YOU);
    // kept in the order things happened (a clock is noted at the tick it started)
    const add = (text: string, owner: number, tick = s.tick) => {
      let i = this.entries.length;
      while (i > 0 && this.entries[i - 1].tick > tick) i--;
      this.entries.splice(i, 0, { tick, text, owner });
    };
    for (const e of ev) {
      switch (e.e) {
        case 'capture':
          if (!this.firstCapture) { this.firstCapture = true; add(`${name(e.owner)} ${verb(e.owner, 'takes', 'take')} the first city, ${s.cities[e.city].name}`, e.owner); }
          break;
        case 'era':
          if (!this.eras.has(e.era)) { this.eras.add(e.era); add(`${name(e.p)} ${verb(e.p, 'is', 'are')} first into the ${ERAS[e.era].name} era`, e.p); }
          break;
        case 'coalition':
          if (e.team >= 0) add(`The world turns on ${team(e.team, false)}`, s.players.find((p) => p.team === e.team)?.id ?? -1);
          break;
        case 'exile':
          add(`${whose(e.p, true)} HQ falls; the government flees to ${s.cities[e.city].name}`, e.p);
          break;
        case 'eliminated':
          add(s.players[e.p]?.surrendered ? `${name(e.p)} ${verb(e.p, 'surrenders', 'surrender')}` : `${name(e.p)} ${verb(e.p, 'is', 'are')} knocked out`, e.p);
          break;
        case 'insurge':
          if (!this.rebels.has(e.p)) { this.rebels.add(e.p); add(`${name(e.p)} ${verb(e.p, 'fights', 'fight')} on: partisans land at ${s.cities[e.city].name}`, e.p); }
          break;
        case 'contractDone':
          if (!this.contracted) { this.contracted = true; add(`${name(e.p)} ${verb(e.p, 'fills', 'fill')} the first city contract, at ${s.cities[e.city].name}`, e.p); }
          break;
        case 'refound':
          add(`${name(e.p)} ${verb(e.p, 'is', 'are')} back: the government is re-founded at ${s.cities[e.city].name}`, e.p);
          break;
        case 'launch':
          add(`${name(e.p)} ${verb(e.p, 'starts', 'start')} a rocket launch`, e.p);
          break;
        case 'scrub':
          add(`${name(e.by)} ${verb(e.by, 'scrubs', 'scrub')} ${whose(e.p)} launch`, e.by);
          break;
        case 'die': {
          if (e.kind === 'launch') add(`${whose(e.owner, true)} Launch Site is destroyed`, e.owner);
          break;
        }
        case 'aceDown':
          add(`${whose(e.p, true)} ace ${e.name} (${UNITS[e.kind]?.name ?? e.kind}) falls${e.by >= 0 ? ` to ${name(e.by) === YOU ? 'you' : name(e.by)}` : ''}`, e.p);
          break;
        case 'vet': {
          const u = s.ents[e.id];
          if (u && (!this.mvp || e.stars > this.mvp.stars)) this.mvp = { kind: u.kind, owner: u.owner, stars: e.stars, tick: s.tick };
          break;
        }
        case 'over':
          add(e.winners >= 0 ? `${team(e.winners)} win${many(e.winners) ? '' : 's'} by ${e.reason}` : 'A draw', s.players.find((p) => p.team === e.winners)?.id ?? -1);
          break;
      }
    }
    // a supremacy clock starting has no event: watch the state
    for (const [t, since] of Object.entries(s.supremacy)) {
      const k = +t;
      if (since >= 0 && !this.clocks.has(k)) { this.clocks.add(k); add(`${team(k)} hold${many(k) ? '' : 's'} most of the cities: the supremacy clock starts`, s.players.find((p) => p.team === k)?.id ?? -1, since); }
      else if (since < 0) this.clocks.delete(k);
    }
  }

  /** "MVP: Rust's Heavy Tank, 3 stars by 14:20" (or "Your Heavy Tank") */
  mvpText(s: MatchState): string {
    const m = this.mvp;
    if (!m) return '';
    const sec = Math.floor(m.tick / TICK_RATE);
    const owner = s.players[m.owner]?.name ?? '?';
    return `MVP: ${owner === YOU ? 'Your' : owner + "'s"} ${UNITS[m.kind]?.name ?? m.kind}, ${'\u0004'.repeat(m.stars)} by ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  }
}

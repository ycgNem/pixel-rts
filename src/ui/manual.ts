// The Field Manual: the first time one of the game's twists touches you (your first city, a
// coalition against you, a launch, exile...), a short card explains it. Each one shows once per
// browser (remembered in localStorage), one at a time. UI only: it reads events, never state
// changes.
import type { MatchState, SimEvent } from '../sim/types';
import type { UI } from './ui';
import { COL } from './ui';
import { LINE_H, wrapText } from './font';
import { ACES, CONTRACTS, INSURGENCY, LAST_STAND } from '../data/rules';

interface Tip { title: string; text: string }

export const TIPS: Record<string, Tip> = {
  city: { title: 'Cities', text: 'Cities pay cash, science, supply and Command Points, and grow over time. Their militia shoots intruders. At Town size you pick a specialty for each.' },
  resist: { title: 'Resistance', text: "A rival's city you take resists: partisans rise unless infantry of yours stay in it until the resistance ends." },
  homeFront: { title: 'Home Front', text: 'Land near your cities and HQ is your ground (dashed lines mark where it meets a rival\'s; the zoomed-out map tints it). Your units slowly heal on it, so fighting at home favours you.' },
  coalitionYou: { title: 'The world turns on you', text: 'You started a supremacy clock or a launch: every other team now deals you extra damage and gets Command Points. Hold on, or break off.' },
  coalition: { title: 'Coalition', text: 'A rival is close to winning (a supremacy clock or a launch): everyone else hits that team harder until it stops. Pile in!' },
  launch: { title: 'Rocket launch', text: 'A Launch Site counts down to a science win. Destroy it, or scrub it: infantry beside the site, with none of the owner\'s there, push the launch back a minute.' },
  exile: { title: 'Government in exile', text: 'Your HQ fell, but your biggest city governs now (the gold crown). Lose every city big enough and you are out.' },
  convoy: { title: 'Merchant convoys', text: 'Coastal cities send merchant ships to your Dock; each pays on arrival. Escort them: a sunk merchant pays its killer half its cargo.' },
  era: { title: 'Eras and doctrines', text: 'Research 4 techs of an era to enter the next. Each new era lets you pick one doctrine, a perk for the rest of the match.' },
  help: { title: 'Call for Help', text: 'An ally fired a flare: allied AIs send part of their army there. You can call for help too (Command Powers).' },
  storm: { title: 'Weather', text: 'Rain slows ground units; storms ground aircraft. Night cuts sight. Plan raids around it.' },
  insurgency: { title: 'Insurgency', text: `Knocked out, not beaten: a squad of ${INSURGENCY.squad} partisans is banked every ${INSURGENCY.every} s (up to ${INSURGENCY.maxCharges}). Select a neutral city (or one you once held) and press V to drop them all (your cash buys a Rocket Trooper per squad). Hold a Town or bigger for ${INSURGENCY.hold / 60} minutes to come back.` },
  insurgents: { title: 'Insurgents', text: `A knocked-out player holds a city with partisans. Unless someone takes it back within ${INSURGENCY.hold / 60} minutes, they are back in the match, governing from it.` },
  contract: { title: 'City contracts', text: `A city posted a job (top right, gold on the map; click the line to look). A tender: bring a ground unit there (or reach it with your borders) and bid (P); the top bid when the clock runs out buys the city. A hold: keep it ${CONTRACTS.hold} s for cash and CP. A bounty: take it from the leader.` },
  lastStand: { title: 'Last stand', text: `Every city is lost, but not the HQ: it trains Riflemen and Rocket Troopers now, a free Rifleman rallies to it every ${LAST_STAND.every} s (up to ${LAST_STAND.max}), and your supply limit is at least ${LAST_STAND.supply}. Hold the gates, retake a city.` },
  ace: { title: 'Wanted aces', text: `Each player's best three-star unit is their ace. Units within ${ACES.radius} tiles of it hit ${Math.round(ACES.aura * 100)}% harder; killing a rival's ace pays $${ACES.bountyCash} and ${ACES.bountyCp} CP. Hover one to see its name and reach.` },
  crate: { title: 'Supply crates', text: 'A supply crate fell somewhere on the map: the first unit to reach it gets cash, oil, science, Command Points or a veteran star.' },
};

const KEY = 'pixel-rts.manual';
/** a card closes by itself after this many seconds */
const SHOW_SECONDS = 25;
const W = 150;

function loadSeen(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(KEY) ?? '[]') as string[]); } catch { return new Set(); }
}

export class FieldManual {
  private seen = loadSeen();
  private queue: string[] = [];
  private shownAt = -1;

  /** Queue the tips these events earn the local player `me`. */
  onEvents(s: MatchState, me: number, events: SimEvent[]) {
    const myTeam = s.players[me]?.team;
    for (const e of events) {
      switch (e.e) {
        case 'capture':
          if (e.owner === me) this.add(e.prev >= 0 ? 'resist' : 'city');
          break;
        case 'resist':
          if (e.p === me) this.add('resist');
          break;
        case 'attacked':
          if (e.p === me) this.add('homeFront');
          break;
        case 'coalition':
          if (e.team >= 0) this.add(e.team === myTeam ? 'coalitionYou' : 'coalition');
          break;
        case 'launch':
        case 'scrub':
          this.add('launch');
          break;
        case 'exile':
          if (e.p === me) this.add('exile');
          break;
        case 'convoy':
          if (e.p === me || e.by === me) this.add('convoy');
          break;
        case 'era':
          if (e.p === me) this.add('era');
          break;
        case 'power':
          if (e.power === 'help' && e.p !== me && s.players[e.p]?.team === myTeam) this.add('help');
          break;
        case 'weather':
          if (e.kind !== 'clear') this.add('storm');
          break;
        case 'crateDrop':
          this.add('crate');
          break;
        case 'contract':
          this.add('contract');
          break;
        case 'ace':
          this.add('ace');
          break;
        case 'lastStand':
          if (e.p === me) this.add('lastStand');
          break;
        case 'eliminated':
          if (e.p === me && !s.over && s.setup.insurgency !== false && !s.players[me].comebacks) this.add('insurgency');
          break;
        case 'rising':
          if (e.p !== me) this.add('insurgents');
          break;
      }
    }
  }

  private add(id: string) {
    if (this.seen.has(id) || this.queue.includes(id)) return;
    this.queue.push(id);
  }

  private done(id: string) {
    this.seen.add(id);
    this.queue = this.queue.filter((q) => q !== id);
    this.shownAt = -1;
    try { localStorage.setItem(KEY, JSON.stringify([...this.seen])); } catch { /* no storage: this session only */ }
  }

  /**
   * Draw the current card at (x, y) if it fits in `room` pixels of height (else it waits, its
   * clock not started); returns the height used (0 if none). `now` is in seconds.
   */
  draw(ui: UI, x: number, y: number, now: number, room = Infinity): number {
    const id = this.queue[0];
    if (!id) return 0;
    const tip = TIPS[id];
    const lines = wrapText(tip.text, W - 10);
    const h = 26 + lines.length * LINE_H + 2;
    if (h > room) return 0;
    if (this.shownAt < 0) this.shownAt = now;
    if (now - this.shownAt > SHOW_SECONDS) { this.done(id); return 0; }
    ui.ctx.globalAlpha = 0.85;
    ui.rect(x, y, W, h, COL.shadow);
    ui.ctx.globalAlpha = 1;
    ui.rect(x, y, W, 1, COL.gold);
    ui.text('Field Manual', x + 4, y + 4, COL.dim);
    ui.text(tip.title, x + 4, y + 13, COL.gold);
    lines.forEach((l, i) => ui.text(l, x + 4, y + 24 + i * LINE_H, COL.text));
    if (ui.button(x + W - 30, y + 2, 28, 10, { label: 'OK', tip: 'Got it. (F1 has every rule.)' })) this.done(id);
    ui.block(x, y, W, h);
    return h + 4;
  }
}

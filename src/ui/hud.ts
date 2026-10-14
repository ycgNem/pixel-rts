// The in-match HUD: top bar, minimap, selection panel, command card, Command Powers, doctrine and
// city choices, messages, and the research / stats / help / menu / end-of-match windows.
// It reads state and sends commands (CLAUDE.md rule 6).
import { UNITS, ABILITIES } from '../data/units';
import { BUILDINGS } from '../data/buildings';
import { CITY_LEVELS, SPECS, type SpecId } from '../data/cities';
import { POWERS, COMMAND, type PowerId } from '../data/powers';
import { ERAS, TECHS, DOCTRINES } from '../data/techs';
import { ACES, COALITION, CONTRACTS, EXCHANGE, EXILE, INSURGENCY, LAST_STAND, PRODUCTION, RESISTANCE, SCRUB, VICTORY, type TradeId } from '../data/rules';
import { tradeBlocked, tradeQuote } from '../sim/exchange';
import { powerCost, supplyDropCash } from '../sim/powers';
import type { Building, City, MatchState, SimEvent, Unit } from '../sim/types';
import { TICK_RATE } from '../sim/types';
import { unitMaxHp, buildingMaxHp, unitCost, hqOf, allied, exileCapital, insurgent } from '../sim/world';
import { charges, chestTroops, dropBlocked, squadProgress } from '../sim/insurgency';
import { bidBlocked, jobReward, minBid, supplyFloor, topBid } from '../sim/contracts';
import type { ContractKind } from '../sim/types';
import { incomeOf, supplyCap, supplyUsed, techBlocked, techCost, TECH_BY_ID, cityIncome } from '../sim/economy';
import { captureRadius, cityTrains } from '../sim/cities';
import { darkness } from '../sim/weather';
import { score, supremacyFrom, supremacyShare, timeLimitOf } from '../sim/victory';
import { sprite } from '../render/art';
import { NEUTRAL_UI, viewColor, viewUi, viewer, setFriendFoe } from '../render/colors';
import type { Camera } from '../render/view';
import type { Minimap } from '../render/minimap';
import type { Fog } from '../render/fog';
import type { Session } from '../net/session';
import type { Input } from '../engine/input';
import { keyLabel, ACTIONS, ACTION_LABELS } from '../engine/input';
import type { GameLoop } from '../engine/loop';
import type { Controller } from './control';
import type { Tutorial } from './tutorial';
import { Chronicle } from './chronicle';
import { UI, COL } from './ui';
import { audio } from '../engine/audio';
import { ICON, textWidth, ellipsize, wrapText, LINE_H } from './font';
import { matchupText, plural, WEAPON_NAMES } from './counters';
import { FieldManual } from './manual';
import { FieldGuide } from './guide';
import { aceName, isAce } from '../sim/aces';

export interface HudDeps {
  session: Session;
  ctl: Controller;
  cam: Camera;
  minimap: Minimap;
  fog: Fog;
  input: Input;
  ui: UI;
  loop: GameLoop;
  /** leave the match */
  quit: () => void;
  /** save the match (the host only); false when it couldn't */
  save?: () => boolean;
  /** Boot Camp steps, in the tutorial match */
  tutorial?: Tutorial;
  /** play again from the end screen (offline only): the same map, or a new seed */
  rematch?: (sameMap: boolean) => void;
}

type Panel = 'none' | 'research' | 'help' | 'stats' | 'menu' | 'guide';
interface Msg { text: string; color: string; t: number; n: number }
export interface Ping { x: number; y: number; t: number; color: string }

const BTN_W = 34, BTN_H = 24, GAP = 2;
const CARD_W = BTN_W * 4 + GAP * 3 + 8;
const CARD_H = BTN_H * 3 + GAP * 2 + 8;
const MM = 86;
/** height of a Command Power button in the strip above the minimap */
const POWER_H = 13;
const TOP_H = 14;
/** message feed: lines shown and how long each lasts (ms) */
const MSG_LINES = 3, MSG_MS = 6000;
/** the getting-started checklist goes away after this many seconds even if unfinished */
const OBJECTIVES_UNTIL = 600;
/** what one click of a gift button sends an ally */
const GIFT = { cash: 250, oil: 50 };

const fmt = (n: number) => (Math.abs(n) >= 10000 ? (n / 1000).toFixed(1) + 'k' : String(Math.floor(n)));
const clock = (ticks: number) => {
  const t = Math.floor(ticks / TICK_RATE);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};
const color = (s: MatchState, p: number) => viewUi(s, p);

const SPEC_KEYS: Record<SpecId, [string, string]> = {
  industry: ['KeyI', 'Indus'], academy: ['KeyU', 'Univ'], fortress: ['KeyF', 'Fort'], market: ['KeyM', 'Mrkt'], port: ['KeyH', 'Port'],
};
const BUILD_ORDER = ['mine', 'derrick', 'barracks', 'factory', 'lab', 'turret', 'airfield', 'dock', 'aagun', 'coastal', 'radar', 'launch'];
const ERA_NUMERAL = ['I', 'II', 'III', 'IV'];
const POWER_ORDER: PowerId[] = ['recon', 'supplyDrop', 'repair', 'rally', 'strike', 'paradrop', 'help'];

export class Hud {
  msgs: Msg[] = [];
  /** the victory tracker's left edge and bottom this frame (the message feed keeps clear of it) */
  private trackerBox: [number, number] = [0, 0];
  pings: Ping[] = [];
  alertAt: [number, number] | null = null;
  /** teams whose supremacy clock we already announced */
  private supSeen = new Set<number>();
  private objectivesDone = false;
  /** the match's story so far, for the end screen */
  private chronicle = new Chronicle();
  private manual = new FieldManual();
  private chatOpen = false;
  private chatDraft = '';
  panel: Panel = 'none';
  /** the Field Guide, opened from the menu */
  private guide = new FieldGuide();
  powerCard = false;
  buildPage = false;
  hideEnd = false;
  private endSeen = false;
  private sellArmed = 0;
  private surrenderArmed = 0;
  private mmDrag = false;

  constructor(private d: HudDeps) {}

  get s(): MatchState {
    return this.d.session.state;
  }
  get me(): number {
    return this.d.session.me;
  }
  private get ui(): UI {
    return this.d.ui;
  }

  say(text: string, c = COL.text) {
    // the same message again just refreshes it and counts up
    const same = this.msgs.find((m) => m.text === text);
    if (same) { same.t = performance.now(); same.n++; same.color = c; return; }
    this.msgs.push({ text, color: c, t: performance.now(), n: 1 });
    if (this.msgs.length > MSG_LINES) this.msgs.shift();
  }

  ping(x: number, y: number, c: string) {
    this.pings.push({ x, y, t: performance.now(), color: c });
    if (this.pings.length > 12) this.pings.shift();
  }

  /** Turn sim events into messages and minimap pings. */
  onEvents(ev: SimEvent[]) {
    const s = this.s, me = this.me, myTeam = s.players[me].team;
    this.chronicle.record(s, ev);
    // (Boot Camp teaches in its own way)
    if (!this.d.tutorial?.active) this.manual.onEvents(s, me, ev);
    for (const e of ev) {
      switch (e.e) {
        case 'reject':
          if (e.p === me) this.say(cap(e.why), COL.red);
          break;
        case 'attacked':
          if (e.p === me) {
            this.say('You are under attack!', COL.red);
            this.ping(e.x, e.y, COL.red);
            this.alertAt = [e.x, e.y];
          }
          break;
        case 'capture': {
          const c = s.cities[e.city];
          if (e.owner === me) { this.say(`Captured ${c.name}`, COL.green); this.alertAt = [c.x, c.y]; }
          else if (e.prev === me) { this.say(`${c.name} was captured by ${s.players[e.owner].name}`, COL.red); this.ping(c.x, c.y, COL.red); this.alertAt = [c.x, c.y]; }
          else if (s.players[e.owner].team === myTeam) this.say(`${s.players[e.owner].name} captured ${c.name}`, COL.text);
          break;
        }
        case 'grow': {
          const c = s.cities[e.city];
          if (e.owner === me) this.say(`${c.name} grew into a ${CITY_LEVELS[e.level - 1].name}${c.specPending ? ' - choose its specialty' : ''}`, COL.gold);
          break;
        }
        case 'researched':
          if (e.p === me) this.say(`Research complete: ${TECH_BY_ID.get(e.tech)?.name}`, COL.blue);
          else if (s.players[e.p].team === myTeam) this.say(`${s.players[e.p].name} researched ${TECH_BY_ID.get(e.tech)?.name} (cheaper for you)`, COL.dim);
          break;
        case 'era':
          if (e.p === me) this.say(`Entered the ${ERAS[e.era].name} era! Choose a doctrine.`, COL.gold);
          else this.say(`${s.players[e.p].name} entered the ${ERAS[e.era].name} era`, COL.dim);
          break;
        case 'built':
          if (e.owner === me) this.say(`${BUILDINGS[e.kind].name} complete`);
          break;
        case 'lastStand':
          if (e.p === me) this.say(`Last stand! Your HQ trains infantry and rallies a defender every ${LAST_STAND.every}s`, COL.gold);
          else this.say(`${s.players[e.p].name} makes a last stand at their HQ`, COL.dim);
          break;
        case 'eliminated':
          if (e.p === me && !s.over && insurgent(s, s.players[me])) this.say('You are knocked out, but not beaten: select a city and drop partisans to fight on', COL.gold);
          else if (s.players[e.p].surrendered) this.say(e.p === me ? 'You surrendered' : `${s.players[e.p].name} surrenders`, e.p === me ? COL.red : COL.gold);
          else this.say(e.p === me ? 'You have been knocked out' : `${s.players[e.p].name} is knocked out${s.players[e.p].comebacks ? ' for good' : ''}`, e.p === me ? COL.red : COL.gold);
          break;
        case 'contract': {
          const c = s.cities[e.city];
          // a bounty on your own city is a warning, not a job
          if (e.kind === 'liberate' && s.contract?.team === s.players[me].team) this.say(`There is a price on your ${c.name}: rivals are paid to take it`, COL.red);
          else this.say(this.contractText(e.city, e.kind, true), COL.gold);
          this.ping(c.x, c.y, COL.gold);
          this.alertAt = [c.x, c.y];
          break;
        }
        case 'bid': {
          const c = s.cities[e.city];
          const outbid = s.contract?.bids.some((b) => b.p === me) && e.p !== me;
          this.say(`${e.p === me ? 'You bid' : s.players[e.p].name + ' bids'} $${e.cash} for ${c.name}`, outbid ? COL.red : e.p === me ? COL.green : COL.gold);
          break;
        }
        case 'contractDone': {
          const c = s.cities[e.city];
          const who = e.p === me ? 'You' : s.players[e.p].name;
          if (e.kind === 'supply') this.say(`${who} won the tender for ${c.name} ($${e.cash}): it joins ${e.p === me ? 'you' : 'them'}`, e.p === me ? COL.green : COL.dim);
          else if (e.kind === 'liberate') this.say(`${who} liberated ${c.name}: +$${e.cash} and ${e.cp} CP`, e.p === me ? COL.green : COL.gold);
          else this.say(`${who} held ${c.name}: +$${e.cash} and ${e.cp} CP`, e.p === me ? COL.green : COL.dim);
          break;
        }
        case 'contractEnd':
          this.say(`${s.cities[e.city].name}'s contract lapses`, COL.dim);
          break;
        case 'insurge': {
          const c = s.cities[e.city];
          if (e.p === me) this.say(`${e.n} partisans land at ${c.name}, hidden for ${INSURGENCY.hidden}s (faded) unless they fire`, COL.green);
          else if (c.owner >= 0 && allied(s, c.owner, me)) {
            this.say(`${s.players[e.p].name}'s ${e.n} partisans land at ${c.name}!`, COL.red);
            this.ping(c.x, c.y, COL.red);
            this.alertAt = [c.x, c.y];
          } else this.say(`${s.players[e.p].name}'s partisans land at ${c.name}`, COL.dim);
          break;
        }
        case 'rising': {
          const c = s.cities[e.city];
          if (e.p === me) this.say(`You hold ${c.name}: keep it ${clock(e.at - s.tick)} to re-found your government`, COL.gold);
          else this.say(`${s.players[e.p].name}'s insurgents hold ${c.name}: they return in ${clock(e.at - s.tick)} unless driven out`, COL.gold);
          this.ping(c.x, c.y, COL.gold);
          break;
        }
        case 'refound': {
          const c = s.cities[e.city];
          if (e.p === me) { this.say(`Your government is re-founded at ${c.name}! You are back in the match`, COL.green); this.alertAt = [c.x, c.y]; }
          else this.say(`${s.players[e.p].name} is back in the match, governing from ${c.name}`, allied(s, e.p, me) ? COL.green : COL.red);
          this.ping(c.x, c.y, COL.gold);
          break;
        }
        case 'coalition': {
          if (e.team < 0) { this.say('The coalition breaks up', COL.dim); break; }
          const t = this.teams().find((k) => k.team === e.team);
          if (e.team === myTeam) { this.say(`The world turns on you! Everyone else gets +${COALITION.cp} CP and hits you ${Math.round((COALITION.damageVs - 1) * 100)}% harder`, COL.red); audio.sfx('siren'); }
          else this.say(`Coalition against ${t?.name ?? 'the leader'}: +${COALITION.cp} CP, and +${Math.round((COALITION.damageVs - 1) * 100)}% damage against them`, COL.gold);
          break;
        }
        case 'resist': {
          const c = s.cities[e.city];
          if (e.p === me) this.say(`Partisans rise in ${c.name} to fight for you!`, COL.green);
          else if (c.owner === me) {
            this.say(`Partisans rise in ${c.name}! Keep ${RESISTANCE.garrison} infantry there to hold it down`, COL.red);
            this.ping(c.x, c.y, COL.red);
            this.alertAt = [c.x, c.y];
          }
          break;
        }
        case 'exile': {
          const c = s.cities[e.city];
          if (e.p === me) {
            this.say(`Your government fled to ${c.name}! Hold it: in ${EXILE.delay}s it trains builders.`, COL.red);
            this.alertAt = [c.x, c.y];
          } else this.say(`${s.players[e.p].name}'s government fled to ${c.name} - capture it to finish them`, s.players[e.p].team === myTeam ? COL.red : COL.gold);
          this.ping(c.x, c.y, COL.gold);
          break;
        }
        case 'crateDrop':
          this.say('A supply crate parachuted in', COL.gold);
          this.ping(e.x, e.y, COL.gold);
          break;
        case 'crate':
          if (e.p === me) this.say(`Crate: ${e.reward === 'veteran' ? 'veteran training!' : `+${e.amount} ${e.reward}`}`, COL.gold);
          break;
        case 'weather':
          this.say(e.kind === 'storm' ? 'A storm rolls in: aircraft grounded, ground units slowed' : e.kind === 'rain' ? 'Rain: ground units slowed' : 'The skies clear', COL.blue);
          break;
        case 'convoy':
          // arrivals just pay (a floating "+$" at the dock); a sinking is news for both sides
          if (e.by >= 0 && e.p === me) { this.say(`${s.players[e.by].name} sank one of your merchant ships`, COL.red); this.ping(e.x, e.y, COL.red); }
          else if (e.by === me) this.say(`Sank a merchant ship: +$${e.cash} and ${e.oil} oil`, COL.gold);
          break;
        case 'scrub':
          this.say(e.p === me ? `Saboteurs at your Launch Site! The launch slips ${SCRUB.delay} s: clear them out with infantry.`
            : `${s.players[e.by].name}'s infantry scrub the launch: ${SCRUB.delay} s more!`, e.p === me ? COL.red : COL.green);
          this.ping(e.x, e.y, COL.gold);
          break;
        case 'launch':
          this.say(`${s.players[e.p].name} began a rocket launch! Destroy the Launch Site, or hold infantry beside it to scrub it!`, e.p === me ? COL.gold : COL.red);
          this.ping(e.x, e.y, COL.gold);
          if (e.p !== me) this.alertAt = [e.x, e.y];
          break;
        case 'power':
          if (e.p !== me && e.power === 'strike') this.ping(e.x, e.y, COL.red);
          if (e.power === 'help' && e.p !== me && s.players[e.p].team === myTeam) {
            this.say(`${s.players[e.p].name} calls for help!`, COL.gold);
            this.ping(e.x, e.y, COL.gold);
            this.alertAt = [e.x, e.y];
          }
          break;
        case 'aceDown': {
          const whose = e.p === me ? 'Your' : s.players[e.p].name + "'s";
          const by = e.by === me ? ': you collect the bounty' : e.by >= 0 ? `: ${s.players[e.by].name} collects the bounty` : '';
          this.say(`${whose} ace ${e.name} is down${by}${e.by === me ? ` (+$${e.cash}, +${e.cp} CP)` : ''}!`, e.p === me ? COL.red : e.by === me ? COL.green : COL.gold);
          break;
        }
        case 'ace': {
          const what = UNITS[e.kind]?.name ?? 'unit';
          if (e.p === me) this.say(`Your ${what} is your ace: ${e.name}! Units near it hit ${Math.round(ACES.aura * 100)}% harder, and there is a price on its head`, COL.gold);
          else if (allied(s, e.p, me)) this.say(`${s.players[e.p].name}'s ${what} is their ace: ${e.name}`, color(s, e.p));
          else this.say(`${s.players[e.p].name}'s ace: ${e.name} (${what}). Kill it for $${ACES.bountyCash} and ${ACES.bountyCp} CP`, color(s, e.p));
          break;
        }
      }
    }
  }

  /** Draw the HUD and handle its clicks and hotkeys. Call before the controller's world input. */
  draw(now: number) {
    const { ui, input: inp, ctl } = this.d;
    const s = this.s;

    // Esc peels back one layer at a time
    if (inp.wasPressed('menu')) {
      inp.consume('menu');
      if (ctl.mode.m !== 'normal') ctl.mode = { m: 'normal' };
      else if (this.buildPage) this.buildPage = false;
      else if (this.powerCard) this.powerCard = false;
      else if (this.panel !== 'none') this.panel = 'none';
      else this.panel = 'menu';
    }
    if (inp.wasPressed('research')) this.toggle('research');
    if (inp.wasPressed('help')) this.toggle('help');
    if (inp.wasPressed('stats')) this.toggle('stats');
    if (inp.wasPressed('powers')) this.powerCard = !this.powerCard;
    if (inp.wasPressed('alert') && this.alertAt) this.d.cam.centerOn(this.alertAt[0], this.alertAt[1]);
    if (inp.wasPressed('home')) { const hq = hqOf(s, this.me); if (hq) this.d.cam.centerOn(hq.x, hq.y); }
    if (inp.wasPressed('pause') && this.d.session.host) this.togglePause();
    if (!ctl.myUnits().some((u) => UNITS[u.kind].builds)) this.buildPage = false;

    // the match just ended: close whatever was open, so the end screen stands alone
    if (s.over && !this.endSeen) {
      this.endSeen = true;
      this.panel = 'none';
      this.powerCard = false;
      this.buildPage = false;
    }
    this.topBar(now);
    // the end screen tells the outcome; the tracker would only crowd it
    if (!s.over || this.hideEnd) this.victoryTracker(now);
    this.minimapBox(now);
    this.selectionPanel();
    this.commandCard();
    if (s.players[this.me].alive) this.powersStrip();
    this.choices();
    this.chatBox();
    this.messages(now);
    if (ctl.mode.m === 'place' && ctl.placeWhy) {
      ui.textCenter(cap(ctl.placeWhy), ui.mx, ui.my + 14, COL.red);
    }
    if (this.d.loop.paused || this.d.session.paused) ui.textCenter('PAUSED', ui.w / 2, TOP_H + 30, COL.gold);

    if (this.panel === 'research') this.research();
    else if (this.panel === 'help') this.help();
    else if (this.panel === 'stats') this.stats(false);
    else if (this.panel === 'menu') this.menu();
    else if (this.panel === 'guide' && !this.guide.draw(this.ui, now / 1000)) this.panel = 'none';
    if (s.over && !this.hideEnd) this.endScreen();
  }

  /** Single player pauses the loop; an online host pauses the match for everyone. */
  private togglePause() {
    const sess = this.d.session;
    if (sess.status() === '') this.d.loop.paused = !this.d.loop.paused;
    else sess.setPaused(!sess.paused);
  }

  private toggle(p: Panel) {
    this.panel = this.panel === p ? 'none' : p;
  }

  // ------------------------------------------------------------------ top bar

  private topBar(now: number) {
    const ui = this.ui, s = this.s, p = s.players[this.me];
    ui.rect(0, 0, ui.w, TOP_H, COL.shadow);
    ui.rect(0, TOP_H - 1, ui.w, 1, COL.edge);
    ui.block(0, 0, ui.w, TOP_H);
    const inc = incomeOf(s, this.me);
    let x = 4;
    const y = 3;
    const item = (icon: string, iconCol: string, main: string, sub: string, tip: string, mainCol = COL.white) => {
      const x0 = x;
      x += ui.text(icon, x, y, iconCol) + 2;
      x += ui.text(main, x, y, mainCol);
      if (sub) x += 2 + ui.text(sub, x + 2, y, COL.dim);
      if (ui.hover(x0, 0, x - x0, TOP_H)) ui.setTip(tip, (x0 + x) / 2, TOP_H + 40);
      x += 10;
    };
    item(ICON.cash, COL.gold, '$' + fmt(p.cash), `+${Math.round(inc.cash * 60)}/m`, 'Cash\nFrom mines, cities and your HQ. Pays for everything.');
    item(ICON.oil, '#b0a7b8', fmt(p.oil), `+${Math.round(inc.oil * 60)}/m`, 'Oil\nFrom derricks. Vehicles, aircraft and ships need it.');
    if (p.alive) {
      const r = p.research;
      const sci = r.cur ? `${TECH_BY_ID.get(r.cur)?.name} ${Math.floor((r.prog / techCost(s, p, r.cur)) * 100)}%` : 'idle';
      const idleBlink = !r.cur && Math.floor(now / 500) % 2 === 0;
      item(ICON.science, COL.blue, sci, r.cur ? '' : '(F2)', `Science +${(inc.science * 60).toFixed(0)}/m\nResearch techs to unlock units and bonuses (F2).`, r.cur ? COL.white : idleBlink ? COL.gold : COL.dim);
      const used = supplyUsed(s, this.me), capN = supplyCap(s, this.me);
      item(ICON.supply, COL.green, `${used}/${capN}`, '', 'Supply\nUnits need supply. Your HQ gives 20; each city gives more as it grows.', used >= capN ? COL.red : COL.white);
    } else if (insurgent(s, p) && !s.over) {
      // knocked out: the partisans still fighting, and the next drop
      const alive = Object.values(s.ents).filter((e) => e.t === 'u' && e.owner === this.me).length;
      item(ICON.supply, COL.green, `${alive} partisans`, '', 'Your insurgents still in the field.');
      const n = charges(s, p);
      item(ICON.cp, COL.gold, n ? `${n} squad${n > 1 ? 's' : ''} ready` : `drop in ${clock(p.insurgeAt - s.tick)}`, '', `Insurgency: select a neutral city (or one you once held) and press D.\nA squad is banked every ${INSURGENCY.every}s, up to ${INSURGENCY.maxCharges}; a drop sends them all.`, n ? COL.gold : COL.light);
    }
    item(ICON.cp, COL.gold, `${p.cp.toFixed(1)}`, `/${COMMAND.max}`, `Command Points +${(inc.cp * 60).toFixed(1)}/m\nSpend them on Command Powers (Tab). Your HQ and cities make them.`);

    // right side: buttons, then era, clock, time of day, weather
    let rx = ui.w - 2;
    const btn = (label: string, key: string, tip: string, active: boolean, onClick: () => void) => {
      const w = textWidth(label) + 10;
      rx -= w;
      if (ui.button(rx, 1, w, TOP_H - 2, { label, tip: `${tip} (${keyLabel(key)})`, active })) onClick();
      rx -= 2;
    };
    btn('Menu', 'Escape', 'Menu', this.panel === 'menu', () => this.toggle('menu'));
    btn('?', 'F1', 'How to play', this.panel === 'help', () => this.toggle('help'));
    btn('Stats', 'F3', 'Match stats', this.panel === 'stats', () => this.toggle('stats'));
    btn('Research', 'F2', 'Tech tree', this.panel === 'research', () => this.toggle('research'));
    const idle = Object.values(s.ents).filter((e) => e.t === 'u' && e.owner === this.me && UNITS[e.kind].builds && !e.order && !e.inside).length;
    if (idle) btn(`Idle ${idle}`, 'Period', 'Select an idle Builder', false, () => { this.d.input.pressed.add('Period'); });
    const dark = darkness(s);
    const tod = !s.setup.weather ? '' : dark > 0.6 ? 'Night' : dark > 0 ? 'Dusk' : 'Day';
    const wx = s.weather.storm > 0 ? 'Storm' : s.weather.rain > 0.2 ? 'Rain' : '';
    const right = [ERAS[p.era].name, clock(s.tick), tod, wx, this.d.session.status()].filter(Boolean).join('  ');
    ui.textRight(right, rx - 4, y, COL.light);
    const limit = timeLimitOf(s.setup);
    if (limit > 0) {
      const left = Math.max(0, limit * TICK_RATE - s.tick);
      ui.textRight(`Ends in ${clock(left)}`, rx - 4, TOP_H + 3, COL.dim);
    }
  }

  // ------------------------------------------------------------------ victory tracker

  /** Teams with someone alive, my team first. */
  private teams(): { team: number; color: string; mine: boolean; name: string }[] {
    const s = this.s, myTeam = s.players[this.me].team;
    const out = new Map<number, { team: number; color: string; mine: boolean; name: string }>();
    for (const p of s.players) {
      if (!p.alive || out.has(p.team)) continue;
      const mates = s.players.filter((o) => o.team === p.team && o.alive);
      out.set(p.team, { team: p.team, color: color(s, p.id), mine: p.team === myTeam, name: p.team === myTeam ? (mates.length > 1 ? 'Your team' : 'You') : mates.length > 1 ? `${p.name}'s team` : p.name });
    }
    return [...out.values()].sort((a, b) => Number(b.mine) - Number(a.mine) || a.team - b.team);
  }

  /** Under the top bar: who holds the cities, and any win that's counting down. */
  private victoryTracker(now: number) {
    const ui = this.ui, s = this.s, v = s.setup.victory;
    const teams = this.teams();
    /** `at`: a map spot a click on the line jumps the camera to */
    const lines: { text: string; color: string; squares?: { color: string; n: number }[]; at?: [number, number] }[] = [];
    // cities per team
    const held = (team: number) => s.cities.filter((c) => c.owner >= 0 && s.players[c.owner].team === team).length;
    const neutral = s.cities.filter((c) => c.owner < 0).length;
    lines.push({ text: 'Cities', color: COL.light, squares: [...teams.map((t) => ({ color: t.color, n: held(t.team) })), ...(neutral ? [{ color: NEUTRAL_UI, n: neutral }] : [])] });
    // supremacy
    if (v.supremacy && s.cities.length) {
      const need = Math.ceil(s.cities.length * supremacyShare(s));
      const from = supremacyFrom(s) * TICK_RATE;
      const racing = teams.find((t) => (s.supremacy[t.team] ?? -1) >= 0);
      if (racing) {
        const left = s.supremacy[racing.team] + VICTORY.supremacyTime * TICK_RATE - s.tick;
        const blink = left < 60 * TICK_RATE && Math.floor(now / 400) % 2 === 0;
        lines.push({ text: `${racing.name} win${racing.name === 'You' ? '' : 's'} by supremacy in ${clock(Math.max(0, left))}`, color: racing.mine ? COL.green : blink ? COL.white : COL.red });
      } else if (s.tick < from) lines.push({ text: `Supremacy from ${clock(from)}: hold ${need} cities`, color: COL.dim });
      else lines.push({ text: `Supremacy: hold ${need} of ${s.cities.length} for ${VICTORY.supremacyTime / 60} min`, color: COL.dim });
      // alert when someone starts the clock
      for (const t of teams) {
        const on = (s.supremacy[t.team] ?? -1) >= 0;
        if (on && !this.supSeen.has(t.team)) {
          this.supSeen.add(t.team);
          if (t.mine) this.say(`You hold ${Math.round(supremacyShare(s) * 100)}% of the cities: keep them for ${VICTORY.supremacyTime / 60} min to win`, COL.green);
          else { this.say(`${t.name} holds ${Math.round(supremacyShare(s) * 100)}% of the cities! Take some back within ${VICTORY.supremacyTime / 60} min`, COL.red); audio.sfx('siren'); }
        } else if (!on) this.supSeen.delete(t.team);
      }
    }
    // the score race, near the end of a time limit
    const limit = timeLimitOf(s.setup) * TICK_RATE;
    if (limit > 0 && limit - s.tick <= VICTORY.scoreRace * TICK_RATE && teams.length > 1) {
      const ranked = [...teams].sort((a, b) => score(s, b.team) - score(s, a.team) || a.team - b.team);
      const lead = ranked[0], mine = teams.find((t) => t.mine);
      const text = lead.mine ? `On time you win: score ${score(s, lead.team)} to ${score(s, ranked[1].team)}`
        : `On time ${lead.name} win${lead.name === 'You' ? '' : 's'}: score ${score(s, lead.team)}${mine ? ` (yours ${score(s, mine.team)})` : ''}`;
      lines.push({ text, color: lead.mine ? COL.green : COL.gold });
    }
    // the rocket
    if (s.launch) {
      const site = s.ents[s.launch.id];
      if (site) {
        const mine = s.players[site.owner].team === s.players[this.me].team;
        lines.push({ text: `${mine ? 'Your' : s.players[site.owner].name + "'s"} rocket launches in ${clock(Math.max(0, s.launch.done - s.tick))}`, color: mine ? COL.green : COL.red });
      }
    }
    // the coalition
    if (s.coalition >= 0) {
      const t = teams.find((k) => k.team === s.coalition);
      if (t) lines.push({ text: t.mine ? 'The world turns on you' : `The world turns on ${t.name}`, color: t.mine ? COL.red : COL.gold });
    }
    // the open city contract
    if (s.contract) {
      const k = s.contract, c = s.cities[k.city];
      const left = clock(Math.max(0, k.until - s.tick));
      const at: [number, number] = [c.x + 0.5, c.y + 0.5];
      const top = topBid(k);
      if (k.kind === 'supply' && top) {
        const mine = top.p === this.me;
        lines.push({ text: `Tender: ${mine ? 'your' : s.players[top.p].name + "'s"} $${top.cash} wins ${c.name} in ${clock(Math.max(0, k.closes - s.tick))}`, color: mine ? COL.green : COL.gold, at });
      } else if (k.kind === 'supply') lines.push({ text: `Tender: ${c.name} takes bids (${left})`, color: COL.gold, at });
      else if (k.kind === 'liberate') {
        const theirs = k.team === s.players[this.me].team;
        lines.push({ text: theirs ? `Bounty on your ${c.name} (${left})` : `Bounty: take ${c.name} (${left})`, color: theirs ? COL.red : COL.gold, at });
      } else if (k.holder >= 0 && s.cities[k.city].owner === k.holder) {
        const mine = k.holder === this.me;
        lines.push({ text: `Contract: ${mine ? 'you hold' : s.players[k.holder].name + ' holds'} ${c.name}, ${clock(Math.max(0, k.since + CONTRACTS.hold * TICK_RATE - s.tick))} to go`, color: mine ? COL.green : COL.gold, at });
      } else lines.push({ text: `Contract: hold ${c.name} (${left})`, color: COL.gold, at });
    }
    // a government in exile
    const p = s.players[this.me];
    if (p.capital >= 0 && s.cities[p.capital]) {
      const c = s.cities[p.capital];
      lines.push({ text: s.tick < p.capitalAt ? `Exile: ${c.name} is your capital in ${clock(p.capitalAt - s.tick)}` : `Government in exile at ${c.name}`, color: COL.gold });
    }
    // draw: a plate under the top bar, right side
    const w = Math.max(...lines.map((l) => textWidth(l.text) + (l.squares ? l.squares.reduce((a, q) => a + 10 + textWidth(String(q.n)), 4) : 0))) + 8;
    const x = ui.w - w - 2, y = TOP_H + (timeLimitOf(s.setup) > 0 ? 11 : 1);
    const h = lines.length * 9 + 4;
    this.trackerBox = [x, y + h];
    ui.ctx.globalAlpha = 0.75;
    ui.rect(x, y, w, h, COL.shadow);
    ui.ctx.globalAlpha = 1;
    lines.forEach((l, i) => {
      let tx = x + 4;
      const ty = y + 3 + i * 9;
      tx += ui.text(l.text, tx, ty, l.color);
      // a line about a place: click it to look there
      if (l.at && ui.hover(x, ty - 1, w, 9)) {
        ui.rect(x + 4, ty + 7, tx - x - 4, 1, l.color);
        if (this.d.input.mouse.pressed[0]) { this.d.input.consumeMouse(0); this.d.cam.centerOn(l.at[0], l.at[1]); }
      }
      for (const q of l.squares ?? []) {
        tx += 5;
        ui.rect(tx, ty + 1, 5, 5, COL.shadow);
        ui.rect(tx + 1, ty + 2, 3, 3, q.color);
        tx += 7;
        tx += ui.text(String(q.n), tx, ty, COL.white);
      }
    });
    if (ui.hover(x, y, w, h)) {
      const how = [
        v.conquest ? 'Conquest: destroy every enemy HQ, then their capitals in exile.' : '',
        v.supremacy ? `Supremacy: hold ${Math.round(supremacyShare(s) * 100)}% of all cities for ${VICTORY.supremacyTime / 60} minutes (from ${supremacyFrom(s) / 60}:00).` : '',
        v.science ? 'Science: research the Space Program, build a Launch Site and keep it standing through the countdown.' : '',
        `Coalition: whoever starts a countdown faces everyone else, who get +${COALITION.cp} CP and +${Math.round((COALITION.damageVs - 1) * 100)}% damage against them.`,
      ];
      ui.setTip(['How to win', ...how.filter(Boolean)].join('\n'), x + w / 2, y + h + 50);
    }
    ui.block(x, y, w, h);
  }

  // ------------------------------------------------------------------ minimap

  private minimapBox(now: number) {
    const { ui, input: inp, cam, minimap, ctl } = this.d;
    const x = 2, y = ui.h - MM - 2;
    ui.panel(x, y, MM, MM);
    const k = ui.s;
    minimap.update(this.s, this.d.fog, this.s.players[this.me].team, now);
    minimap.draw(ui.ctx, (x + 3) * k, (y + 3) * k, (MM - 6) * k, cam, this.pings.map((p) => ({ ...p, t: p.t })), now);
    const pick = minimap.pick(inp.mouse.x, inp.mouse.y, (x + 3) * k, (y + 3) * k, (MM - 6) * k);
    // jump on the press itself: a quick tap can be released before the next frame
    if (inp.mouse.pressed[0] && pick) { this.mmDrag = true; inp.consumeMouse(0); cam.centerOn(pick[0], pick[1]); }
    if (!inp.mouse.down[0]) this.mmDrag = false;
    if (this.mmDrag) {
      const p2 = minimap.pick(Math.max((x + 3) * k, Math.min((x + MM - 3) * k - 1, inp.mouse.x)), Math.max((y + 3) * k, Math.min((y + MM - 3) * k - 1, inp.mouse.y)), (x + 3) * k, (y + 3) * k, (MM - 6) * k);
      if (p2) cam.centerOn(p2[0], p2[1]);
    }
    if (inp.mouse.pressed[2] && pick) {
      inp.consumeMouse(2);
      const ids = ctl.myUnits().map((u) => u.id);
      if (ids.length) {
        ctl.send({ t: 'move', p: this.me, ids, x: pick[0], y: pick[1], q: inp.shift });
        this.ping(pick[0], pick[1], COL.green);
      }
    }
  }

  // ------------------------------------------------------------------ selection panel

  private selectionPanel() {
    const ui = this.ui, s = this.s, ctl = this.d.ctl;
    const x = MM + 6, w = ui.w - x - CARD_W - 4, h = 66, y = ui.h - h - 2;
    const ents = [...ctl.selected].map((id) => s.ents[id]).filter(Boolean);
    const city = ctl.selCity >= 0 ? s.cities[ctl.selCity] : null;
    if (!ents.length && !city) return;
    ui.panel(x, y, w, h);
    if (city && !ents.length) return this.cityInfo(city, x + 4, y + 4, w - 8);
    if (ents.length === 1) {
      const e = ents[0];
      if (e.t === 'u') this.unitInfo(e, x + 4, y + 4, w - 8);
      else this.buildingInfo(e, x + 4, y + 4, w - 8);
      return;
    }
    // many: a grid of icons
    const cell = 18, cols = Math.floor((w - 8) / cell), rows = 3;
    const sorted = ents.sort((a, b) => (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : a.id - b.id));
    sorted.slice(0, cols * rows).forEach((e, i) => {
      const cx = x + 4 + (i % cols) * cell, cy = y + 4 + Math.floor(i / cols) * cell;
      const hov = ui.hover(cx, cy, cell - 1, cell - 1);
      ui.rect(cx, cy, cell - 1, cell - 1, hov ? COL.panel2 : COL.shadow);
      const sp = e.t === 'u' ? sprite(`u:${e.kind}:2`, viewColor(s, e.owner)) : sprite(`b:${e.kind}`, viewColor(s, e.owner));
      ui.icon(sp, cx + cell / 2 - 0.5, cy + cell / 2 - 1, cell - 3);
      const max = e.t === 'u' ? unitMaxHp(s, e) : buildingMaxHp(s, e);
      ui.bar(cx + 1, cy + cell - 3, cell - 3, 1, e.hp / max, e.hp / max > 0.6 ? COL.green : e.hp / max > 0.3 ? COL.gold : COL.red);
      if (e.t === 'u' && e.vet) ui.text(ICON.star.repeat(1), cx + 1, cy + 1, COL.gold, null);
      if (hov) {
        ui.setTip(`${e.t === 'u' ? UNITS[e.kind].name : BUILDINGS[e.kind].name}\nClick: select only this. Shift: remove. Ctrl: all of this kind.`, cx + cell / 2, cy);
        if (ui.clicked(cx, cy, cell - 1, cell - 1)) {
          if (this.d.input.shift) ctl.selected.delete(e.id);
          else if (this.d.input.ctrl) ctl.selected = new Set(ents.filter((o) => o.kind === e.kind).map((o) => o.id));
          else ctl.selected = new Set([e.id]);
        }
      }
    });
    if (ents.length > cols * rows) ui.textRight(`+${ents.length - cols * rows}`, x + w - 4, y + h - 11, COL.light);
  }

  private header(sp: ReturnType<typeof sprite>, name: string, owner: number, x: number, y: number) {
    const ui = this.ui;
    ui.rect(x, y, 30, 30, COL.shadow);
    ui.icon(sp, x + 15, y + 15, 28);
    ui.text(name, x + 34, y, COL.white);
    if (owner !== this.me) ui.text(owner >= 0 ? this.s.players[owner].name : 'Neutral', x + 36 + textWidth(name), y, owner >= 0 ? color(this.s, owner) : COL.dim);
  }

  private hpLine(hp: number, max: number, x: number, y: number, w: number) {
    const ui = this.ui;
    const f = hp / max;
    ui.bar(x, y + 2, w, 4, f, f > 0.6 ? COL.green : f > 0.3 ? COL.gold : COL.red);
    ui.text(`${Math.ceil(hp)}/${Math.round(max)}`, x + w + 4, y, COL.light);
  }

  private unitInfo(u: Unit, x: number, y: number, w: number) {
    const ui = this.ui, s = this.s, d = UNITS[u.kind];
    this.header(sprite(`u:${u.kind}:2`, viewColor(s, u.owner)), isAce(s, u) ? `${d.name} "${aceName(s, u)}"` : d.name, u.owner, x, y);
    if (u.vet) ui.textRight(ICON.star.repeat(u.vet), x + w, y, COL.gold);
    this.hpLine(u.hp, unitMaxHp(s, u), x + 34, y + 10, 70);
    const o = u.order;
    const status = !o ? (u.dug ? 'Dug in' : u.hold ? 'Holding position' : u.tgt ? 'Fighting' : 'Idle')
      : o.o === 'move' ? (o.am ? 'Attack-moving' : 'Moving') : o.o === 'attack' ? 'Attacking' : o.o === 'build' ? 'Building' : o.o === 'load' ? 'Boarding' : o.o === 'unload' ? 'Unloading' : 'Patrolling';
    if (u.owner === this.me) ui.text(status, x + 34, y + 20, COL.light);
    let ly = y + 34;
    for (const wpn of d.weapons) {
      ui.text(`${WEAPON_NAMES[wpn.cls] ?? wpn.cls}: ${wpn.dmg} dmg, range ${wpn.range}, vs ${wpn.hits.join('/')}`, x, ly, COL.text);
      ly += LINE_H;
    }
    if (!d.weapons.length) { ui.text(d.desc, x, ly, COL.text); ly += LINE_H; }
    const extra: string[] = [];
    if (d.captures) extra.push('captures cities');
    if (d.ability) extra.push(`ability: ${ABILITIES[d.ability].name}`);
    if (d.carries) extra.push(`carrying ${u.cargo.length} units`);
    if (d.stealth) extra.push('stealth');
    if (d.detects) extra.push('detects subs');
    if (extra.length) ui.text(cap(extra.join(', ')), x, ly, COL.dim);
    ui.textRight(`${ICON.supply}${d.supply}  speed ${d.speed}  sight ${d.sight}`, x + w, y + 20, COL.dim);
    // what it's good and bad against, down the right-hand side
    if (!UNITS[u.kind].builds) matchupText(u.kind).forEach((line, i) => ui.textRight(ellipsize(line, Math.floor(w / 2) - 6), x + w, y + 34 + i * LINE_H, COL.dim));
  }

  private buildingInfo(b: Building, x: number, y: number, w: number) {
    const ui = this.ui, s = this.s, d = BUILDINGS[b.kind];
    this.header(sprite(`b:${b.kind}`, viewColor(s, b.owner)), d.name, b.owner, x, y);
    this.hpLine(b.hp, buildingMaxHp(s, b), x + 34, y + 10, 70);
    if (b.built < 1) {
      ui.text(`Under construction ${Math.floor(b.built * 100)}%`, x + 34, y + 20, COL.gold);
      ui.para(d.desc, x, y + 34, w, COL.dim);
      return;
    }
    if (b.owner !== this.me) { ui.para(d.desc, x, y + 34, w, COL.dim); return; }
    const inc: string[] = [];
    if (d.income?.cash) inc.push(`+$${(d.income.cash * (b.kind === 'mine' && s.map.deposits[b.dep]?.rich ? 2 : 1) * 60).toFixed(0)}/m`);
    if (d.income?.oil) inc.push(`+${d.income.oil * 60} oil/m`);
    if (d.income?.science) inc.push(`+${d.income.science * 60} sci/m`);
    if (d.supply) inc.push(`+${d.supply} supply`);
    if (b.kind === 'hq') inc.push(`+${COMMAND.hqRate} CP/m`);
    if (inc.length) ui.text(inc.join('  '), x + 34, y + 20, COL.green);
    if (b.prod.length || UNITS_AT[b.kind]) this.queue(b.prod, b.blocked, x, y + 34, (i) => this.d.ctl.send({ t: 'cancelTrain', p: this.me, at: b.id, index: i }));
    else ui.para(d.desc, x, y + 34, w, COL.dim);
  }

  private queue(prod: { kind: string; left: number; total: number }[], blocked: boolean, x: number, y: number, cancel: (i: number) => void) {
    const ui = this.ui, s = this.s;
    for (let i = 0; i < PRODUCTION.queueMax; i++) {
      const cx = x + i * 24;
      const item = prod[i];
      const hov = ui.hover(cx, y, 22, 22);
      ui.frame(cx, y, 22, 22, hov && item ? COL.panel2 : COL.shadow);
      if (!item) continue;
      ui.icon(sprite(`u:${item.kind}:2`, viewColor(s, this.me)), cx + 11, cy(y), 18);
      if (i === 0) ui.bar(cx + 2, y + 19, 18, 1, 1 - item.left / item.total, blocked ? COL.red : COL.green);
      if (hov) {
        ui.setTip(`${UNITS[item.kind].name}\nClick to cancel (full refund)`, cx + 11, y);
        if (ui.clicked(cx, y, 22, 22)) cancel(i);
      }
    }
    if (blocked) ui.text('Supply full! Grow or capture cities.', x + 124, y + 7, COL.red);
    else if (prod.length) ui.text(`${Math.ceil((prod[0].left / TICK_RATE))}s`, x + 124, y + 7, COL.light);
  }

  private cityInfo(c: City, x: number, y: number, w: number) {
    const ui = this.ui, s = this.s;
    // unexplored: only what everyone knows (its name, where it is, any public job)
    if (s.setup.fog !== 'off' && !this.d.fog.isExplored(c.x, c.y)) {
      this.header(sprite('city:1', 0), c.name, this.me, x, y); // (owner unknown: no owner label)
      ui.text('Unexplored: send a unit to look', x + 34, y + 10, COL.dim);
      if (s.contract?.city === c.id) ui.text(ellipsize(this.contractText(c.id, s.contract.kind), w), x, y + 34, COL.gold);
      return;
    }
    const L = CITY_LEVELS[c.level - 1];
    this.header(sprite(`city:${c.level}`, 0), c.name, c.owner, x, y);
    ui.text(`${L.name} (level ${c.level})${c.spec ? ' - ' + SPECS[c.spec].name : ''}`, x + 34, y + 10, COL.gold);
    if (c.level < CITY_LEVELS.length && c.owner >= 0) {
      ui.text('Growth', x + 34, y + 20, COL.dim);
      ui.bar(x + 64, y + 22, 60, 3, c.grow, COL.green);
    }
    let ly = y + 34;
    if (c.owner >= 0 && s.tick < c.calm) { ui.text(`Unrest: no income for ${Math.ceil((c.calm - s.tick) / TICK_RATE)}s`, x, ly, COL.red); ly += LINE_H; }
    if (c.resistFor >= 0 && s.tick < c.resistUntil) {
      const left = Math.ceil((c.resistUntil - s.tick) / TICK_RATE);
      const what = c.owner === this.me ? `keep ${RESISTANCE.garrison} infantry here or partisans rise` : `partisans rise for ${s.players[c.resistFor].name}`;
      ui.text(`Resisting ${left}s: ${what} (${c.risen}/${RESISTANCE.max})`, x, ly, COL.gold);
      ly += LINE_H;
    }
    const inc = c.owner >= 0 ? cityIncome(s, c) : { cash: CITY_LEVELS[c.level - 1].cash, science: CITY_LEVELS[c.level - 1].science, cp: L.cp / 60 };
    ui.text(`+$${Math.round(inc.cash * 60)}/m  +${Math.round(inc.science * 60)} sci/m  +${L.supply} supply  +${(inc.cp * 60).toFixed(1)} CP/m`, x, ly, c.owner === this.me ? COL.green : COL.light);
    ly += LINE_H;
    if (c.cap > 0 && c.capBy >= 0) {
      ui.text(`Being captured by ${s.players[c.capBy].name}: ${Math.floor(c.cap * 100)}%`, x, ly, color(s, c.capBy));
      ly += LINE_H;
    } else if ((c.owner < 0 || !allied(s, c.owner, this.me)) && !(s.contract?.kind === 'supply' && s.contract.city === c.id)) {
      ui.text(`Capture: keep infantry within ${captureRadius(c)} tiles with no enemies around`, x, ly, COL.dim);
      ly += LINE_H;
    }
    // a public job posted here
    if (s.contract?.city === c.id) {
      ui.text(this.contractText(c.id, s.contract.kind), x, ly, COL.gold);
      ly += LINE_H;
    }
    // insurgency: someone re-founding here, or (knocked out) what one of our squads could do
    const riser = s.players.find((p) => p.rising === c.id && insurgent(s, p));
    if (riser) {
      ui.text(`${riser.id === this.me ? 'You re-found' : riser.name + ' re-founds'} the government here in ${clock(Math.max(0, riser.risingAt - s.tick))}${riser.id === this.me ? '' : ' unless driven out'}`, x, ly, COL.gold);
      ly += LINE_H;
    }
    const me = s.players[this.me];
    if (insurgent(s, me) && !s.over && c.owner !== this.me) {
      const why = dropBlocked(s, me, c);
      const ok = !why || why.startsWith('partisans ready');
      const n = Math.max(1, charges(s, me)), pr = squadProgress(s, c, n, chestTroops(me, n), me.id);
      const sq = n > 1 ? `${n} squads` : 'one squad';
      ui.text(!ok ? `Insurgency: ${why}` : pr >= 1 ? `Insurgency: ${sq} can take it past its militia` : `Insurgency: its militia stops ${sq} at about ${Math.round(pr * 100)}%`, x, ly, !ok ? COL.dim : pr >= 1 ? COL.green : COL.red);
      ly += LINE_H;
    }
    if (c.owner === this.me && c.prod.length) this.queue(c.prod, false, x + w - 124 - 100, y + 4, (i) => this.d.ctl.send({ t: 'cancelTrain', p: this.me, at: c.id, city: true, index: i }));
    if (c.owner === this.me && c.specPending) ui.text('Choose a specialty in the command card', x, ly, Math.floor(performance.now() / 400) % 2 ? COL.gold : COL.white);
  }

  // ------------------------------------------------------------------ command card

  private commandCard() {
    const ui = this.ui, s = this.s, ctl = this.d.ctl;
    const x = ui.w - CARD_W - 2, y = ui.h - CARD_H - 2;
    const slot = (i: number): [number, number] => [x + 4 + (i % 4) * (BTN_W + GAP), y + 4 + Math.floor(i / 4) * (BTN_H + GAP)];
    const p = s.players[this.me];
    const units = ctl.myUnits();
    const bs = ctl.myBuildings();
    const city = ctl.selCity >= 0 && !ctl.selected.size ? s.cities[ctl.selCity] : null;
    // nothing of ours selected: no empty box
    const rebel = !!city && insurgent(s, p) && !s.over;
    const supply = !!city && p.alive && !s.over && s.contract?.kind === 'supply' && s.contract.city === city.id;
    // our city shows a card only when it has something to offer (a specialty, training, the exchange)
    const ourCity = !!city && city.owner === this.me && (city.specPending || exileCapital(s, this.me) === city || ['builder', 'rifleman', 'patrolboat'].some((k) => cityTrains(s, city, k)));
    if (!this.powerCard && !units.length && !bs.length && !ourCity && !rebel && !supply) return;
    ui.panel(x, y, CARD_W, CARD_H);

    if (this.powerCard) {
      this.powerOrder().forEach((id, i) => this.powerButton(id, ...slot(i), BTN_W, BTN_H, true));
      const [bx, by] = slot(11);
      if (ui.button(bx, by, BTN_W, BTN_H, { label: 'Back', hotkey: 'Tab', tip: 'Back to orders' })) this.powerCard = false;
      return;
    }

    if (units.length && this.buildPage) {
      BUILD_ORDER.forEach((kind, i) => {
        const d = BUILDINGS[kind];
        const locked = d.tech && !p.techs.includes(d.tech);
        const poor = p.cash < d.cost.cash || p.oil < d.cost.oil;
        const [bx, by] = slot(i);
        const costTxt = `$${d.cost.cash}${d.cost.oil ? ` + ${d.cost.oil} oil` : ''}`;
        if (ui.button(bx, by, BTN_W, BTN_H, {
          icon: sprite(`b:${kind}`, viewColor(s, this.me)), hotkey: 'Key' + d.hotkey, disabled: !!locked,
          tip: `${d.name}  ${costTxt}\n${d.desc}${locked ? `\nNeeds ${TECH_BY_ID.get(d.tech!)?.name}` : ''}\nBuild time ${d.buildTime}s`,
          badge: locked ? '' : `${d.cost.cash}`, badgeColor: poor ? COL.red : COL.white,
        })) {
          ctl.mode = { m: 'place', kind };
        }
      });
      return;
    }

    if (units.length) {
      const has = (f: (u: Unit) => boolean) => units.some(f);
      let i = 0;
      const b = (label: string, key: string, tip: string, active: boolean, act: () => void, disabled = false) => {
        const [bx, by] = slot(i++);
        if (ui.button(bx, by, BTN_W, BTN_H, { label, hotkey: key, tip, active, disabled })) act();
      };
      const ids = units.map((u) => u.id);
      const armed = has((u) => UNITS[u.kind].weapons.length > 0);
      b('Atk', 'KeyQ', 'Attack-move\nMove, fighting anything on the way. Click the map.', ctl.mode.m === 'attackMove', () => (ctl.mode = { m: 'attackMove' }), !armed);
      b('Stop', 'KeyX', 'Stop', false, () => ctl.send({ t: 'stop', p: this.me, ids }));
      b('Hold', 'KeyH', 'Hold position\nStay put and fire at what comes in range.', units.every((u) => u.hold), () => ctl.send({ t: 'hold', p: this.me, ids }), !armed);
      b('Patrl', 'KeyP', 'Patrol\nWalk back and forth, fighting. Click the map.', ctl.mode.m === 'patrol', () => (ctl.mode = { m: 'patrol' }), !armed);
      if (has((u) => !!UNITS[u.kind].builds)) b('Build', 'KeyB', 'Build\nOpen the building menu.', false, () => (this.buildPage = true));
      const abKinds = [...new Set(units.map((u) => UNITS[u.kind].ability).filter(Boolean))] as (keyof typeof ABILITIES)[];
      // a mixed selection gets a second ability button on F, so no two buttons share a key
      for (const [n, ab] of abKinds.slice(0, 2).entries()) {
        const def = ABILITIES[ab];
        const with_ = units.filter((u) => UNITS[u.kind].ability === ab);
        const ready = with_.filter((u) => s.tick >= u.abReady);
        const cd = ready.length ? 0 : Math.min(...with_.map((u) => (u.abReady - s.tick) / TICK_RATE / def.cooldown));
        const [bx, by] = slot(i++);
        const active = ab === 'digIn' ? with_.every((u) => u.dug) : false;
        if (ui.button(bx, by, BTN_W, BTN_H, { label: ABILITY_LABEL[ab], hotkey: n ? 'KeyF' : 'KeyE', tip: `${def.name}\n${def.desc}\nCooldown ${def.cooldown}s`, cooldown: cd, active, disabled: !ready.length })) {
          if (ab === 'flare') ctl.mode = { m: 'ability' };
          else ctl.send({ t: 'ability', p: this.me, ids: ready.map((u) => u.id) });
        }
      }
      if (has((u) => u.cargo.length > 0)) b('Unld', 'KeyU', 'Unload\nClick a shore to land the troops.', ctl.mode.m === 'unload', () => (ctl.mode = { m: 'unload' }));
      return;
    }

    if (bs.length) {
      const b = bs[0];
      const d = BUILDINGS[b.kind];
      let i = 0;
      if (b.built < 1) {
        const [bx, by] = slot(11);
        if (ui.button(bx, by, BTN_W, BTN_H, { label: 'Cancel', hotkey: 'Delete', tip: `Cancel construction\nRefunds ${PRODUCTION.buildCancelRefund * 100}%` })) ctl.send({ t: 'cancelBuild', p: this.me, id: b.id });
        return;
      }
      const sameKind = bs.filter((o) => o.kind === b.kind && o.built >= 1);
      // in a last stand the HQ trains infantry too
      const kinds = [...(UNITS_AT[b.kind] ?? []), ...(b.kind === 'hq' && s.players[this.me].lastStand ? LAST_STAND.units : [])];
      for (const kind of kinds) this.trainButton(kind, ...slot(i++), (n) => {
        // spread the order across every selected building of this kind (shortest queue first)
        const len = new Map(sameKind.map((o) => [o.id, o.prod.length]));
        for (let k = 0; k < n; k++) {
          const target = [...sameKind].sort((a2, b2) => len.get(a2.id)! - len.get(b2.id)! || a2.id - b2.id)[0];
          ctl.send({ t: 'train', p: this.me, at: target.id, kind, n: 1 });
          len.set(target.id, len.get(target.id)! + 1);
        }
      });
      if (b.kind === 'hq') this.tradeButtons(slot, 4);
      if (UNITS_AT[b.kind]) {
        const [bx, by] = slot(8);
        if (ui.button(bx, by, BTN_W, BTN_H, { label: 'Rally', hotkey: 'KeyY', tip: 'Set rally point\nNew units go here. Or right-click the map.', active: ctl.mode.m === 'rally' })) ctl.mode = { m: 'rally' };
      }
      if (b.kind !== 'hq') {
        const [bx, by] = slot(11);
        const armed = performance.now() - this.sellArmed < 2500;
        if (ui.button(bx, by, BTN_W, BTN_H, { label: armed ? 'Sure?' : 'Sell', hotkey: 'Delete', tip: `Sell ${d.name}\nRefunds ${PRODUCTION.sellRefund * 100}% of the cash cost. Click twice.`, color: armed ? COL.red : undefined })) {
          if (armed) { ctl.send({ t: 'sell', p: this.me, id: b.id }); this.sellArmed = 0; }
          else this.sellArmed = performance.now();
        }
      }
      return;
    }

    if (city && supply) {
      const bid = minBid(s);
      const why = bidBlocked(s, p, city, bid);
      const [bx, by] = slot(0);
      if (ui.button(bx, by, BTN_W, BTN_H, {
        label: 'Bid', hotkey: 'KeyP', disabled: !!why, color: COL.gold, badge: `${bid}`, badgeColor: p.cash < bid ? COL.red : COL.white,
        tip: `Bid $${bid} for ${city.name}\nEach new bid must top the last by ${Math.round(CONTRACTS.raise * 100)}%; a late bid adds time (${CONTRACTS.late}s at least).\nThe highest bid when it closes pays, and the city joins that player peacefully.\nYou need a ground unit inside its ring, or your borders reaching it.${why ? '\n' + cap(why) : ''}`,
      })) ctl.send({ t: 'contract', p: this.me, city: city.id, bid });
      return;
    }

    if (city && rebel) {
      const why = dropBlocked(s, p, city);
      const cd = p.insurgeAt > s.tick ? (p.insurgeAt - s.tick) / TICK_RATE / INSURGENCY.every : 0;
      const banked = charges(s, p), n = Math.max(1, banked), extra = chestTroops(p, n), pr = squadProgress(s, city, n, extra, p.id);
      const sq = n > 1 ? `${n} squads` : 'One squad';
      const wait = n < INSURGENCY.maxCharges ? 'wait to bank another squad' : 'pick a smaller city';
      const odds = city.owner === this.me ? 'Reinforce your city.' : pr >= 1 ? `${sq} can take it past its militia.` : `Its militia stops ${sq.toLowerCase()} at about ${Math.round(pr * 100)}%: ${wait}.`;
      const men = INSURGENCY.squad * n, name = UNITS[INSURGENCY.kind].name, chest = UNITS[INSURGENCY.chestKind].name;
      const also = extra ? ` and ${extra} ${extra > 1 ? plural(chest) : chest} (war chest, $${extra * INSURGENCY.chestCost})` : '';
      const [bx, by] = slot(0);
      if (ui.button(bx, by, BTN_W, BTN_H, {
        label: 'Drop', hotkey: 'KeyV', disabled: !!why && !why.startsWith('partisans ready'), cooldown: cd, badge: banked ? `${banked}` : undefined,
        tip: `Drop partisans\n${men} ${men > 1 ? plural(name) : name}${also} land around ${city.name}. ${odds}\nA squad is banked every ${INSURGENCY.every}s (up to ${INSURGENCY.maxCharges}); a drop sends every banked squad.\nYour war chest buys a ${chest} per squad for $${INSURGENCY.chestCost} while it lasts.\nThey land hidden for ${INSURGENCY.hidden}s (until they fire): the capture starts unseen.\nAt a neutral city, or one you once held.${why ? '\n' + cap(why) : ''}`,
      })) ctl.send({ t: 'insurge', p: this.me, city: city.id });
      return;
    }

    if (city && city.owner === this.me) {
      let i = 0;
      if (city.specPending) {
        for (const id of Object.keys(SPECS) as SpecId[]) {
          const sp = SPECS[id];
          const [bx, by] = slot(i++);
          const bad = sp.coastal && !city.coastal;
          if (ui.button(bx, by, BTN_W, BTN_H, { label: SPEC_KEYS[id][1], hotkey: SPEC_KEYS[id][0], tip: `${sp.name}\n${sp.desc}${bad ? '\nThis city is not on the coast.' : ''}`, disabled: bad, color: COL.gold })) {
            ctl.send({ t: 'spec', p: this.me, city: city.id, spec: id });
          }
        }
        i = 8;
      }
      for (const kind of ['builder', 'rifleman', 'patrolboat']) {
        if (!cityTrains(s, city, kind)) continue;
        this.trainButton(kind, ...slot(i++), (n) => ctl.send({ t: 'train', p: this.me, at: city.id, city: true, kind, n }));
      }
      // the exiled government runs the exchange from its capital
      if (exileCapital(s, this.me) === city && !city.specPending) this.tradeButtons(slot, 4);
      const [bx, by] = slot(11);
      if ((cityTrains(s, city, 'rifleman') || cityTrains(s, city, 'patrolboat') || cityTrains(s, city, 'builder')) && ui.button(bx, by, BTN_W, BTN_H, { label: 'Rally', hotkey: 'KeyY', tip: 'Set rally point', active: ctl.mode.m === 'rally' })) ctl.mode = { m: 'rally' };
    }
  }

  /** The exchange: three trade buttons from this slot on. */
  private tradeButtons(slot: (i: number) => [number, number], from: number) {
    const ui = this.ui, s = this.s, p = s.players[this.me];
    (Object.keys(EXCHANGE.trades) as TradeId[]).forEach((id, k) => {
      const t = EXCHANGE.trades[id];
      const q = tradeQuote(s, p, id);
      const why = tradeBlocked(s, p, id);
      const [bx, by] = slot(from + k);
      const label = { buyOil: `Buy${ICON.oil}`, sellOil: `Sell${ICON.oil}`, fundResearch: `Fund${ICON.science}` }[id];
      const payTxt = t.payWith === 'cash' ? `$${q.pay}` : `${q.pay} oil`;
      const getTxt = t.gets === 'cash' ? `$${q.get}` : `${q.get} ${t.gets}`;
      if (ui.button(bx, by, BTN_W, BTN_H, {
        label, hotkey: t.hotkey, disabled: !!why && !!t.needs && why.startsWith('needs'),
        tip: `${t.name}: ${payTxt} for ${getTxt}\n${t.desc}\nEach trade raises the price ${EXCHANGE.heat * 100}%; prices cool over time.${why ? '\n' + cap(why) : ''}`,
        badge: payTxt.replace(' oil', ''), badgeColor: why ? COL.red : COL.white, badgeTop: true,
      })) this.d.ctl.send({ t: 'trade', p: this.me, trade: id });
    });
  }

  private trainButton(kind: string, bx: number, by: number, train: (n: number) => void) {
    const ui = this.ui, s = this.s, p = s.players[this.me];
    const d = UNITS[kind];
    const cost = unitCost(s, this.me, kind);
    const locked = d.tech && !p.techs.includes(d.tech);
    const poor = p.cash < cost.cash || p.oil < cost.oil;
    const costTxt = `$${Math.round(cost.cash)}${cost.oil ? ` + ${Math.round(cost.oil)} oil` : ''}`;
    if (ui.button(bx, by, BTN_W, BTN_H, {
      icon: sprite(`u:${kind}:2`, viewColor(s, this.me)), hotkey: 'Key' + d.hotkey, disabled: !!locked,
      tip: `${d.name}  ${costTxt}  ${ICON.supply}${d.supply}\n${d.desc}\n${matchupText(kind).join('\n')}${locked ? `\nNeeds ${TECH_BY_ID.get(d.tech!)?.name}` : ''}\nShift: queue 5`,
      badge: locked ? '' : `${Math.round(cost.cash)}`, badgeColor: poor ? COL.red : COL.white,
    })) train(this.d.input.shift ? 5 : 1);
  }

  // ------------------------------------------------------------------ powers

  /** The top of the powers strip (or of the minimap, for a player without powers). */
  private powersTop(): number {
    if (!this.s.players[this.me].alive) return this.ui.h - MM - 4;
    return this.ui.h - MM - 4 - Math.ceil(this.powerOrder().length / 2) * (POWER_H + 1) - 9;
  }

  /** Above the minimap: a Command Point meter and a compact 2-column grid of powers. */
  private powersStrip() {
    const ui = this.ui, p = this.s.players[this.me];
    const h = POWER_H, bw = (MM - 2) / 2;
    const order = this.powerOrder();
    let y = this.powersTop();
    // one notch per point
    const mx = 11, mw = MM - 9;
    ui.text(ICON.cp, 2, y, COL.gold);
    ui.rect(mx, y + 1, mw, 5, COL.shadow);
    ui.rect(mx + 1, y + 2, Math.round((mw - 2) * Math.min(1, p.cp / COMMAND.max)), 3, COL.gold);
    for (let i = 1; i < COMMAND.max; i++) ui.rect(mx + Math.round((mw * i) / COMMAND.max), y + 2, 1, 3, COL.shadow);
    if (ui.hover(0, y - 1, MM + 2, 8)) ui.setTip(`Command Points ${p.cp.toFixed(1)}/${COMMAND.max}\nYour HQ and cities make them. Spend them on powers (Tab opens them with hotkeys).`, MM / 2, y);
    ui.block(0, y - 1, MM + 2, 8);
    y += 8;
    order.forEach((id, i) => this.powerButton(id, 2 + (i % 2) * (bw + 2), y + Math.floor(i / 2) * (h + 1), bw, h, false));
  }

  /** The powers this player can use (Call for Help only with allies). */
  private powerOrder(): PowerId[] {
    const s = this.s, me = s.players[this.me];
    const allies = s.players.some((o) => o.id !== this.me && o.alive && o.team === me.team);
    return POWER_ORDER.filter((id) => id !== 'help' || allies);
  }

  private powerButton(id: PowerId, x: number, y: number, w: number, h: number, keys: boolean) {
    const ui = this.ui, s = this.s, p = s.players[this.me], ctl = this.d.ctl;
    const def = POWERS[id];
    const locked = p.era < def.era;
    const ready = p.powerReady[id] ?? 0;
    const cd = ready > s.tick ? (ready - s.tick) / TICK_RATE / def.cooldown : 0;
    const cost = powerCost(p, id);
    const poor = p.cp < cost;
    const label = w > 60 ? `${def.name}` : SHORT_POWER[id];
    if (ui.button(x, y, w, h, {
      label, hotkey: keys ? 'Key' + def.hotkey : undefined, disabled: locked || cd > 0, cooldown: cd,
      active: ctl.mode.m === 'power' && ctl.mode.power === id,
      tip: `${def.name}  ${cost} CP\n${def.desc}${id === 'supplyDrop' && !locked ? `\nRight now: $${supplyDropCash(s, this.me)}` : ''}${locked ? `\nUnlocks in the ${ERAS[def.era].name} era` : ''}${def.needsVision ? '\nYou must see the target.' : ''}\nCooldown ${def.cooldown}s`,
      // a locked power shows the era it opens in, not a cost you can't pay anyway
      badge: w > 40 ? (locked ? ERA_NUMERAL[def.era] : String(cost)) : undefined, badgeColor: locked ? COL.dim : poor ? COL.red : COL.gold,
      color: poor ? COL.dim : undefined,
    })) {
      if (!def.targeted) ctl.send({ t: 'power', p: this.me, power: id });
      else ctl.mode = { m: 'power', power: id };
    }
  }

  // ------------------------------------------------------------------ doctrine & city choices

  private choices() {
    const ui = this.ui, s = this.s, p = s.players[this.me], ctl = this.d.ctl;
    // the end screen tells the story now
    if (s.over && !this.hideEnd) return;
    let y = TOP_H + 16;
    const x = 4, w = 150;
    // the column stops above the powers strip
    const floor = this.powersTop() - 4;
    if (p.doctrinePending) {
      const opts = DOCTRINES.filter((d) => d.era === p.doctrinePending);
      // each choice: its name, then its perk in up to three lines
      const dw = 200, row = 14 + 3 * LINE_H + 4;
      ui.panel(x, y, dw, 16 + opts.length * row);
      ui.text(`Choose a doctrine (${ERAS[p.doctrinePending].name})`, x + 5, y + 5, COL.gold);
      opts.forEach((d, i) => {
        const by = y + 16 + i * row;
        if (ui.button(x + 4, by, dw - 8, row - 2, { tip: `${d.name}\n${d.desc}\nYou keep it for the rest of the match.` })) ctl.send({ t: 'doctrine', p: this.me, id: d.id });
        ui.text(d.name, x + 8, by + 4, COL.white);
        const lines = wrapText(d.desc, dw - 18);
        if (lines.length > 3) lines.splice(2, lines.length - 2, ellipsize(lines.slice(2).join(' '), dw - 18));
        lines.forEach((l, k) => ui.text(l, x + 8, by + 14 + k * LINE_H, COL.dim));
      });
      y += 20 + opts.length * row;
    }
    if (insurgent(s, p) && !s.over) y += this.insurgency(x, y, w);
    for (const c of s.cities) {
      if (c.owner !== this.me || !c.specPending || !p.alive) continue;
      const label = `${c.name}: pick a specialty`;
      if (ui.button(x, y, w, 14, { label, color: COL.gold, tip: `${c.name} grew. Choose what it becomes.` })) {
        ctl.selected.clear();
        ctl.selCity = c.id;
        this.d.cam.centerOn(c.x, c.y);
      }
      y += 15;
    }
    if (this.d.tutorial?.active) this.d.tutorial.draw(ui, s, this.me, ctl, this.d.cam, x, y);
    // Field Manual cards wait while a doctrine or a city's specialty is being chosen, and while there is no room
    else if (!p.doctrinePending && !s.cities.some((c) => c.owner === this.me && c.specPending)) {
      const top = y;
      y += this.manual.draw(ui, x, y, s.tick / TICK_RATE, floor - y);
      if (top === TOP_H + 16) this.objectives(x, y, floor);
    }
  }

  /** What the open contract at city `id` asks, in one line. */
  private contractText(id: number, kind: ContractKind, short = false): string {
    const s = this.s, c = s.cities[id];
    if (kind === 'supply') {
      const floor = supplyFloor(c);
      return short ? `Contract: ${c.name} takes bids from $${floor}: the top bid buys it`
        : `Contract: tender from $${floor} (a unit here or your borders, then Bid); the top bid buys it`;
    }
    const r = jobReward(s, kind, s.contract?.level ?? c.level);
    if (kind === 'liberate') {
      const leader = s.players.filter((p) => p.team === s.contract?.team).map((p) => p.name).join(' & ');
      return short ? `Bounty: take ${c.name} from ${leader} for $${r.cash} + ${r.cp} CP`
        : `Bounty: take it from ${leader} for $${r.cash} + ${r.cp} CP (it keeps its size)`;
    }
    return short ? `Contract: hold ${c.name} ${CONTRACTS.hold}s for $${r.cash} + ${r.cp} CP`
      : `Contract: take it and hold it ${CONTRACTS.hold}s for $${r.cash} + ${r.cp} CP`;
  }

  /** Knocked out: when the next partisan drop is ready, and how a re-founding goes. Returns the height used. */
  private insurgency(x: number, y: number, w: number): number {
    const ui = this.ui, s = this.s, p = s.players[this.me];
    const lines: [string, string][] = [];
    const n = charges(s, p);
    if (!n) lines.push([`Next squad in ${clock(p.insurgeAt - s.tick)}`, COL.light]);
    else {
      lines.push([`${n}/${INSURGENCY.maxCharges} squads ready: select a city, press D`, Math.floor(performance.now() / 500) % 2 ? COL.gold : COL.white]);
      if (n < INSURGENCY.maxCharges) lines.push([`Another squad in ${clock(p.insurgeAt + n * INSURGENCY.every * TICK_RATE - s.tick)}`, COL.light]);
    }
    const chest = Math.floor(p.cash / INSURGENCY.chestCost);
    if (chest) lines.push([`War chest $${Math.floor(p.cash)}: ${chest} rocket${chest > 1 ? 's' : ''}`, COL.light]);
    if (p.rising >= 0) lines.push([`Hold ${s.cities[p.rising].name}: back in ${clock(Math.max(0, p.risingAt - s.tick))}`, COL.green]);
    else for (const l of wrapText(`Take a city; hold one of Town size or more for ${clock(INSURGENCY.hold * TICK_RATE)} to re-found your government.`, w - 10)) lines.push([l, COL.dim]);
    const h = 16 + lines.length * LINE_H + 2;
    ui.panel(x, y, w, h);
    ui.text('Insurgency', x + 5, y + 5, COL.gold);
    lines.forEach(([t, c], i) => ui.text(t, x + 5, y + 16 + i * LINE_H, c));
    if (ui.hover(x, y, w, h)) ui.setTip(`You are knocked out, but the fight goes on.\nA squad of ${INSURGENCY.squad} partisans is banked every ${INSURGENCY.every}s, up to ${INSURGENCY.maxCharges}.\nDrop them all at a neutral city or one you once held.\nCity militia shoots capturers: small cities fall to one squad, bigger ones need more.`, x + w / 2, y + h);
    ui.block(x, y, w, h);
    return h + 4;
  }

  /** First-match guidance: a short checklist that ticks itself off, then goes away. */
  private objectives(x: number, y: number, floor: number) {
    const ui = this.ui, s = this.s, p = s.players[this.me];
    if (this.objectivesDone || s.tick > OBJECTIVES_UNTIL * TICK_RATE) return;
    const have = (kind: string) => Object.values(s.ents).some((e) => e.t === 'b' && e.owner === this.me && e.kind === kind && e.built >= 1);
    const items: [string, boolean, string][] = [
      ['Build a Mine on ore', have('mine'), 'Select a Builder, press B, then pick the Mine and click an ore deposit.'],
      ['Build a Barracks', have('barracks'), 'Barracks train infantry: riflemen capture cities.'],
      ['Capture a city', s.cities.some((c) => c.owner === this.me), 'Send infantry into the dashed circle around a city and keep enemies out until the bar fills.'],
      ['Start research (F2)', p.techs.length > 0 || !!p.research.cur, 'Techs unlock units and bonuses. Each era also offers a doctrine.'],
      ['Build a Factory', have('factory'), 'Factories build tanks; they need oil from a Derrick.'],
    ];
    if (items.every((i) => i[1])) { this.objectivesDone = true; return; }
    const w = 128, h = 13 + items.length * 9;
    if (y + h > floor) return;
    ui.ctx.globalAlpha = 0.8;
    ui.rect(x, y, w, h, COL.shadow);
    ui.ctx.globalAlpha = 1;
    ui.text('Getting started', x + 4, y + 3, COL.gold);
    items.forEach(([label, done, tip], i) => {
      const ly = y + 13 + i * 9;
      ui.rect(x + 4, ly + 1, 5, 5, done ? COL.green : COL.edge);
      if (!done) ui.rect(x + 5, ly + 2, 3, 3, COL.shadow);
      ui.text(label, x + 12, ly, done ? COL.dim : COL.text);
      if (ui.hover(x, ly - 1, w, 9)) ui.setTip(`${label}\n${tip}`, x + w / 2, ly);
    });
    ui.block(x, y, w, h);
  }

  // ------------------------------------------------------------------ chat

  /** Online: Enter opens a chat line above the command card; incoming lines join the message feed. */
  private chatBox() {
    const ui = this.ui, sess = this.d.session, inp = this.d.input;
    for (const c of sess.chat.splice(0)) this.say(`${c.name}: ${c.text}`, COL.white);
    if (sess.status() === '') return;
    if (this.chatOpen) {
      const w = 200, x = Math.round(ui.w / 2 - w / 2), y = ui.h - 40;
      const r = ui.textField('chat', x, y, w, 15, this.chatDraft, { placeholder: 'Say something (Enter)', max: 120 });
      this.chatDraft = r.value;
      if (r.submitted) { sess.say(this.chatDraft); this.chatDraft = ''; this.chatOpen = false; ui.blur(); inp.consume('chat'); }
      else if (ui.focus !== 'chat') this.chatOpen = false;
    } else if (inp.wasPressed('chat')) {
      inp.consume('chat');
      this.chatOpen = true;
      ui.focus = 'chat';
    }
  }

  // ------------------------------------------------------------------ messages

  private messages(now: number) {
    const ui = this.ui;
    this.msgs = this.msgs.filter((m) => now - m.t < MSG_MS);
    // the feed sits under the top bar, mid-screen; on a narrow screen where it would run into the
    // victory tracker, it drops below it
    const widest = Math.max(0, ...this.msgs.map((m) => textWidth(m.n > 1 ? `${m.text} (x${m.n})` : m.text) + 10));
    const [tx, tb] = this.trackerBox;
    let y = TOP_H + 4;
    if (tb > 0 && ui.w / 2 + widest / 2 > tx - 2) y = tb + 3;
    this.trackerBox = [ui.w, 0];
    for (const m of this.msgs) {
      const text = m.n > 1 ? `${m.text} (x${m.n})` : m.text;
      const w = textWidth(text) + 10;
      ui.ctx.globalAlpha = Math.min(1, (MSG_MS - (now - m.t)) / 800);
      // a dark plate behind each line, so it reads over any terrain
      ui.ctx.globalAlpha *= 0.7;
      ui.rect(Math.round(ui.w / 2 - w / 2), y - 1, w, LINE_H, COL.shadow);
      ui.ctx.globalAlpha = Math.min(1, (MSG_MS - (now - m.t)) / 800);
      ui.textCenter(text, ui.w / 2, y, m.color);
      ui.ctx.globalAlpha = 1;
      y += LINE_H;
    }
  }

  // ------------------------------------------------------------------ windows

  private window(w: number, h: number, title: string): [number, number] {
    const ui = this.ui;
    const x = Math.round((ui.w - w) / 2), y = Math.max(TOP_H + 2, Math.round((ui.h - h) / 2) - 20);
    ui.panel(x, y, w, h);
    ui.text(title, x + 6, y + 5, COL.gold);
    if (ui.button(x + w - 14, y + 3, 11, 11, { label: ICON.close, tip: 'Close (Esc)' })) this.panel = 'none';
    return [x, y];
  }

  private research() {
    const ui = this.ui, s = this.s, p = s.players[this.me], ctl = this.d.ctl;
    const colW = 124, w = colW * 4 + 5 * 4, rowH = 23;
    const h = 40 + 8 * rowH + 54;
    let hovered: (typeof TECHS)[number] | null = null;
    const [x, y] = this.window(w, h, `Research  ${ICON.science} ${Math.floor(p.science)} banked  (+${(incomeOf(s, this.me).science * 60).toFixed(0)}/m)`);
    ERAS.forEach((era, ei) => {
      const cx = x + 4 + ei * (colW + 4);
      const done = p.techs.filter((t) => TECH_BY_ID.get(t)?.era === ei).length;
      const head = ei <= p.era ? COL.white : COL.dim;
      ui.text(`${'I II III IV'.split(' ')[ei]}. ${era.name}`, cx + 2, y + 18, head);
      if (ei === p.era && ei < ERAS.length - 1) ui.textRight(`${done}/4`, cx + colW - 2, y + 18, COL.light);
      TECHS.filter((t) => t.era === ei).forEach((t, ti) => {
        const by = y + 30 + ti * rowH;
        const have = p.techs.includes(t.id);
        const cur = p.research.cur === t.id;
        const qi = p.research.queue.indexOf(t.id);
        const why = have ? null : techBlocked(p, t.id);
        const cost = techCost(s, p, t.id);
        const ally = s.players.some((o) => o.id !== p.id && o.team === p.team && o.techs.includes(t.id));
        const hit = ui.button(cx, by, colW, rowH - 2, {
          active: cur || qi >= 0, disabled: have || (!!why && t.era > p.era + 1),
          tip: `${t.name}  (${cost} science)\n${t.desc}${why && !have ? `\n${cap(why)}` : ''}${ally ? '\nAn ally knows this: 25% cheaper.' : ''}${!have ? '\nClick: research. Click again: cancel.' : ''}`,
        });
        ui.text(ellipsize(t.name, colW - 30), cx + 4, by + 3, have ? COL.green : why ? COL.dim : COL.white);
        ui.text(have ? 'done' : cur ? `${Math.floor((p.research.prog / cost) * 100)}%` : qi >= 0 ? `#${qi + 2}` : `${cost}`, cx + 4, by + 11, have ? COL.green : ally ? COL.blue : COL.light);
        // what it unlocks, as little icons; otherwise its branch
        const unlocks = UNLOCKS.get(t.id) ?? [];
        if (unlocks.length) unlocks.slice(0, 3).forEach((name, k) => ui.icon(sprite(name, viewColor(s, this.me)), cx + colW - 9 - k * 15, by + 10, 14));
        else ui.textRight(BRANCH[t.branch], cx + colW - 4, by + 11, COL.dim);
        if (ui.hover(cx, by, colW, rowH - 2)) hovered = t;
        if (cur) ui.bar(cx + 3, by + rowH - 6, colW - 6, 1, p.research.prog / cost, COL.blue);
        if (hit && !have) {
          if (cur) ctl.send({ t: 'cancelResearch', p: this.me, index: -1 });
          else if (qi >= 0) ctl.send({ t: 'cancelResearch', p: this.me, index: qi });
          else ctl.send({ t: 'research', p: this.me, tech: t.id });
        }
      });
    });
    // the hovered tech in full
    const ht = hovered as (typeof TECHS)[number] | null;
    if (ht) {
      const names = (UNLOCKS.get(ht.id) ?? []).map((n) => (n.startsWith('u:') ? UNITS[n.split(':')[1]].name : BUILDINGS[n.slice(2)].name));
      ui.text(`${ht.name} (${techCost(s, p, ht.id)} science)`, x + 6, y + h - 46, COL.gold);
      ui.text(ellipsize(`${ht.desc}${names.length ? `  Unlocks: ${names.join(', ')}.` : ''}`, w - 12), x + 6, y + h - 36, COL.text);
    } else ui.text('Point at a tech to see what it does.', x + 6, y + h - 41, COL.dim);
    const docs = p.doctrines.map((id) => DOCTRINES.find((d) => d.id === id)?.name).filter(Boolean);
    ui.text(`Doctrines: ${docs.length ? docs.join(', ') : 'none yet (one per new era)'}`, x + 6, y + h - 22, COL.light);
    ui.text('Research 4 techs of an era to enter the next one. Allies share knowledge: techs they know cost you 25% less.', x + 6, y + h - 12, COL.dim);
  }

  /** the F1 help's page (on a screen too short for all of it) */
  private helpPage = 0;

  private help() {
    const ui = this.ui;
    const rules = [
      `Win: knock out every enemy (HQ, then any capital in exile), hold ${Math.round(supremacyShare(this.s) * 100)}% of cities for ${VICTORY.supremacyTime / 60} min (from ${supremacyFrom(this.s) / 60}:00), or launch a rocket.`,
      'Left-click / drag: select.  Right-click: move, attack, build, board, set rally.',
      'Double-click or Ctrl+click: select all of that kind on screen.  Ctrl+1-9: make a group; 1-9: select it.',
      'Letters: the command card buttons (shown in each corner).  Builders: B opens the building menu.',
      'Mines go on ore, derricks on oil.  Infantry capture cities: stand in the ring with no enemies nearby.',
      "Counters: Riflemen beat Rocket Troopers, Rocket Troopers beat tanks, tanks beat Riflemen; flak and fighters down aircraft; submarines sink ships. A unit's tooltip and panel say what it beats.",
      'Cities grow and give cash, science, supply and Command Points. Their militia shoots intruders.',
      'At Town size a city picks a specialty (industry, university, fortress...).',
      "Take a rival's city and it resists: partisans rise unless you keep infantry in it.",
      'Command Powers (Tab or the left strip) cost Command Points. Call for Help brings allied AIs.',
      'Each new era lets you pick one of three doctrines.',
      'Whoever nears supremacy or starts a launch faces a coalition: everyone else hits them harder.',
      'A launch can be scrubbed: hold infantry beside the site with none of theirs there.',
      'Night cuts sight; rain slows ground units; storms ground aircraft. Grab the supply crates!',
      'HQ selected: trade cash for oil or science (O, L, J). Lose it, and your biggest city governs in exile.',
      'Home Front: land near your cities is your ground (dashed where it meets a rival\'s); your units slowly heal on it.',
      'Coastal cities send merchant ships to your Dock. Escort them: a sunk merchant pays its killer.',
      'City contracts (gold, top right): bid for the city (a ground unit there, then P), hold it, or take a bounty city from the leader.',
      'Your best three-star unit is your ace: it gets a name, allies near it hit harder, and its killer collects a bounty.',
      'Knocked out? Fight on: drop partisans at a city (V), and hold a Town for 3 min to come back.',
    ];
    const keys = ACTIONS.filter((a) => a !== 'debug').map((a) => `${ACTION_LABELS[a]}: ${this.d.input.binds[a].map(keyLabel).join(' / ')}`);
    const w = 460;
    // long rules wrap onto a second line rather than being cut off
    const lines = rules.flatMap((l) => wrapText(l, w - 12));
    const keyRows = Math.ceil(keys.length / 2);
    // on a short screen: pages (the rules, as many as they need, then the keys)
    const room = Math.max(4, Math.floor((ui.h - TOP_H - 4 - 26) / LINE_H));
    const pages: { rules: string[]; keys: boolean }[] = lines.length + 1 + keyRows <= room ? [{ rules: lines, keys: true }] : [];
    if (!pages.length) {
      for (let i = 0; i < lines.length; i += room) pages.push({ rules: lines.slice(i, i + room), keys: false });
      pages.push({ rules: [], keys: true });
    }
    this.helpPage %= pages.length;
    const pg = pages[this.helpPage];
    const h = 26 + pg.rules.length * LINE_H + (pg.keys ? (pg.rules.length ? 6 : 0) + keyRows * LINE_H : 0);
    const [x, y] = this.window(w, h, pages.length > 1 ? `How to play (${this.helpPage + 1}/${pages.length})` : 'How to play');
    if (pages.length > 1 && ui.button(x + w - 62, y + 3, 44, 11, { label: 'Next', tip: 'Next page' })) this.helpPage++;
    pg.rules.forEach((l, i) => ui.text(l, x + 6, y + 18 + i * LINE_H, COL.text));
    if (!pg.keys) return;
    const ky = y + 18 + pg.rules.length * LINE_H + (pg.rules.length ? 6 : 0);
    keys.forEach((l, i) => ui.text(l, x + 6 + (i % 2) * 225, ky + Math.floor(i / 2) * LINE_H, COL.light));
  }

  private stats(end: boolean, extra = 0): [number, number, number] {
    const ui = this.ui, s = this.s;
    const w = end ? 440 : 520, h = 60 + s.players.length * 12 + (end ? 98 : 0) + extra;
    const [x, y] = end ? [Math.round((ui.w - w) / 2), Math.round((ui.h - h) / 2)] : this.window(w, h, 'Match stats');
    if (end) ui.panel(x, y, w, h);
    // cities held now and taken in all; cash earned in all
    const cols = ['Player', 'Built', 'Lost', 'Kills', 'Cities', 'Taken', 'Earned', 'Techs', 'Score'];
    const cx = [6, 110, 145, 180, 215, 255, 295, 345, 380];
    const top = y + (end ? 50 : 20);
    cols.forEach((c, i) => ui.text(c, x + cx[i], top, COL.dim));
    s.players.forEach((p, r) => {
      const ry = top + 12 + r * 12;
      const held = s.cities.filter((c) => c.owner === p.id).length;
      const vals = [p.name + (p.alive ? '' : ' (out)'), p.stats.unitsBuilt, p.stats.unitsLost, p.stats.kills, held, p.stats.citiesCaptured, `$${fmt(p.stats.cashEarned)}`, p.techs.length, score(s, p.team)];
      vals.forEach((v, i) => ui.text(String(v), x + cx[i], ry, i === 0 ? color(s, p.id) : COL.text));
      // send an ally some cash or oil
      const me = s.players[this.me];
      if (!end && p.id !== this.me && p.alive && me.alive && p.team === me.team) {
        if (ui.button(x + 432, ry - 2, 38, 11, { label: `$${GIFT.cash}`, tip: `Send ${p.name} $${GIFT.cash}`, disabled: me.cash < GIFT.cash })) this.d.ctl.send({ t: 'gift', p: this.me, to: p.id, cash: GIFT.cash, oil: 0 });
        if (ui.button(x + 474, ry - 2, 40, 11, { label: `${GIFT.oil} oil`, tip: `Send ${p.name} ${GIFT.oil} oil`, disabled: me.oil < GIFT.oil })) this.d.ctl.send({ t: 'gift', p: this.me, to: p.id, cash: 0, oil: GIFT.oil });
      }
    });
    if (!end && s.players.some((p) => p.id !== this.me && p.team === s.players[this.me].team)) ui.text('Send', x + 432, top, COL.dim);
    return [x, y, w];
  }

  private menu() {
    const ui = this.ui, sess = this.d.session, loop = this.d.loop;
    const w = 160, h = 146 + (this.d.save ? 18 : 0);
    const [x, y] = this.window(w, h, 'Menu');
    let by = y + 18;
    const b = (label: string, act: () => void, opts: { color?: string; disabled?: boolean; tip?: string } = {}) => {
      if (ui.button(x + 6, by, w - 12, 16, { label, ...opts })) act();
      by += 18;
    };
    b('Resume', () => (this.panel = 'none'));
    const solo = sess.host && sess.status() === '';
    if (solo) b(`Speed: ${loop.speed}x`, () => { const sp = [0.5, 1, 1.5, 2, 3]; loop.speed = sp[(sp.indexOf(loop.speed) + 1) % sp.length]; }, { tip: 'Game speed (single player only)' });
    if (sess.host) b(loop.paused || sess.paused ? 'Unpause' : 'Pause', () => this.togglePause());
    const save = this.d.save;
    if (save && !this.s.over) b('Save game', () => {
      if (save()) this.say('Game saved. Continue it from the title screen.', COL.green);
      else this.say('Could not save: browser storage is full or blocked.', COL.red);
    }, { tip: 'One save slot. The match also saves itself every minute.' });
    b('How to play', () => (this.panel = 'help'));
    b('Field Guide', () => (this.panel = 'guide'), { tip: 'Every unit and building: what it costs, what it does, what it beats.' });
    b(`Colors: ${viewer.friendFoe ? 'friend or foe' : 'players'}`, () => setFriendFoe(!viewer.friendFoe),
      { tip: 'Players: everyone in their own color.\nFriend or foe: you blue, allies teal, enemies red.' });
    const armed = performance.now() - this.surrenderArmed < 3000;
    if (this.s.players[this.me].alive && !this.s.over) b(armed ? 'Really surrender?' : 'Surrender', () => {
      if (armed) { this.d.ctl.send({ t: 'surrender', p: this.me }); this.panel = 'none'; }
      else this.surrenderArmed = performance.now();
    }, { color: COL.red });
    b('Quit to title', () => this.d.quit(), { color: armed ? COL.red : undefined });
  }

  private endScreen() {
    const ui = this.ui, s = this.s;
    const over = s.over!;
    const won = over.winners >= 0 && over.winners === s.players[this.me].team;
    ui.ctx.globalAlpha = 0.5;
    ui.rect(0, 0, ui.w, ui.h, COL.shadow);
    ui.ctx.globalAlpha = 1;
    // the story of the match: its last moments if it was a long one, and the MVP
    const story = this.chronicle.entries.slice(-CHRONICLE_LINES);
    const mvp = this.chronicle.mvpText(s);
    const storyH = story.length || mvp ? 14 + (story.length + (mvp ? 1 : 0)) * LINE_H : 0;
    const [x, y, w] = this.stats(true, storyH);
    const title = over.winners < 0 ? 'Draw' : won ? 'Victory!' : 'Defeat';
    const reason: Record<string, string> = {
      conquest: 'by conquest: every rival knocked out', supremacy: 'by supremacy: held most of the cities', science: 'by science: the rocket launched',
      time: 'on time: highest score', draw: '',
    };
    ui.ctx.save();
    ui.textCenter(title, x + w / 2, y + 8, won ? COL.gold : COL.red);
    ui.ctx.restore();
    const winners = s.players.filter((p) => p.team === over.winners).map((p) => p.name).join(' & ');
    ui.textCenter(`${winners ? winners + ' won ' : ''}${reason[over.reason] ?? over.reason} at ${clock(over.tick)}`, x + w / 2, y + 22, COL.text);
    // the AI styles are revealed (a Random one was kept secret)
    const styles = s.setup.players.flatMap((p) => (p.kind === 'ai' && p.ai ? [`${p.name}: ${p.ai.personality ?? 'balanced'}`] : []));
    if (styles.length) ui.textCenter(ellipsize(`AI styles: ${styles.join(', ')}`, w - 12), x + w / 2, y + 34, COL.dim);
    // army value graph
    const gx = x + 10, gy = y + 60 + s.players.length * 12 + 10, gw = w - 20, gh = 60;
    ui.rect(gx, gy, gw, gh, COL.shadow);
    ui.text('Army value', gx + 3, gy + 2, COL.dim);
    const maxV = Math.max(1, ...s.players.flatMap((p) => p.stats.history.map((h) => h[0])));
    const n = Math.max(2, ...s.players.map((p) => p.stats.history.length));
    for (const p of s.players) {
      const hst = p.stats.history;
      ui.ctx.strokeStyle = color(s, p.id);
      ui.ctx.lineWidth = ui.s;
      ui.ctx.beginPath();
      hst.forEach((h, i) => {
        const px = (gx + (i / (n - 1)) * gw) * ui.s, py = (gy + gh - (h[0] / maxV) * (gh - 12)) * ui.s;
        if (i) ui.ctx.lineTo(px, py);
        else ui.ctx.moveTo(px, py);
      });
      ui.ctx.stroke();
    }
    let sy = gy + gh + 6;
    if (storyH) {
      ui.text('How it went', gx, sy, COL.dim);
      sy += 12;
      for (const e of story) {
        ui.text(clock(e.tick), gx, sy, COL.dim);
        ui.text(ellipsize(e.text, gw - 34), gx + 32, sy, e.owner >= 0 ? color(s, e.owner) : COL.text);
        sy += LINE_H;
      }
      if (mvp) { ui.text(mvp, gx, sy, COL.gold); sy += LINE_H; }
      sy += 2;
    }
    const by = sy;
    const again = this.d.rematch;
    const bw = 100, nb = again ? 4 : 2, left = x + w / 2 - (nb * (bw + 4) - 4) / 2;
    if (ui.button(left, by, bw, 16, { label: 'Keep watching' })) this.hideEnd = true;
    if (ui.button(left + bw + 4, by, bw, 16, { label: 'Main menu' })) this.d.quit();
    if (again) {
      if (ui.button(left + 2 * (bw + 4), by, bw, 16, { label: 'Rematch', tip: 'The same map and players again.' })) again(true);
      if (ui.button(left + 3 * (bw + 4), by, bw, 16, { label: 'New map', tip: 'The same players on a new map.' })) again(false);
    }
  }
}

const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
/** the end screen shows this many of the match's last key moments */
const CHRONICLE_LINES = 9;
const cy = (y: number) => y + 11;

/** Which units each building trains, in data order. */
const UNITS_AT: Record<string, string[]> = {};
for (const u of Object.values(UNITS)) for (const at of u.at) if (at !== 'city') (UNITS_AT[at] ??= []).push(u.id);

const ABILITY_LABEL: Record<string, string> = { digIn: 'Dig', flare: 'Flare', smoke: 'Smoke', barrage: 'Barge', afterburner: 'Burn', sonar: 'Sonar' };
const SHORT_POWER: Record<PowerId, string> = { recon: 'Recon', supplyDrop: 'Aid', repair: 'Fix', rally: 'Rally', strike: 'Strike', paradrop: 'Para', help: 'Help' };
/** sprite names of the units and buildings each tech unlocks */
const UNLOCKS = new Map<string, string[]>();
for (const u of Object.values(UNITS)) if (u.tech) UNLOCKS.set(u.tech, [...(UNLOCKS.get(u.tech) ?? []), `u:${u.id}:2`]);
for (const b of Object.values(BUILDINGS)) if (b.tech) UNLOCKS.set(b.tech, [...(UNLOCKS.get(b.tech) ?? []), `b:${b.id}`]);
const BRANCH: Record<string, string> = { economy: 'eco', land: 'land', air: 'air', naval: 'sea', science: 'sci' };

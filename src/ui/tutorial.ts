// Guides: step-by-step help on top of an ordinary match. They are UI only (CLAUDE.md rules 3 and
// 6): they read the state, say what to click next and point at it (on the map, or at a HUD
// button); the player does everything with the normal controls, so the match underneath is an
// ordinary one.
//
// Two programs share this:
// - Boot Camp, the tutorial match: every system once, one step at a time.
// - First Orders, in any other match until a player has finished it once (or hidden it): the
//   opening (ore, research, a city, oil, a Barracks, a Factory).
// Each step's hint follows what the player has selected and open, so it always names the very next
// click: "pick a Builder" -> "click Build" -> "click the Mine" -> "click the ore".
import type { Building, MatchState, Unit } from '../sim/types';
import { TICK_RATE } from '../sim/types';
import { UNITS } from '../data/units';
import { BUILDINGS } from '../data/buildings';
import { TECHS } from '../data/techs';
import { POWERS } from '../data/powers';
import { techBlocked } from '../sim/economy';
import { powerCost } from '../sim/powers';
import { allied, hqOf, unitCost } from '../sim/world';
import { TILE, type Camera } from '../render/view';
import type { Controller } from './control';
import { LINE_H, textWidth, wrapText } from './font';
import { COL, type UI } from './ui';

type Pt = { x: number; y: number };
export interface Rect { x: number; y: number; w: number; h: number }
/** what the guide needs to know about the HUD: what is open, and where its buttons were drawn this frame */
export interface HudView {
  buildPage: boolean;
  powerCard: boolean;
  panel: string;
  /** HUD buttons by name ('cmd:Build', 'build:mine', 'top:Research', 'tech:deepMining', 'train:rifleman', 'power:recon') */
  marks: Record<string, Rect>;
}
interface Ctx { s: MatchState; me: number; ctl: Controller; cam: Camera; hud: HudView; t: Tutorial }

/** The next thing to do, and what to point at. */
interface Hint {
  text: string;
  /** a spot on the map (world tiles), with a word by the arrow */
  at?: Pt | null;
  label?: string;
  /** a HUD button to light up (a key of HudView.marks), and a word or two by its arrow */
  mark?: string;
  tag?: string;
}
interface Step {
  title: string;
  /** why it matters, in a line (First Orders) */
  why?: string;
  hint: (c: Ctx) => Hint;
  done: (c: Ctx) => boolean;
}

export type Program = 'bootcamp' | 'orders';

/** how long the last step stays up (s) */
const OUTRO_SECONDS = 25;
/** the selection panel and command card cover this much of the bottom (UI units, with a margin: an edge arrow sits above them) */
const EDGE_BOTTOM = 92;
/** the minimap and powers strip in the bottom-left corner (UI units) */
const LEFT_COLUMN = { w: 96, h: 150 };
/** how far above its spot the bouncing arrow reaches, with its label (UI units) */
const ARROW_H = 42;
const CARD_W = 160;
/** First Orders: off once finished or hidden (remembered per browser) */
const ORDERS_KEY = 'pixel-rts.orders';

/** Should a new match show First Orders? */
export function ordersWanted(): boolean {
  try { return !localStorage.getItem(ORDERS_KEY); } catch { return true; }
}
function setOrders(v: 'done' | 'off' | null) {
  try { if (v) localStorage.setItem(ORDERS_KEY, v); else localStorage.removeItem(ORDERS_KEY); } catch { /* no storage: this session only */ }
}

// ------------------------------------------------------------------ reading the state

const mine = (s: MatchState, me: number) => Object.values(s.ents).filter((e) => e.owner === me);
const myUnits = (s: MatchState, me: number) => mine(s, me).filter((e): e is Unit => e.t === 'u');
const myBuildings = (s: MatchState, me: number, kind: string) => mine(s, me).filter((e): e is Building => e.t === 'b' && e.kind === kind);
const has = (s: MatchState, me: number, kind: string) => myBuildings(s, me, kind).length > 0;
const home = (c: Ctx): Pt => hqOf(c.s, c.me) ?? c.s.map.starts[c.me];
const nearest = <T extends Pt>(list: T[], from: Pt): T | null =>
  list.reduce<T | null>((b, p) => (!b || Math.hypot(p.x - from.x, p.y - from.y) < Math.hypot(b.x - from.x, b.y - from.y) ? p : b), null);
const pct = (f: number) => `${Math.floor(f * 100)}%`;

/** the nearest free deposit of a kind, pointed at its middle */
function deposit(c: Ctx, kind: 'ore' | 'oil'): Pt | null {
  // deposits are stored by their top-left tile; compare and point at their middles
  const mids = c.s.map.deposits.filter((d) => (kind === 'oil' ? d.kind === 'oil' : d.kind !== 'oil')).map((d) => ({ x: d.x + 1, y: d.y + 1 }));
  const taken = (m: Pt) => Object.values(c.s.ents).some((e) => e.t === 'b' && Math.abs(e.x - m.x) < 1.5 && Math.abs(e.y - m.y) < 1.5);
  return nearest(mids.filter((m) => !taken(m)), home(c));
}

/** the city I am already taking, else the nearest city nobody holds (or, failing that, a rival's) */
function targetCity(c: Ctx) {
  const myTeam = c.s.players[c.me].team;
  const taking = c.s.cities.filter((ci) => ci.owner !== c.me && ci.capTeam === myTeam && ci.capBy === c.me && ci.cap > 0);
  if (taking.length) return nearest(taking.map((ci) => ({ ...ci, x: ci.x + 0.5, y: ci.y + 0.5 })), home(c));
  const free = c.s.cities.filter((ci) => ci.owner < 0);
  const list = free.length ? free : c.s.cities.filter((ci) => ci.owner >= 0 && !allied(c.s, ci.owner, c.me));
  return nearest(list.map((ci) => ({ ...ci, x: ci.x + 0.5, y: ci.y + 0.5 })), home(c));
}

const selectedUnits = (c: Ctx) => c.ctl.myUnits();
const builderPicked = (c: Ctx) => selectedUnits(c).some((u) => UNITS[u.kind].builds);
const selectedBuilding = (c: Ctx, kind: string) => c.ctl.myBuildings().some((b) => b.kind === kind);

/** Pick a Builder (or train one at the HQ if there are none). */
function pickBuilder(c: Ctx): Hint {
  const builders = myUnits(c.s, c.me).filter((u) => UNITS[u.kind].builds && !u.inside);
  if (!builders.length) {
    if (selectedBuilding(c, 'hq')) return { text: 'Click the Builder button to train one.', mark: 'train:builder' };
    return { text: 'You have no Builders left. Click your HQ to train one.', at: home(c), label: 'HQ' };
  }
  return { text: 'Click one of your Builders (the yellow hard hats) to select it.', at: nearest(builders, home(c)), label: 'Builder' };
}

/** Put up a building: pick a Builder, open Build, pick the building, click where it goes. */
function buildHint(c: Ctx, kind: string, where: Hint): Hint {
  const d = BUILDINGS[kind], p = c.s.players[c.me];
  if (c.ctl.mode.m === 'place' && c.ctl.mode.kind === kind) return where;
  if (!builderPicked(c)) return pickBuilder(c);
  if (!c.hud.buildPage) return { text: 'Click Build (or press B) to open the building menu.', mark: 'cmd:Build' };
  const short = p.cash < d.cost.cash ? `$${d.cost.cash - Math.floor(p.cash)} more cash` : p.oil < d.cost.oil ? `${d.cost.oil - Math.floor(p.oil)} more oil` : '';
  if (short) return { text: `The ${d.name} costs $${d.cost.cash}${d.cost.oil ? ` and ${d.cost.oil} oil` : ''}: you need ${short}. It comes in every second, so wait a moment.`, mark: `build:${kind}` };
  return { text: `Click the ${d.name} (or press ${d.hotkey}). It costs $${d.cost.cash}${d.cost.oil ? ` and ${d.cost.oil} oil` : ''}.`, mark: `build:${kind}` };
}

/** Train a unit at a building of `at`: wait for it to finish, select it, click the unit's button. */
function trainHint(c: Ctx, at: string, kind: string): Hint {
  const d = UNITS[kind], ad = BUILDINGS[at], p = c.s.players[c.me];
  const bs = myBuildings(c.s, c.me, at);
  const ready = bs.filter((b) => b.built >= 1);
  if (!ready.length) {
    const b = nearest(bs, home(c));
    if (!b) return { text: `First build a ${ad.name}.` };
    return { text: `Your ${ad.name} is going up (${pct(b.built)}). Idle Builders come and help by themselves.`, at: b, label: ad.name };
  }
  if (!selectedBuilding(c, at)) return { text: `Click your ${ad.name} to select it.`, at: nearest(ready, home(c)), label: ad.name };
  const cost = unitCost(c.s, c.me, kind);
  if (p.oil < cost.oil) return { text: `A ${d.name} needs ${Math.round(cost.oil)} oil; you have ${Math.floor(p.oil)}. Oil comes from Derricks on oil wells.`, mark: `train:${kind}` };
  return { text: `Click the ${d.name} button (or press ${d.hotkey}). Shift-click queues five.`, mark: `train:${kind}` };
}

/** the first tech to suggest: Deep Mining if it can be started, else any open tech of this era */
function firstTech(c: Ctx) {
  const p = c.s.players[c.me];
  const open = TECHS.filter((t) => t.era <= p.era && !p.techs.includes(t.id) && !techBlocked(p, t.id));
  return open.find((t) => t.id === 'deepMining') ?? open.find((t) => t.branch === 'economy') ?? open[0];
}

function researchHint(c: Ctx): Hint {
  const t = firstTech(c);
  if (c.hud.panel !== 'research') return { text: 'Click Research at the top right (or press F2) to open the tech tree.', mark: 'top:Research' };
  if (!t) return { text: 'Click any tech to start researching it.' };
  return { text: `Click ${t.name} (${t.desc.replace(/\.$/, '')}) to start it, then close the window (Esc) and play on: it finishes by itself.`, mark: `tech:${t.id}`, tag: 'Start here' };
}

function cityHint(c: Ctx): Hint {
  const ci = targetCity(c);
  if (!ci) return { text: 'Every city is taken: take one back from a rival.' };
  const myTeam = c.s.players[c.me].team;
  if (ci.capTeam === myTeam && ci.capBy === c.me && ci.cap > 0) return { text: `Taking ${ci.name}: ${pct(ci.cap)}. Keep your troops inside the dashed ring until the bar fills.`, at: ci, label: ci.name };
  const picked = selectedUnits(c).filter((u) => UNITS[u.kind].captures);
  if (picked.length) return { text: `Right-click ${ci.name}, under the arrow. Your troops walk into its ring and take it while they stand inside.`, at: ci, label: ci.name };
  const troops = myUnits(c.s, c.me).filter((u) => UNITS[u.kind].captures && !u.inside);
  if (!troops.length) return { text: 'Only infantry take cities. Build a Barracks and train Riflemen (they are cheap).' };
  return { text: 'Select your Riflemen: drag a box around them, or double-click one to pick every Rifleman on screen.', at: nearest(troops, home(c)), label: 'Riflemen' };
}

const oreHint = (c: Ctx): Hint => buildHint(c, 'mine', { text: 'Now click the ore field the arrow points at. The outline turns green where the Mine fits; your Builder walks over and builds it.', at: deposit(c, 'ore'), label: 'Ore' });
const oilHint = (c: Ctx): Hint => buildHint(c, 'derrick', { text: 'Now click the oil well the arrow points at (the dark pool). Your Builder walks over and builds the Derrick.', at: deposit(c, 'oil'), label: 'Oil' });
const nearHome = (kind: string) => (c: Ctx): Hint => buildHint(c, kind, { text: `Click open ground near your HQ to place the ${BUILDINGS[kind].name} (red means it does not fit there).`, at: home(c), label: 'HQ' });

const startedResearch = (c: Ctx) => { const r = c.s.players[c.me].research; return !!r.cur || r.queue.length > 0 || c.s.players[c.me].techs.length > 0; };
const ownsCity = (c: Ctx) => c.s.cities.some((ci) => ci.owner === c.me);

// ------------------------------------------------------------------ the programs

const BOOT_CAMP: Step[] = [
  {
    title: 'Look around',
    hint: () => ({ text: 'Move the view with WASD, the arrow keys, the screen edges or the minimap. The mouse wheel zooms.' }),
    done: (c) => Math.hypot(c.cam.cx - c.t.camStart.x, c.cam.cy - c.t.camStart.y) / TILE > 6,
  },
  {
    title: 'Mine some ore',
    why: 'Cash pays for everything. A Mine on ore earns it for the rest of the match.',
    hint: oreHint,
    done: (c) => has(c.s, c.me, 'mine'),
  },
  {
    title: 'Pump some oil',
    why: 'Tanks, planes and ships need oil.',
    hint: oilHint,
    done: (c) => has(c.s, c.me, 'derrick'),
  },
  {
    title: 'Raise a Barracks',
    why: 'It trains infantry, the troops that take cities.',
    hint: nearHome('barracks'),
    done: (c) => has(c.s, c.me, 'barracks'),
  },
  {
    title: 'Train Riflemen',
    hint: (c) => trainHint(c, 'barracks', 'rifleman'),
    done: (c) => myBuildings(c.s, c.me, 'barracks').some((b) => b.prod.length > 0)
      || mine(c.s, c.me).filter((e) => e.kind === 'rifleman').length > c.t.riflemen,
  },
  {
    title: 'Take a city',
    why: 'Cities pay cash, science, supply and Command Points, and grow.',
    hint: cityHint,
    done: ownsCity,
  },
  {
    title: 'Research',
    why: 'Science from your HQ, cities and Labs buys techs: new units and bonuses.',
    hint: researchHint,
    done: startedResearch,
  },
  {
    title: 'Roll out a tank',
    why: 'Vehicles crush infantry in the open.',
    hint: (c) => (has(c.s, c.me, 'factory') ? trainHint(c, 'factory', 'lighttank') : nearHome('factory')(c)),
    done: (c) => mine(c.s, c.me).some((e) => e.t === 'u' && UNITS[e.kind].cls === 'vehicle' && !UNITS[e.kind].builds),
  },
  {
    title: 'Call in a power',
    why: 'Cities and your HQ earn Command Points (CP) to spend on powers.',
    hint: (c) => {
      const foe = c.s.players.find((p) => p.team !== c.s.players[c.me].team);
      const base = foe ? c.s.map.starts[foe.id] : null;
      if (c.ctl.mode.m === 'power') return { text: 'Click near the enemy base to fly over it.', at: base, label: 'Enemy base' };
      const cost = powerCost(c.s.players[c.me], 'recon'), cp = c.s.players[c.me].cp;
      if (cp < cost) return { text: `Recon Flight costs ${cost} CP; you have ${cp.toFixed(1)}. Wait a little: your HQ and cities earn more.`, mark: 'power:recon' };
      return { text: `Click ${POWERS.recon.name} in the powers list at the bottom left (or press Tab, then Z).`, mark: 'power:recon' };
    },
    done: (c) => Object.keys(c.s.players[c.me].powerReady).length > 0,
  },
  {
    title: 'Now win',
    hint: () => ({ text: 'Destroy the enemy HQ, hold most of the cities, or launch a rocket. Grow your cities, pick doctrines each era, and press F1 any time for the rules. Good luck, Commander!' }),
    done: (c) => c.t.outroAt >= 0 && c.s.tick - c.t.outroAt > OUTRO_SECONDS * TICK_RATE,
  },
];

const FIRST_ORDERS: Step[] = [
  {
    title: 'Mine some ore',
    why: 'Cash pays for everything. A Mine on ore earns it for the rest of the match.',
    hint: oreHint,
    done: (c) => has(c.s, c.me, 'mine'),
  },
  {
    title: 'Start research',
    why: 'Science from your HQ and cities buys techs: new units and more income.',
    hint: researchHint,
    done: startedResearch,
  },
  {
    title: 'Take a city',
    why: 'Cities pay cash, science, supply and Command Points, and grow.',
    hint: cityHint,
    done: ownsCity,
  },
  {
    title: 'Pump some oil',
    why: 'Tanks, planes and ships need oil.',
    hint: oilHint,
    done: (c) => has(c.s, c.me, 'derrick'),
  },
  {
    title: 'Raise a Barracks',
    why: 'It trains Riflemen, the troops that take cities.',
    hint: nearHome('barracks'),
    done: (c) => has(c.s, c.me, 'barracks'),
  },
  {
    title: 'Build a Factory',
    why: 'Factories build tanks and other vehicles (they cost oil).',
    hint: nearHome('factory'),
    done: (c) => has(c.s, c.me, 'factory'),
  },
  {
    title: 'You have the basics',
    hint: () => ({ text: 'Take more cities, grow your army and destroy the enemy HQ. F1 has every rule; Menu > Field Guide has every unit.' }),
    done: (c) => c.t.outroAt >= 0 && c.s.tick - c.t.outroAt > OUTRO_SECONDS * TICK_RATE,
  },
];

export class Tutorial {
  step = 0;
  /** the camera spot when the guide began (world pixels) */
  camStart: Pt = { x: 0, y: 0 };
  /** riflemen we started with */
  riflemen = 0;
  /** the tick the last step came up (-1 before) */
  outroAt = -1;
  skipped = false;
  private started = false;
  /** hint targets the camera has already been brought to ('step:label') */
  private shown = new Set<string>();
  /** this frame's HUD button to light up, drawn last, over the panels */
  private mark: string | null = null;
  private markTag: string | null = null;
  /** this frame's hint (the e2e checks read it) */
  hint: Hint | null = null;
  private readonly steps: Step[];

  constructor(readonly program: Program = 'bootcamp') {
    this.steps = program === 'bootcamp' ? BOOT_CAMP : FIRST_ORDERS;
  }

  get active(): boolean {
    return !this.skipped && this.step < this.steps.length;
  }

  /** the step count, for the e2e checks */
  get length(): number {
    return this.steps.length;
  }

  /** First Orders off for good (Hide), or on again from the menu. */
  hide() {
    this.skipped = true;
    if (this.program === 'orders') setOrders('off');
  }
  static showOrders() {
    setOrders(null);
  }

  /** Draw the step card at (x, y) in UI units and the pointer in the world; returns the height used. */
  draw(ui: UI, s: MatchState, me: number, ctl: Controller, cam: Camera, hud: HudView, x: number, y: number): number {
    this.mark = null;
    this.hint = null;
    if (!this.started) {
      this.started = true;
      this.camStart = { x: cam.cx, y: cam.cy };
      this.riflemen = Object.values(s.ents).filter((e) => e.owner === me && e.kind === 'rifleman').length;
    }
    if (!this.active) return 0;
    const c: Ctx = { s, me, ctl, cam, hud, t: this };
    // finished steps (also ones done early) fall away
    while (this.step < this.steps.length && this.steps[this.step].done(c)) {
      this.step++;
      if (this.step === this.steps.length - 1) this.outroAt = s.tick;
      if (this.step === this.steps.length && this.program === 'orders') setOrders('done');
    }
    if (!this.active) return 0;
    const st = this.steps[this.step];
    const hint = st.hint(c);
    this.hint = hint;
    const w = CARD_W;
    const lines = wrapText(hint.text, w - 10);
    const why = st.why ? wrapText(st.why, w - 10) : [];
    const h = 26 + lines.length * LINE_H + (why.length ? 3 + why.length * LINE_H : 0) + 2;
    ui.ctx.globalAlpha = 0.88;
    ui.rect(x, y, w, h, COL.shadow);
    ui.ctx.globalAlpha = 1;
    ui.rect(x, y, w, 1, COL.gold);
    const head = this.program === 'bootcamp' ? 'Boot Camp' : 'First orders';
    ui.text(`${head} ${this.step + 1}/${this.steps.length}`, x + 4, y + 4, COL.dim);
    ui.text(st.title, x + 4, y + 13, COL.gold);
    lines.forEach((l, i) => ui.text(l, x + 4, y + 24 + i * LINE_H, COL.white));
    const wy = y + 27 + lines.length * LINE_H;
    why.forEach((l, i) => ui.text(l, x + 4, wy + i * LINE_H, COL.dim));
    const close = this.program === 'bootcamp'
      ? { label: 'Skip', tip: 'Stop the tutorial and just play.' }
      : { label: 'Hide', tip: 'Hide these orders for good.\n(Menu > First orders brings them back.)' };
    hud.marks['guide:close'] = { x: x + w - 30, y: y + 2, w: 28, h: 10 };
    if (ui.button(x + w - 30, y + 2, 28, 10, close)) this.hide();
    ui.block(x, y, w, h);
    this.mark = hint.mark ?? null;
    this.markTag = hint.tag ?? null;
    if (hint.at) {
      const card = { x, y, w, h };
      // a new target that is off screen or under this card: bring the camera to it, once
      const key = `${this.step}:${hint.label ?? ''}`;
      if (!this.shown.has(key)) {
        this.shown.add(key);
        if (!this.visible(ui, cam, hint.at, card)) cam.centerOn(hint.at.x, hint.at.y);
      }
      this.pointer(ui, cam, hint.at, hint.label, s.tick, card);
    }
    return h + 4;
  }

  /** Light up this frame's HUD button (call after every panel is drawn, so it sits on top). */
  drawMark(ui: UI, marks: Record<string, Rect>, tick: number) {
    const r = this.active && this.mark ? marks[this.mark] : null;
    if (!r) return;
    const k = ui.s, ctx = ui.ctx;
    const on = Math.floor((tick / TICK_RATE) * 3) % 2 === 0;
    const bob = Math.round(Math.sin((tick / TICK_RATE) * 6) * 2);
    // a blinking gold frame around the button
    const c = on ? COL.gold : COL.white;
    ui.rect(r.x - 2, r.y - 2, r.w + 4, 1, c);
    ui.rect(r.x - 2, r.y + r.h + 1, r.w + 4, 1, c);
    ui.rect(r.x - 2, r.y - 2, 1, r.h + 4, c);
    ui.rect(r.x + r.w + 1, r.y - 2, 1, r.h + 4, c);
    // and an arrow at it: from below for the top bar, from above for the bottom card, from the left elsewhere
    const dir = r.y < 40 ? 'up' : r.y + r.h > ui.h - 100 ? 'down' : 'right';
    const tip = dir === 'up' ? { x: r.x + r.w / 2, y: r.y + r.h + 3 - bob } : dir === 'down' ? { x: r.x + r.w / 2, y: r.y - 3 + bob } : { x: r.x - 3 + bob, y: r.y + r.h / 2 };
    const a = dir === 'up' ? -Math.PI / 2 : dir === 'down' ? Math.PI / 2 : 0;
    ctx.save();
    ctx.translate(Math.round(tip.x) * k, Math.round(tip.y) * k);
    ctx.rotate(a);
    ctx.fillStyle = COL.gold;
    ctx.strokeStyle = COL.shadow;
    ctx.lineWidth = Math.max(1, k);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-8 * k, -6 * k);
    ctx.lineTo(-8 * k, -2 * k);
    ctx.lineTo(-14 * k, -2 * k);
    ctx.lineTo(-14 * k, 2 * k);
    ctx.lineTo(-8 * k, 2 * k);
    ctx.lineTo(-8 * k, 6 * k);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    // its words, past the arrow's tail (the guide card may be under a window just now)
    if (this.markTag) {
      const tw = textWidth(this.markTag) + 6;
      const tx = dir === 'right' ? tip.x - 16 - tw : tip.x - tw / 2;
      const ty = dir === 'up' ? tip.y + 16 : dir === 'down' ? tip.y - 26 : tip.y - 5;
      const lx = Math.round(Math.max(2, Math.min(ui.w - tw - 2, tx)));
      ui.ctx.globalAlpha = 0.85;
      ui.rect(lx, Math.round(ty), tw, 10, COL.shadow);
      ui.ctx.globalAlpha = 1;
      ui.text(this.markTag, lx + 3, Math.round(ty) + 1, COL.gold);
    }
  }

  /** Is the spot in the open play area (clear of the top bar, the bottom panels and the card), arrow included? */
  private visible(ui: UI, cam: Camera, at: Pt, card: Rect): boolean {
    const k = ui.s;
    const px = cam.sx(at.x) / k, py = cam.sy(at.y) / k;
    const x0 = 24, x1 = ui.w - 24, y0 = 34, y1 = ui.h - EDGE_BOTTOM;
    const leftCol = px < LEFT_COLUMN.w && py > ui.h - LEFT_COLUMN.h;
    // the arrow and its label stand up to ARROW_H units above the spot
    const underCard = px > card.x - 8 && px < card.x + card.w + 8 && py > card.y - 4 && py < card.y + card.h + ARROW_H;
    // (the arrow and its label must clear the top bar and the tracker too)
    return px > x0 && px < x1 && py - ARROW_H > y0 && py < y1 && !leftCol && !underCard;
  }

  /** A labelled bouncing arrow over the target, or one at the screen edge pointing to it (click it to go there). */
  private pointer(ui: UI, cam: Camera, at: Pt, label: string | undefined, tick: number, card: Rect) {
    const k = ui.s, ctx = ui.ctx;
    const px = cam.sx(at.x) / k, py = cam.sy(at.y) / k;
    // the open play area: clear of the top bar and tracker, and of the bottom panels
    const x0 = 24, x1 = ui.w - 24, y0 = 34, y1 = ui.h - EDGE_BOTTOM;
    // the minimap and powers strip fill the bottom-left column
    const leftCol = (x: number, y: number) => x < LEFT_COLUMN.w && y > ui.h - LEFT_COLUMN.h;
    const inside = this.visible(ui, cam, at, card);
    const bob = Math.round(Math.sin((tick / TICK_RATE) * 6) * 2);
    const tag = (cx: number, ty: number) => {
      if (!label) return;
      const tw = textWidth(label) + 6;
      const lx = Math.round(Math.max(2, Math.min(ui.w - tw - 2, cx - tw / 2)));
      ui.ctx.globalAlpha = 0.85;
      ui.rect(lx, ty, tw, 9, COL.shadow);
      ui.ctx.globalAlpha = 1;
      ui.text(label, lx + 3, ty + 1, COL.gold);
    };
    ctx.fillStyle = COL.gold;
    ctx.strokeStyle = COL.shadow;
    ctx.lineWidth = Math.max(1, k);
    if (inside) {
      // pointing down at the spot
      const tx = Math.round(px), ty = Math.round(py) - 16 + bob;
      ctx.beginPath();
      ctx.moveTo(tx * k, ty * k);
      ctx.lineTo((tx - 6) * k, (ty - 8) * k);
      ctx.lineTo((tx - 2) * k, (ty - 8) * k);
      ctx.lineTo((tx - 2) * k, (ty - 14) * k);
      ctx.lineTo((tx + 2) * k, (ty - 14) * k);
      ctx.lineTo((tx + 2) * k, (ty - 8) * k);
      ctx.lineTo((tx + 6) * k, (ty - 8) * k);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      tag(tx, ty - 25);
      return;
    }
    // at the edge of the play area, turned toward the spot
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const dx = px - cx, dy = py - cy;
    const f = Math.min((x1 - cx) / Math.abs(dx || 1e-6), (y1 - cy) / Math.abs(dy || 1e-6));
    const ex = Math.round(cx + dx * f);
    let ey = Math.round(cy + dy * f);
    if (leftCol(ex, ey)) ey = ui.h - LEFT_COLUMN.h - 8;
    // never under the card: just below it instead
    if (ex > card.x - 8 && ex < card.x + card.w + 8 && ey > card.y - 8 && ey < card.y + card.h + 8) ey = card.y + card.h + 12;
    const a = Math.atan2(dy, dx);
    ctx.save();
    ctx.translate(ex * k, ey * k);
    ctx.rotate(a);
    ctx.beginPath();
    ctx.moveTo((8 + bob) * k, 0);
    ctx.lineTo((bob - 2) * k, -7 * k);
    ctx.lineTo((bob - 2) * k, 7 * k);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    // the label sits just inside the arrow
    tag(ex - Math.cos(a) * 16, Math.round(ey - Math.sin(a) * 14) - 4);
    // (a small click box: a unit standing by the edge stays clickable)
    if (ui.hover(ex - 6, ey - 6, 12, 12)) ui.setTip(`Click to look there${label ? `: ${label}` : ''}`, ex, ey - 10);
    if (ui.clicked(ex - 6, ey - 6, 12, 12)) cam.centerOn(at.x, at.y);
  }
}

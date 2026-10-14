// Boot Camp: a first match that teaches one thing at a time. It is UI only (CLAUDE.md rules 3 and
// 6): it reads the state, says what to do next and points at it; the player does everything with
// the normal controls, so the match underneath is an ordinary skirmish.
import type { Building, MatchState } from '../sim/types';
import { TICK_RATE } from '../sim/types';
import { UNITS } from '../data/units';
import { hqOf } from '../sim/world';
import { TILE, type Camera } from '../render/view';
import type { Controller } from './control';
import { LINE_H, wrapText } from './font';
import { COL, type UI } from './ui';

type Pt = { x: number; y: number };
interface Ctx { s: MatchState; me: number; ctl: Controller; cam: Camera; t: Tutorial }
interface Step {
  title: string;
  text: string;
  done: (c: Ctx) => boolean;
  /** where to point, in world tiles */
  at?: (c: Ctx) => Pt | null;
}

/** how long the last step stays up (s) */
const OUTRO_SECONDS = 25;
/** the selection panel and command card cover this much of the bottom (UI units, with a margin: an edge arrow sits above them) */
const EDGE_BOTTOM = 92;
/** the minimap and powers strip in the bottom-left corner (UI units) */
const LEFT_COLUMN = { w: 96, h: 150 };
/** how far above its spot the bouncing arrow reaches (UI units) */
const ARROW_H = 32;

interface Rect { x: number; y: number; w: number; h: number }

const mine = (s: MatchState, me: number) => Object.values(s.ents).filter((e) => e.owner === me);
const has = (s: MatchState, me: number, kind: string) => mine(s, me).some((e) => e.t === 'b' && e.kind === kind);
const home = (c: Ctx): Pt => hqOf(c.s, c.me) ?? c.s.map.starts[c.me];
const nearest = <T extends Pt>(list: T[], from: Pt): T | null =>
  list.reduce<T | null>((b, p) => (!b || Math.hypot(p.x - from.x, p.y - from.y) < Math.hypot(b.x - from.x, b.y - from.y) ? p : b), null);
/** the nearest free deposit of a kind, pointed at its middle */
function deposit(c: Ctx, kind: 'ore' | 'oil'): Pt | null {
  // deposits are stored by their top-left tile; compare and point at their middles
  const mids = c.s.map.deposits.filter((d) => (kind === 'oil' ? d.kind === 'oil' : d.kind !== 'oil')).map((d) => ({ x: d.x + 1, y: d.y + 1 }));
  const taken = (m: Pt) => Object.values(c.s.ents).some((e) => e.t === 'b' && Math.abs(e.x - m.x) < 1.5 && Math.abs(e.y - m.y) < 1.5);
  return nearest(mids.filter((m) => !taken(m)), home(c));
}

const STEPS: Step[] = [
  {
    title: 'Look around',
    text: 'Scroll with the arrow keys, the screen edges or the minimap. The mouse wheel zooms.',
    done: (c) => Math.hypot(c.cam.cx - c.t.camStart.x, c.cam.cy - c.t.camStart.y) / TILE > 6,
  },
  {
    title: 'Pick a Builder',
    text: 'Left-click one of your Builders by the HQ. Builders put up every building.',
    done: (c) => [...c.ctl.selected].some((id) => c.s.ents[id] && UNITS[c.s.ents[id].kind]?.builds),
    at: (c) => nearest(mine(c.s, c.me).filter((e) => e.t === 'u' && UNITS[e.kind].builds), home(c)),
  },
  {
    title: 'Mine some ore',
    text: 'Press B for the building menu, pick the Mine (M) and click the ore by the arrow. Mines pay cash forever.',
    done: (c) => has(c.s, c.me, 'mine'),
    at: (c) => deposit(c, 'ore'),
  },
  {
    title: 'Pump some oil',
    text: 'Now a Derrick (O) on the oil well. Tanks, planes and ships need oil.',
    done: (c) => has(c.s, c.me, 'derrick'),
    at: (c) => deposit(c, 'oil'),
  },
  {
    title: 'Raise a Barracks',
    text: 'Build a Barracks (B, then B) near your HQ. It trains infantry.',
    done: (c) => has(c.s, c.me, 'barracks'),
    at: (c) => home(c),
  },
  {
    title: 'Train Riflemen',
    text: 'When it is finished, click the Barracks and train Riflemen (R). Shift+R queues five.',
    done: (c) => mine(c.s, c.me).some((e) => e.t === 'b' && e.kind === 'barracks' && (e as Building).prod.length > 0)
      || mine(c.s, c.me).filter((e) => e.kind === 'rifleman').length > c.t.riflemen,
    at: (c) => nearest(mine(c.s, c.me).filter((e) => e.t === 'b' && e.kind === 'barracks'), home(c)),
  },
  {
    title: 'Take a city',
    text: 'Drag a box around your Riflemen, then right-click inside the ring of the city by the arrow. Stay until the bar fills: the city is yours.',
    done: (c) => c.s.cities.some((ci) => ci.owner === c.me),
    at: (c) => {
      const ci = nearest(c.s.cities.filter((ci) => ci.owner < 0), home(c));
      return ci && { x: ci.x + 0.5, y: ci.y + 0.5 };
    },
  },
  {
    title: 'Research',
    text: 'Press F2 and pick a tech. Science comes from your HQ, cities and Labs; techs unlock units and bonuses.',
    done: (c) => !!c.s.players[c.me].research.cur || c.s.players[c.me].techs.length > 0,
  },
  {
    title: 'Roll out a tank',
    text: 'Build a Factory (B, then F), select it and build a Light Tank. Vehicles crush infantry in the open.',
    done: (c) => mine(c.s, c.me).some((e) => e.t === 'u' && UNITS[e.kind].cls === 'vehicle' && !UNITS[e.kind].builds),
    at: (c) => nearest(mine(c.s, c.me).filter((e) => e.t === 'b' && e.kind === 'factory'), home(c)) ?? home(c),
  },
  {
    title: 'Call in a power',
    text: 'Cities and your HQ earn Command Points. Press Tab, then Recon Flight (Z), and click near the enemy base to see it.',
    done: (c) => Object.keys(c.s.players[c.me].powerReady).length > 0,
    at: (c) => {
      const foe = c.s.players.find((p) => p.team !== c.s.players[c.me].team);
      return foe ? c.s.map.starts[foe.id] : null;
    },
  },
  {
    title: 'Now win',
    text: 'Destroy the enemy HQ, hold most of the cities, or launch a rocket. Grow your cities, pick doctrines each era, and press F1 any time for the rules. Good luck, Commander!',
    done: (c) => c.t.outroAt >= 0 && c.s.tick - c.t.outroAt > OUTRO_SECONDS * TICK_RATE,
  },
];

export class Tutorial {
  step = 0;
  /** the camera spot when the tutorial began (world pixels) */
  camStart: Pt = { x: 0, y: 0 };
  /** riflemen we started with */
  riflemen = 0;
  /** the tick the last step came up (-1 before) */
  outroAt = -1;
  skipped = false;
  private started = false;
  /** the step whose target the camera has already been brought to (-1 = none yet) */
  private shown = -1;

  get active(): boolean {
    return !this.skipped && this.step < STEPS.length;
  }

  /** Draw the step card at (x, y) in UI units and the pointer in the world; returns the height used. */
  draw(ui: UI, s: MatchState, me: number, ctl: Controller, cam: Camera, x: number, y: number): number {
    if (!this.started) {
      this.started = true;
      this.camStart = { x: cam.cx, y: cam.cy };
      this.riflemen = Object.values(s.ents).filter((e) => e.owner === me && e.kind === 'rifleman').length;
    }
    if (!this.active) return 0;
    const c: Ctx = { s, me, ctl, cam, t: this };
    // finished steps (also ones done early) fall away
    while (this.step < STEPS.length && STEPS[this.step].done(c)) {
      this.step++;
      if (this.step === STEPS.length - 1) this.outroAt = s.tick;
    }
    if (!this.active) return 0;
    const st = STEPS[this.step];
    const w = 150;
    const lines = wrapText(st.text, w - 10);
    const h = 26 + lines.length * LINE_H;
    ui.ctx.globalAlpha = 0.85;
    ui.rect(x, y, w, h, COL.shadow);
    ui.ctx.globalAlpha = 1;
    ui.rect(x, y, w, 1, COL.gold);
    ui.text(`Boot Camp ${this.step + 1}/${STEPS.length}`, x + 4, y + 4, COL.dim);
    ui.text(st.title, x + 4, y + 13, COL.gold);
    lines.forEach((l, i) => ui.text(l, x + 4, y + 24 + i * LINE_H, COL.text));
    if (ui.button(x + w - 30, y + 2, 28, 10, { label: 'Skip', tip: 'Stop the tutorial and just play.' })) this.skipped = true;
    ui.block(x, y, w, h);
    const at = st.at?.(c);
    if (at) {
      const card = { x, y, w, h };
      // a new step whose target is off screen or under this card: bring the camera to it, once
      if (this.shown !== this.step) {
        this.shown = this.step;
        if (!this.visible(ui, cam, at, card)) cam.centerOn(at.x, at.y);
      }
      this.pointer(ui, cam, at, s.tick, card);
    }
    return h + 4;
  }

  /** Is the spot in the open play area (clear of the top bar, the bottom panels and the card), arrow included? */
  private visible(ui: UI, cam: Camera, at: Pt, card: Rect): boolean {
    const k = ui.s;
    const px = cam.sx(at.x) / k, py = cam.sy(at.y) / k;
    const x0 = 24, x1 = ui.w - 24, y0 = 34, y1 = ui.h - EDGE_BOTTOM;
    const leftCol = px < LEFT_COLUMN.w && py > ui.h - LEFT_COLUMN.h;
    // the arrow stands up to 30 units above the spot
    const underCard = px > card.x - 8 && px < card.x + card.w + 8 && py > card.y - 4 && py < card.y + card.h + ARROW_H;
    return px > x0 && px < x1 && py > y0 && py < y1 && !leftCol && !underCard;
  }

  /** A bouncing arrow over the target, or one at the screen edge pointing to it (click it to go there). */
  private pointer(ui: UI, cam: Camera, at: Pt, tick: number, card: Rect) {
    const k = ui.s, ctx = ui.ctx;
    const px = cam.sx(at.x) / k, py = cam.sy(at.y) / k;
    // the open play area: clear of the top bar and tracker, and of the bottom panels
    const x0 = 24, x1 = ui.w - 24, y0 = 34, y1 = ui.h - EDGE_BOTTOM;
    // the minimap and powers strip fill the bottom-left column
    const leftCol = (x: number, y: number) => x < LEFT_COLUMN.w && y > ui.h - LEFT_COLUMN.h;
    const inside = this.visible(ui, cam, at, card);
    const bob = Math.round(Math.sin((tick / TICK_RATE) * 6) * 2);
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
    // (a small click box: a unit standing by the edge stays clickable)
    if (ui.hover(ex - 6, ey - 6, 12, 12)) ui.setTip('Click to look there', ex, ey - 10);
    if (ui.clicked(ex - 6, ey - 6, 12, 12)) cam.centerOn(at.x, at.y);
  }
}

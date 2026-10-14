// In-match controls: selection, camera, context orders, control groups, placement and targeting
// modes. Everything the player does becomes a Command sent through the session.
import { UNITS } from '../data/units';
import { BUILDINGS } from '../data/buildings';
import type { Building, City, Command, Ent, MatchState, Unit } from '../sim/types';
import { enemies, allied } from '../sim/world';
import { placementProblem } from '../sim/commands';
import { CAPTURE } from '../data/cities';
import type { PowerId } from '../data/powers';
import type { Session } from '../net/session';
import type { Input } from '../engine/input';
import type { Camera } from '../render/view';
import { TILE } from '../render/view';
import type { Fog } from '../render/fog';
import { detected } from '../sim/vision';
import { audio } from '../engine/audio';

export type Mode =
  | { m: 'normal' }
  | { m: 'place'; kind: string }
  | { m: 'attackMove' }
  | { m: 'patrol' }
  | { m: 'ability' }
  | { m: 'unload' }
  | { m: 'rally' }
  | { m: 'power'; power: PowerId };

export interface Marker { x: number; y: number; t: number; kind: 'move' | 'attack' | 'rally' }

export class Controller {
  selected = new Set<number>();
  selCity = -1;
  hover = 0;
  hoverCity = -1;
  mode: Mode = { m: 'normal' };
  groups = new Map<number, number[]>();
  markers: Marker[] = [];
  drag: { x0: number; y0: number } | null = null;
  private lastGroupKey = '';
  private lastGroupTime = 0;
  /** world tile under the mouse */
  mx = 0;
  my = 0;
  /** placement ghost validity, for the HUD */
  placeWhy: string | null = null;

  constructor(private session: Session, private cam: Camera, private input: Input, private fog: Fog) {}

  get s(): MatchState {
    return this.session.state;
  }
  get me(): number {
    return this.session.me;
  }

  send(c: Command) {
    this.session.send(c);
    if (c.t === 'attack' || (c.t === 'move' && c.am)) audio.sfx('attack');
    else if (c.t === 'move' || c.t === 'patrol' || c.t === 'load' || c.t === 'unload' || c.t === 'assist' || c.t === 'rally') audio.sfx('order');
    else if (c.t === 'build') audio.sfx('place');
  }

  /** Selected units owned by me. */
  myUnits(): Unit[] {
    const out: Unit[] = [];
    for (const id of this.selected) {
      const e = this.s.ents[id];
      if (e && e.t === 'u' && e.owner === this.me && !e.inside) out.push(e);
    }
    return out;
  }

  myBuildings(): Building[] {
    const out: Building[] = [];
    for (const id of this.selected) {
      const e = this.s.ents[id];
      if (e && e.t === 'b' && e.owner === this.me) out.push(e);
    }
    return out;
  }

  /** Drop dead or hidden entities from the selection. */
  prune() {
    for (const id of [...this.selected]) {
      const e = this.s.ents[id];
      if (!e || (e.t === 'u' && e.inside)) this.selected.delete(id);
      else if (e.owner !== this.me && !this.visible(e)) this.selected.delete(id);
    }
    if (this.selCity >= 0 && this.selected.size) this.selCity = -1;
  }

  visible(e: Ent): boolean {
    if (e.owner >= 0 && allied(this.s, e.owner, this.me)) return true;
    if (e.t === 'b') {
      const d = BUILDINGS[e.kind];
      for (let y = e.ty; y < e.ty + d.h; y++) for (let x = e.tx; x < e.tx + d.w; x++) if (this.fog.isVisible(x, y)) return true;
      return false;
    }
    if (!this.fog.isVisible(e.x, e.y) && this.s.setup.fog !== 'off') return false;
    if (UNITS[e.kind].stealth && !detected(this.s, this.s.players[this.me].team, e)) return false;
    return true;
  }

  /** Entity under a screen point (units first, then buildings). */
  pick(px: number, py: number, alpha: number, prev: Map<number, [number, number, number]>): Ent | null {
    const wx = this.cam.wx(px), wy = this.cam.wy(py);
    let best: Ent | null = null, bd = Infinity;
    for (const id in this.s.ents) {
      const e = this.s.ents[id];
      if (e.t === 'u') {
        if (e.inside || !this.visible(e)) continue;
        const p = prev.get(e.id);
        const x = p ? p[0] + (e.x - p[0]) * alpha : e.x;
        let y = p ? p[1] + (e.y - p[1]) * alpha : e.y;
        const d = UNITS[e.kind];
        if (d.layer === 'air') y -= 1.2;
        const cy = d.cls === 'infantry' ? y - 0.3 : y;
        const r = Math.max(0.35, d.radius + 0.15) / Math.max(0.5, Math.min(1, this.cam.z)) * (this.cam.strategic ? 2 : 1);
        const dist = Math.hypot(wx - x, wy - cy);
        if (dist < r && dist < bd) { bd = dist; best = e; }
      }
    }
    if (best) return best;
    for (const id in this.s.ents) {
      const e = this.s.ents[id];
      if (e.t !== 'b' || !this.visible(e)) continue;
      const d = BUILDINGS[e.kind];
      if (wx >= e.tx && wx < e.tx + d.w && wy >= e.ty - 0.5 && wy < e.ty + d.h) return e;
    }
    return null;
  }

  pickCity(px: number, py: number): City | null {
    const wx = this.cam.wx(px), wy = this.cam.wy(py);
    // cities are public landmarks: selectable under fog too (the panel says what is known)
    for (const c of this.s.cities) if (Math.hypot(wx - c.x - 0.5, wy - c.y - 0.5) < 2.2) return c;
    return null;
  }

  /** Camera input. */
  camera(dt: number, overUI: boolean) {
    const cam = this.cam, inp = this.input;
    const speed = (900 * dt) / Math.min(1, cam.z) / Math.max(1, cam.z / 2);
    let dx = 0, dy = 0;
    if (inp.isDown('panLeft')) dx -= speed;
    if (inp.isDown('panRight')) dx += speed;
    if (inp.isDown('panUp')) dy -= speed;
    if (inp.isDown('panDown')) dy += speed;
    // edge scrolling
    const edge = 6 * Math.max(1, inp.scale);
    if (inp.mouse.inside && document.hasFocus()) {
      if (inp.mouse.x < edge) dx -= speed;
      if (inp.mouse.x > cam.w - edge) dx += speed;
      if (inp.mouse.y < edge) dy -= speed;
      if (inp.mouse.y > cam.h - edge) dy += speed;
    }
    if (dx || dy) cam.pan(dx, dy);
    // middle drag
    if (inp.mouse.down[1] && inp.mouse.moved) {
      const [fx, fy] = inp.mouse.from[1];
      cam.pan(-(inp.mouse.x - fx) / cam.z, -(inp.mouse.y - fy) / cam.z);
      inp.mouse.from[1] = [inp.mouse.x, inp.mouse.y];
    }
    if (inp.mouse.wheel && !overUI) cam.zoomAt(-Math.sign(inp.mouse.wheel), inp.mouse.x, inp.mouse.y);
    if (inp.wasPressed('zoomIn')) cam.zoomAt(1, cam.w / 2, cam.h / 2);
    if (inp.wasPressed('zoomOut')) cam.zoomAt(-1, cam.w / 2, cam.h / 2);
  }

  /** Mouse on the battlefield (when not over the HUD). */
  pointer(alpha: number, prev: Map<number, [number, number, number]>, overUI: boolean, now: number) {
    const inp = this.input, cam = this.cam;
    this.mx = cam.wx(inp.mouse.x);
    this.my = cam.wy(inp.mouse.y);
    const under = overUI ? null : this.pick(inp.mouse.x, inp.mouse.y, alpha, prev);
    this.hover = under?.id ?? 0;
    const city = !under && !overUI ? this.pickCity(inp.mouse.x, inp.mouse.y) : null;
    this.hoverCity = city?.id ?? -1;

    if (this.mode.m === 'place') this.updatePlace();

    if (inp.mouse.pressed[0] && !overUI) {
      if (this.mode.m !== 'normal') {
        this.useMode(under, now);
        inp.consumeMouse(0);
        return;
      }
      this.drag = { x0: inp.mouse.x, y0: inp.mouse.y };
    }
    if (inp.mouse.released[0] && this.drag) {
      const { x0, y0 } = this.drag;
      this.drag = null;
      if (Math.hypot(inp.mouse.x - x0, inp.mouse.y - y0) > 6 * inp.scale) this.boxSelect(x0, y0, inp.mouse.x, inp.mouse.y, alpha, prev);
      else this.clickSelect(under, city, inp.mouse.dblclick || inp.ctrl);
    }
    if (inp.mouse.pressed[2] && !overUI) {
      if (this.mode.m !== 'normal') { this.mode = { m: 'normal' }; return; }
      this.contextOrder(under, city, now);
    }
  }

  private clickSelect(e: Ent | null, city: City | null, sameKind: boolean) {
    const add = this.input.shift;
    if (!e) {
      if (!add) this.selected.clear();
      this.selCity = city ? city.id : -1;
      return;
    }
    this.selCity = -1;
    if (sameKind && e.owner === this.me) {
      // every unit of this kind on screen
      if (!add) this.selected.clear();
      for (const id in this.s.ents) {
        const o = this.s.ents[id];
        if (o.owner !== this.me || o.kind !== e.kind || (o.t === 'u' && o.inside)) continue;
        const sx = this.cam.sx(o.x), sy = this.cam.sy(o.y);
        if (sx >= 0 && sy >= 0 && sx < this.cam.w && sy < this.cam.h) this.selected.add(o.id);
      }
      return;
    }
    if (add && e.owner === this.me) {
      if (this.selected.has(e.id)) this.selected.delete(e.id);
      else this.selected.add(e.id);
      return;
    }
    this.selected.clear();
    this.selected.add(e.id);
  }

  private boxSelect(x0: number, y0: number, x1: number, y1: number, alpha: number, prev: Map<number, [number, number, number]>) {
    const ax = Math.min(x0, x1), bx = Math.max(x0, x1), ay = Math.min(y0, y1), by = Math.max(y0, y1);
    const hits: Ent[] = [];
    for (const id in this.s.ents) {
      const e = this.s.ents[id];
      if (e.owner !== this.me || e.t !== 'u' || e.inside) continue;
      const p = prev.get(e.id);
      const x = p ? p[0] + (e.x - p[0]) * alpha : e.x, y = p ? p[1] + (e.y - p[1]) * alpha : e.y;
      const sx = this.cam.sx(x), sy = this.cam.sy(y - (UNITS[e.kind].layer === 'air' ? 1.2 : 0));
      if (sx >= ax && sx <= bx && sy >= ay && sy <= by) hits.push(e);
    }
    // a box of only builders and soldiers picks the soldiers (builders get left out)
    const army = hits.filter((e) => !UNITS[e.kind].builds);
    const pickList = army.length ? army : hits;
    if (!this.input.shift) this.selected.clear();
    for (const e of pickList) this.selected.add(e.id);
    if (pickList.length) this.selCity = -1;
  }

  /** Right click: the obvious order for what's under the cursor. */
  private contextOrder(e: Ent | null, city: City | null, now: number) {
    const q = this.input.shift;
    const units = this.myUnits();
    const x = this.mx, y = this.my;
    if (!units.length) {
      // set the rally point of selected production buildings / my city
      const bs = this.myBuildings();
      for (const b of bs) this.send({ t: 'rally', p: this.me, at: b.id, x, y });
      if (this.selCity >= 0 && this.s.cities[this.selCity]?.owner === this.me) this.send({ t: 'rally', p: this.me, at: this.selCity, city: true, x, y });
      if (bs.length || this.selCity >= 0) this.markers.push({ x, y, t: now, kind: 'rally' });
      return;
    }
    const ids = units.map((u) => u.id);
    if (e && e.owner >= 0 && enemies(this.s, this.me, e.owner)) {
      const armed = units.filter((u) => UNITS[u.kind].weapons.length).map((u) => u.id);
      if (armed.length) {
        this.send({ t: 'attack', p: this.me, ids: armed, target: e.id, q });
        this.markers.push({ x: e.x, y: e.y, t: now, kind: 'attack' });
      }
      const rest = ids.filter((id) => !armed.includes(id));
      if (rest.length) this.send({ t: 'move', p: this.me, ids: rest, x, y, q });
      return;
    }
    if (e && e.t === 'u' && e.owner === this.me && UNITS[e.kind].carries) {
      const land = units.filter((u) => UNITS[u.kind].layer === 'ground').map((u) => u.id);
      if (land.length) { this.send({ t: 'load', p: this.me, ids: land, target: e.id }); return; }
    }
    if (e && e.t === 'b' && allied(this.s, this.me, e.owner)) {
      const builders = units.filter((u) => UNITS[u.kind].builds).map((u) => u.id);
      if (builders.length) {
        this.send({ t: 'assist', p: this.me, ids: builders, target: e.id, q });
        const others = ids.filter((id) => !builders.includes(id));
        if (others.length) this.send({ t: 'move', p: this.me, ids: others, x, y, q });
        return;
      }
    }
    const carriers = units.filter((u) => u.cargo.length);
    if (carriers.length && this.fog && !this.isWater(x, y)) {
      this.send({ t: 'unload', p: this.me, ids: carriers.map((u) => u.id), x, y });
      const others = ids.filter((id) => !carriers.some((c) => c.id === id));
      if (others.length) this.send({ t: 'move', p: this.me, ids: others, x, y, q });
      this.markers.push({ x, y, t: now, kind: 'move' });
      return;
    }
    void city;
    this.send({ t: 'move', p: this.me, ids, x, y, q });
    this.markers.push({ x, y, t: now, kind: 'move' });
  }

  private isWater(x: number, y: number): boolean {
    const t = this.s.map.terrain[Math.floor(y) * this.s.map.w + Math.floor(x)];
    return t === 0 || t === 1;
  }

  /** Clicks in a targeting mode. */
  private useMode(under: Ent | null, now: number) {
    const m = this.mode;
    const x = this.mx, y = this.my;
    const ids = this.myUnits().map((u) => u.id);
    const keep = this.input.shift;
    switch (m.m) {
      case 'place': {
        const builders = this.myUnits().filter((u) => UNITS[u.kind].builds).map((u) => u.id);
        const [tx, ty] = this.placeTile(m.kind);
        if (!this.placeWhy && builders.length) {
          this.send({ t: 'build', p: this.me, ids: builders, kind: m.kind, tx, ty, q: keep });
          if (!keep) this.mode = { m: 'normal' };
        }
        return;
      }
      case 'attackMove':
        this.send({ t: 'move', p: this.me, ids, x, y, am: true, q: keep });
        this.markers.push({ x, y, t: now, kind: 'attack' });
        break;
      case 'patrol':
        this.send({ t: 'patrol', p: this.me, ids, x, y });
        this.markers.push({ x, y, t: now, kind: 'move' });
        break;
      case 'ability':
        this.send({ t: 'ability', p: this.me, ids, x, y });
        break;
      case 'unload':
        this.send({ t: 'unload', p: this.me, ids, x, y });
        break;
      case 'rally':
        for (const b of this.myBuildings()) this.send({ t: 'rally', p: this.me, at: b.id, x, y });
        if (this.selCity >= 0) this.send({ t: 'rally', p: this.me, at: this.selCity, city: true, x, y });
        this.markers.push({ x, y, t: now, kind: 'rally' });
        break;
      case 'power':
        this.send({ t: 'power', p: this.me, power: m.power, x, y });
        break;
    }
    void under;
    if (!keep || m.m === 'power') this.mode = { m: 'normal' };
  }

  /** Top-left tile for placing a building centered under the mouse (snaps to deposits). */
  placeTile(kind: string): [number, number] {
    const d = BUILDINGS[kind];
    let tx = Math.round(this.mx - d.w / 2), ty = Math.round(this.my - d.h / 2);
    if (d.on) {
      let best = null, bd = 4;
      for (const dep of this.s.map.deposits) {
        if (dep.kind !== d.on) continue;
        const dist = Math.hypot(dep.x + 1 - this.mx, dep.y + 1 - this.my);
        if (dist < bd) { bd = dist; best = dep; }
      }
      if (best) { tx = best.x; ty = best.y; }
    }
    return [tx, ty];
  }

  private updatePlace() {
    if (this.mode.m !== 'place') return;
    const [tx, ty] = this.placeTile(this.mode.kind);
    let why = placementProblem(this.s, this.me, this.mode.kind, tx, ty);
    // can't place where you've never looked
    const d = BUILDINGS[this.mode.kind];
    if (!why && this.s.setup.fog !== 'off') {
      for (let y = ty; y < ty + d.h && !why; y++) for (let x = tx; x < tx + d.w; x++) if (!this.fog.isExplored(x, y)) { why = 'unexplored ground'; break; }
    }
    const p = this.s.players[this.me];
    if (!why && (p.cash < d.cost.cash || p.oil < d.cost.oil)) why = 'not enough resources';
    this.placeWhy = why;
  }

  /** Keyboard: control groups, select-all, idle builder. */
  keys(now: number) {
    const inp = this.input;
    for (let k = 0; k <= 9; k++) {
      const code = 'Digit' + k;
      if (!inp.keyPressed(code)) continue;
      if (inp.ctrl) { this.groups.set(k, [...this.selected].filter((id) => this.s.ents[id]?.owner === this.me)); continue; }
      const g = (this.groups.get(k) ?? []).filter((id) => this.s.ents[id]);
      if (inp.shift) { for (const id of g) this.selected.add(id); continue; }
      if (!g.length) continue;
      this.selected = new Set(g);
      this.selCity = -1;
      if (this.lastGroupKey === code && now - this.lastGroupTime < 400) this.centerOnSelection();
      this.lastGroupKey = code;
      this.lastGroupTime = now;
    }
    if (inp.wasPressed('army')) {
      this.selected.clear();
      for (const id in this.s.ents) {
        const e = this.s.ents[id];
        if (e.t === 'u' && e.owner === this.me && !e.inside && !UNITS[e.kind].builds) this.selected.add(e.id);
      }
      this.selCity = -1;
    }
    if (inp.wasPressed('idleBuilder')) {
      const idle = Object.values(this.s.ents).filter((e): e is Unit => e.t === 'u' && e.owner === this.me && !!UNITS[e.kind].builds && !e.order && !e.inside);
      if (idle.length) {
        const cur = [...this.selected][0];
        const i = idle.findIndex((u) => u.id === cur);
        const u = idle[(i + 1) % idle.length];
        this.selected = new Set([u.id]);
        this.cam.centerOn(u.x, u.y);
      }
    }
  }

  centerOnSelection() {
    let x = 0, y = 0, n = 0;
    for (const id of this.selected) { const e = this.s.ents[id]; if (e) { x += e.x; y += e.y; n++; } }
    if (n) this.cam.centerOn(x / n, y / n);
  }

  /** Draw the drag box, placement ghost, order markers. */
  drawOverlay(ctx: CanvasRenderingContext2D, now: number) {
    const inp = this.input, cam = this.cam, z = cam.z;
    if (this.drag) {
      const { x0, y0 } = this.drag;
      if (Math.hypot(inp.mouse.x - x0, inp.mouse.y - y0) > 6 * inp.scale) {
        ctx.strokeStyle = '#1ebc73';
        ctx.lineWidth = Math.max(1, inp.scale);
        ctx.fillStyle = 'rgba(30,188,115,0.1)';
        const x = Math.min(x0, inp.mouse.x), y = Math.min(y0, inp.mouse.y), w = Math.abs(inp.mouse.x - x0), h = Math.abs(inp.mouse.y - y0);
        ctx.fillRect(x, y, w, h);
        ctx.strokeRect(x + 0.5, y + 0.5, w, h);
      }
    }
    if (this.mode.m === 'place') {
      const kind = this.mode.kind;
      const d = BUILDINGS[kind];
      const [tx, ty] = this.placeTile(kind);
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = this.placeWhy ? '#e83b3b' : '#1ebc73';
      for (let y = ty; y < ty + d.h; y++) for (let x = tx; x < tx + d.w; x++) ctx.fillRect(cam.sx(x) + 1, cam.sy(y) + 1, TILE * z - 2, TILE * z - 2);
      ctx.globalAlpha = 1;
      if (kind === 'turret' || kind === 'aagun' || kind === 'coastal') {
        const r = (d.weapons?.[0]?.range ?? 0) * TILE * z;
        ctx.strokeStyle = 'rgba(255,255,255,0.4)';
        ctx.beginPath();
        ctx.arc(cam.sx(tx + d.w / 2), cam.sy(ty + d.h / 2), r, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    if (this.mode.m === 'power' || this.mode.m === 'ability') {
      ctx.strokeStyle = '#f9c22b';
      ctx.lineWidth = Math.max(1, z);
      const r = 1.5 * TILE * z;
      ctx.beginPath();
      ctx.arc(inp.mouse.x, inp.mouse.y, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    this.markers = this.markers.filter((m) => now - m.t < 700);
    for (const m of this.markers) {
      const k = 1 - (now - m.t) / 700;
      const sx = cam.sx(m.x), sy = cam.sy(m.y);
      ctx.strokeStyle = m.kind === 'attack' ? '#e83b3b' : m.kind === 'rally' ? '#f9c22b' : '#1ebc73';
      ctx.lineWidth = Math.max(1, Math.round(z));
      const r = (4 + 8 * k) * Math.max(1, z);
      ctx.beginPath();
      ctx.moveTo(sx - r, sy); ctx.lineTo(sx, sy - r * 0.6); ctx.lineTo(sx + r, sy); ctx.lineTo(sx, sy + r * 0.6); ctx.closePath();
      ctx.stroke();
    }
    void CAPTURE;
  }
}

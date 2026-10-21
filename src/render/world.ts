// Draws the battlefield: terrain, cities, buildings, units (interpolated between ticks), shots,
// effects, fog, overlays, night and weather. Reads state only (CLAUDE.md rule 6).
import { ACES, CONTRACTS } from '../data/rules';
import { aceName, isAce } from '../sim/aces';
import { UNITS } from '../data/units';
import { BUILDINGS } from '../data/buildings';
import { PALETTE, C, rgba } from '../data/palette';
import { captureRadius } from '../sim/cities';
import type { Building, City, MatchState, Unit } from '../sim/types';
import { TICK_RATE } from '../sim/types';
import { unitMaxHp, buildingMaxHp, insurgent } from '../sim/world';
import { dropBlocked } from '../sim/insurgency';
import { darkness } from '../sim/weather';
import { detected, stealthy } from '../sim/vision';
import { sprite, drawSprite, facing8, opaqueBounds } from './art';
import { TerritoryLayer } from './territory';
import { TerrainLayer } from './terrain';
import type { Camera } from './view';
import { TILE } from './view';
import type { Fog } from './fog';
import type { Fx } from './fx';
import { drawText, textWidth, ICON } from '../ui/font';
import { viewColor, viewUi } from './colors';
import { Props, type Prop } from './props';
import { Ambient } from './ambient';
import { CELL, dither, ditherAlpha, levels } from './dither';
import { makeCanvas } from './pixbuf';

/** strategic zoom: at least STRAT_MERGE units of one owner within STRAT_CELL UI pixels of each
 *  other merge into one badge with a count */
const STRAT_CELL = 18, STRAT_MERGE = 4;
/** idle planes circle: radius (tiles), angular speed (rad/s), seconds to ease in or out */
const ORBIT = { r: 0.9, speed: 1.1, ease: 0.8 };
/** a plane over ground units (within `r` tiles) is drawn see-through, so it never hides a fight */
const OVERFLY = { r: 1.2, alpha: 0.8 };

export interface WorldView {
  me: number;
  team: number;
  selected: Set<number>;
  hover: number;
  hoverCity: number;
  selectedCity: number;
  prev: Map<number, [number, number, number]>;
  alpha: number;
  time: number;
  ui: number;
}

interface Item { y: number; draw: () => void; unit?: Unit }

/** a smoke screen: each puff's opacity at its heart, and the dithered alpha levels it is drawn in */
const SMOKE_ALPHA = 0.45;
const SMOKE_LEVELS = [0, 0.25, 0.5, 0.7];

/** health bars stay up this long after a hit */
const HURT_SHOW_MS = 3000;
/** how dark full night gets (outside the pools of light) */
const NIGHT_ALPHA = 0.5;

/** Text with a 1-pixel dark outline all round, readable on any terrain. */
function outlined(ctx: CanvasRenderingContext2D, str: string, x: number, y: number, color: string, ui: number) {
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) drawText(ctx, str, x + dx * ui, y + dy * ui, '#1a1420', ui, null);
  drawText(ctx, str, x, y, color, ui, null);
}

export class WorldRenderer {
  terrain: TerrainLayer;
  props: Props;
  ambient: Ambient;
  territory: TerritoryLayer;
  /** per aircraft: how far into its holding circle it is, and when that was worked out */
  private orbits = new Map<number, { b: number; t: number }>();
  private rain: { x: number; y: number; s: number }[] = [];

  constructor(s: MatchState) {
    this.terrain = new TerrainLayer(s.map, s.setup.seed);
    this.props = new Props(s, (x0, y0, x1, y1) => this.terrain.blocks(x0, y0, x1, y1));
    this.ambient = new Ambient(s.map, s.setup.seed);
    this.territory = new TerritoryLayer(s.map.w, s.map.h);
  }

  private prop(ctx: CanvasRenderingContext2D, p: Prop, cam: Camera, time: number) {
    const sp = sprite(p.name, -1);
    if (!sp) return;
    // livestock and wildlife turn around every so often, each on its own clock
    let flip = p.flip;
    if (p.alive && Math.floor(time / 3.7 + p.tile * 0.618) % 3 === 0) flip = !flip;
    drawSprite(ctx, sp, cam.sx(p.x), cam.sy(p.y), cam.z, flip);
  }

  /** Interpolated unit position (world tiles). */
  /** How far into its holding circle an idle plane is (0..1), easing in and out over ORBIT.ease s. */
  private orbitBlend(u: Unit, time: number): number {
    const o = this.orbits.get(u.id) ?? { b: 0, t: time };
    const dt = Math.min(0.25, Math.max(0, time - o.t));
    o.b = Math.max(0, Math.min(1, o.b + (u.mv ? -dt : dt) / ORBIT.ease));
    o.t = time;
    this.orbits.set(u.id, o);
    return o.b;
  }

  pos(u: Unit, v: WorldView): [number, number] {
    const p = v.prev.get(u.id);
    if (!p) return [u.x, u.y];
    if (Math.abs(p[0] - u.x) > 3 || Math.abs(p[1] - u.y) > 3) return [u.x, u.y];
    return [p[0] + (u.x - p[0]) * v.alpha, p[1] + (u.y - p[1]) * v.alpha];
  }

  colorOf(s: MatchState, owner: number): number {
    return viewColor(s, owner);
  }

  draw(ctx: CanvasRenderingContext2D, s: MatchState, cam: Camera, fog: Fog, fx: Fx, v: WorldView) {
    const z = cam.z;
    const [x0, y0, x1, y1] = cam.bounds(4);
    ctx.fillStyle = '#1a1420';
    ctx.fillRect(0, 0, cam.w, cam.h);
    this.terrain.draw(ctx, x0, y0, x1, y1, (tx) => cam.sx(tx), (ty) => cam.sy(ty), z, performance.now());
    // scenery: flat props lie on the ground now; tall ones are sorted in with the units below
    const props = this.props.visible(x0 - 2, y0 - 1, x1 + 2, y1 + 3);
    for (const p of props) if (p.flat) this.prop(ctx, p, cam, v.time);
    // Home Front borders lie on the ground, under everything else
    this.territory.update(s);
    this.territory.draw(ctx, s, cam, x0, y0, x1, y1);

    const inView = (x: number, y: number, r = 4) => x > x0 - r && y > y0 - r && x < x1 + r && y < y1 + r;
    const vis = (x: number, y: number) => s.setup.fog === 'off' || fog.isVisible(x, y);
    const mine = (owner: number) => owner >= 0 && s.players[owner].team === v.team;

    // ---- ground layer: cities, capture rings, smoke, rally zones
    for (const c of s.cities) if (inView(c.x, c.y, 6) && (fog.isExplored(c.x, c.y) || s.setup.fog === 'off')) this.city(ctx, s, c, cam, v);
    fx.drawWrecks(ctx, cam, (x, y) => inView(x, y));
    for (const fx2 of s.effects) {
      if (!inView(fx2.x, fx2.y, fx2.r + 2)) continue;
      const sx = cam.sx(fx2.x), sy = cam.sy(fx2.y), r = fx2.r * TILE * z;
      if (fx2.k === 'rally' && mine(fx2.owner)) this.circle(ctx, sx, sy, r, rgba(C.gold, 0.5), z);
      if (fx2.k === 'help' && mine(fx2.owner)) {
        // a flare for the team: its area, a pulse, and a column of signal smoke over a burning head
        const pulse = (v.time * 1.5) % 1;
        this.circle(ctx, sx, sy, r, rgba(C.lime, 0.35), z);
        this.circle(ctx, sx, sy, r * (0.2 + pulse * 0.8), rgba(C.lime, 0.9 * (1 - pulse)), z * 2);
        const bx = Math.round(sx), by = Math.round(sy);
        // the puffs rise and spread, drifting with a slow sway
        for (let i = 0; i < 12; i++) {
          const k = (i + ((v.time * 2) % 1)) / 12, size = Math.round(4 + k * 8);
          const sway = Math.round(Math.sin(v.time * 1.7 + i * 0.6) * k * 5);
          ctx.fillStyle = rgba(i % 3 ? C.lime : C.cream, 0.8 * (1 - k));
          ctx.fillRect(bx + (sway - size / 2) * z, by - Math.round(8 + k * 60) * z, size * z, size * z);
        }
        ctx.fillStyle = PALETTE[C.slate];
        ctx.fillRect(bx - z, by - 5 * z, 2 * z, 6 * z);
        ctx.fillStyle = PALETTE[Math.floor(v.time * 10) % 2 ? C.white : C.lime];
        ctx.fillRect(bx - 2 * z, by - 9 * z, 4 * z, 4 * z);
      }
      if (fx2.k === 'strike' && fx2.at !== undefined && s.tick < fx2.at) {
        if (Math.floor(v.time * 6) % 2) this.circle(ctx, sx, sy, r, rgba(C.red, 0.9), z * 2);
        ctx.fillStyle = rgba(C.red, 0.15);
        ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.fill();
      }
      if (fx2.k === 'fire') {
        if (Math.random() < 0.5) fx.parts.push({ x: fx2.x + (Math.random() - 0.5) * 2, y: fx2.y + (Math.random() - 0.5) * 2, z: 0, vx: 0, vy: 0, vz: 1.2, life: 0.6, max: 0.6, c: [C.gold, C.orange, C.ember][Math.floor(Math.random() * 3)], size: 2, kind: 'smoke' });
      }
    }

    // ---- foundation pads (ground level, under everything that stands)
    for (const id in s.ents) {
      const e = s.ents[id];
      if (e.t !== 'b') continue;
      const d = BUILDINGS[e.kind];
      if (!inView(e.tx + d.w / 2, e.ty + d.h / 2, d.w + 2)) continue;
      if (!mine(e.owner) && !this.footVisible(fog, e, s)) continue;
      this.pad(ctx, e.kind, cam.sx(e.tx), cam.sy(e.ty), d.w * TILE * z, d.h * TILE * z, z, d.on !== undefined);
    }
    for (const g of fog.ghosts.values()) {
      const d = BUILDINGS[g.kind];
      if (s.ents[g.id] && this.footVisible(fog, s.ents[g.id] as Building, s)) continue;
      if (inView(g.tx + d.w / 2, g.ty + d.h / 2, d.w + 2)) this.pad(ctx, g.kind, cam.sx(g.tx), cam.sy(g.ty), d.w * TILE * z, d.h * TILE * z, z, d.on !== undefined);
    }

    // ---- y-sorted: buildings, ground units, ships
    const items: Item[] = [];
    const air: Unit[] = [];
    /** where ground units are drawn this frame (tiles), for planes flying over them */
    const ground: [number, number][] = [];
    /** zoomed out, units are drawn as icons and badges after everything on the ground */
    const strat: Unit[] = [];
    for (const id in s.ents) {
      const e = s.ents[id];
      if (e.t === 'b') {
        const d = BUILDINGS[e.kind];
        if (!inView(e.tx + d.w / 2, e.ty + d.h / 2, d.w + 2)) continue;
        if (!mine(e.owner) && !this.footVisible(fog, e, s)) continue;
        items.push({ y: e.ty + d.h, draw: () => this.building(ctx, s, e, cam, v) });
        continue;
      }
      if (e.inside) continue;
      if (!inView(e.x, e.y)) continue;
      if (!mine(e.owner)) {
        if (!vis(e.x, e.y)) continue;
        if (stealthy(s, e) && !detected(s, v.team, e)) continue;
      }
      if (cam.strategic) { strat.push(e); continue; }
      if (UNITS[e.kind].layer === 'air') { air.push(e); continue; }
      const [px, py] = this.pos(e, v);
      ground.push([px, py]);
      items.push({ y: py, unit: e, draw: () => this.unit(ctx, s, e, px, py, cam, v) });
    }
    // remembered enemy buildings in the fog
    for (const g of fog.ghosts.values()) {
      const d = BUILDINGS[g.kind];
      if (!inView(g.tx + d.w / 2, g.ty + d.h / 2, d.w + 2)) continue;
      const live = s.ents[g.id];
      if (live && this.footVisible(fog, live as Building, s)) continue;
      items.push({ y: g.ty + d.h, draw: () => {
        const sp = sprite(`b:${g.kind}`, this.colorOf(s, g.owner));
        if (!sp) return;
        ctx.globalAlpha = 0.55;
        drawSprite(ctx, sp, cam.sx(g.tx), cam.sy(g.ty + d.h), z);
        ctx.globalAlpha = 1;
      } });
    }
    for (const c of s.crates) if (inView(c.x, c.y) && vis(c.x, c.y)) items.push({ y: c.y, draw: () => this.crate(ctx, c.x, c.y, cam, v) });
    for (const p of props) if (!p.flat) items.push({ y: p.y, draw: () => this.prop(ctx, p, cam, v.time) });
    items.sort((a, b) => a.y - b.y);
    for (const it of items) it.draw();
    if (strat.length) this.strategicUnits(ctx, s, strat, cam, v);

    // ---- shots in flight, effects
    for (const sh of s.shots) {
      const t = Math.min(1, (s.tick + v.alpha - sh.t0) / Math.max(1, sh.land - sh.t0));
      const x = sh.x0 + (sh.x - sh.x0) * t, y = sh.y0 + (sh.y - sh.y0) * t;
      if (!inView(x, y) || !vis(x, y)) continue;
      const arc = sh.cls === 'shell' || sh.cls === 'bomb' ? Math.sin(t * Math.PI) * (sh.cls === 'shell' ? 1.2 : 0) : 0;
      const sx = cam.sx(x), sy = cam.sy(y) - Math.round(arc * TILE * z);
      const k = Math.max(1, Math.round(z * (sh.cls === 'shell' ? 3 : 2)));
      ctx.fillStyle = sh.cls === 'rocket' || sh.cls === 'missile' ? PALETTE[C.coral] : PALETTE[C.ink];
      ctx.fillRect(sx - (k >> 1), sy - (k >> 1), k, k);
      if (sh.cls === 'rocket' || sh.cls === 'missile') {
        ctx.fillStyle = rgba(C.gold, 0.8);
        const bx = sx - Math.round(((sh.x - sh.x0) / (Math.hypot(sh.x - sh.x0, sh.y - sh.y0) || 1)) * 3 * z);
        const by = sy - Math.round(((sh.y - sh.y0) / (Math.hypot(sh.x - sh.x0, sh.y - sh.y0) || 1)) * 3 * z);
        ctx.fillRect(bx - (k >> 1), by - (k >> 1), k, k);
      }
    }
    const smokes = s.effects.filter((fx2) => fx2.k === 'smoke' && inView(fx2.x, fx2.y, fx2.r + 2));
    for (const fx2 of smokes) this.smoke(ctx, fx2, cam, v);
    // the units in the smoke keep their bars, stars and names on top of it
    if (smokes.length && !cam.strategic) for (const it of items) {
      const u = it.unit;
      if (!u || !smokes.some((f) => Math.hypot(u.x - f.x, u.y - f.y) < f.r * 1.2)) continue;
      const [px, py] = this.pos(u, v);
      this.unitBars(ctx, s, u, cam.sx(px), cam.sy(py), cam, v);
    }
    // cloud shadows drift over the ground and everything on it
    const dark = darkness(s);
    this.ambient.drawClouds(ctx, cam, v.time, dark, s.weather.rain);
    fx.draw(ctx, cam);
    for (const c of s.cities) if (inView(c.x, c.y, 6) && (fog.isExplored(c.x, c.y) || s.setup.fog === 'off')) this.cityLabel(ctx, s, c, cam, v);

    // ---- aircraft (shadow, then plane) above everything on the ground
    for (const u of air) {
      let [px, py] = this.pos(u, v);
      // a plane with nowhere to go circles its spot instead of hanging still (helicopters hover)
      let dir = u.dir;
      if (UNITS[u.kind].id !== 'helicopter') {
        const b = this.orbitBlend(u, v.time);
        if (b > 0) {
          const a = v.time * ORBIT.speed + u.id * 1.7;
          px += Math.cos(a) * ORBIT.r * b;
          py += Math.sin(a) * ORBIT.r * b;
          if (b > 0.5) dir = a + Math.PI / 2;
        }
      }
      const sp = sprite(`u:${u.kind}:${facing8(dir)}`, this.colorOf(s, u.owner));
      if (!sp) continue;
      const lift = 1.2;
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = PALETTE[C.ink];
      ctx.beginPath();
      ctx.ellipse(cam.sx(px), cam.sy(py), sp.w * 0.3 * z, sp.h * 0.15 * z, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      if (v.selected.has(u.id)) this.selRing(ctx, s, u, cam.sx(px), cam.sy(py - lift), cam, UNITS[u.kind].radius);
      // (the units drawn this frame, not the sim's spatial grid: rendering must never touch sim caches)
      if (ground.some(([gx, gy]) => Math.abs(gx - px) <= OVERFLY.r && Math.abs(gy - py) <= OVERFLY.r)) ctx.globalAlpha = OVERFLY.alpha;
      drawSprite(ctx, sp, cam.sx(px), cam.sy(py - lift), z);
      ctx.globalAlpha = 1;
      this.unitBars(ctx, s, u, cam.sx(px), cam.sy(py - lift), cam, v);
    }
    // forget planes that are gone
    if (this.orbits.size > air.length * 2 + 64) for (const id of this.orbits.keys()) if (!s.ents[id]) this.orbits.delete(id);

    this.ambient.drawBirds(ctx, cam, v.time, dark, s.weather.storm > 0);

    // ---- fog
    if (s.setup.fog !== 'off') {
      fog.draw(ctx, cam);
      // cities are public landmarks: an unexplored one still shows where it is and its name
      for (const c of s.cities) if (inView(c.x, c.y, 6) && !fog.isExplored(c.x, c.y)) this.landmark(ctx, s, c, cam, v);
    }

    // ---- night (with pools of light) and rain
    if (dark > 0) this.drawNight(ctx, s, cam, dark, v, (x, y) => s.setup.fog === 'off' || fog.isExplored(x, y));
    if (s.weather.rain > 0) this.drawRain(ctx, cam, s.weather.rain, s.weather.storm > 0, v);
  }

  /**
   * A building's footing: a packed-earth apron just around the base of its sprite (not the whole
   * footprint), with a darker rim and a contact shadow, so the building sits on the ground.
   */
  private pad(ctx: CanvasRenderingContext2D, kind: string, x: number, y: number, w: number, h: number, z: number, onDeposit: boolean) {
    if (onDeposit) return;
    const k = Math.max(1, z);
    const sp = sprite(`b:${kind}`, 0), ob = opaqueBounds(`b:${kind}`);
    // the sprite's base, in screen px (falls back to the footprint for placeholder art)
    let x0 = x, x1 = x + w, y1 = y + h, top = y;
    if (sp && ob) {
      const left = Math.round(x - sp.ox * z), sy = Math.round(y + h - sp.oy * z);
      x0 = left + ob.x0 * z; x1 = left + ob.x1 * z; y1 = sy + ob.y1 * z; top = sy + ob.y0 * z;
    }
    const baseH = Math.max(6 * k, Math.round((y1 - top) * 0.45));
    const ax0 = x0 - 2 * k, ax1 = x1 + 2 * k, ay0 = y1 - baseH, ay1 = y1 + 2 * k;
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = PALETTE[C.dust];
    ctx.fillRect(ax0, ay0, ax1 - ax0, ay1 - ay0);
    ctx.fillStyle = PALETTE[C.taupe];
    ctx.fillRect(ax0 + k, ay0 + k, ax1 - ax0 - 2 * k, ay1 - ay0 - 2 * k);
    // contact shadow along the bottom edge, falling a little to the right
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = PALETTE[C.ink];
    ctx.fillRect(x0 + 2 * k, y1 - 2 * k, x1 - x0, 3 * k);
    ctx.globalAlpha = 1;
  }

  /**
   * Night: a blue-dark layer with soft holes around cities, your buildings and your units, and a
   * warm glow on lit cities, so the battlefield stays readable while it reads as night.
   */
  /**
   * Night: a blue dark with pools of light around the viewer's team and the cities they have
   * seen, and a warm glow over cities. Zoomed in, both are drawn on a small canvas of art-pixel
   * cells anchored to the world and dithered (see dither.ts), so they read as pixel art.
   */
  private drawNight(ctx: CanvasRenderingContext2D, s: MatchState, cam: Camera, dark: number, v: WorldView, explored: (x: number, y: number) => boolean) {
    const z = cam.z;
    // the cell grid: whole cells of CELL art pixels, starting at a world-aligned cell left of and above the screen
    const cell = cam.strategic ? 1 : CELL * z;
    const per = cam.strategic ? 1 : TILE / CELL;
    const gx = cam.strategic ? 0 : Math.floor(cam.wx(0) * per), gy = cam.strategic ? 0 : Math.floor(cam.wy(0) * per);
    const ox = cam.strategic ? 0 : cam.sx(gx / per), oy = cam.strategic ? 0 : cam.sy(gy / per);
    const w = Math.ceil((cam.w - ox) / cell) + 1, h = Math.ceil((cam.h - oy) / cell) + 1;
    if (!this.nightCanvas || this.nightCanvas.width !== w || this.nightCanvas.height !== h) {
      this.nightCanvas = makeCanvas(w, h);
      this.glowCanvas = makeCanvas(w, h);
    }
    const toX = (wx: number) => (cam.sx(wx) - ox) / cell, toY = (wy: number) => (cam.sy(wy) - oy) / cell;
    const n = this.nightCanvas.getContext('2d', { willReadFrequently: true })!;
    n.globalCompositeOperation = 'source-over';
    n.clearRect(0, 0, w, h);
    const top = NIGHT_ALPHA * dark;
    n.fillStyle = `rgba(16, 20, 54, ${top})`;
    n.fillRect(0, 0, w, h);
    n.globalCompositeOperation = 'destination-out';
    const hole = (wx: number, wy: number, r: number, strength: number) => {
      const x = toX(wx), y = toY(wy), rr = (r * TILE * z) / cell;
      if (x < -rr || y < -rr || x > w + rr || y > h + rr) return;
      const g = n.createRadialGradient(x, y, 0, x, y, rr);
      g.addColorStop(0, `rgba(0,0,0,${strength})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      n.fillStyle = g;
      n.fillRect(x - rr, y - rr, rr * 2, rr * 2);
    };
    const myTeam = s.players[v.me]?.team;
    // (a city lights up the night only where the viewer has seen it: no glow gives away the unexplored)
    for (const c of s.cities) if (explored(c.x, c.y)) hole(c.x + 0.5, c.y + 0.5, 3 + c.level * 0.6, 0.85);
    for (const id in s.ents) {
      const e = s.ents[id];
      if (e.owner < 0 || s.players[e.owner].team !== myTeam) continue;
      if (e.t === 'b') hole(e.x, e.y, 3, 0.7);
      else if (!e.inside) hole(e.x, e.y, 1.6, 0.45);
    }
    // a warm glow over lit cities
    const gl = this.glowCanvas!.getContext('2d', { willReadFrequently: true })!;
    gl.clearRect(0, 0, w, h);
    const glow = 0.12 * dark;
    for (const c of s.cities) {
      if (!explored(c.x, c.y)) continue;
      const x = toX(c.x + 0.5), y = toY(c.y + 0.5), rr = ((2 + c.level * 0.4) * TILE * z) / cell;
      if (x < -rr || y < -rr || x > w + rr || y > h + rr) continue;
      const g = gl.createRadialGradient(x, y, 0, x, y, rr);
      g.addColorStop(0, `rgba(251, 185, 84, ${glow})`);
      g.addColorStop(1, 'rgba(251, 185, 84, 0)');
      gl.fillStyle = g;
      gl.fillRect(x - rr, y - rr, rr * 2, rr * 2);
    }
    if (!cam.strategic) {
      for (const [c2, lv] of [[n, levels(Math.round(255 * top), 4)], [gl, levels(Math.round(255 * glow), 2)]] as const) {
        const img = c2.getImageData(0, 0, w, h);
        ditherAlpha(img, lv, gx, gy);
        c2.putImageData(img, 0, 0);
      }
    }
    ctx.imageSmoothingEnabled = cam.strategic;
    ctx.drawImage(this.nightCanvas, ox, oy, w * cell, h * cell);
    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(this.glowCanvas!, ox, oy, w * cell, h * cell);
    ctx.globalCompositeOperation = 'source-over';
    ctx.imageSmoothingEnabled = false;
  }

  private footVisible(fog: Fog, b: Building, s: MatchState): boolean {
    if (s.setup.fog === 'off') return true;
    const d = BUILDINGS[b.kind];
    for (let y = b.ty; y < b.ty + d.h; y++) for (let x = b.tx; x < b.tx + d.w; x++) if (fog.isVisible(x, y)) return true;
    return false;
  }

  private circle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, w: number) {
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1, w);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  private city(ctx: CanvasRenderingContext2D, s: MatchState, c: City, cam: Camera, v: WorldView) {
    const z = cam.z;
    const cx = cam.sx(c.x + 0.5), cy = cam.sy(c.y + 0.5);
    const ownerColor = viewUi(s, c.owner);
    // a knocked-out viewer with partisans ready sees where they can drop them (a slow gold pulse)
    const me = s.players[v.me];
    const drop = !!me && !s.over && insurgent(s, me) && !dropBlocked(s, me, c);
    // capture circle
    if (drop || v.hoverCity === c.id || v.selectedCity === c.id || c.cap > 0 || cam.strategic) {
      ctx.setLineDash([4 * z, 4 * z]);
      if (drop) ctx.globalAlpha = 0.55 + 0.45 * Math.sin(v.time * 4);
      this.circle(ctx, cx, cy, captureRadius(c) * TILE * z, drop ? '#f9c22b' : ownerColor, z);
      ctx.globalAlpha = 1;
      ctx.setLineDash([]);
    }
    const sp = sprite(`city:${c.level}`, 0);
    if (sp) drawSprite(ctx, sp, cx, cy, z);
    // a specialty shows as a landmark at the city's edge: smokestack, observatory, tower, market, crane
    const mark = c.spec ? sprite(`prop:${c.spec}`, -1) : null;
    if (mark && sp) drawSprite(ctx, mark, cx + Math.round((sp.w / 2 - 6) * z), cy + Math.round((sp.h / 2 - 2) * z), z);
  }

  /** The city's flag, name, level and capture bar: drawn after the units, so a fight never hides them. */
  private cityLabel(ctx: CanvasRenderingContext2D, s: MatchState, c: City, cam: Camera, v: WorldView) {
    const z = cam.z;
    const cx = cam.sx(c.x + 0.5), cy = cam.sy(c.y + 0.5);
    const ownerColor = viewUi(s, c.owner);
    const sp = sprite(`city:${c.level}`, 0);
    // flag
    const fx = cx + Math.round(10 * z), fy = cy - Math.round(26 * z);
    ctx.fillStyle = PALETTE[C.ink];
    ctx.fillRect(fx, fy, Math.max(1, z), Math.round(14 * z));
    ctx.fillStyle = ownerColor;
    ctx.fillRect(fx + Math.max(1, z), fy, Math.round(8 * z), Math.round(5 * z));
    // a gold crown on the flagpole marks a government in exile
    const capital = c.owner >= 0 && s.players[c.owner].capital === c.id;
    if (capital) {
      const k = Math.max(1, z), gx = fx - 2 * k, gy = fy - 6 * k;
      const crown = ['x.x.x', 'xxxxx', 'xxxxx'];
      for (const [col, d] of [[PALETTE[C.ink], 1], ['#f9c22b', 0]] as const)
        crown.forEach((row, yy) => [...row].forEach((ch, xx) => {
          if (ch !== 'x') return;
          ctx.fillStyle = col;
          if (d) ctx.fillRect(gx + (xx - 1) * k, gy + (yy - 1) * k, 3 * k, 3 * k);
          else ctx.fillRect(gx + xx * k, gy + yy * k, k, k);
        }));
    }
    // name, level, capture progress
    if (z >= 1 || cam.strategic) {
      const ui = v.ui;
      const name = `${c.name}${c.spec ? ' ' + SPEC_ICON[c.spec] : ''}`;
      const tw = textWidth(name) * ui;
      const ty = cy + Math.round(sp ? (sp.h / 2) * z + 2 : 20);
      outlined(ctx, name, Math.round(cx - tw / 2), ty, ownerColor, ui);
      for (let i = 0; i < c.level; i++) {
        ctx.fillStyle = '#f9c22b';
        ctx.fillRect(Math.round(cx - (c.level * 4 * ui) / 2 + i * 4 * ui), ty + 10 * ui, 3 * ui, 3 * ui);
      }
      if (c.cap > 0) {
        const bw = 40 * ui;
        const capColor = c.capBy >= 0 ? viewUi(s, c.capBy) : '#ffffff';
        ctx.fillStyle = '#1a1420';
        ctx.fillRect(Math.round(cx - bw / 2) - 1, ty + 15 * ui - 1, bw + 2, 3 * ui + 2);
        ctx.fillStyle = capColor;
        ctx.fillRect(Math.round(cx - bw / 2), ty + 15 * ui, Math.round(bw * c.cap), 3 * ui);
      }
      let line = ty + 20 * ui;
      // zoomed out, cities sit close together: their status words would pile up, so only the bar
      // and the rare clocks everyone races (a contract, a re-founding) show
      if (!cam.strategic) {
        if (c.owner >= 0 && s.tick < c.calm) { outlined(ctx, 'unrest', Math.round(cx - textWidth('unrest') * ui / 2), line, '#e83b3b', ui); line += 8 * ui; }
        if (c.resistFor >= 0 && s.tick < c.resistUntil) { outlined(ctx, 'resisting', Math.round(cx - textWidth('resisting') * ui / 2), line, '#f79617', ui); line += 8 * ui; }
        if (capital) { outlined(ctx, 'capital', Math.round(cx - textWidth('capital') * ui / 2), line, '#f9c22b', ui); line += 8 * ui; }
        // our city waits for its specialty: say so on the map, blinking
        if (c.owner === v.me && c.specPending && Math.floor(v.time * 2.5) % 2 === 0) {
          const t = 'pick a specialty!';
          outlined(ctx, t, Math.round(cx - textWidth(t) * ui / 2), line, '#f9c22b', ui);
          line += 8 * ui;
        }
      }
      line = this.jobLabel(ctx, s, c, cx, line, v);
      // insurgents re-founding a government here: the clock everyone is racing
      const riser = s.players.find((p) => p.rising === c.id && insurgent(s, p));
      if (riser) {
        const left = Math.max(0, Math.ceil((riser.risingAt - s.tick) / TICK_RATE));
        const t = `rising ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
        outlined(ctx, t, Math.round(cx - textWidth(t) * ui / 2), line, '#f9c22b', ui);
      }
    }
  }

  /** A public job at city c, if any: what it is and how long it stays open (or how long the holder has left). Returns the next line's y. */
  private jobLabel(ctx: CanvasRenderingContext2D, s: MatchState, c: City, cx: number, line: number, v: WorldView): number {
    const k = s.contract, ui = v.ui;
    if (!k || k.city !== c.id) return line;
    const holding = k.kind === 'hold' && k.holder >= 0 && c.owner === k.holder;
    const tender = k.kind === 'supply' && k.closes > 0;
    const t = Math.max(0, Math.ceil(((holding ? k.since + CONTRACTS.hold * TICK_RATE : tender ? k.closes : k.until) - s.tick) / TICK_RATE));
    const word = k.kind === 'liberate' ? 'bounty' : tender ? 'tender' : k.kind === 'supply' ? 'supply' : holding ? 'held' : 'hold';
    const label = `${word} ${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
    const blink = Math.floor(v.time * 2) % 2 === 0;
    outlined(ctx, label, Math.round(cx - textWidth(label) * ui / 2), line, blink ? '#f9c22b' : '#fbff86', ui);
    return line + 8 * ui;
  }

  /**
   * An unexplored city over the fog: a map pin and its name in neutral grey (no owner, size or
   * capture: those are for scouts to find out), and any public job there.
   */
  private landmark(ctx: CanvasRenderingContext2D, s: MatchState, c: City, cam: Camera, v: WorldView) {
    const ui = v.ui, k = Math.max(1, Math.round(ui));
    const cx = cam.sx(c.x + 0.5), cy = cam.sy(c.y + 0.5);
    const pin = ['.xxx.', 'xx.xx', 'xxxxx', '.xxx.', '..x..'];
    const grey = PALETTE[C.pebble];
    for (const [col, out] of [[PALETTE[C.ink], true], [grey, false]] as const)
      pin.forEach((row, yy) => [...row].forEach((ch, xx) => {
        if (ch !== 'x') return;
        ctx.fillStyle = col;
        const px = cx + (xx - 2) * k, py = cy - 6 * k + yy * k;
        if (out) ctx.fillRect(px - k, py - k, 3 * k, 3 * k);
        else ctx.fillRect(px, py, k, k);
      }));
    if (v.selectedCity === c.id || v.hoverCity === c.id) this.circle(ctx, cx, cy, 2.2 * TILE * cam.z, 'rgba(255,255,255,0.5)', cam.z);
    if (cam.z < 1 && !cam.strategic) return;
    const tw = textWidth(c.name) * ui;
    outlined(ctx, c.name, Math.round(cx - tw / 2), cy + 2 * k, grey, ui);
    this.jobLabel(ctx, s, c, cx, cy + 2 * k + 9 * ui, v);
  }

  private building(ctx: CanvasRenderingContext2D, s: MatchState, b: Building, cam: Camera, v: WorldView) {
    const z = cam.z;
    const d = BUILDINGS[b.kind];
    const sp = sprite(`b:${b.kind}`, this.colorOf(s, b.owner));
    const x = cam.sx(b.tx), y = cam.sy(b.ty + d.h);
    const fw = d.w * TILE * z, fh = d.h * TILE * z;
    if (v.selected.has(b.id) || v.hover === b.id) {
      ctx.strokeStyle = v.selected.has(b.id) ? viewUi(s, b.owner) : 'rgba(255,255,255,0.5)';
      ctx.lineWidth = Math.max(1, z);
      ctx.strokeRect(x + 0.5, y - fh + 0.5, fw - 1, fh - 1);
    }
    if (b.built < 1) {
      // the building rising out of its foundation as it's built
      if (sp) {
        const visH = Math.max(1, Math.round(sp.h * b.built));
        ctx.globalAlpha = 0.85;
        ctx.drawImage(sp.img, sp.x, sp.y + sp.h - visH, sp.w, visH, Math.round(x - sp.ox * z), Math.round(y - sp.oy * z + (sp.h - visH) * z), sp.w * z, visH * z);
        ctx.globalAlpha = 1;
      }
      ctx.strokeStyle = PALETTE[C.amber];
      ctx.lineWidth = Math.max(1, z);
      // scaffolding poles up to the current height
      const top = y - Math.max(6 * z, fh * 0.75 * b.built + 6 * z);
      for (let i = 0; i <= d.w; i++) {
        const px = Math.round(x + Math.min(fw - z, i * TILE * z));
        ctx.beginPath(); ctx.moveTo(px, y - 2 * z); ctx.lineTo(px, top); ctx.stroke();
      }
      ctx.beginPath(); ctx.moveTo(x, top + 2 * z); ctx.lineTo(x + fw, top + 2 * z); ctx.stroke();
    } else if (sp) drawSprite(ctx, sp, x, y, z);
    // bars
    const max = buildingMaxHp(s, b);
    // a site under construction shows its progress up top, and its health only when it is hit
    const hit = this.hitRecently(b.id, b.hp);
    const show = b.built < 1 ? hit : b.hp < max * 0.5 || hit || v.selected.has(b.id) || v.hover === b.id;
    if (b.built < 1) this.progressBar(ctx, x + fw / 2, y - fh - 4 * z, Math.min(fw * 0.8, 40 * z), b.built, '#f9c22b', z);
    if (show) this.hpBar(ctx, x + fw / 2, y - fh - (b.built < 1 ? 9 : 4) * z, Math.min(fw, 48 * z), Math.min(1, b.hp / max), z);
    else if (b.prod.length) {
      const f = b.prod[0];
      this.progressBar(ctx, x + fw / 2, y - 6 * z, Math.min(fw * 0.8, 40 * z), 1 - f.left / f.total, b.blocked ? '#e83b3b' : '#1ebc73', z);
    }
    if (b.rally && v.selected.has(b.id)) {
      ctx.setLineDash([3 * z, 3 * z]);
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.beginPath();
      ctx.moveTo(x + fw / 2, y - fh / 2);
      ctx.lineTo(cam.sx(b.rally[0]), cam.sy(b.rally[1]));
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (s.launch?.id === b.id && !s.over) {
      const left = Math.max(0, (s.launch.done - s.tick) / TICK_RATE);
      const t = `LAUNCH ${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}`;
      // a beacon: rings pulsing out from the pad (faster in the last half minute), and a big clock
      const fast = left < 30, period = fast ? 0.5 : 1.2;
      for (const off of [0, 0.5]) {
        const k = ((v.time / period + off) % 1);
        ctx.strokeStyle = rgba(fast ? C.red : C.gold, 1 - k);
        ctx.lineWidth = Math.max(1, Math.round(2 * z));
        ctx.beginPath();
        ctx.arc(Math.round(x + fw / 2), Math.round(y - fh / 2), fw * (0.55 + k * 0.9), 0, Math.PI * 2);
        ctx.stroke();
      }
      const big = v.ui * 2;
      drawText(ctx, t, Math.round(x + fw / 2 - (textWidth(t) * big) / 2), y - fh - 22 * v.ui, fast && Math.floor(v.time * 4) % 2 ? '#e83b3b' : '#f9c22b', big, '#1a1420');
    }
  }

  /**
   * A smoke screen: soft grey puffs turning slowly, drawn as dithered cells on the world grid (like
   * the fog and the night) so it stays pixel art.
   */
  private smoke(ctx: CanvasRenderingContext2D, e: { x: number; y: number; r: number }, cam: Camera, v: WorldView) {
    const puffs = Array.from({ length: 7 }, (_, i) => {
      const a = i * 0.9 + v.time * 0.3, r = e.r * (0.4 + (i % 3) * 0.25);
      return { x: e.x + Math.cos(a) * r * 0.5, y: e.y + Math.sin(a) * r * 0.5, r: r * 0.6 };
    });
    const per = TILE / CELL, R = e.r * 1.2, cs = CELL * cam.z;
    const byLevel = new Map<number, [number, number][]>();
    for (let gy = Math.floor((e.y - R) * per); gy <= Math.ceil((e.y + R) * per); gy++)
      for (let gx = Math.floor((e.x - R) * per); gx <= Math.ceil((e.x + R) * per); gx++) {
        const wx = (gx + 0.5) / per, wy = (gy + 0.5) / per;
        // each puff a soft disc; overlapping puffs thicken (as the old translucent circles did)
        let clear = 1;
        for (const p of puffs) {
          const d = Math.hypot(wx - p.x, wy - p.y);
          if (d < p.r) clear *= 1 - SMOKE_ALPHA * Math.min(1, (p.r - d) / (p.r * 0.35));
        }
        const lv = dither(1 - clear, SMOKE_LEVELS, gx, gy);
        if (!lv) continue;
        let list = byLevel.get(lv);
        if (!list) byLevel.set(lv, (list = []));
        list.push([Math.round(cam.sx(gx / per)), Math.round(cam.sy(gy / per))]);
      }
    for (const [lv, cells] of byLevel) {
      ctx.fillStyle = rgba(C.pebble, lv);
      for (const [x, y] of cells) ctx.fillRect(x, y, cs, cs);
    }
  }

  private unit(ctx: CanvasRenderingContext2D, s: MatchState, u: Unit, px: number, py: number, cam: Camera, v: WorldView) {
    const z = cam.z;
    const d = UNITS[u.kind];
    const sx = cam.sx(px), sy = cam.sy(py);
    if (cam.strategic) {
      this.icon(ctx, s, u, sx, sy, v);
      return;
    }
    const f = facing8(u.dir);
    let sp = null;
    if (d.cls === 'infantry' && u.mv) sp = sprite(`u:${u.kind}:${f}:w${Math.floor(v.time * 8 + u.id) % 4}`, this.colorOf(s, u.owner));
    sp ??= sprite(`u:${u.kind}:${f}`, this.colorOf(s, u.owner));
    if (v.selected.has(u.id)) this.selRing(ctx, s, u, sx, sy, cam, d.radius);
    else if (v.hover === u.id) this.circle(ctx, sx, sy, d.radius * TILE * z * 1.2, 'rgba(255,255,255,0.45)', z);
    if (d.layer === 'naval') {
      // wake
      if (u.mv) {
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        const bx = sx - Math.round(Math.cos(u.dir) * d.radius * TILE * z), by = sy - Math.round(Math.sin(u.dir) * d.radius * TILE * z);
        ctx.fillRect(bx - z, by - z, 3 * z, 3 * z);
      }
      if (stealthy(s, u)) ctx.globalAlpha = 0.7;
    } else if (u.hide > s.tick) {
      // partisans landing hidden (their side sees them; it shows they are unseen, and how long for)
      ctx.globalAlpha = 0.5 + 0.15 * Math.sin(v.time * 5);
    }
    if (u.dug) {
      ctx.fillStyle = PALETTE[C.khaki];
      ctx.fillRect(sx - 7 * z, sy + 1 * z, 14 * z, 3 * z);
    }
    if (sp) drawSprite(ctx, sp, sx, sy, z);
    // ships fly a pennant in their team color (their hulls carry little of it)
    if (d.layer === 'naval' && sp) {
      const mx = sx, my = sy - Math.round(Math.min(sp.h * 0.5, d.radius * TILE * 1.1) * z);
      ctx.fillStyle = PALETTE[C.ink];
      ctx.fillRect(mx, my, z, 7 * z);
      ctx.fillRect(mx + z, my - z, 6 * z, 4 * z);
      ctx.fillStyle = viewUi(s, u.owner);
      ctx.fillRect(mx + z, my, 5 * z, 2 * z);
      // a merchant flies the trade flag: a gold band under the team color (a transport is plain)
      if (u.kind === 'merchant') {
        ctx.fillStyle = PALETTE[C.ink];
        ctx.fillRect(mx + z, my + 3 * z, 6 * z, 2 * z);
        ctx.fillStyle = '#f9c22b';
        ctx.fillRect(mx + z, my + 2 * z, 5 * z, 2 * z);
      }
    }
    ctx.globalAlpha = 1;
    this.unitBars(ctx, s, u, sx, sy, cam, v);
  }

  /** One unit at strategic zoom: a shape per class (dot infantry, square vehicle, triangle aircraft, bar ship). */
  private icon(ctx: CanvasRenderingContext2D, s: MatchState, u: Unit, sx: number, sy: number, v: WorldView) {
    const d = UNITS[u.kind];
    const col = v.selected.has(u.id) ? '#ffffff' : u.owner >= 0 ? viewUi(s, u.owner) : '#fff';
    const k = Math.round((d.cls === 'infantry' ? 1.5 : 2.5) * v.ui);
    sx = Math.round(sx); sy = Math.round(sy);
    ctx.fillStyle = '#1a1420';
    if (d.cls === 'aircraft') {
      ctx.beginPath(); ctx.moveTo(sx, sy - k - 2); ctx.lineTo(sx + k + 2, sy + k + 1); ctx.lineTo(sx - k - 2, sy + k + 1); ctx.fill();
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.moveTo(sx, sy - k); ctx.lineTo(sx + k, sy + k); ctx.lineTo(sx - k, sy + k); ctx.fill();
    } else if (d.cls === 'ship') {
      ctx.fillRect(sx - k - 2, sy - 3, k * 2 + 4, 6);
      ctx.fillStyle = col;
      ctx.fillRect(sx - k - 1, sy - 2, k * 2 + 2, 4);
    } else if (d.cls === 'infantry') {
      ctx.beginPath(); ctx.arc(sx, sy, k + 1, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(sx, sy, k, 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.fillRect(sx - k - 1, sy - k - 1, k * 2 + 2, k * 2 + 2);
      ctx.fillStyle = col;
      ctx.fillRect(sx - k, sy - k, k * 2, k * 2);
    }
  }

  /**
   * Strategic zoom: each owner's units that crowd one screen cell merge into a badge with a count
   * (an outline when any of them is selected); the rest are drawn as icons.
   */
  private strategicUnits(ctx: CanvasRenderingContext2D, s: MatchState, units: Unit[], cam: Camera, v: WorldView) {
    const r = STRAT_CELL * v.ui;
    const at = units.map((u) => { const [px, py] = this.pos(u, v); return [cam.sx(px), cam.sy(py)]; });
    // greedy clusters: each unit not yet taken gathers its owner's untaken units within r of it
    const taken = new Uint8Array(units.length);
    const groups: Unit[][] = [];
    for (let i = 0; i < units.length; i++) {
      if (taken[i]) continue;
      const g = [i];
      for (let j = i + 1; j < units.length; j++)
        if (!taken[j] && units[j].owner === units[i].owner && Math.abs(at[j][0] - at[i][0]) < r && Math.abs(at[j][1] - at[i][1]) < r) g.push(j);
      if (g.length < STRAT_MERGE) { taken[i] = 1; groups.push([units[i]]); continue; }
      for (const k of g) taken[k] = 1;
      groups.push(g.map((k) => units[k]));
    }
    for (const g of groups) {
      if (g.length < STRAT_MERGE) {
        for (const u of g) { const [px, py] = this.pos(u, v); this.icon(ctx, s, u, cam.sx(px), cam.sy(py), v); }
        continue;
      }
      let x = 0, y = 0;
      for (const u of g) { const [px, py] = this.pos(u, v); x += cam.sx(px) / g.length; y += cam.sy(py) / g.length; }
      const text = `${g.length}`;
      const w = (textWidth(text) + 4) * v.ui, h = 9 * v.ui;
      const bx = Math.round(x - w / 2), by = Math.round(y - h / 2);
      const sel = g.some((u) => v.selected.has(u.id));
      ctx.fillStyle = sel ? '#ffffff' : '#1a1420';
      ctx.fillRect(bx - v.ui, by - v.ui, w + 2 * v.ui, h + 2 * v.ui);
      ctx.fillStyle = g[0].owner >= 0 ? viewUi(s, g[0].owner) : '#fff';
      ctx.fillRect(bx, by, w, h);
      outlined(ctx, text, bx + 2 * v.ui, by + v.ui, '#ffffff', v.ui);
    }
  }

  private selRing(ctx: CanvasRenderingContext2D, s: MatchState, u: Unit, sx: number, sy: number, cam: Camera, r: number) {
    const z = cam.z;
    const col = viewUi(s, u.owner);
    ctx.strokeStyle = col;
    ctx.lineWidth = Math.max(1, z);
    ctx.beginPath();
    ctx.ellipse(sx, sy + 2 * z, r * TILE * z * 1.25, r * TILE * z * 0.8, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  private unitBars(ctx: CanvasRenderingContext2D, s: MatchState, u: Unit, sx: number, sy: number, cam: Camera, v: WorldView) {
    const z = cam.z;
    const max = unitMaxHp(s, u);
    const d = UNITS[u.kind];
    const top = sy - Math.round((d.cls === 'infantry' ? 22 : d.radius * TILE * 1.6) * z);
    if (u.hp < max * 0.5 || this.hitRecently(u.id, u.hp) || v.selected.has(u.id) || v.hover === u.id) this.hpBar(ctx, sx, top, Math.max(12, d.radius * TILE * 1.6) * z, u.hp / max, z);
    // an ace (wanted: a bounty on its head) wears a gold star where the veteran pips go, always
    // shown so rivals can find it; other veterans show their pips
    if (isAce(s, u)) {
      // twice the size of a pip row: the most wanted unit on the field should be easy to spot
      const k = 2 * v.ui, w = textWidth(ICON.star) * k;
      outlined(ctx, ICON.star, Math.round(sx - w / 2), Math.round(top - 16 * v.ui), '#f9c22b', k);
    } else for (let i = 0; i < u.vet; i++) {
      ctx.fillStyle = '#f9c22b';
      ctx.fillRect(Math.round(sx - (u.vet * 3 * z) / 2 + i * 3 * z), top - 3 * z, 2 * z, 2 * z);
    }
    // an ace: its name, and the reach of its aura, when you point at it
    if (isAce(s, u) && (v.selected.has(u.id) || v.hover === u.id)) {
      // the aura's reach: dashed gold over a dark shadow, so it reads on grass and sand alike
      ctx.lineWidth = Math.max(1, z);
      ctx.setLineDash([3 * z, 3 * z]);
      for (const [col, dy] of [['rgba(26, 20, 32, 0.5)', Math.max(1, z)], ['rgba(249, 194, 43, 0.9)', 0]] as const) {
        ctx.strokeStyle = col;
        ctx.beginPath();
        ctx.arc(sx, sy + dy, ACES.radius * TILE * z, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      const name = aceName(s, u);
      outlined(ctx, name, Math.round(sx - (textWidth(name) * v.ui) / 2), Math.round(top - 25 * v.ui), '#f9c22b', v.ui);
    }
    if (u.cargo.length) {
      drawText(ctx, String(u.cargo.length), sx + 6 * z, top - 4 * z, '#ffffff', v.ui, '#1a1420');
    }
  }

  /** last hp seen per entity, and when it last went down (render-side memory, wall clock) */
  private lastHp = new Map<number, { hp: number; at: number }>();
  /** offscreen layers for night (darkness with holes cut for lights, one cell per pixel) and the cities' warm glow */
  private nightCanvas: HTMLCanvasElement | null = null;
  private glowCanvas: HTMLCanvasElement | null = null;
  /** Was this entity hurt in the last few seconds? (Health bars show only then, or when low.) */
  private hitRecently(id: number, hp: number): boolean {
    const now = performance.now();
    const m = this.lastHp.get(id);
    if (!m) { this.lastHp.set(id, { hp, at: -1e9 }); return false; }
    if (hp < m.hp) m.at = now;
    m.hp = hp;
    if (this.lastHp.size > 5000) this.lastHp.clear();
    return now - m.at < HURT_SHOW_MS;
  }

  private hpBar(ctx: CanvasRenderingContext2D, cx: number, y: number, w: number, frac: number, z: number) {
    const h = Math.max(2, Math.round(2 * z));
    const x = Math.round(cx - w / 2);
    ctx.fillStyle = '#1a1420';
    ctx.fillRect(x - 1, y - 1, Math.round(w) + 2, h + 2);
    ctx.fillStyle = frac > 0.6 ? '#1ebc73' : frac > 0.3 ? '#f9c22b' : '#e83b3b';
    ctx.fillRect(x, y, Math.round(w * Math.max(0, Math.min(1, frac))), h);
  }

  private progressBar(ctx: CanvasRenderingContext2D, cx: number, y: number, w: number, frac: number, color: string, z: number) {
    const h = Math.max(2, Math.round(2 * z));
    const x = Math.round(cx - w / 2);
    ctx.fillStyle = '#1a1420';
    ctx.fillRect(x - 1, y - 1, Math.round(w) + 2, h + 2);
    ctx.fillStyle = color;
    ctx.fillRect(x, y, Math.round(w * Math.max(0, Math.min(1, frac))), h);
  }

  private crate(ctx: CanvasRenderingContext2D, x: number, y: number, cam: Camera, v: WorldView) {
    const z = cam.z;
    const sx = cam.sx(x), sy = cam.sy(y);
    const bob = Math.round(Math.sin(v.time * 3) * 2 * z);
    ctx.fillStyle = '#1a1420';
    ctx.fillRect(sx - 6 * z, sy - 6 * z + bob, 12 * z, 12 * z);
    ctx.fillStyle = PALETTE[C.amber];
    ctx.fillRect(sx - 5 * z, sy - 5 * z + bob, 10 * z, 10 * z);
    ctx.fillStyle = PALETTE[C.rust];
    ctx.fillRect(sx - 5 * z, sy - z + bob, 10 * z, 2 * z);
    ctx.fillRect(sx - z, sy - 5 * z + bob, 2 * z, 10 * z);
    // glint so crates catch the eye
    if (Math.floor(v.time * 2) % 3 === 0) { ctx.fillStyle = '#ffffff'; ctx.fillRect(sx - 4 * z, sy - 4 * z + bob, 2 * z, 2 * z); }
  }

  private drawRain(ctx: CanvasRenderingContext2D, cam: Camera, amount: number, storm: boolean, v: WorldView) {
    const want = Math.round((storm ? 260 : 160) * amount);
    while (this.rain.length < want) this.rain.push({ x: Math.random() * cam.w, y: Math.random() * cam.h, s: 0.7 + Math.random() * 0.6 });
    this.rain.length = want;
    ctx.strokeStyle = storm ? 'rgba(200,220,255,0.45)' : 'rgba(170,200,255,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const r of this.rain) {
      r.y += 14 * r.s * (storm ? 1.5 : 1);
      r.x -= 3 * r.s * (storm ? 2 : 1);
      if (r.y > cam.h) { r.y = -10; r.x = Math.random() * cam.w * 1.2; }
      if (r.x < -10) r.x = cam.w;
      ctx.moveTo(r.x, r.y);
      ctx.lineTo(r.x - 3 * (storm ? 2 : 1), r.y + 9);
    }
    ctx.stroke();
    if (storm && Math.random() < 0.004) { ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillRect(0, 0, cam.w, cam.h); }
    void v;
  }
}

// specialty glyphs after a city's name (pictures, so they can't be misread as Roman numerals)
export const SPEC_ICON: Record<string, string> = { industry: ICON.cog, academy: ICON.science, fortress: ICON.shield, market: ICON.coin, port: ICON.anchor };

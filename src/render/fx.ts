// Visual effects driven by sim events: tracers, muzzle flashes, explosions, smoke, floating text.
// Purely cosmetic; positions are in world tiles. Particles use Math.random (render only — the sim
// never sees them).
import { C, PALETTE } from '../data/palette';
import { UNITS } from '../data/units';
import type { SimEvent } from '../sim/types';
import type { Camera } from './view';
import { TILE } from './view';
import { drawText } from '../ui/font';
import { charred, drawSprite, facing8 } from './art';

/** gun tracers fly at this many tiles per second and are this many pixels long */
const TRACER_SPEED = 45, TRACER_LEN = 5;
/** smoke never gets more opaque than this, so it doesn't hide the fight */
const SMOKE_ALPHA = 0.45;
/** a destroyed vehicle or aircraft leaves a burnt hull for this long (s), smoking for the first
 *  part and fading out at the end; a ship sinks in `WRECK_SINK` s */
const WRECK_LIFE = 20, WRECK_SMOKE = 8, WRECK_FADE = 4, WRECK_SINK = 5;
/** a hull is drawn a little see-through over its scorch mark */
const WRECK_ALPHA = 0.8, SCORCH = 0.25;

interface Particle { x: number; y: number; z: number; vx: number; vy: number; vz: number; life: number; max: number; c: number; size: number; kind: 'spark' | 'smoke' | 'debris' | 'flash' | 'ring' }
/** a short streak flying from (x0, y0) to (x1, y1) over `max` seconds */
interface Tracer { x0: number; y0: number; x1: number; y1: number; life: number; max: number; c: number; w: number }
interface Floater { x: number; y: number; text: string; c: number; life: number }
interface Wreck { x: number; y: number; name: string; life: number; max: number; ship: boolean; puff: number }

export class Fx {
  parts: Particle[] = [];
  tracers: Tracer[] = [];
  floaters: Floater[] = [];
  wrecks: Wreck[] = [];
  /** screen shake amount (px), decays */
  shake = 0;

  onEvents(ev: SimEvent[], visible: (x: number, y: number) => boolean, me: number, posOf: (id: number) => [number, number] | null, cityAt: (id: number) => [number, number]) {
    for (const e of ev) {
      switch (e.e) {
        case 'shot': {
          if (!visible(e.x0, e.y0) && !visible(e.x1, e.y1)) break;
          const dx = e.x1 - e.x0, dy = e.y1 - e.y0, d = Math.hypot(dx, dy) || 1;
          const mx = e.x0 + (dx / d) * 0.4, my = e.y0 + (dy / d) * 0.4;
          this.flash(mx, my, e.w === 'cannon' || e.w === 'shell' ? 3 : 2);
          if (e.w === 'gun') {
            const fly = Math.max(0.04, d / TRACER_SPEED);
            this.tracers.push({ x0: mx, y0: my, x1: e.x1 + (Math.random() - 0.5) * 0.3, y1: e.y1 + (Math.random() - 0.5) * 0.3, life: fly, max: fly, c: C.cream, w: 1 });
          }
          if (e.w === 'flak') for (let i = 0; i < 3; i++) this.puff(e.x1 + (Math.random() - 0.5), e.y1 + (Math.random() - 0.5), 0.6, C.stone, 2);
          break;
        }
        case 'hit':
          if (!visible(e.x, e.y)) break;
          this.boom(e.x, e.y, e.big ? 1.4 : e.cls === 'gun' ? 0.25 : 0.7, e.cls === 'gun' ? 0 : 1);
          if (e.big) this.shake = Math.max(this.shake, 3);
          break;
        case 'die':
          if (!visible(e.x, e.y)) break;
          this.boom(e.x, e.y, e.b ? 2.4 : 1, 2);
          if (e.b) this.shake = Math.max(this.shake, 6);
          else if (UNITS[e.kind] && UNITS[e.kind].cls !== 'infantry') {
            const ship = UNITS[e.kind].cls === 'ship';
            const life = ship ? WRECK_SINK : WRECK_LIFE;
            this.wrecks.push({ x: e.x, y: e.y, name: `u:${e.kind}:${facing8(e.dir ?? 0)}`, life, max: life, ship, puff: 0 });
          }
          break;
        case 'convoy':
          if (visible(e.x, e.y) && (e.p === me || e.by === me)) this.text(e.x, e.y, `+$${e.cash}`, C.gold);
          break;
        case 'crate':
          this.text(e.x, e.y, e.reward === 'cash' ? `+$${e.amount}` : e.reward === 'oil' ? `+${e.amount} oil` : e.reward === 'science' ? `+${e.amount} sci` : e.reward === 'cp' ? `+${e.amount} CP` : 'Veteran!', e.p === me ? C.cream : C.pebble);
          this.ring(e.x, e.y, C.cream);
          break;
        case 'vet': {
          const at = posOf(e.id);
          if (!at || !visible(at[0], at[1])) break;
          this.ring(at[0], at[1], C.gold);
          this.text(at[0], at[1], '\u0004'.repeat(e.stars), C.gold);
          break;
        }
        case 'capture':
          break;
        // partisans land: green signal smoke rising around the city
        case 'insurge': {
          const [cx, cy] = cityAt(e.city);
          if (!visible(cx, cy)) break;
          for (let i = 0; i < 14; i++) {
            const a = (i / 14) * Math.PI * 2, r = 1.5 + Math.random() * 1.5;
            this.puff(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 2 + Math.random() * 2, i % 2 ? C.leaf : C.frost, 3 + Math.round(Math.random() * 2));
          }
          this.ring(cx, cy, C.leaf);
          break;
        }
        // a new ace: a gold ring; a fallen ace: its bounty floats up for the one who collects
        case 'ace':
          if (visible(e.x, e.y)) { this.ring(e.x, e.y, C.gold); this.text(e.x, e.y, 'ACE', C.gold); }
          break;
        case 'aceDown':
          if (!visible(e.x, e.y)) break;
          this.ring(e.x, e.y, C.gold);
          if (e.by === me) this.text(e.x, e.y, `+$${e.cash}`, C.gold);
          break;
        case 'power':
          if (e.power === 'supplyDrop' || e.power === 'repair' || e.power === 'rally' || e.power === 'recon') this.ring(e.x, e.y, e.power === 'repair' ? C.leaf : C.gold);
          break;
        case 'ability':
          if (e.ab === 'smoke') for (let i = 0; i < 24; i++) this.puff(e.x + (Math.random() - 0.5) * 4, e.y + (Math.random() - 0.5) * 4, 3 + Math.random() * 5, C.pebble, 6);
          break;
      }
    }
  }

  flash(x: number, y: number, size: number) {
    this.parts.push({ x, y, z: 0, vx: 0, vy: 0, vz: 0, life: 0.06, max: 0.06, c: C.cream, size, kind: 'flash' });
  }

  puff(x: number, y: number, life: number, c: number, size: number) {
    this.parts.push({ x, y, z: 0, vx: (Math.random() - 0.5) * 0.3, vy: (Math.random() - 0.5) * 0.3, vz: 0.4, life, max: life, c, size, kind: 'smoke' });
  }

  ring(x: number, y: number, c: number) {
    this.parts.push({ x, y, z: 0, vx: 0, vy: 0, vz: 0, life: 0.6, max: 0.6, c, size: 1, kind: 'ring' });
  }

  text(x: number, y: number, text: string, c: number) {
    this.floaters.push({ x, y, text, c, life: 1.6 });
  }

  /** An explosion of a given size (tiles); debris 0 = none, 1 = some, 2 = lots. */
  boom(x: number, y: number, r: number, debris: number) {
    const n = Math.round(4 + r * 10);
    this.parts.push({ x, y, z: 0, vx: 0, vy: 0, vz: 0, life: 0.12, max: 0.12, c: C.cream, size: Math.max(3, r * 10), kind: 'flash' });
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = (0.5 + Math.random()) * r * 2.5;
      this.parts.push({ x, y, z: 0, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vz: 0, life: 0.25 + Math.random() * 0.3, max: 0.55, c: [C.gold, C.orange, C.ember, C.red][i % 4], size: 1 + Math.round(Math.random() * r * 2), kind: 'spark' });
    }
    for (let i = 0; i < Math.round(r * 5); i++) this.puff(x + (Math.random() - 0.5) * r, y + (Math.random() - 0.5) * r, 1 + Math.random() * 1.5 * r, i % 2 ? C.slate : C.plum, 2 + Math.round(r * 3));
    for (let i = 0; i < debris * 4; i++) {
      const a = Math.random() * Math.PI * 2, sp = 1 + Math.random() * 2;
      this.parts.push({ x, y, z: 0, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vz: 3 + Math.random() * 3, life: 0.5, max: 0.5, c: i % 2 ? C.olive : C.dust, size: 2, kind: 'debris' });
    }
  }

  update(dt: number) {
    for (const p of this.parts) {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.kind === 'debris') { p.vz -= 12 * dt; p.z = Math.max(0, p.z + p.vz * dt); }
      if (p.kind === 'smoke') { p.z += p.vz * dt; p.vx *= 0.98; p.vy *= 0.98; }
      if (p.kind === 'spark') { p.vx *= 0.9; p.vy *= 0.9; }
    }
    if (this.parts.length > 3000) this.parts.splice(0, this.parts.length - 3000);
    this.parts = this.parts.filter((p) => p.life > 0);
    for (const w of this.wrecks) {
      w.life -= dt;
      w.puff -= dt;
      // a burning hull smokes for a while
      if (!w.ship && w.max - w.life < WRECK_SMOKE && w.puff <= 0) {
        w.puff = 0.35;
        this.puff(w.x + (Math.random() - 0.5) * 0.4, w.y - 0.2, 1.5, Math.random() < 0.5 ? C.slate : C.plum, 3);
      }
    }
    this.wrecks = this.wrecks.filter((w) => w.life > 0);
    for (const t of this.tracers) t.life -= dt;
    this.tracers = this.tracers.filter((t) => t.life > 0);
    for (const f of this.floaters) { f.life -= dt; f.y -= dt * 0.6; }
    this.floaters = this.floaters.filter((f) => f.life > 0);
    this.shake = Math.max(0, this.shake - dt * 20);
  }

  /** Wrecks lie on the ground under the living units. */
  drawWrecks(ctx: CanvasRenderingContext2D, cam: Camera, inView: (x: number, y: number) => boolean) {
    if (cam.strategic) return;
    const z = cam.z;
    for (const w of this.wrecks) {
      if (!inView(w.x, w.y)) continue;
      const sp = charred(w.name);
      if (!sp) continue;
      const sx = cam.sx(w.x), sy = cam.sy(w.y);
      if (w.ship) {
        // a ship goes down: it slides under and fades
        const k = 1 - w.life / w.max;
        ctx.save();
        ctx.beginPath();
        ctx.rect(sx - sp.w * z, sy - sp.h * z, sp.w * 2 * z, sp.h * z + Math.round((1 - k) * sp.h * 0.5) * z);
        ctx.clip();
        ctx.globalAlpha = 1 - k * 0.6;
        drawSprite(ctx, sp, sx, sy + Math.round(k * sp.h * 0.5) * z, z);
        ctx.restore();
        continue;
      }
      const a = Math.min(1, w.life / WRECK_FADE);
      // a scorch mark on the ground under the hull
      ctx.globalAlpha = a * SCORCH;
      ctx.fillStyle = PALETTE[C.ink];
      ctx.beginPath();
      ctx.ellipse(sx, sy, Math.round(sp.w * 0.42 * z), Math.round(sp.h * 0.24 * z), 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = a * WRECK_ALPHA;
      drawSprite(ctx, sp, sx, sy, z);
    }
    ctx.globalAlpha = 1;
  }

  /** Draw the ground-level effects (smoke, sparks, tracers). */
  draw(ctx: CanvasRenderingContext2D, cam: Camera) {
    const z = cam.z;
    // tracers: a short streak travelling from the muzzle to the target
    for (const t of this.tracers) {
      const k = 1 - t.life / t.max;
      const hx = t.x0 + (t.x1 - t.x0) * k, hy = t.y0 + (t.y1 - t.y0) * k;
      const d = Math.hypot(t.x1 - t.x0, t.y1 - t.y0) || 1;
      const len = Math.min(d * k, TRACER_LEN / TILE);
      ctx.strokeStyle = PALETTE[t.c];
      ctx.lineWidth = Math.max(1, z);
      ctx.beginPath();
      ctx.moveTo(cam.sx(hx - ((t.x1 - t.x0) / d) * len), cam.sy(hy - ((t.y1 - t.y0) / d) * len));
      ctx.lineTo(cam.sx(hx), cam.sy(hy));
      ctx.stroke();
    }
    for (const p of this.parts) {
      const sx = cam.sx(p.x), sy = cam.sy(p.y) - Math.round(p.z * TILE * 0.3 * z);
      const k = Math.max(1, Math.round(p.size * z * (p.kind === 'smoke' ? 0.6 + (1 - p.life / p.max) : 1)));
      if (p.kind === 'ring') {
        const r = (1 - p.life / p.max) * 1.5 * TILE * z;
        ctx.strokeStyle = PALETTE[p.c];
        ctx.globalAlpha = p.life / p.max;
        ctx.lineWidth = Math.max(1, z);
        ctx.beginPath();
        ctx.arc(sx, sy, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
        continue;
      }
      ctx.globalAlpha = p.kind === 'smoke' ? Math.min(SMOKE_ALPHA, p.life / p.max) : 1;
      ctx.fillStyle = PALETTE[p.c];
      ctx.fillRect(sx - (k >> 1), sy - (k >> 1), k, k);
    }
    ctx.globalAlpha = 1;
  }

  /** Floating text sits above everything. */
  drawText(ctx: CanvasRenderingContext2D, cam: Camera, ui: number) {
    for (const f of this.floaters) {
      ctx.globalAlpha = Math.min(1, f.life);
      drawText(ctx, f.text, cam.sx(f.x) - f.text.length * 2.5 * ui, cam.sy(f.y) - 20 * ui, PALETTE[f.c], ui, '#2e222f');
    }
    ctx.globalAlpha = 1;
  }
}

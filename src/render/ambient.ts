// Ambient life over the battlefield (render-only, nothing here touches the match): cloud shadows
// drifting with the wind, and now and then a flock of birds crossing the view, gulls over the sea
// and dark birds over land, each with its shadow on the ground.
import { PALETTE, C } from '../data/palette';
import { T } from '../data/terrain';
import type { GameMap } from '../sim/types';
import { valueNoise } from '../sim/rng';
import { makeCanvas } from './pixbuf';
import { TILE, type Camera } from './view';

/** the shadow pattern's size (art px; it tiles), the wind (art px/s), and the shadows' opacity */
const CLOUD = 384, WIND: [number, number] = [6, 2.5], CLOUD_ALPHA = 0.08;
/** seconds between flocks (min, extra random), birds' speed (art px/s) and height (art px) */
const FLOCK_GAP: [number, number] = [9, 14], BIRD_SPEED = 46, BIRD_HEIGHT = 34;
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);

interface Bird { x: number; y: number; ph: number; gull: boolean }
interface Flock { birds: Bird[]; vx: number; vy: number; age: number }

export class Ambient {
  private cloud: HTMLCanvasElement;
  private flocks: Flock[] = [];
  private nextFlock = 4;
  private last = -1;

  constructor(private map: GameMap, seed: number) {
    // a tileable cloud-shadow pattern: periodic value noise, cut off with a dithered edge
    this.cloud = makeCanvas(CLOUD, CLOUD);
    const ctx = this.cloud.getContext('2d')!;
    const img = ctx.createImageData(CLOUD, CLOUD);
    const P = 4, Q = 9; // noise periods across the pattern (coarse and fine)
    const wrapNoise = (x: number, y: number, per: number, s: number) => {
      // value noise on a torus: blend the four wrapped copies
      const fx = x / CLOUD, fy = y / CLOUD;
      const a = valueNoise(fx * per, fy * per, s), b = valueNoise((fx - 1) * per, fy * per, s);
      const c = valueNoise(fx * per, (fy - 1) * per, s), d = valueNoise((fx - 1) * per, (fy - 1) * per, s);
      return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
    };
    const [r, g, b] = [0x1a, 0x14, 0x20];
    for (let y = 0; y < CLOUD; y++)
      for (let x = 0; x < CLOUD; x++) {
        const n = wrapNoise(x, y, P, seed + 3) * 0.7 + wrapNoise(x, y, Q, seed + 4) * 0.3;
        const edge = (n - 0.64) / 0.05;
        if (edge < BAYER[(y & 3) * 4 + (x & 3)]) continue;
        const i = (y * CLOUD + x) * 4;
        img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255;
      }
    ctx.putImageData(img, 0, 0);
  }

  /** Cloud shadows over the ground and everything on it (not by night, fainter in rain). */
  drawClouds(ctx: CanvasRenderingContext2D, cam: Camera, time: number, dark: number, rain: number) {
    const a = CLOUD_ALPHA * (1 - dark) * (1 - rain * 0.6);
    // (zoomed out they read as stains on the map, not weather)
    if (a < 0.02 || cam.strategic) return;
    const z = cam.z;
    // whole art pixels of drift, so the shadow's pixels stay on the art grid
    const ox = Math.floor(time * WIND[0]) % CLOUD, oy = Math.floor(time * WIND[1]) % CLOUD;
    const wx0 = cam.wx(0) * TILE, wy0 = cam.wy(0) * TILE, wx1 = cam.wx(cam.w) * TILE, wy1 = cam.wy(cam.h) * TILE;
    const i0 = Math.floor((wx0 - ox) / CLOUD), j0 = Math.floor((wy0 - oy) / CLOUD);
    const i1 = Math.floor((wx1 - ox) / CLOUD), j1 = Math.floor((wy1 - oy) / CLOUD);
    ctx.globalAlpha = a;
    ctx.imageSmoothingEnabled = false;
    const size = Math.round(CLOUD * z);
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const sx = cam.sx((i * CLOUD + ox) / TILE), sy = cam.sy((j * CLOUD + oy) / TILE);
        ctx.drawImage(this.cloud, sx, sy, size, size);
      }
    ctx.globalAlpha = 1;
  }

  /** Flocks of birds (only zoomed in: at the strategic zoom they would be specks). */
  drawBirds(ctx: CanvasRenderingContext2D, cam: Camera, time: number, dark: number, storm: boolean) {
    const dt = this.last < 0 ? 0 : Math.min(0.1, time - this.last);
    this.last = time;
    if (dt > 0 && !storm && dark < 0.6 && (this.nextFlock -= dt) <= 0) {
      this.nextFlock = FLOCK_GAP[0] + Math.random() * FLOCK_GAP[1];
      this.spawn(cam);
    }
    for (const f of this.flocks) {
      f.age += dt;
      for (const b of f.birds) { b.x += f.vx * dt; b.y += f.vy * dt; }
    }
    this.flocks = this.flocks.filter((f) => f.age < 40);
    if (cam.strategic) return;
    const z = cam.z, k = Math.max(1, Math.round(z));
    for (const f of this.flocks)
      for (const b of f.birds) {
        const sx = cam.sx(b.x / TILE), sy = cam.sy(b.y / TILE);
        if (sx < -20 || sy < -20 || sx > cam.w + 20 || sy > cam.h + 60) continue;
        // shadow on the ground below and ahead of the light
        ctx.globalAlpha = 0.25;
        ctx.fillStyle = PALETTE[C.ink];
        ctx.fillRect(sx + Math.round(6 * z), sy + Math.round(BIRD_HEIGHT * z), 3 * k, k);
        ctx.globalAlpha = 1;
        // a 5-pixel 'v', wings up or down
        const up = Math.floor(time * 6 + b.ph) % 2 === 0;
        ctx.fillStyle = PALETTE[b.gull ? C.white : C.plum];
        const px = (dx: number, dy: number) => ctx.fillRect(sx + dx * k, sy + dy * k, k, k);
        px(0, 0);
        px(-1, up ? -1 : 0); px(1, up ? -1 : 0);
        px(-2, up ? -2 : 1); px(2, up ? -2 : 1);
      }
  }

  private spawn(cam: Camera) {
    // from one edge of the view toward the other, a little askew
    const w = cam.w / cam.z, h = cam.h / cam.z;
    const cx = cam.wx(cam.w / 2) * TILE, cy = cam.wy(cam.h / 2) * TILE;
    const ang = Math.random() * Math.PI * 2;
    const vx = Math.cos(ang) * BIRD_SPEED, vy = Math.sin(ang) * BIRD_SPEED;
    const r = Math.hypot(w, h) / 2 + 30;
    const x0 = cx - Math.cos(ang) * r + (Math.random() - 0.5) * w * 0.5, y0 = cy - Math.sin(ang) * r + (Math.random() - 0.5) * h * 0.5;
    const m = this.map, tx = Math.floor(cx / TILE), ty = Math.floor(cy / TILE);
    const t = m.terrain[Math.max(0, Math.min(m.h - 1, ty)) * m.w + Math.max(0, Math.min(m.w - 1, tx))];
    const gull = t === T.WATER || t === T.DEEP || t === T.SAND;
    const n = 3 + Math.floor(Math.random() * 5);
    const birds: Bird[] = [];
    // a loose V behind the leader
    for (let i = 0; i < n; i++) {
      const side = i % 2 ? 1 : -1, rank = Math.ceil(i / 2);
      const bx = -Math.cos(ang) * rank * 9 - Math.sin(ang) * side * rank * 8 + (Math.random() - 0.5) * 4;
      const by = -Math.sin(ang) * rank * 9 + Math.cos(ang) * side * rank * 8 + (Math.random() - 0.5) * 4;
      birds.push({ x: x0 + bx, y: y0 + by, ph: Math.random() * 2, gull });
    }
    this.flocks.push({ birds, vx, vy, age: 0 });
  }
}

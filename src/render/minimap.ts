// The minimap: terrain baked once at one pixel per tile, with cities, units, buildings, crates,
// alerts and the camera frame drawn on top. Players get a marker shape as well as a color.
import { TERRAIN } from '../data/terrain';
import { PALETTE_RGB, PALETTE, TEAM_COLORS } from '../data/palette';
import { UNITS } from '../data/units';
import { BUILDINGS } from '../data/buildings';
import type { MatchState } from '../sim/types';
import { stealthy } from '../sim/vision';
import { makeCanvas } from './pixbuf';
import { viewColor, viewUi } from './colors';
import type { Fog } from './fog';
import type { Camera } from './view';

/** HQ marker shapes (7 × 7, map pixels), one per player color: square, diamond, triangle, plus, X, ring. */
const HQ_MARKS = [
  ['#######', '#######', '##...##', '##...##', '##...##', '#######', '#######'],
  ['...#...', '..###..', '.##.##.', '##...##', '.##.##.', '..###..', '...#...'],
  ['...#...', '..###..', '..#.#..', '.##.##.', '.#...#.', '#######', '#######'],
  ['..###..', '..###..', '#######', '#######', '#######', '..###..', '..###..'],
  ['##...##', '###.###', '.#####.', '..###..', '.#####.', '###.###', '##...##'],
  ['..###..', '.#...#.', '#.....#', '#.....#', '#.....#', '.#...#.', '..###..'],
];

export class Minimap {
  base: HTMLCanvasElement;
  private layer: HTMLCanvasElement;
  private last = -1;

  constructor(private s: MatchState) {
    const { w, h, terrain } = s.map;
    this.base = makeCanvas(w, h);
    const ctx = this.base.getContext('2d')!;
    const img = ctx.createImageData(w, h);
    for (let i = 0; i < w * h; i++) {
      const [r, g, b] = PALETTE_RGB[TERRAIN[terrain[i]].mini];
      img.data.set([r, g, b, 255], i * 4);
    }
    for (const d of s.map.deposits)
      for (let y = d.y; y < d.y + 2; y++)
        for (let x = d.x; x < d.x + 2; x++) img.data.set(d.kind === 'oil' ? [20, 16, 24, 255] : d.rich ? [249, 194, 43, 255] : [205, 104, 61, 255], (y * w + x) * 4);
    ctx.putImageData(img, 0, 0);
    this.layer = makeCanvas(w, h);
  }

  /** Redraw the dynamic layer (a few times per second). */
  update(s: MatchState, fog: Fog, team: number, now: number) {
    if (now - this.last < 200) return;
    this.last = now;
    this.s = s;
    const { w, h } = s.map;
    const ctx = this.layer.getContext('2d')!;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(this.base, 0, 0);
    // fog
    ctx.globalAlpha = 0.85;
    ctx.drawImage(fog.canvas, 0, 0);
    ctx.globalAlpha = 1;
    // cities
    for (const c of s.cities) {
      // an unexplored city is a grey landmark (who holds it is for scouts to find out)
      ctx.fillStyle = !fog.isExplored(c.x, c.y) && s.setup.fog !== 'off' ? '#9babb2' : viewUi(s, c.owner);
      ctx.fillRect(c.x - 2, c.y - 2, 5, 5);
      ctx.fillStyle = '#2e222f';
      ctx.fillRect(c.x, c.y, 1, 1);
    }
    // a city with a public job: a blinking gold frame, fog or not (everyone was told where)
    const job = s.contract ? s.cities[s.contract.city] : undefined;
    if (job && Math.floor(now / 400) % 2 === 0) {
      ctx.strokeStyle = '#f9c22b';
      ctx.lineWidth = 2;
      ctx.strokeRect(job.x - 5, job.y - 5, 11, 11);
    }
    // enemy building memories
    for (const g of fog.ghosts.values()) {
      if (s.ents[g.id] && fog.isVisible(g.tx, g.ty)) continue;
      const bd = BUILDINGS[g.kind];
      ctx.fillStyle = PALETTE[TEAM_COLORS[viewColor(s, g.owner)].ramp[1]];
      ctx.fillRect(g.tx, g.ty, bd.w, bd.h);
    }
    // entities
    for (const id in s.ents) {
      const e = s.ents[id];
      if (e.t === 'u' && e.inside) continue;
      const mine = e.owner >= 0 && s.players[e.owner].team === team;
      if (!mine && !fog.isVisible(e.x, e.y)) continue;
      if (e.t === 'u' && stealthy(s, e) && !mine) continue;
      const col = e.owner >= 0 ? viewUi(s, e.owner) : '#ffffff';
      ctx.fillStyle = col;
      if (e.t === 'b') {
        const bd = BUILDINGS[e.kind];
        ctx.fillRect(e.tx, e.ty, bd.w, bd.h);
      } else {
        const big = UNITS[e.kind].cls !== 'infantry';
        ctx.fillRect(Math.floor(e.x) - (big ? 1 : 0), Math.floor(e.y) - (big ? 1 : 0), big ? 2 : 1, big ? 2 : 1);
      }
    }
    for (const c of s.crates) {
      ctx.fillStyle = '#fbff86';
      ctx.fillRect(Math.floor(c.x) - 1, Math.floor(c.y) - 1, 3, 3);
    }
    // each player's HQ gets a marker shape too, so colors aren't the only way to tell them apart
    for (const id in s.ents) {
      const e = s.ents[id];
      if (e.t !== 'b' || e.kind !== 'hq' || e.owner < 0) continue;
      if (s.players[e.owner].team !== team && !fog.isExplored(e.x, e.y) && s.setup.fog !== 'off') continue;
      const shape = HQ_MARKS[s.players[e.owner].color % HQ_MARKS.length];
      const cx = Math.floor(e.x) - 3, cy = Math.floor(e.y) - 3;
      for (let pass = 0; pass < 2; pass++) {
        ctx.fillStyle = pass ? viewUi(s, e.owner) : '#2e222f';
        shape.forEach((row, y) => {
          for (let x = 0; x < row.length; x++) {
            if (row[x] !== '#') continue;
            if (pass) ctx.fillRect(cx + x, cy + y, 1, 1);
            else ctx.fillRect(cx + x - 1, cy + y - 1, 3, 3);
          }
        });
      }
    }
  }

  /** Draw into a box on screen, with the camera frame and pings. */
  draw(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, cam: Camera, pings: { x: number; y: number; t: number; color: string }[], now: number) {
    const { w, h } = this.s.map;
    const k = size / Math.max(w, h);
    const dw = Math.round(w * k), dh = Math.round(h * k);
    const ox = x + Math.round((size - dw) / 2), oy = y + Math.round((size - dh) / 2);
    ctx.fillStyle = '#1a1420';
    ctx.fillRect(x, y, size, size);
    ctx.drawImage(this.layer, ox, oy, dw, dh);
    // camera frame
    const x0 = cam.wx(0), y0 = cam.wy(0), x1 = cam.wx(cam.w), y1 = cam.wy(cam.h);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    ctx.strokeRect(Math.round(ox + Math.max(0, x0) * k) + 0.5, Math.round(oy + Math.max(0, y0) * k) + 0.5, Math.round((Math.min(w, x1) - Math.max(0, x0)) * k), Math.round((Math.min(h, y1) - Math.max(0, y0)) * k));
    for (const p of pings) {
      const age = (now - p.t) / 1000;
      if (age > 3) continue;
      const r = 3 + (age % 1) * 10;
      ctx.strokeStyle = p.color;
      ctx.beginPath();
      ctx.arc(ox + p.x * k, oy + p.y * k, r, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  /** Map tile under a point inside the drawn minimap box, or null. */
  pick(px: number, py: number, x: number, y: number, size: number): [number, number] | null {
    const { w, h } = this.s.map;
    const k = size / Math.max(w, h);
    const dw = w * k, dh = h * k;
    const ox = x + (size - dw) / 2, oy = y + (size - dh) / 2;
    if (px < ox || py < oy || px > ox + dw || py > oy + dh) return null;
    return [(px - ox) / k, (py - oy) / k];
  }
}


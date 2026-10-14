// Home Front borders: which team's ground each tile is (see sim/territory.ts), drawn as thin
// team-colored edges only where two teams' claims meet (a frontier), on land only, and as a light
// tint at strategic zoom (which also shows where a claim ends in open country).
// Render only: the tile map is rebuilt when a city or HQ changes hands, grows, or falls.
import type { MatchState } from '../sim/types';
import { claims } from '../sim/territory';
import { T } from '../data/terrain';
import { makeCanvas } from './pixbuf';
import { viewUi } from './colors';
import type { Camera } from './view';
import { TILE } from './view';

/** the tint's opacity at strategic zoom, and the border line's (times CLOSE when zoomed in to 2x+) */
const TINT = 0.16, EDGE = 0.85, CLOSE = 0.75;
/** border dash and gap length, in art pixels (a tile is a whole number of dashes) */
const DASH = 4;
const SHADOW = '#1a1420';

export class TerritoryLayer {
  /** the claiming player per tile (-1 = nobody's) */
  private owner: Int16Array;
  private key = '';
  private tint: HTMLCanvasElement;

  constructor(private w: number, private h: number) {
    this.owner = new Int16Array(w * h).fill(-1);
    this.tint = makeCanvas(w, h);
  }

  update(s: MatchState) {
    const cl = claims(s);
    // colors can change with the friend-or-foe setting, so they're part of the key
    const key = cl.map((c) => `${c.owner}:${c.x}:${c.y}:${c.r}:${viewUi(s, c.owner)}`).join('|');
    if (key === this.key) return;
    this.key = key;
    const { w, h } = this;
    const depth = new Float32Array(w * h).fill(1);
    this.owner.fill(-1);
    const wet = (i: number) => s.map.terrain[i] === T.WATER || s.map.terrain[i] === T.DEEP;
    for (const c of cl) {
      const x0 = Math.max(0, Math.floor(c.x - c.r)), x1 = Math.min(w - 1, Math.ceil(c.x + c.r));
      const y0 = Math.max(0, Math.floor(c.y - c.r)), y1 = Math.min(h - 1, Math.ceil(c.y + c.r));
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          // land only: a border never runs across the sea
          if (wet(y * w + x)) continue;
          const k = Math.hypot(x + 0.5 - c.x, y + 0.5 - c.y) / c.r;
          if (k < depth[y * w + x]) { depth[y * w + x] = k; this.owner[y * w + x] = c.owner; }
        }
    }
    const ctx = this.tint.getContext('2d')!;
    const img = ctx.createImageData(w, h);
    const rgb = new Map<number, [number, number, number]>();
    for (let i = 0; i < w * h; i++) {
      const o = this.owner[i];
      if (o < 0) continue;
      let c = rgb.get(o);
      if (!c) { const hex = viewUi(s, o); c = [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]; rgb.set(o, c); }
      img.data[i * 4] = c[0]; img.data[i * 4 + 1] = c[1]; img.data[i * 4 + 2] = c[2]; img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }

  draw(ctx: CanvasRenderingContext2D, s: MatchState, cam: Camera, x0: number, y0: number, x1: number, y1: number) {
    const z = cam.z;
    if (cam.strategic) {
      ctx.globalAlpha = TINT;
      ctx.drawImage(this.tint, cam.sx(0), cam.sy(0), this.w * TILE * z, this.h * TILE * z);
      ctx.globalAlpha = 1;
    }
    // an edge wherever the tile next door is another team's ground (a frontier; open country gets
    // none, so lines don't wander across fields): one path per color, dashed in step with the
    // tiles, over a dark shadow a pixel lower so it reads on grass and forest alike; zoomed in,
    // where it is big, it steps back
    const { w, h, owner } = this;
    const team = (o: number) => (o < 0 ? -1 : s.players[o].team);
    const rival = (i: number, t: number) => owner[i] >= 0 && team(owner[i]) !== t;
    // each side's line sits one line-width inside its own ground, so two neighbours show both colors
    const lw = Math.max(1, Math.round(z)), len = Math.round(TILE * z), half = lw * 1.5;
    const paths = new Map<string, Path2D>();
    for (let y = Math.max(0, Math.floor(y0)); y <= Math.min(h - 1, Math.ceil(y1)); y++)
      for (let x = Math.max(0, Math.floor(x0)); x <= Math.min(w - 1, Math.ceil(x1)); x++) {
        const o = owner[y * w + x];
        if (o < 0) continue;
        const t = team(o);
        const col = viewUi(s, o);
        let p = paths.get(col);
        if (!p) { p = new Path2D(); paths.set(col, p); }
        const sx = cam.sx(x), sy = cam.sy(y);
        const seg = (ax: number, ay: number, bx: number, by: number) => { p!.moveTo(ax, ay); p!.lineTo(bx, by); };
        if (x > 0 && rival(y * w + x - 1, t)) seg(sx + half, sy, sx + half, sy + len);
        if (x < w - 1 && rival(y * w + x + 1, t)) seg(sx + len - half, sy, sx + len - half, sy + len);
        if (y > 0 && rival((y - 1) * w + x, t)) seg(sx, sy + half, sx + len, sy + half);
        if (y < h - 1 && rival((y + 1) * w + x, t)) seg(sx, sy + len - half, sx + len, sy + len - half);
      }
    ctx.lineWidth = lw;
    ctx.setLineDash([DASH * z, DASH * z]);
    const alpha = EDGE * (z >= 2 ? CLOSE : 1);
    for (const [col, p] of paths) {
      ctx.globalAlpha = alpha * 0.8;
      ctx.strokeStyle = SHADOW;
      ctx.save();
      ctx.translate(0, lw);
      ctx.stroke(p);
      ctx.restore();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = col;
      ctx.stroke(p);
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }
}

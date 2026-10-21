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
  /**
   * The frontier, worked out when the claims change: per color, flat [x, y, sides] triples for
   * each tile with a rival team's ground next door (sides: 1 left, 2 right, 4 up, 8 down).
   */
  private edges = new Map<string, number[]>();

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
    // the frontier: an edge wherever the tile next door is another team's ground (open country
    // gets none, so lines don't wander across fields)
    const owner = this.owner;
    const team = (o: number) => (o < 0 ? -1 : s.players[o].team);
    const rival = (i: number, t: number) => owner[i] >= 0 && team(owner[i]) !== t;
    this.edges.clear();
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x, o = owner[i];
        if (o < 0) continue;
        const t = team(o);
        const sides = (x > 0 && rival(i - 1, t) ? 1 : 0) | (x < w - 1 && rival(i + 1, t) ? 2 : 0) | (y > 0 && rival(i - w, t) ? 4 : 0) | (y < h - 1 && rival(i + w, t) ? 8 : 0);
        if (!sides) continue;
        const col = viewUi(s, o);
        let list = this.edges.get(col);
        if (!list) this.edges.set(col, (list = []));
        list.push(x, y, sides);
      }
  }

  draw(ctx: CanvasRenderingContext2D, s: MatchState, cam: Camera, x0: number, y0: number, x1: number, y1: number) {
    const z = cam.z;
    if (cam.strategic) {
      ctx.globalAlpha = TINT;
      ctx.drawImage(this.tint, cam.sx(0), cam.sy(0), this.w * TILE * z, this.h * TILE * z);
      ctx.globalAlpha = 1;
    }
    // the frontier (see `edges`): one path per color, dashed in step with the tiles, over a dark
    // shadow a pixel lower so it reads on grass and forest alike; zoomed in, where it is big, it
    // steps back. Each side's line sits one line-width inside its own ground, so two neighbours
    // show both colors
    const lw = Math.max(1, Math.round(z)), len = Math.round(TILE * z), half = lw * 1.5;
    const vx0 = Math.floor(x0), vx1 = Math.ceil(x1), vy0 = Math.floor(y0), vy1 = Math.ceil(y1);
    const paths = new Map<string, Path2D>();
    for (const [col, list] of this.edges) {
      let p: Path2D | null = null;
      for (let k = 0; k < list.length; k += 3) {
        const x = list[k], y = list[k + 1], sides = list[k + 2];
        if (x < vx0 || x > vx1 || y < vy0 || y > vy1) continue;
        if (!p) paths.set(col, (p = new Path2D()));
        const sx = cam.sx(x), sy = cam.sy(y);
        if (sides & 1) { p.moveTo(sx + half, sy); p.lineTo(sx + half, sy + len); }
        if (sides & 2) { p.moveTo(sx + len - half, sy); p.lineTo(sx + len - half, sy + len); }
        if (sides & 4) { p.moveTo(sx, sy + half); p.lineTo(sx + len, sy + half); }
        if (sides & 8) { p.moveTo(sx, sy + len - half); p.lineTo(sx + len, sy + len - half); }
      }
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

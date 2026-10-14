// The camera: world position, integer zoom, and conversions between world tiles and screen pixels.
// Zoom is device pixels per art pixel. 1-4 are pixel-perfect; 0.5 and 0.25 are the strategic view,
// where units become icons (GAME_DESIGN §13).

export const TILE = 32;
export const ZOOMS = [0.25, 0.5, 1, 2, 3, 4];

export class Camera {
  /** world px at the screen center */
  cx = 0;
  cy = 0;
  /** the zoom drawn this frame; `zoomAt` eases it to the next step over a few frames */
  private _z = 1;
  /** the zoom step being eased toward */
  zt = 1;
  /** screen px that stays fixed while the zoom eases */
  private anchor: [number, number] = [0, 0];
  get z() {
    return this._z;
  }
  /** setting the zoom directly jumps there (no easing) */
  set z(v: number) {
    this._z = this.zt = v;
  }
  /** screen size in device px */
  w = 1;
  h = 1;
  /** map size in tiles */
  mw = 1;
  mh = 1;

  get strategic() {
    return this.z < 1;
  }

  /** screen px of a world point given in tiles */
  sx(tx: number): number {
    return Math.round((tx * TILE - this.cx) * this.z + this.w / 2);
  }
  sy(ty: number): number {
    return Math.round((ty * TILE - this.cy) * this.z + this.h / 2);
  }
  /** world tile coordinate under a screen pixel */
  wx(px: number): number {
    return ((px - this.w / 2) / this.z + this.cx) / TILE;
  }
  wy(py: number): number {
    return ((py - this.h / 2) / this.z + this.cy) / TILE;
  }

  /** visible tile rectangle (inclusive), padded */
  bounds(pad = 2): [number, number, number, number] {
    return [Math.floor(this.wx(0)) - pad, Math.floor(this.wy(0)) - pad, Math.ceil(this.wx(this.w)) + pad, Math.ceil(this.wy(this.h)) + pad];
  }

  centerOn(tx: number, ty: number) {
    this.cx = tx * TILE;
    this.cy = ty * TILE;
    this.clamp();
  }

  pan(dx: number, dy: number) {
    this.cx += dx;
    this.cy += dy;
    this.clamp();
  }

  /** Step the zoom keeping the world point under (px, py) fixed; `update` eases there. */
  zoomAt(dir: number, px: number, py: number) {
    const i = ZOOMS.indexOf(this.zt);
    const ni = Math.max(0, Math.min(ZOOMS.length - 1, (i < 0 ? 2 : i) + dir));
    if (ZOOMS[ni] === this.zt) return;
    this.zt = ZOOMS[ni];
    this.anchor = [px, py];
  }

  /** Ease the drawn zoom toward the step (in log space, so every step takes about as long). */
  update(dt: number) {
    if (this._z === this.zt) return;
    const [px, py] = this.anchor;
    const wx = this.wx(px), wy = this.wy(py);
    const lt = Math.log2(this.zt);
    const l = lt + (Math.log2(this._z) - lt) * Math.exp(-dt * 22);
    this._z = Math.abs(l - lt) < 0.03 ? this.zt : 2 ** l;
    this.cx = wx * TILE - (px - this.w / 2) / this._z;
    this.cy = wy * TILE - (py - this.h / 2) / this._z;
    this.clamp();
  }

  clamp() {
    const mx = this.mw * TILE, my = this.mh * TILE;
    const hw = this.w / 2 / this.z, hh = this.h / 2 / this.z;
    // allow a margin so edges can sit under the HUD
    const m = 3 * TILE;
    this.cx = hw * 2 >= mx + 2 * m ? mx / 2 : Math.max(hw - m, Math.min(mx + m - hw, this.cx));
    this.cy = hh * 2 >= my + 2 * m ? my / 2 : Math.max(hh - m, Math.min(my + m - hh, this.cy));
    // keep pixel art on the pixel grid
    this.cx = Math.round(this.cx * this.z) / this.z;
    this.cy = Math.round(this.cy * this.z) / this.z;
  }
}

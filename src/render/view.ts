// The camera: world position, integer zoom, and conversions between world tiles and screen pixels.
// Zoom is device pixels per art pixel. 1-4 are pixel-perfect; 0.5 and 0.25 are the strategic view,
// where units become icons (GAME_DESIGN §13).

export const TILE = 32;
export const ZOOMS = [0.25, 0.5, 1, 2, 3, 4];

export class Camera {
  /** world px at the screen center */
  cx = 0;
  cy = 0;
  z = 1;
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

  /** Change zoom keeping the world point under (px, py) fixed. */
  zoomAt(dir: number, px: number, py: number) {
    const i = ZOOMS.indexOf(this.z);
    const ni = Math.max(0, Math.min(ZOOMS.length - 1, (i < 0 ? 2 : i) + dir));
    if (ZOOMS[ni] === this.z) return;
    const wx = this.wx(px), wy = this.wy(py);
    this.z = ZOOMS[ni];
    this.cx = wx * TILE - (px - this.w / 2) / this.z;
    this.cy = wy * TILE - (py - this.h / 2) / this.z;
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

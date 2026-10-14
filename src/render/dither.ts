// Ordered dithering for the soft layers (fog edges, night and its pools of light): an alpha
// between two levels becomes a 4×4 Bayer pattern of the two, on a grid of whole art-pixel cells
// anchored to the world, so these layers read as pixel art and don't shimmer when the camera pans.

/** art pixels per dither cell */
export const CELL = 4;

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);

/** The level for alpha `a` at world grid cell (gx, gy): one of `levels` (ascending), dithered. */
export function dither(a: number, levels: readonly number[], gx: number, gy: number): number {
  if (a <= levels[0]) return levels[0];
  for (let k = 1; k < levels.length; k++) {
    if (a > levels[k]) continue;
    const f = (a - levels[k - 1]) / (levels[k] - levels[k - 1]);
    return f > BAYER[(gy & 3) * 4 + (gx & 3)] ? levels[k] : levels[k - 1];
  }
  return levels[levels.length - 1];
}

/** Dither an image's alpha in place; (gx, gy) is the world grid index of its top-left cell. */
export function ditherAlpha(img: ImageData, levels: readonly number[], gx: number, gy: number) {
  const d = img.data, w = img.width, h = img.height;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4 + 3;
      if (d[i]) d[i] = dither(d[i], levels, gx + x, gy + y);
    }
}

/** Evenly spaced alpha levels from 0 to `top` (n steps). */
export function levels(top: number, n: number): number[] {
  return Array.from({ length: n + 1 }, (_, k) => Math.round((top * k) / n));
}

// Blockouts: simple shapes in the game's projection (a roof seen from above, the south wall below
// it) used as init images for PixelLab, so generated buildings keep our square-grid 3/4 view
// instead of drifting isometric.
//
// A building with a w x h tile footprint and wall height H becomes a (w*32) x (h*32 + H) image:
// rows 0..h*32 are the roof, then H rows of front wall.
//
// Usage: node scripts/blockout.mjs <outdir>   (writes one PNG per building plus city levels)
import fs from 'node:fs';
import path from 'node:path';
import { encodePNG } from './lib/png.mjs';
import { rgbOf } from './lib/pixel.mjs';

const T = 32;
export const SPECS = {
  hq: { w: 4, h: 4, H: 24, roof: '#9babb2', wall: '#7f708a', trim: '#4d65b4', door: true, windows: 3 },
  mine: { w: 2, h: 2, H: 12, roof: '#966c6c', wall: '#694f62', trim: '#4d65b4', door: true },
  derrick: { w: 2, h: 2, H: 28, roof: '#625565', wall: '#3e3546', trim: '#4d65b4', tower: true },
  barracks: { w: 3, h: 3, H: 18, roof: '#676633', wall: '#966c6c', trim: '#4d65b4', door: true, windows: 2 },
  factory: { w: 4, h: 3, H: 22, roof: '#7f708a', wall: '#625565', trim: '#4d65b4', door: true, saw: true },
  lab: { w: 2, h: 2, H: 18, roof: '#c7dcd0', wall: '#9babb2', trim: '#4d65b4', dome: true },
  turret: { w: 1, h: 1, H: 12, roof: '#7f708a', wall: '#625565', trim: '#4d65b4', round: true },
  airfield: { w: 4, h: 5, H: 8, roof: '#625565', wall: '#3e3546', trim: '#4d65b4', runway: true },
  dock: { w: 3, h: 3, H: 12, roof: '#966c6c', wall: '#694f62', trim: '#4d65b4', pier: true },
  aagun: { w: 1, h: 1, H: 12, roof: '#7f708a', wall: '#625565', trim: '#4d65b4', round: true },
  coastal: { w: 2, h: 2, H: 14, roof: '#7f708a', wall: '#625565', trim: '#4d65b4', round: true },
  radar: { w: 2, h: 2, H: 30, roof: '#9babb2', wall: '#7f708a', trim: '#4d65b4', dish: true },
  launch: { w: 5, h: 5, H: 40, roof: '#7f708a', wall: '#625565', trim: '#4d65b4', rocket: true },
};

function canvas(w, h) {
  const data = new Uint8Array(w * h * 4);
  const set = (x, y, c) => {
    x |= 0; y |= 0;
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const [r, g, b] = rgbOf(c);
    data.set([r, g, b, 255], (y * w + x) * 4);
  };
  const rect = (x, y, rw, rh, c) => { for (let yy = y; yy < y + rh; yy++) for (let xx = x; xx < x + rw; xx++) set(xx, yy, c); };
  const disc = (cx, cy, r, c) => { for (let yy = -r; yy <= r; yy++) for (let xx = -r; xx <= r; xx++) if (xx * xx + yy * yy <= r * r) set(cx + xx, cy + yy, c); };
  return { w, h, data, set, rect, disc };
}

export function building(id) {
  const s = SPECS[id];
  const W = s.w * T, R = s.h * T, Hh = R + s.H;
  const c = canvas(W, Hh);
  const m = 2;
  if (s.runway) {
    // flat tarmac with a runway stripe and a small hangar at the back
    c.rect(m, m + s.H, W - 2 * m, R - 2 * m, s.roof);
    c.rect(W / 2 - 10, m + s.H + 4, 20, R - 12, '#3e3546');
    for (let y = m + s.H + 10; y < Hh - 12; y += 14) c.rect(W / 2 - 1, y, 2, 7, '#c7dcd0');
    c.rect(m + 4, m, 40, 30, '#7f708a');
    c.rect(m + 4, m + 30, 40, s.H + 4, '#625565');
    c.rect(m + 4, m, 40, 2, s.trim);
    return c;
  }
  if (s.pier) {
    c.rect(m, m, W - 2 * m, R * 0.55, s.roof);
    c.rect(m, m + R * 0.55, W - 2 * m, s.H, s.wall);
    for (let x = m + 6; x < W - m; x += 14) c.rect(x, m + R * 0.55 + s.H, 6, R * 0.45 - 4, '#966c6c');
    c.rect(m, m, W - 2 * m, 2, s.trim);
    return c;
  }
  if (s.round) {
    const r = Math.floor(W / 2) - 3;
    c.rect(W / 2 - r, R / 2 + 2, r * 2, s.H, s.wall);
    c.disc(W / 2, R / 2 + 2, r, s.roof);
    c.disc(W / 2, R / 2 + 2, Math.max(2, r - 4), s.trim);
    c.rect(W / 2 - 1, 2, 3, R / 2, '#2e222f');
    return c;
  }
  // roof, trim, front wall
  c.rect(m, m, W - 2 * m, R - m, s.roof);
  c.rect(m, m, W - 2 * m, 2, s.trim);
  c.rect(m, m, 2, R - m, s.trim);
  c.rect(W - m - 2, m, 2, R - m, s.trim);
  c.rect(m, R, W - 2 * m, s.H - 1, s.wall);
  c.rect(m, Hh - 3, W - 2 * m, 2, '#3e3546');
  if (s.door) c.rect(W / 2 - 6, Hh - Math.min(16, s.H - 2), 12, Math.min(14, s.H - 3), '#3e3546');
  for (let i = 0; i < (s.windows ?? 0); i++) {
    const x = m + 8 + i * 14;
    if (x + 6 < W / 2 - 8) { c.rect(x, R + 4, 6, 6, '#4d9be6'); c.rect(W - x - 6, R + 4, 6, 6, '#4d9be6'); }
  }
  if (s.saw) for (let x = m + 4; x < W - m - 8; x += 16) for (let k = 0; k < 10; k++) c.rect(x + k, m + 8 + k, 2, R - 24 - k, k < 3 ? '#c7dcd0' : s.roof);
  if (s.dome) c.disc(W / 2, R / 2, Math.floor(W / 4), '#c7dcd0');
  if (s.dish) { c.disc(W / 2, R / 2, Math.floor(W / 3), '#c7dcd0'); c.disc(W / 2, R / 2, 3, '#3e3546'); }
  if (s.tower) { c.rect(W / 2 - 6, 0, 12, R + 4, '#3e3546'); c.disc(W / 2, R - 8, 8, '#2e222f'); }
  if (s.rocket) { c.rect(W / 2 - 10, 4, 20, R + 10, '#c7dcd0'); c.rect(W / 2 - 10, 4, 20, 8, '#e83b3b'); }
  return c;
}

/** A city of a given level: a cluster of house blocks around a square, bigger each level. */
export function city(level) {
  const size = [64, 80, 96, 112, 128][level - 1];
  const c = canvas(size, size);
  const n = [4, 6, 9, 12, 16][level - 1];
  let seed = level * 9301;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  c.disc(size / 2, size / 2, size / 2 - 2, '#ab947a');
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rnd() * 0.4, d = size * (0.18 + rnd() * 0.22);
    const x = size / 2 + Math.cos(a) * d - 8, y = size / 2 + Math.sin(a) * d - 10;
    const roof = ['#b33831', '#9e4539', '#cd683d', '#625565'][Math.floor(rnd() * 4)];
    c.rect(x, y, 16, 10, roof);
    c.rect(x, y + 10, 16, 6, '#c7dcd0');
    c.rect(x + 6, y + 12, 4, 4, '#3e3546');
  }
  c.rect(size / 2 - 6, size / 2 - 14, 12, 12, '#9babb2');
  c.rect(size / 2 - 6, size / 2 - 2, 12, 8, '#7f708a');
  return c;
}

if (process.argv[1] && process.argv[1].endsWith('blockout.mjs')) {
  const out = process.argv[2] ?? 'e2e/out/blockout';
  fs.mkdirSync(out, { recursive: true });
  for (const id of Object.keys(SPECS)) {
    const c = building(id);
    fs.writeFileSync(path.join(out, id + '.png'), encodePNG(c.w, c.h, c.data));
  }
  for (let l = 1; l <= 5; l++) {
    const c = city(l);
    fs.writeFileSync(path.join(out, `city${l}.png`), encodePNG(c.w, c.h, c.data));
  }
  console.log(`blockouts → ${out}`);
}

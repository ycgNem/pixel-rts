// Procedural placeholder sprites for anything that has no imported art yet. Team parts are drawn
// with the blue key ramp (palette 44-48) so they recolor like the real art.
import { UNITS } from '../data/units';
import { BUILDINGS } from '../data/buildings';
import { C } from '../data/palette';
import { PixBuf } from './pixbuf';
import { defineSprite, hasSprite } from './art';
import { TILE } from './view';

const K0 = 44, K1 = 46, K2 = 47, K3 = 48; // key ramp dark → light

function put(name: string, b: PixBuf, ox: number, oy: number) {
  if (hasSprite(name)) return;
  defineSprite(name, { img: b.toCanvas(), x: 0, y: 0, w: b.w, h: b.h, ox, oy });
}

function vehicle(kind: string, size: number, a: number): PixBuf {
  const b = new PixBuf(size, size);
  const c = size / 2;
  const L = size * 0.36, W = size * 0.24;
  const ca = Math.cos(a), sa = Math.sin(a);
  const px = -sa, py = ca;
  // shadow
  b.orect(c + 1, c + 2, L, W + 1, a, C.shade);
  if (kind === 'scout' || kind === 'flaktruck') {
    for (const [s1, s2] of [[0.6, 1], [-0.6, 1], [0.6, -1], [-0.6, -1]]) b.disc(c + ca * L * s1 + px * W * s2, c + sa * L * s1 + py * W * s2, size * 0.07, C.ink);
    b.orect(c, c, L, W * 0.8, a, K1);
    b.orect(c - ca * L * 0.2, c - sa * L * 0.2, L * 0.5, W * 0.6, a, K2);
    if (kind === 'flaktruck') {
      b.disc(c - ca * L * 0.3, c - sa * L * 0.3, size * 0.11, K0);
      for (const s of [-1, 1]) b.line(c - ca * L * 0.3 + px * s * 2, c - sa * L * 0.3 + py * s * 2, c + ca * L * 0.3 + px * s * 2, c + sa * L * 0.3 + py * s * 2, C.ink);
    } else b.line(c, c, c + ca * L * 0.7, c + sa * L * 0.7, C.ink);
  } else {
    // tracks, hull, turret, barrel
    for (const s of [-1, 1]) b.orect(c + px * W * 0.85 * s, c + py * W * 0.85 * s, L, W * 0.32, a, C.slate);
    b.orect(c, c, L * 0.9, W * 0.62, a, K1);
    b.orect(c - ca, c - sa, L * 0.6, W * 0.4, a, K2);
    const barrel = kind === 'artillery' ? L * 1.5 : kind === 'heavytank' ? L * 1.2 : L;
    const tw = kind === 'artillery' ? 1 : 2;
    for (let t = 0; t < tw; t++) b.line(c + px * t, c + py * t, c + ca * barrel + px * t, c + sa * barrel + py * t, C.ink);
    b.disc(c, c, size * (kind === 'heavytank' ? 0.16 : 0.13), K2);
    b.disc(c - 1, c - 1, size * 0.06, K3);
  }
  b.outline(C.ink);
  return b;
}

function aircraft(kind: string, size: number, a: number): PixBuf {
  const b = new PixBuf(size, size);
  const c = size / 2;
  const ca = Math.cos(a), sa = Math.sin(a), px = -sa, py = ca;
  const L = size * 0.4;
  if (kind === 'helicopter') {
    b.orect(c, c, L * 0.55, L * 0.25, a, K1);
    b.line(c, c, c - ca * L, c - sa * L, K0);
    b.line(c - L * 0.9, c, c + L * 0.9, c, C.stone);
    b.line(c, c - L * 0.9, c, c + L * 0.9, C.stone);
  } else {
    const span = kind === 'bomber' ? L * 1.1 : L * 0.8;
    b.orect(c, c, L, size * 0.07, a, K1);
    b.orect(c + ca * L * 0.05, c + sa * L * 0.05, size * 0.09, span, a, K2);
    b.orect(c - ca * L * 0.8, c - sa * L * 0.8, size * 0.05, span * 0.4, a, K1);
    if (kind === 'bomber') for (const s of [-0.5, 0.5]) b.disc(c + px * span * s, c + py * span * s, 2, C.slate);
  }
  b.outline(C.ink);
  return b;
}

function ship(kind: string, size: number, a: number): PixBuf {
  const b = new PixBuf(size, size);
  const c = size / 2;
  const ca = Math.cos(a), sa = Math.sin(a);
  const L = size * 0.42, W = size * (kind === 'submarine' ? 0.08 : kind === 'transport' ? 0.16 : 0.12);
  // hull tapering to the bow
  for (let t = -1; t <= 1; t += 0.02) {
    const w = t > 0.5 ? W * (1 - (t - 0.5) * 2) : W;
    b.orect(c + ca * L * t, c + sa * L * t, 1, Math.max(0.5, w), a, kind === 'submarine' ? C.slate : C.stone);
  }
  b.orect(c - ca * L * 0.1, c - sa * L * 0.1, L * 0.35, W * 0.6, a, K1);
  const guns = kind === 'battleship' ? 3 : kind === 'destroyer' ? 2 : kind === 'patrolboat' ? 1 : 0;
  for (let g = 0; g < guns; g++) {
    const t = 0.55 - g * 0.5;
    const gx = c + ca * L * t, gy = c + sa * L * t;
    b.disc(gx, gy, W * 0.6, K2);
    b.line(gx, gy, gx + ca * W * 2, gy + sa * W * 2, C.ink);
  }
  b.outline(C.ink);
  return b;
}

function infantry(kind: string, a: number, frame: number): PixBuf {
  const b = new PixBuf(24, 24);
  const c = 12;
  const ca = Math.cos(a), sa = Math.sin(a);
  const step = frame % 2 ? 1 : -1;
  b.disc(c, c + 7, 4, C.shade); // shadow
  // legs
  b.rect(c - 2, c + 2 + (step > 0 ? 0 : 1), 2, 4, C.ink);
  b.rect(c + 1, c + 2 + (step > 0 ? 1 : 0), 2, 4, C.ink);
  // body and head
  b.rect(c - 3, c - 3, 6, 6, kind === 'builder' ? C.amber : K1);
  b.rect(c - 2, c - 2, 4, 2, kind === 'builder' ? C.gold : K2);
  b.disc(c, c - 5, 2.6, kind === 'builder' ? C.gold : K0);
  // weapon or tool
  const len = kind === 'rocket' ? 7 : kind === 'builder' ? 3 : 6;
  b.line(c + ca * 2, c + sa * 2 - 1, c + ca * len, c + sa * len - 1, kind === 'builder' ? C.dust : C.ink);
  b.outline(C.ink);
  return b;
}

function building(kind: string): PixBuf {
  const d = BUILDINGS[kind];
  const w = d.w * TILE, h = d.h * TILE;
  const wall = Math.min(14, Math.max(6, h * 0.25));
  const b = new PixBuf(w, h + 4);
  const roofC = kind === 'hq' ? K1 : kind === 'mine' ? C.dust : kind === 'derrick' ? C.slate : K1;
  const pad = d.w === 1 ? 4 : 3;
  // walls (front face) and roof
  b.rect(pad, pad + 2, w - pad * 2, h - pad - 2, C.stone);
  b.rect(pad, h - wall, w - pad * 2, wall, C.slate);
  b.rect(pad + 2, pad, w - pad * 2 - 4, h - wall - pad, roofC);
  b.rect(pad + 2, pad, w - pad * 2 - 4, 3, K2);
  // details per kind
  if (kind === 'derrick' || kind === 'mine') {
    b.rect(pad + 2, pad, w - pad * 2 - 4, h - wall - pad, C.stone);
    b.line(w / 2 - 6, h - wall, w / 2, pad, C.ink);
    b.line(w / 2 + 6, h - wall, w / 2, pad, C.ink);
    b.rect(w / 2 - 3, pad + 4, 6, 4, K2);
    if (kind === 'mine') b.disc(w / 2, h - wall - 4, 5, C.ink);
  }
  if (d.weapons) {
    b.disc(w / 2, h / 2 - 2, Math.min(w, h) * 0.25, C.slate);
    b.disc(w / 2, h / 2 - 3, Math.min(w, h) * 0.17, K1);
    b.line(w / 2, h / 2 - 3, w / 2, 2, C.ink);
  }
  if (kind === 'hq') for (let i = 0; i < 3; i++) b.rect(pad + 8 + i * 16, h - wall + 3, 8, 6, C.gold);
  if (kind === 'barracks' || kind === 'factory' || kind === 'airfield' || kind === 'dock') b.rect(w / 2 - 6, h - wall + 2, 12, wall - 2, C.ink);
  if (kind === 'radar') b.disc(w / 2, h / 2 - 4, 9, C.frost);
  if (kind === 'launch') { b.rect(w / 2 - 6, 4, 12, h - 20, C.frost); b.rect(w / 2 - 3, 0, 6, 6, C.red); }
  b.outline(C.ink);
  return b;
}

function city(level: number): PixBuf {
  const size = 64 + level * 16;
  const b = new PixBuf(size, size);
  const n = 3 + level * 3;
  // a cluster of houses around a plaza, bigger and taller with level
  const c = size / 2;
  b.disc(c, c, size * 0.42, C.dust);
  b.disc(c, c, size * 0.38, C.taupe);
  let seed = level * 97;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2, r = 6 + rnd() * size * 0.3;
    const x = Math.round(c + Math.cos(a) * r), y = Math.round(c + Math.sin(a) * r);
    const hw = 4 + Math.floor(rnd() * (3 + level)), hh = 4 + Math.floor(rnd() * 3);
    const tall = level >= 4 && rnd() < 0.4;
    b.rect(x - hw, y - hh + (tall ? -8 : 0), hw * 2, hh * 2 + (tall ? 8 : 0), tall ? C.pebble : C.frost);
    b.rect(x - hw, y - hh + (tall ? -8 : 0), hw * 2, 3, rnd() < 0.5 ? C.brick : C.rust);
  }
  b.rect(c - 3, c - 3, 6, 6, C.gold);
  b.outline(C.ink);
  return b;
}

function deposit(kind: 'ore' | 'oil' | 'rich'): PixBuf {
  const b = new PixBuf(64, 64);
  let seed = kind.length * 31;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  if (kind === 'oil') {
    b.disc(32, 34, 18, C.ink);
    b.disc(30, 32, 14, C.plum);
    b.disc(26, 28, 4, C.mauve);
  } else {
    for (let i = 0; i < 9; i++) {
      const x = 14 + rnd() * 36, y = 14 + rnd() * 36, r = 4 + rnd() * 5;
      b.disc(x, y + 1, r, C.slate);
      b.disc(x, y, r - 1, kind === 'rich' ? C.gold : C.stone);
      b.set(x - 1, y - 1, kind === 'rich' ? C.cream : C.copper);
      b.set(x + 1, y, kind === 'rich' ? C.amber : C.rust);
    }
  }
  b.outline(C.ink);
  return b;
}

/** Register placeholders for everything the imported sheets don't cover. */
export function buildProcedural() {
  for (const u of Object.values(UNITS)) {
    // imported art without walk frames just slides; don't mix in placeholder frames
    const imported = hasSprite(`u:${u.id}:0`);
    for (let d = 0; d < 8; d++) {
      const a = (d * Math.PI) / 4;
      if (u.cls === 'infantry') {
        for (let f = 0; f < 4 && !imported; f++) {
          const b = infantry(u.id, a, f);
          put(`u:${u.id}:${d}:w${f}`, b, 12, 18);
        }
        put(`u:${u.id}:${d}`, infantry(u.id, a, 0), 12, 18);
      } else if (u.cls === 'vehicle') {
        const size = u.id === 'heavytank' || u.id === 'artillery' ? 48 : 40;
        put(`u:${u.id}:${d}`, vehicle(u.id, size, a), size / 2, size / 2);
      } else if (u.cls === 'aircraft') {
        const size = u.id === 'bomber' ? 64 : 48;
        put(`u:${u.id}:${d}`, aircraft(u.id, size, a), size / 2, size / 2);
      } else {
        const size = u.id === 'battleship' ? 112 : u.id === 'destroyer' ? 88 : u.id === 'patrolboat' ? 56 : 72;
        put(`u:${u.id}:${d}`, ship(u.id, size, a), size / 2, size / 2);
      }
    }
  }
  for (const k of Object.keys(BUILDINGS)) {
    const d = BUILDINGS[k];
    put(`b:${k}`, building(k), 0, d.h * TILE);
  }
  for (let l = 1; l <= 5; l++) {
    const b = city(l);
    put(`city:${l}`, b, b.w / 2, b.h / 2);
  }
  for (const k of ['ore', 'oil', 'rich'] as const) put(`dep:${k}`, deposit(k), 0, 0);
}

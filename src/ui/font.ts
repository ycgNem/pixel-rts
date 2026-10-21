// Hand-made proportional bitmap pixel font (ported from Sprocket & Sprout). Cap height 7px,
// descenders 2px. Special glyphs for resources live in the private range below.
// Glyphs are pre-rendered into an atlas once per color.

const G: Record<string, string> = {
  A: '.##.|#..#|#..#|####|#..#|#..#|#..#',
  B: '###.|#..#|#..#|###.|#..#|#..#|###.',
  C: '.##.|#..#|#...|#...|#...|#..#|.##.',
  D: '###.|#..#|#..#|#..#|#..#|#..#|###.',
  E: '####|#...|#...|###.|#...|#...|####',
  F: '####|#...|#...|###.|#...|#...|#...',
  G: '.##.|#..#|#...|#.##|#..#|#..#|.###',
  H: '#..#|#..#|#..#|####|#..#|#..#|#..#',
  I: '###|.#.|.#.|.#.|.#.|.#.|###',
  J: '..##|...#|...#|...#|#..#|#..#|.##.',
  K: '#..#|#..#|#.#.|##..|#.#.|#..#|#..#',
  L: '#...|#...|#...|#...|#...|#...|####',
  M: '#...#|##.##|#.#.#|#.#.#|#...#|#...#|#...#',
  N: '#..#|##.#|##.#|#.##|#.##|#..#|#..#',
  O: '.##.|#..#|#..#|#..#|#..#|#..#|.##.',
  P: '###.|#..#|#..#|###.|#...|#...|#...',
  Q: '.##.|#..#|#..#|#..#|#..#|#.#.|.#.#',
  R: '###.|#..#|#..#|###.|#.#.|#..#|#..#',
  S: '.##.|#..#|#...|.##.|...#|#..#|.##.',
  T: '#####|..#..|..#..|..#..|..#..|..#..|..#..',
  U: '#..#|#..#|#..#|#..#|#..#|#..#|.##.',
  V: '#...#|#...#|#...#|#...#|.#.#.|.#.#.|..#..',
  W: '#...#|#...#|#...#|#.#.#|#.#.#|##.##|#...#',
  X: '#...#|#...#|.#.#.|..#..|.#.#.|#...#|#...#',
  Y: '#...#|#...#|.#.#.|..#..|..#..|..#..|..#..',
  Z: '####|...#|..#.|.#..|#...|#...|####',
  a: '....|....|.##.|...#|.###|#..#|.###',
  b: '#...|#...|###.|#..#|#..#|#..#|###.',
  c: '...|...|.##|#..|#..|#..|.##',
  d: '...#|...#|.###|#..#|#..#|#..#|.###',
  e: '....|....|.##.|#..#|####|#...|.###',
  f: '..#|.#.|###|.#.|.#.|.#.|.#.',
  g: '....|....|.###|#..#|#..#|#..#|.###|...#|.##.',
  h: '#...|#...|###.|#..#|#..#|#..#|#..#',
  i: '#|.|#|#|#|#|#',
  j: '..#|...|..#|..#|..#|..#|..#|#.#|.#.',
  k: '#...|#...|#..#|#.#.|##..|#.#.|#..#',
  l: '#.|#.|#.|#.|#.|#.|.#',
  m: '.....|.....|##.#.|#.#.#|#.#.#|#.#.#|#.#.#',
  n: '....|....|###.|#..#|#..#|#..#|#..#',
  o: '....|....|.##.|#..#|#..#|#..#|.##.',
  p: '....|....|###.|#..#|#..#|#..#|###.|#...|#...',
  q: '....|....|.###|#..#|#..#|#..#|.###|...#|...#',
  r: '...|...|#.#|##.|#..|#..|#..',
  s: '....|....|.###|#...|.##.|...#|###.',
  t: '.#.|.#.|###|.#.|.#.|.#.|..#',
  u: '....|....|#..#|#..#|#..#|#..#|.###',
  v: '.....|.....|#...#|#...#|.#.#.|.#.#.|..#..',
  w: '.....|.....|#...#|#...#|#.#.#|#.#.#|.#.#.',
  x: '....|....|#..#|#..#|.##.|#..#|#..#',
  y: '....|....|#..#|#..#|#..#|#..#|.###|...#|.##.',
  z: '....|....|####|..#.|.#..|#...|####',
  '0': '.##.|#..#|#.##|##.#|#..#|#..#|.##.',
  '1': '.#.|##.|.#.|.#.|.#.|.#.|###',
  '2': '.##.|#..#|...#|..#.|.#..|#...|####',
  '3': '###.|...#|...#|.##.|...#|...#|###.',
  '4': '#..#|#..#|#..#|####|...#|...#|...#',
  '5': '####|#...|###.|...#|...#|#..#|.##.',
  '6': '.##.|#...|#...|###.|#..#|#..#|.##.',
  '7': '####|...#|..#.|..#.|.#..|.#..|.#..',
  '8': '.##.|#..#|#..#|.##.|#..#|#..#|.##.',
  '9': '.##.|#..#|#..#|.###|...#|...#|.##.',
  ' ': '...|...|...|...|...|...|...',
  '!': '#|#|#|#|#|.|#',
  '"': '#.#|#.#|...|...|...|...|...',
  '#': '.....|.#.#.|#####|.#.#.|#####|.#.#.|.....',
  $: '..#..|.####|#.#..|.###.|..#.#|####.|..#..',
  '%': '.....|#...#|...#.|..#..|.#...|#...#|.....',
  '&': '.##..|#..#.|.##..|.#...|#.#.#|#..#.|.##.#',
  "'": '#|#|.|.|.|.|.',
  '(': '.#|#.|#.|#.|#.|#.|.#',
  ')': '#.|.#|.#|.#|.#|.#|#.',
  '*': '...|#.#|.#.|###|.#.|#.#|...',
  '+': '...|...|.#.|###|.#.|...|...',
  ',': '..|..|..|..|..|.#|.#|#.',
  '-': '...|...|...|###|...|...|...',
  '.': '.|.|.|.|.|.|#',
  '/': '...#|...#|..#.|.#..|.#..|#...|#...',
  ':': '.|#|.|.|.|#|.',
  ';': '..|.#|..|..|..|.#|.#|#.',
  '<': '...|..#|.#.|#..|.#.|..#|...',
  '=': '...|...|###|...|###|...|...',
  '>': '...|#..|.#.|..#|.#.|#..|...',
  '?': '.##.|#..#|...#|..#.|.#..|....|.#..',
  '@': '.###.|#...#|#.###|#.#.#|#.##.|#....|.###.',
  '[': '##|#.|#.|#.|#.|#.|##',
  '\\': '#...|#...|.#..|..#.|..#.|...#|...#',
  ']': '##|.#|.#|.#|.#|.#|##',
  '^': '.#.|#.#|...|...|...|...|...',
  _: '....|....|....|....|....|....|####',
  '`': '#.|.#|..|..|..|..|..',
  '{': '..#|.#.|.#.|#..|.#.|.#.|..#',
  '|': '#|#|#|#|#|#|#',
  '}': '#..|.#.|.#.|..#|.#.|.#.|#..',
  '~': '....|....|.#.#|#.#.|....|....|....',
  // Special symbols (use via ICON constants below)
  '\u0001': '.....|.#.#.|#####|#####|.###.|..#..|.....', // heart
  '\u0002': '.....|.###.|#####|##.##|#####|.###.|.....', // coin with a square hole
  '\u0003': '...#.|..#..|.#...|#####|...#.|..#..|.#...', // bolt
  '\u0004': '..#..|..#..|#####|.###.|.#.#.|#...#|.....', // star
  '\u0005': '.###.|#.#.#|#.#.#|#.###|#...#|#...#|.###.', // clock
  '\u0006': '.....|..#..|.###.|#####|..#..|..#..|.....', // arrow up
  '\u0007': '.....|..#..|..#..|#####|.###.|..#..|.....', // arrow down
  '\u0008': '.....|.#...|.##..|.###.|.##..|.#...|.....', // play / right arrow
  '\u000e': '.....|...#.|..##.|.###.|..##.|...#.|.....', // left arrow
  '\u000f': '.....|#.#.#|.###.|##.##|.###.|#.#.#|.....', // cog
  '\u0010': '..#..|.####|#.#..|.###.|..#.#|####.|..#..', // cash
  '\u0011': '..#..|..#..|.###.|.###.|#####|#####|.###.', // oil drop
  '\u0012': '.###.|..#..|..#..|.###.|#####|#####|.###.', // science flask
  '\u0013': '.###.|.###.|..#..|#####|..#..|.#.#.|.#.#.', // supply (soldier)
  '\u0014': '#....|####.|#####|####.|#....|#....|#....', // command point (flag)
  '\u0015': '#...#|.#.#.|..#..|.#.#.|#...#|.....|.....', // close x
  '\u0016': '#####|##.##|##.##|#####|.###.|..#..|.....', // shield
  '\u0017': '..#..|.###.|..#..|..#..|#.#.#|.###.|.....', // anchor
};

export const ICON = {
  heart: '\u0001', coin: '\u0002', bolt: '\u0003', star: '\u0004', clock: '\u0005',
  up: '\u0006', down: '\u0007', right: '\u0008', left: '\u000e', cog: '\u000f',
  cash: '\u0010', oil: '\u0011', science: '\u0012', supply: '\u0013', cp: '\u0014', close: '\u0015',
  shield: '\u0016', anchor: '\u0017',
};

export const FONT_H = 9; // cell height incl. descenders
export const LINE_H = 10;

interface Glyph { w: number; rows: string[]; ax: number; ay: number }
const glyphs = new Map<string, Glyph>();
for (const [ch, def] of Object.entries(G)) {
  const rows = def.split('|');
  glyphs.set(ch, { w: rows[0].length, rows, ax: 0, ay: 0 });
}

export function glyphWidth(ch: string): number {
  const g = glyphs.get(ch) ?? glyphs.get('?')!;
  return g.w;
}

export function textWidth(s: string): number {
  let w = 0;
  for (let i = 0; i < s.length; i++) {
    w += glyphWidth(s[i]) + 1;
  }
  return Math.max(0, w - 1);
}

/** Cut text to fit a pixel width, ending in '..' when it had to be shortened. */
export function ellipsize(s: string, maxW: number): string {
  if (textWidth(s) <= maxW) return s;
  let t = s;
  while (t.length > 1 && textWidth(t.trimEnd() + '..') > maxW) t = t.slice(0, -1);
  return t.trimEnd() + '..';
}

/** Word-wrap text to a pixel width. Respects explicit '\n'. */
export function wrapText(s: string, maxW: number): string[] {
  const out: string[] = [];
  for (const para of s.split('\n')) {
    const words = para.split(' ');
    let line = '';
    for (const word of words) {
      const test = line ? line + ' ' + word : word;
      if (textWidth(test) > maxW && line) {
        out.push(line);
        line = word;
      } else line = test;
    }
    out.push(line);
  }
  return out;
}

// ---- atlas rendering (browser only) ----

let atlasWhite: HTMLCanvasElement | null = null;
const tinted = new Map<string, HTMLCanvasElement>();
const ATLAS_COLS = 16;
const CELL_W = 6;

function buildAtlas(): HTMLCanvasElement {
  const chars = [...glyphs.keys()];
  const rowsN = Math.ceil(chars.length / ATLAS_COLS);
  const c = document.createElement('canvas');
  c.width = ATLAS_COLS * CELL_W;
  c.height = rowsN * FONT_H;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fff';
  chars.forEach((ch, i) => {
    const g = glyphs.get(ch)!;
    g.ax = (i % ATLAS_COLS) * CELL_W;
    g.ay = Math.floor(i / ATLAS_COLS) * FONT_H;
    g.rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) if (row[x] === '#') ctx.fillRect(g.ax + x, g.ay + y, 1, 1);
    });
  });
  return c;
}

function atlasFor(color: string): HTMLCanvasElement {
  if (!atlasWhite) atlasWhite = buildAtlas();
  let a = tinted.get(color);
  if (!a) {
    a = document.createElement('canvas');
    a.width = atlasWhite.width;
    a.height = atlasWhite.height;
    const ctx = a.getContext('2d')!;
    ctx.drawImage(atlasWhite, 0, 0);
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, a.width, a.height);
    tinted.set(color, a);
  }
  return a;
}

/** Draw pixel text. `scale` is an integer multiplier in current transform units. */
export function drawText(
  ctx: CanvasRenderingContext2D,
  s: string,
  x: number,
  y: number,
  color: string,
  scale = 1,
  shadow: string | null = null,
): number {
  if (shadow) drawRaw(ctx, s, x + scale, y + scale, shadow, scale);
  return drawRaw(ctx, s, x, y, color, scale);
}

function drawRaw(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, color: string, scale: number): number {
  if (!s) return 0;
  const line = lineFor(s, color);
  ctx.drawImage(line, 0, 0, line.width, FONT_H, x, y, line.width * scale, FONT_H * scale);
  return (line.width + 1) * scale;
}

/**
 * Whole strings, drawn glyph by glyph once per color and kept: most text on screen is the same
 * from one frame to the next, and one image is far cheaper to draw than a glyph at a time.
 */
const lines = new Map<string, HTMLCanvasElement>();
const MAX_LINES = 1000;

function lineFor(s: string, color: string): HTMLCanvasElement {
  const key = color + '\u0000' + s;
  let c = lines.get(key);
  if (c) return c;
  if (lines.size >= MAX_LINES) lines.clear();
  const atlas = atlasFor(color);
  c = document.createElement('canvas');
  c.width = Math.max(1, textWidth(s));
  c.height = FONT_H;
  const ctx = c.getContext('2d')!;
  let cx = 0;
  for (let i = 0; i < s.length; i++) {
    const g = glyphs.get(s[i]) ?? glyphs.get('?')!;
    if (s[i] !== ' ') ctx.drawImage(atlas, g.ax, g.ay, g.w, FONT_H, cx, 0, g.w, FONT_H);
    cx += g.w + 1;
  }
  lines.set(key, c);
  return c;
}

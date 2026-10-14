// Guards the core rule from CLAUDE.md: game rules (src/sim) and balance data (src/data) are pure
// TypeScript. They import nothing but each other, never touch the browser or the network, and
// never read the wall clock or Math.random, so the same code runs single-player, as the online
// host, and headless in these tests.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PURE_DIRS = ['src/sim', 'src/data'];

const RULES: [RegExp, string][] = [
  [/\bfrom\s+['"](?!\.{1,2}\/)[^'"]*['"]/, 'package import (sim and data use no dependencies)'],
  [/\bfrom\s+['"][^'"]*\b(render|ui|net|engine|app)(\/|['"])/, 'import from render/ui/net/engine/app'],
  [/\b(window|document|navigator|localStorage|sessionStorage|requestAnimationFrame|fetch)\b/, 'browser API'],
  [/\bMath\.random\b|\bDate\.now\b|\bperformance\.now\b|\bnew Date\b/, 'non-deterministic source (use the seeded RNG / tick count)'],
  [/\b(setTimeout|setInterval)\b/, 'timer (the sim only advances through step())'],
];

/** Returns "line: reason" for every rule broken in a source file. */
export function violations(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/\/\/.*$/gm, '');
  const out: string[] = [];
  code.split('\n').forEach((line, i) => {
    for (const [re, reason] of RULES) if (re.test(line)) out.push(`${i + 1}: ${reason}`);
  });
  return out;
}

function tsFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return tsFiles(p);
    return e.name.endsWith('.ts') ? [p] : [];
  });
}

describe('sim boundary', () => {
  it('src/sim and src/data stay pure', () => {
    const problems = PURE_DIRS.flatMap((d) => tsFiles(join(ROOT, d))).flatMap((f) =>
      violations(readFileSync(f, 'utf8')).map((v) => `${relative(ROOT, f)}:${v}`),
    );
    expect(problems).toEqual([]);
  });

  it('catches the things it should', () => {
    expect(violations("import * as P from 'phaser';")).toHaveLength(1);
    expect(violations("import { draw } from '../render/units';")).toHaveLength(1);
    expect(violations("import { send } from '../net';")).toHaveLength(1);
    expect(violations('const r = Math.random();')).toHaveLength(1);
    expect(violations('const t = Date.now();')).toHaveLength(1);
    expect(violations('document.title = "x";')).toHaveLength(1);
    expect(violations("import { UNITS } from '../data/units';")).toEqual([]);
    expect(violations('// Math.random is banned here')).toEqual([]);
  });
});

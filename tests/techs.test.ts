// The tech tree: every tech can be researched by command, and what it promises switches on.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BUILDINGS } from '../src/data/buildings';
import { UNITS } from '../src/data/units';
import { DOCTRINES, TECHS, type ModKey } from '../src/data/techs';
import { modAdd, modMul } from '../src/sim/mods';
import { vision } from '../src/sim/vision';
import { hqOf, sec } from '../src/sim/world';
import { step } from '../src/sim/match';
import { placeBuilding } from '../src/sim/lifecycle';
import type { Command, MatchState } from '../src/sim/types';
import { match, run } from './helpers';

/** The reject reason for one command, or '' when it was accepted. */
function why(s: MatchState, c: Command): string {
  const ev = step(s, [c]);
  const r = ev.find((e) => e.e === 'reject');
  return r && r.e === 'reject' ? r.why : '';
}

describe('tech tree', () => {
  it('every tech can be researched by command, and what it promises switches on', () => {
    for (const t of TECHS) {
      const s = match({ fog: 'on' });
      const p = s.players[0];
      p.era = t.era;
      p.techs = [...(t.needs ?? [])];
      const hq = hqOf(s, 0)!;
      const units = Object.values(UNITS).filter((u) => u.tech === t.id);
      const buildings = Object.values(BUILDINGS).filter((b) => b.tech === t.id);
      const train = (kind: string): Command => ({ t: 'train', p: 0, at: hq.id, kind, n: 1 });
      const build = (kind: string): Command => ({ t: 'build', p: 0, ids: [], kind, tx: 0, ty: 0 });
      // locked before
      for (const u of units) expect(why(s, train(u.id)), `${t.id} → ${u.id}`).toMatch(/^needs /);
      for (const b of buildings) expect(why(s, build(b.id)), `${t.id} → ${b.id}`).toMatch(/^needs /);
      const before = (t.mods ?? []).map((m) => (m.mul !== undefined ? modMul(p, m.key) : modAdd(p, m.key)));

      // research it by command
      p.science = 1e6;
      const ev = run(s, 0.1, [{ t: 'research', p: 0, tech: t.id }]);
      expect(p.techs, t.id).toContain(t.id);
      expect(ev.some((e) => e.e === 'researched' && e.tech === t.id)).toBe(true);

      // unlocked after (a train or build may still fail for another reason, never the tech)
      for (const u of units) expect(why(s, train(u.id))).not.toMatch(/^needs /);
      for (const b of buildings) expect(why(s, build(b.id))).not.toMatch(/^needs /);
      (t.mods ?? []).forEach((m, i) => {
        if (m.mul !== undefined) expect(modMul(p, m.key), `${t.id} ${m.key}`).toBeCloseTo(before[i] + (m.mul - 1));
        else expect(modAdd(p, m.key), `${t.id} ${m.key}`).toBe(before[i] + m.add!);
      });
      if (t.reveal) {
        // the satellite window: the whole map, every `every` seconds, for `duration`
        s.tick = sec(t.reveal.every * 3);
        expect(vision(s, p.team).every((v) => v === 1)).toBe(true);
        s.tick = sec(t.reveal.every * 3 + t.reveal.duration + 1);
        expect(vision(s, p.team).every((v) => v === 1)).toBe(false);
      }
      const effects = units.length + buildings.length + (t.mods?.length ?? 0) + (t.reveal ? 1 : 0);
      expect(effects, `${t.id} does nothing`).toBeGreaterThan(0);
    }
  });

  it('every stat a tech or doctrine changes is read by the sim', () => {
    const dir = join(__dirname, '../src/sim');
    const files = (d: string): string[] =>
      readdirSync(d, { withFileTypes: true }).flatMap((f) => (f.isDirectory() ? files(join(d, f.name)) : f.name.endsWith('.ts') ? [join(d, f.name)] : []));
    const src = files(dir).map((f) => readFileSync(f, 'utf8')).join('\n');
    const keys = new Set<ModKey>();
    for (const t of [...TECHS, ...DOCTRINES]) for (const m of t.mods ?? []) keys.add(m.key);
    for (const k of keys) expect(src.includes(`'${k}'`), `nothing in src/sim reads '${k}'`).toBe(true);
  });

  it('a tech changes the game, not just the number: Deep Mining makes a mine pay more cash', () => {
    const s = match();
    const p = s.players[0];
    const dep = s.map.deposits.findIndex((d) => d.kind === 'ore' && !d.rich);
    placeBuilding(s, 'mine', 0, s.map.deposits[dep].x, s.map.deposits[dep].y, 1, dep);
    const earn = () => { const c = p.cash; run(s, 10); return p.cash - c; };
    const a = earn();
    p.techs.push('deepMining');
    const b = earn();
    const mineRate = BUILDINGS.mine.income!.cash! * 10;
    expect(b - a).toBeCloseTo(mineRate * (TECHS.find((t) => t.id === 'deepMining')!.mods![0].mul! - 1), 0);
  });
});

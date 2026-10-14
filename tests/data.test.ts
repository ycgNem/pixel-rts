// Data validation: every reference between data files resolves (M3 "data validation test").
import { describe, expect, it } from 'vitest';
import { UNITS, ABILITIES } from '../src/data/units';
import { BUILDINGS } from '../src/data/buildings';
import { TECHS, DOCTRINES, ERAS } from '../src/data/techs';
import { DAMAGE, ARMOR_CLASSES } from '../src/data/damage';
import { CITY_LEVELS, SPECS } from '../src/data/cities';
import { POWERS } from '../src/data/powers';
import { TEAM_COLORS, PALETTE } from '../src/data/palette';
import { TERRAIN } from '../src/data/terrain';

const techIds = new Set(TECHS.map((t) => t.id));

describe('data', () => {
  it('units reference real buildings, techs and abilities', () => {
    for (const u of Object.values(UNITS)) {
      expect(u.id).toBe(Object.keys(UNITS).find((k) => UNITS[k] === u));
      for (const at of u.at) expect(at === 'city' || !!BUILDINGS[at], `${u.id} at ${at}`).toBe(true);
      if (u.tech) expect(techIds.has(u.tech), `${u.id} tech ${u.tech}`).toBe(true);
      if (u.ability) expect(ABILITIES[u.ability]).toBeTruthy();
      for (const w of u.weapons) {
        expect(DAMAGE[w.cls], `${u.id} weapon`).toBeTruthy();
        expect(w.range).toBeGreaterThan(0);
      }
      expect(ARMOR_CLASSES).toContain(u.armor);
    }
  });

  it('buildings reference real techs; every tech unlock is used or changes stats', () => {
    for (const b of Object.values(BUILDINGS)) if (b.tech) expect(techIds.has(b.tech), `${b.id} tech`).toBe(true);
    const unlocks = new Set([...Object.values(UNITS).map((u) => u.tech), ...Object.values(BUILDINGS).map((b) => b.tech)]);
    for (const t of TECHS) expect(unlocks.has(t.id) || (t.mods?.length ?? 0) > 0 || !!t.reveal, `${t.id} does nothing`).toBe(true);
  });

  it('tech prerequisites exist and come from the same or an earlier era', () => {
    for (const t of TECHS) {
      expect(t.era).toBeLessThan(ERAS.length);
      for (const n of t.needs ?? []) {
        const req = TECHS.find((k) => k.id === n);
        expect(req, `${t.id} needs ${n}`).toBeTruthy();
        expect(req!.era).toBeLessThanOrEqual(t.era);
      }
    }
  });

  it('every era after the first offers three doctrines; every era has enough techs', () => {
    for (let e = 1; e < ERAS.length; e++) expect(DOCTRINES.filter((d) => d.era === e)).toHaveLength(3);
    for (let e = 0; e < ERAS.length; e++) expect(TECHS.filter((t) => t.era === e).length).toBeGreaterThanOrEqual(4);
  });

  it('city levels, specializations, powers, colors and terrain are well formed', () => {
    expect(CITY_LEVELS).toHaveLength(5);
    for (const s of Object.values(SPECS)) expect(s.name).toBeTruthy();
    for (const p of Object.values(POWERS)) expect(p.cost).toBeGreaterThan(0);
    for (const c of TEAM_COLORS) for (const i of c.ramp) expect(i).toBeLessThan(PALETTE.length);
    for (const t of TERRAIN) expect(t.mini).toBeLessThan(PALETTE.length);
  });
});

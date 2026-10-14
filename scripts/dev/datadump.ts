// Debug: print the balance data as compact tables (for keeping docs/GAME_DESIGN.md honest).
//   node scripts/run.mjs scripts/dev/datadump.ts
import { UNITS, ABILITIES } from '../../src/data/units';
import { BUILDINGS } from '../../src/data/buildings';
import { DAMAGE } from '../../src/data/damage';
import { CITY_LEVELS, SPECS, CAPTURE, MILITIA, FORTRESS_GUN } from '../../src/data/cities';
import { TECHS, ERAS, DOCTRINES, TECH_COST, TECH_ESCALATE } from '../../src/data/techs';
import { POWERS, COMMAND, SUPPLY_DROP } from '../../src/data/powers';
import { CRATES, VICTORY, EXILE, EXCHANGE, START, MAPGEN, SUPPLY } from '../../src/data/rules';

export function main() {
  const log = (...a: unknown[]) => console.log(...a);
  log('START', JSON.stringify(START), 'SUPPLY', JSON.stringify(SUPPLY));
  log('\nBUILDINGS');
  for (const b of Object.values(BUILDINGS)) {
    const x = b as unknown as Record<string, unknown>;
    log(`${b.id} ${b.w}x${b.h} hp ${b.hp} $${b.cost.cash}${b.cost.oil ? '+' + b.cost.oil + 'oil' : ''} t${b.buildTime}s tech ${b.tech ?? '-'} income ${JSON.stringify(x.income ?? '')} supply ${x.supply ?? ''} weapons ${JSON.stringify((b.weapons ?? []).map((w) => [w.cls, w.dmg, w.range, w.cd]))}`);
  }
  log('\nUNITS');
  for (const u of Object.values(UNITS)) log(`${u.id} ${u.cls}/${u.armor}/${u.layer} hp ${u.hp} spd ${u.speed} sight ${u.sight} $${u.cost.cash}+${u.cost.oil} sup ${u.supply} t${u.buildTime} at ${u.at.join('/')} tech ${u.tech ?? '-'} ab ${u.ability ?? '-'} w ${JSON.stringify(u.weapons.map((w) => [w.cls, w.dmg, w.range, w.cd]))}`);
  log('\nABILITIES', JSON.stringify(Object.fromEntries(Object.entries(ABILITIES).map(([k, a]) => [k, [a.name, a.cooldown]]))));
  log('\nDAMAGE');
  for (const [k, v] of Object.entries(DAMAGE)) log(k, JSON.stringify(v));
  log('\nCITY_LEVELS', JSON.stringify(CITY_LEVELS));
  log('CAPTURE', JSON.stringify(CAPTURE));
  log('MILITIA', JSON.stringify(MILITIA), 'FORTRESS', JSON.stringify(FORTRESS_GUN));
  log('SPECS', JSON.stringify(Object.values(SPECS).map((s) => [s.name, s.desc])));
  log('\nERAS', JSON.stringify(ERAS), 'TECH_COST', JSON.stringify(TECH_COST), 'ESCALATE', TECH_ESCALATE);
  for (let e = 0; e < 4; e++) log(`era ${e}: ` + TECHS.filter((t) => t.era === e).map((t) => `${t.name} [${t.branch}] ${t.desc}`).join(' | '));
  log('\nDOCTRINES');
  for (const d of DOCTRINES) log(`era ${d.era} ${d.name}: ${d.desc}`);
  log('\nPOWERS', JSON.stringify(COMMAND), JSON.stringify(SUPPLY_DROP));
  for (const p of Object.values(POWERS)) log(`${p.name} ${p.cost}CP cd ${p.cooldown}s era ${p.era}: ${p.desc}`);
  log('\nCRATES', JSON.stringify(CRATES));
  log('VICTORY', JSON.stringify(VICTORY), 'EXILE', JSON.stringify(EXILE));
  log('EXCHANGE', JSON.stringify(EXCHANGE));
  log('MAPGEN', JSON.stringify(MAPGEN));
}

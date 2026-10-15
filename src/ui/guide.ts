// The Field Guide (title screen): every unit and building, its sprite turning through its eight
// facings in any team colour, its numbers, and what it beats, all read from the data files so it
// never drifts from the balance. UI only.
import { UNITS, ABILITIES, type UnitDef } from '../data/units';
import { BUILDINGS, type BuildingDef } from '../data/buildings';
import { TECHS } from '../data/techs';
import { TEAM_COLORS, PALETTE } from '../data/palette';
import { sprite } from '../render/art';
import { type UI, COL } from './ui';
import { ICON, LINE_H, ellipsize, textWidth } from './font';
import { matchupText, WEAPON_NAMES } from './counters';

const TECH_NAME = new Map(TECHS.map((t) => [t.id, t.name]));
const GROUPS: [string, UnitDef['cls']][] = [['Infantry', 'infantry'], ['Vehicles', 'vehicle'], ['Aircraft', 'aircraft'], ['Ships', 'ship']];
const LAYER_WORDS: Record<string, string> = { ground: 'ground', naval: 'ships', air: 'aircraft' };
/** units a player can train, by group (the merchant ship sails by itself) */
const TRAINABLE = GROUPS.map(([label, cls]) => [label, Object.values(UNITS).filter((u) => u.cls === cls && u.at.length).map((u) => u.id)] as const);
const BUILDING_IDS = Object.keys(BUILDINGS);
/** where a unit is trained, in words */
const AT_WORDS = (u: UnitDef) => u.at.map((a) => (a === 'city' ? 'big cities' : BUILDINGS[a]?.name ?? a)).join(', ');
/** which units each building trains */
const TRAINS: Record<string, string[]> = {};
for (const u of Object.values(UNITS)) for (const a of u.at) if (a !== 'city') (TRAINS[a] ??= []).push(u.id);

const cost = (c: { cash: number; oil: number }) => (c.cash || c.oil ? `${ICON.cash}${c.cash}${c.oil ? `  ${ICON.oil}${c.oil}` : ''}` : 'free');

export class FieldGuide {
  private tab: 'units' | 'buildings' = 'units';
  private unit = 'rifleman';
  private building = 'hq';
  private color = 0;

  /** Draw the guide over the title screen; false once it is closed. */
  draw(ui: UI, time: number): boolean {
    const w = Math.min(ui.w - 12, 560), h = Math.min(ui.h - 12, 330);
    const x = Math.round((ui.w - w) / 2), y = Math.round((ui.h - h) / 2);
    ui.panel(x, y, w, h);
    ui.text('Field Guide', x + 6, y + 5, COL.gold);
    if (ui.button(x + 70, y + 3, 44, 12, { label: 'Units', active: this.tab === 'units', tip: 'Every unit you can train' })) this.tab = 'units';
    if (ui.button(x + 116, y + 3, 56, 12, { label: 'Buildings', active: this.tab === 'buildings', tip: 'Every building' })) this.tab = 'buildings';
    if (ui.button(x + w - 14, y + 3, 11, 11, { label: ICON.close, hotkey: 'Escape', tip: 'Close (Esc)' })) return false;
    const listW = 118, top = y + 20;
    if (this.tab === 'units') {
      this.unitList(ui, x + 4, top, listW, h - 24);
      this.unitPage(ui, x + listW + 10, top, w - listW - 16, h - 24, time);
    } else {
      this.buildingList(ui, x + 4, top, listW, h - 24);
      this.buildingPage(ui, x + listW + 10, top, w - listW - 16, h - 24);
    }
    return true;
  }

  // ---------------------------------------------------------------- units

  private unitList(ui: UI, x: number, y: number, w: number, h: number) {
    // rows shrink to fit a short screen
    const n = TRAINABLE.reduce((a, [, ids]) => a + ids.length, 0);
    const row = Math.max(10, Math.min(13, Math.floor((h - TRAINABLE.length * 10) / n)));
    let ly = y;
    for (const [label, ids] of TRAINABLE) {
      ui.text(label, x + 2, ly, COL.dim);
      ly += 10;
      for (const id of ids) {
        const d = UNITS[id], on = this.unit === id;
        if (ui.hover(x, ly, w, row)) ui.rect(x, ly, w, row, COL.panel2);
        if (on) ui.rect(x, ly, w, row, '#45293f');
        ui.icon(sprite(`u:${id}:2`, this.color), x + 7, ly + row / 2, 15); // (a size that fits every sprite at its own scale)
        ui.text(ellipsize(d.name, w - 18), x + 16, ly + Math.round((row - 7) / 2), on ? COL.gold : COL.text);
        if (ui.clicked(x, ly, w, row)) this.unit = id;
        ly += row;
      }
    }
  }

  private unitPage(ui: UI, x: number, y: number, w: number, h: number, time: number) {
    const d = UNITS[this.unit];
    // the sprite turns through its facings (infantry walk while they turn)
    const box = 72;
    ui.rect(x, y, box, box, COL.shadow);
    const dir = Math.floor(time * 1.2) % 8;
    const walk = d.cls === 'infantry' ? sprite(`u:${d.id}:${dir}:w${Math.floor(time * 8) % 4}`, this.color) : null;
    ui.icon(walk ?? sprite(`u:${d.id}:${dir}`, this.color), x + box / 2, y + box / 2, box - 6);
    this.swatches(ui, x, y + box + 3, box);
    // the numbers
    const tx = x + box + 8, tw = w - box - 8;
    ui.text(d.name, tx, y, COL.gold);
    const where = `${GROUPS.find(([, c]) => c === d.cls)?.[0] ?? ''} from ${AT_WORDS(d)}${d.tech ? `, needs ${TECH_NAME.get(d.tech) ?? d.tech}` : ''}`;
    ui.text(ellipsize(where, tw), tx, y + 10, COL.light);
    ui.text(`${cost(d.cost)}   ${ICON.supply}${d.supply}   ${ICON.clock}${d.buildTime}s`, tx, y + 22, COL.text);
    ui.text(`${ICON.heart}${d.hp} HP   speed ${d.speed}   sight ${d.sight}`, tx, y + 32, COL.text);
    const flags: string[] = [];
    if (d.captures) flags.push('captures cities');
    if (d.builds) flags.push('builds and repairs');
    if (d.carries) flags.push(`carries ${d.carries} supply of troops`);
    if (d.stealth) flags.push('hidden until it fires');
    if (d.detects) flags.push('detects submarines');
    if (flags.length) ui.text(ellipsize(flags.join(', '), tw), tx, y + 42, COL.green);
    let ly = y + 56;
    for (const wpn of d.weapons) {
      const vs = wpn.hits.map((l) => LAYER_WORDS[l]).join('/');
      ui.text(ellipsize(`${WEAPON_NAMES[wpn.cls] ?? wpn.cls}: ${wpn.dmg} dmg every ${wpn.cd}s, range ${wpn.range}${wpn.minRange ? ` (min ${wpn.minRange})` : ''}${wpn.splash ? ', splash' : ''}, vs ${vs}`, tw), tx, ly, COL.text);
      ly += LINE_H;
    }
    if (!d.weapons.length) { ui.text('Unarmed', tx, ly, COL.dim); ly += LINE_H; }
    if (d.ability) {
      const a = ABILITIES[d.ability];
      ui.text(ellipsize(`Ability: ${a.name}. ${a.desc}`, tw), tx, ly, COL.blue);
      ly += LINE_H;
    }
    ly = Math.max(ly + 4, y + box + 18);
    ly += ui.para(d.desc, x, ly, w, COL.light) + 4;
    // what it's good and bad against
    for (const line of matchupText(d.id)) {
      if (ly > y + h - LINE_H) break;
      ui.text(ellipsize(line, w), x, ly, line.startsWith('Beats') ? COL.green : line.startsWith('Countered') ? COL.red : COL.dim);
      ly += LINE_H;
    }
  }

  // ---------------------------------------------------------------- buildings

  private buildingList(ui: UI, x: number, y: number, w: number, h: number) {
    const row = Math.max(10, Math.min(14, Math.floor(h / BUILDING_IDS.length)));
    BUILDING_IDS.forEach((id, i) => {
      const ly = y + i * row, on = this.building === id;
      if (ui.hover(x, ly, w, row)) ui.rect(x, ly, w, row, COL.panel2);
      if (on) ui.rect(x, ly, w, row, '#45293f');
      ui.icon(sprite(`b:${id}`, this.color), x + 7, ly + row / 2, row - 1);
      ui.text(ellipsize(BUILDINGS[id].name, w - 18), x + 16, ly + Math.round((row - 7) / 2), on ? COL.gold : COL.text);
      if (ui.clicked(x, ly, w, row)) this.building = id;
    });
  }

  private buildingPage(ui: UI, x: number, y: number, w: number, h: number) {
    const d: BuildingDef = BUILDINGS[this.building];
    const box = 72;
    ui.rect(x, y, box, box, COL.shadow);
    ui.icon(sprite(`b:${d.id}`, this.color), x + box / 2, y + box / 2, box - 6);
    this.swatches(ui, x, y + box + 3, box);
    const tx = x + box + 8, tw = w - box - 8;
    ui.text(d.name, tx, y, COL.gold);
    const where = d.start ? 'You start with one' : `${d.on ? `Built on ${d.on}` : d.coastal ? 'Built on a coast' : 'Built anywhere on land'}${d.tech ? `, needs ${TECH_NAME.get(d.tech) ?? d.tech}` : ''}${d.needs ? `, after a ${BUILDINGS[d.needs].name}` : ''}`;
    ui.text(ellipsize(where, tw), tx, y + 10, COL.light);
    ui.text(`${d.start ? '' : `${cost(d.cost)}   ${ICON.clock}${d.buildTime}s   `}${d.w}x${d.h} tiles`, tx, y + 22, COL.text);
    ui.text(`${ICON.heart}${d.hp} HP   sight ${d.sight}`, tx, y + 32, COL.text);
    const gives: string[] = [];
    if (d.income?.cash) gives.push(`${ICON.cash}+${Math.round(d.income.cash * 60)}/min`);
    if (d.income?.oil) gives.push(`${ICON.oil}+${Math.round(d.income.oil * 60)}/min`);
    if (d.income?.science) gives.push(`${ICON.science}+${Math.round(d.income.science * 60)}/min`);
    if (d.supply) gives.push(`${ICON.supply}+${d.supply}`);
    if (d.detects) gives.push('detects submarines');
    if (gives.length) ui.text(ellipsize(gives.join('   '), tw), tx, y + 42, COL.green);
    let ly = y + 56;
    for (const wpn of d.weapons ?? []) {
      ui.text(ellipsize(`${WEAPON_NAMES[wpn.cls] ?? wpn.cls}: ${wpn.dmg} dmg every ${wpn.cd}s, range ${wpn.range}, vs ${wpn.hits.map((l) => LAYER_WORDS[l]).join('/')}`, tw), tx, ly, COL.text);
      ly += LINE_H;
    }
    ly = Math.max(ly + 4, y + box + 18);
    ly += ui.para(d.desc, x, ly, w, COL.light) + 6;
    // what it trains, with their pictures
    const trains = TRAINS[d.id] ?? [];
    if (trains.length && ly < y + h - 24) {
      ui.text('Trains', x, ly, COL.dim);
      let ix = x + textWidth('Trains') + 6;
      for (const id of trains) {
        if (ix + 20 > x + w) break;
        ui.rect(ix, ly - 3, 18, 18, COL.shadow);
        ui.icon(sprite(`u:${id}:2`, this.color), ix + 9, ly + 6, 16);
        if (ui.hover(ix, ly - 3, 18, 18)) ui.setTip(UNITS[id].name, ix + 9, ly - 3);
        if (ui.clicked(ix, ly - 3, 18, 18)) { this.tab = 'units'; this.unit = id; }
        ix += 20;
      }
    }
  }

  /** Team colour picker under the preview. */
  private swatches(ui: UI, x: number, y: number, w: number) {
    const n = TEAM_COLORS.length, s = Math.floor((w - (n - 1)) / n);
    TEAM_COLORS.forEach((c, i) => {
      const sx = x + i * (s + 1);
      ui.rect(sx, y, s, 6, i === this.color ? COL.white : COL.shadow);
      ui.rect(sx + 1, y + 1, s - 2, 4, PALETTE[c.ui]);
      if (ui.hover(sx, y, s, 6)) ui.setTip(c.name, sx + s / 2, y);
      if (ui.clicked(sx, y, s, 6)) this.color = i;
    });
  }
}

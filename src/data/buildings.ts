// Every building's stats. Footprints are in tiles; income is per second.
import type { Cost, WeaponDef } from './units';

export interface BuildingDef {
  id: string;
  name: string;
  w: number;
  h: number;
  hp: number;
  cost: Cost;
  buildTime: number;
  tech?: string;
  sight: number;
  /** must sit exactly on a deposit of this kind */
  on?: 'ore' | 'oil';
  /** must touch water (ships spawn there) */
  coastal?: boolean;
  income?: { cash?: number; oil?: number; science?: number };
  supply?: number;
  weapons?: WeaponDef[];
  /** players can't place it (the HQ comes with the start) */
  start?: boolean;
  /** detects stealth units in sight */
  detects?: boolean;
  hotkey: string;
  desc: string;
}

export const BUILDINGS: Record<string, BuildingDef> = {
  hq: {
    id: 'hq', name: 'Headquarters', w: 4, h: 4, hp: 9000, cost: { cash: 0, oil: 0 }, buildTime: 1, sight: 10,
    income: { cash: 2, science: 0.5 }, supply: 20, start: true, hotkey: 'Q',
    weapons: [
      { cls: 'gun', dmg: 14, range: 7, cd: 0.8, hits: ['ground', 'naval'] },
      { cls: 'cannon', dmg: 40, range: 7, cd: 3, hits: ['ground', 'naval'], speed: 18 },
    ],
    desc: 'Trains Builders, charges Command Points. Armed and tough, but if it falls, you are out.',
  },
  mine: {
    id: 'mine', name: 'Mine', w: 2, h: 2, hp: 600, cost: { cash: 250, oil: 0 }, buildTime: 20, sight: 4,
    on: 'ore', income: { cash: 3.5 }, hotkey: 'M', desc: 'Built on ore. +$210/min (rich ore: double).',
  },
  derrick: {
    id: 'derrick', name: 'Oil Derrick', w: 2, h: 2, hp: 600, cost: { cash: 300, oil: 0 }, buildTime: 25, sight: 4,
    on: 'oil', income: { oil: 1 }, hotkey: 'O', desc: 'Built on an oil well. +60 oil/min.',
  },
  barracks: {
    id: 'barracks', name: 'Barracks', w: 3, h: 3, hp: 1000, cost: { cash: 300, oil: 0 }, buildTime: 30, sight: 6,
    hotkey: 'B', desc: 'Trains infantry.',
  },
  factory: {
    id: 'factory', name: 'Factory', w: 4, h: 3, hp: 1500, cost: { cash: 600, oil: 0 }, buildTime: 45, sight: 6,
    hotkey: 'F', desc: 'Builds vehicles.',
  },
  lab: {
    id: 'lab', name: 'Research Lab', w: 2, h: 2, hp: 600, cost: { cash: 400, oil: 0 }, buildTime: 30, sight: 5,
    income: { science: 1.5 }, hotkey: 'L', desc: '+90 science/min.',
  },
  turret: {
    id: 'turret', name: 'Gun Turret', w: 1, h: 1, hp: 500, cost: { cash: 200, oil: 0 }, buildTime: 20, sight: 8,
    tech: 'fortification', hotkey: 'T',
    weapons: [{ cls: 'gun', dmg: 14, range: 7, cd: 0.8, hits: ['ground', 'naval'] }],
    desc: 'Defends against ground units.',
  },
  airfield: {
    id: 'airfield', name: 'Airfield', w: 4, h: 5, hp: 1800, cost: { cash: 800, oil: 100 }, buildTime: 50, sight: 7,
    tech: 'flight', hotkey: 'E', desc: 'Builds aircraft.',
  },
  dock: {
    id: 'dock', name: 'Dock', w: 3, h: 3, hp: 1500, cost: { cash: 600, oil: 0 }, buildTime: 40, sight: 7,
    tech: 'shipbuilding', coastal: true, hotkey: 'N', desc: 'Builds ships. Must touch water.',
  },
  aagun: {
    id: 'aagun', name: 'AA Gun', w: 1, h: 1, hp: 450, cost: { cash: 250, oil: 0 }, buildTime: 20, sight: 10,
    tech: 'antiAir', hotkey: 'G',
    weapons: [{ cls: 'flak', dmg: 20, range: 9, cd: 0.8, hits: ['air'] }],
    desc: 'Defends against aircraft.',
  },
  coastal: {
    id: 'coastal', name: 'Coastal Battery', w: 2, h: 2, hp: 900, cost: { cash: 500, oil: 0 }, buildTime: 30, sight: 10,
    tech: 'navalDoctrine', hotkey: 'C', detects: true,
    weapons: [{ cls: 'shell', dmg: 70, range: 13, cd: 4, hits: ['naval'], splash: 1, speed: 12 }],
    desc: 'Long-range defense against ships.',
  },
  radar: {
    id: 'radar', name: 'Radar', w: 2, h: 2, hp: 700, cost: { cash: 500, oil: 0 }, buildTime: 30, sight: 20,
    tech: 'radar', hotkey: 'R', detects: true, desc: 'Sees far, ignores night. Detects submarines.',
  },
  launch: {
    id: 'launch', name: 'Launch Site', w: 5, h: 5, hp: 4000, cost: { cash: 3000, oil: 500 }, buildTime: 90, sight: 6,
    tech: 'spaceProgram', hotkey: 'X', desc: 'Survive the countdown to win a science victory.',
  },
};

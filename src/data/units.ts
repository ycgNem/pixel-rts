// Every unit's stats. Balance changes happen here (CLAUDE.md rule 5).
// Distances are in tiles, times in seconds, speeds in tiles per second.
import type { ArmorClass, Layer, WeaponClass } from './damage';

export interface WeaponDef {
  cls: WeaponClass;
  dmg: number;
  range: number;
  /** seconds between shots */
  cd: number;
  /** layers this weapon can hit */
  hits: Layer[];
  /** splash radius (tiles); damage falls off to 25% at the edge */
  splash?: number;
  /** can't fire at targets closer than this */
  minRange?: number;
  /** projectile speed in tiles/s; omitted = hits instantly */
  speed?: number;
}

export interface Cost { cash: number; oil: number }

export type UnitClass = 'infantry' | 'vehicle' | 'aircraft' | 'ship';
export type AbilityId = 'digIn' | 'flare' | 'smoke' | 'barrage' | 'afterburner' | 'sonar';

export interface UnitDef {
  id: string;
  name: string;
  cls: UnitClass;
  armor: ArmorClass;
  layer: Layer;
  hp: number;
  speed: number;
  sight: number;
  /** collision radius (tiles) */
  radius: number;
  cost: Cost;
  supply: number;
  buildTime: number;
  /** building ids (or 'city') that train it */
  at: string[];
  /** tech that unlocks it; omitted = available from the start */
  tech?: string;
  weapons: WeaponDef[];
  /** can capture cities */
  captures?: boolean;
  /** can construct and repair buildings */
  builds?: boolean;
  /** supply of land units it can carry */
  carries?: number;
  /** hidden from enemies until it fires or a detector is near */
  stealth?: boolean;
  /** reveals stealth units within its sight */
  detects?: boolean;
  ability?: AbilityId;
  hotkey: string;
  desc: string;
}

const G: Layer[] = ['ground', 'naval'];
const AIR: Layer[] = ['air'];
const ALL: Layer[] = ['ground', 'naval', 'air'];

export const UNITS: Record<string, UnitDef> = {
  builder: {
    id: 'builder', name: 'Builder', cls: 'infantry', armor: 'infantry', layer: 'ground',
    hp: 60, speed: 1.7, sight: 6, radius: 0.22, cost: { cash: 100, oil: 0 }, supply: 1, buildTime: 10,
    at: ['hq'], weapons: [], builds: true, hotkey: 'B',
    desc: 'Builds and repairs. Unarmed.',
  },
  rifleman: {
    id: 'rifleman', name: 'Rifleman', cls: 'infantry', armor: 'infantry', layer: 'ground',
    hp: 80, speed: 1.5, sight: 7, radius: 0.22, cost: { cash: 60, oil: 0 }, supply: 1, buildTime: 8,
    at: ['barracks', 'city'], captures: true, ability: 'digIn', hotkey: 'R',
    weapons: [{ cls: 'gun', dmg: 8, range: 4.5, cd: 1.0, hits: G }],
    desc: 'Cheap all-rounder. Captures cities. Can dig in.',
  },
  rocket: {
    id: 'rocket', name: 'Rocket Trooper', cls: 'infantry', armor: 'infantry', layer: 'ground',
    hp: 70, speed: 1.35, sight: 7, radius: 0.22, cost: { cash: 130, oil: 0 }, supply: 1, buildTime: 10,
    at: ['barracks'], tech: 'rocketry', captures: true, hotkey: 'T',
    weapons: [{ cls: 'rocket', dmg: 24, range: 5, cd: 2.2, hits: G, speed: 12 }],
    desc: 'Anti-vehicle infantry. Slow to fire.',
  },
  flaktrooper: {
    id: 'flaktrooper', name: 'Flak Trooper', cls: 'infantry', armor: 'infantry', layer: 'ground',
    hp: 70, speed: 1.35, sight: 8, radius: 0.22, cost: { cash: 100, oil: 0 }, supply: 1, buildTime: 10,
    at: ['barracks'], tech: 'antiAir', captures: true, hotkey: 'F',
    weapons: [{ cls: 'flak', dmg: 14, range: 6, cd: 1.2, hits: ALL }],
    desc: 'Anti-air infantry.',
  },
  scout: {
    id: 'scout', name: 'Scout Car', cls: 'vehicle', armor: 'light', layer: 'ground',
    hp: 140, speed: 3.4, sight: 10, radius: 0.32, cost: { cash: 150, oil: 10 }, supply: 1, buildTime: 10,
    at: ['factory'], ability: 'flare', hotkey: 'C',
    weapons: [{ cls: 'gun', dmg: 9, range: 5, cd: 0.6, hits: G }],
    desc: 'Fast, sees far. Fires a recon flare.',
  },
  lighttank: {
    id: 'lighttank', name: 'Light Tank', cls: 'vehicle', armor: 'heavy', layer: 'ground',
    hp: 380, speed: 2.2, sight: 8, radius: 0.4, cost: { cash: 300, oil: 55 }, supply: 2, buildTime: 18,
    at: ['factory'], ability: 'smoke', hotkey: 'L',
    weapons: [
      { cls: 'cannon', dmg: 34, range: 5.5, cd: 1.8, hits: G, speed: 18, splash: 0.5 },
      { cls: 'gun', dmg: 4, range: 4.5, cd: 0.6, hits: G },
    ],
    desc: 'Main battle unit early on. Can pop smoke.',
  },
  heavytank: {
    id: 'heavytank', name: 'Heavy Tank', cls: 'vehicle', armor: 'heavy', layer: 'ground',
    hp: 820, speed: 1.6, sight: 8, radius: 0.48, cost: { cash: 500, oil: 100 }, supply: 3, buildTime: 22,
    at: ['factory'], tech: 'heavyArmor', hotkey: 'H',
    weapons: [
      { cls: 'cannon', dmg: 60, range: 6, cd: 2.4, hits: G, speed: 18, splash: 0.8 },
      { cls: 'gun', dmg: 6, range: 4.5, cd: 0.6, hits: G },
    ],
    desc: 'Breaks defensive lines.',
  },
  artillery: {
    id: 'artillery', name: 'Artillery', cls: 'vehicle', armor: 'light', layer: 'ground',
    hp: 200, speed: 1.6, sight: 7, radius: 0.44, cost: { cash: 400, oil: 70 }, supply: 3, buildTime: 20,
    at: ['factory'], tech: 'artillery', ability: 'barrage', hotkey: 'R',
    weapons: [{ cls: 'shell', dmg: 55, range: 12, minRange: 3, cd: 4, hits: G, splash: 1.2, speed: 8 }],
    desc: 'Long range, splash damage, minimum range. Fragile.',
  },
  flaktruck: {
    id: 'flaktruck', name: 'Flak Truck', cls: 'vehicle', armor: 'light', layer: 'ground',
    hp: 220, speed: 2.6, sight: 9, radius: 0.38, cost: { cash: 250, oil: 30 }, supply: 2, buildTime: 14,
    at: ['factory'], tech: 'antiAir', hotkey: 'K',
    weapons: [{ cls: 'flak', dmg: 16, range: 7, cd: 0.9, hits: ALL }],
    desc: 'Mobile anti-air.',
  },
  fighter: {
    id: 'fighter', name: 'Fighter', cls: 'aircraft', armor: 'air', layer: 'air',
    hp: 220, speed: 5.5, sight: 10, radius: 0.45, cost: { cash: 300, oil: 80 }, supply: 2, buildTime: 16,
    at: ['airfield'], tech: 'flight', ability: 'afterburner', hotkey: 'F',
    weapons: [{ cls: 'missile', dmg: 30, range: 6, cd: 1.5, hits: AIR, speed: 22 }],
    desc: 'Hunts aircraft.',
  },
  bomber: {
    id: 'bomber', name: 'Bomber', cls: 'aircraft', armor: 'air', layer: 'air',
    hp: 420, speed: 3.6, sight: 9, radius: 0.6, cost: { cash: 600, oil: 120 }, supply: 4, buildTime: 26,
    at: ['airfield'], tech: 'bombers', hotkey: 'B',
    weapons: [{ cls: 'bomb', dmg: 120, range: 1.5, cd: 5, hits: G, splash: 1.6, speed: 6 }],
    desc: 'Heavy damage to ground targets and buildings. Cannot hit aircraft.',
  },
  helicopter: {
    id: 'helicopter', name: 'Attack Helicopter', cls: 'aircraft', armor: 'air', layer: 'air',
    hp: 300, speed: 4, sight: 9, radius: 0.5, cost: { cash: 450, oil: 100 }, supply: 3, buildTime: 20,
    at: ['airfield'], tech: 'rotorcraft', hotkey: 'H',
    weapons: [{ cls: 'rocket', dmg: 28, range: 6, cd: 2, hits: G, speed: 14 }],
    desc: 'Anti-armor gunship. Can hover.',
  },
  patrolboat: {
    id: 'patrolboat', name: 'Patrol Boat', cls: 'ship', armor: 'ship', layer: 'naval',
    hp: 260, speed: 3.8, sight: 9, radius: 0.5, cost: { cash: 200, oil: 20 }, supply: 2, buildTime: 14,
    at: ['dock', 'city'], tech: 'shipbuilding', hotkey: 'P',
    weapons: [{ cls: 'gun', dmg: 10, range: 5, cd: 0.6, hits: G }],
    desc: 'Fast and light.',
  },
  transport: {
    id: 'transport', name: 'Transport Ship', cls: 'ship', armor: 'ship', layer: 'naval',
    hp: 600, speed: 3, sight: 7, radius: 0.6, cost: { cash: 250, oil: 30 }, supply: 2, buildTime: 16,
    at: ['dock'], tech: 'shipbuilding', carries: 8, hotkey: 'T',
    weapons: [],
    desc: 'Carries 8 supply of land units across water.',
  },
  // merchant convoys (see CONVOY): sent by coastal cities, never trained
  merchant: {
    id: 'merchant', name: 'Merchant Ship', cls: 'ship', armor: 'ship', layer: 'naval',
    hp: 300, speed: 2.4, sight: 6, radius: 0.6, cost: { cash: 0, oil: 0 }, supply: 0, buildTime: 0,
    at: [], hotkey: '',
    weapons: [],
    desc: "Unarmed. Carries trade from your coastal cities to your Dock. Sink a rival's for half its cargo.",
  },
  destroyer: {
    id: 'destroyer', name: 'Destroyer', cls: 'ship', armor: 'ship', layer: 'naval',
    hp: 700, speed: 3, sight: 10, radius: 0.7, cost: { cash: 550, oil: 110 }, supply: 4, buildTime: 26,
    at: ['dock'], tech: 'navalDoctrine', detects: true, ability: 'sonar', hotkey: 'R',
    weapons: [
      { cls: 'cannon', dmg: 40, range: 7, cd: 2, hits: G, speed: 18 },
      { cls: 'flak', dmg: 12, range: 6, cd: 1, hits: AIR },
      { cls: 'depth', dmg: 45, range: 7, cd: 2, hits: ['naval'] },
    ],
    desc: 'All-rounder with anti-air. Detects and depth-charges submarines.',
  },
  submarine: {
    id: 'submarine', name: 'Submarine', cls: 'ship', armor: 'sub', layer: 'naval',
    hp: 450, speed: 2.6, sight: 8, radius: 0.6, cost: { cash: 450, oil: 60 }, supply: 3, buildTime: 22,
    at: ['dock'], tech: 'submarines', stealth: true, hotkey: 'U',
    weapons: [{ cls: 'torpedo', dmg: 90, range: 6, cd: 4, hits: ['naval'], speed: 7 }],
    desc: 'Hidden until it fires or a destroyer comes near. Kills battleships; destroyers hunt it.',
  },
  battleship: {
    id: 'battleship', name: 'Battleship', cls: 'ship', armor: 'ship', layer: 'naval',
    hp: 2400, speed: 2, sight: 10, radius: 0.9, cost: { cash: 1000, oil: 200 }, supply: 6, buildTime: 40,
    at: ['dock'], tech: 'dreadnoughts', hotkey: 'B',
    weapons: [{ cls: 'shell', dmg: 90, range: 14, minRange: 3, cd: 5, hits: G, splash: 1.5, speed: 10 }],
    desc: 'Long-range shore bombardment. Outguns destroyers; fears submarines.',
  },
};

/** Ability tuning (seconds, tiles). */
export const ABILITIES: Record<AbilityId, { name: string; cooldown: number; duration: number; radius?: number; desc: string }> = {
  digIn: { name: 'Dig In', cooldown: 4, duration: 0, desc: 'Toggle: takes 40% less damage, cannot move.' },
  flare: { name: 'Recon Flare', cooldown: 30, duration: 12, radius: 7, desc: 'Reveal an area for 12 s.' },
  smoke: { name: 'Smoke Screen', cooldown: 40, duration: 8, radius: 3, desc: 'Units inside smoke take 50% less damage from range.' },
  barrage: { name: 'Barrage', cooldown: 45, duration: 3, desc: 'Fire 4 shells in quick succession.' },
  afterburner: { name: 'Afterburner', cooldown: 25, duration: 5, desc: '+80% speed for 5 s.' },
  sonar: { name: 'Sonar Ping', cooldown: 30, duration: 8, radius: 14, desc: 'Reveal submarines in a wide area.' },
};

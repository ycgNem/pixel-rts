// The tech tree (GAME_DESIGN §8) and Doctrines (our twist: each new era also offers a choice of
// three doctrines, and you keep only one — so two players with the same techs still play
// differently).

/** Stats a tech or doctrine can change. `mul` multiplies, `add` adds. */
export type ModKey =
  | 'mineIncome' | 'derrickIncome' | 'cityCash' | 'cityScience' | 'cityGrowth' | 'allCash' | 'allScience'
  | 'supply' | 'citySupply' | 'production' | 'structureHp' | 'vehicleHp' | 'vehicleSpeed' | 'infantryHp'
  | 'infantrySpeed' | 'aircraftSpeed' | 'aircraftHp' | 'aircraftCost' | 'fighterDamage' | 'artilleryRange'
  | 'navalRange' | 'shipHp' | 'unitCost' | 'cpRate' | 'captureSpeed' | 'sight'
  | 'buildSpeed' | 'infantryDamage' | 'vehicleDamage' | 'tradeRate';

export interface Mod { key: ModKey; mul?: number; add?: number }

export interface TechDef {
  id: string;
  name: string;
  era: number;
  branch: 'economy' | 'land' | 'air' | 'naval' | 'science';
  /** techs that must be researched first (besides reaching the era) */
  needs?: string[];
  mods?: Mod[];
  /** periodic map reveal (Satellites) */
  reveal?: { every: number; duration: number };
  desc: string;
}

export const ERAS = [
  { name: 'Industrial', cost: 200 },
  { name: 'Mechanized', cost: 600 },
  { name: 'Modern', cost: 1400 },
  { name: 'Future', cost: 2800 },
];
/** Techs of the current era needed to unlock the next one. */
export const TECHS_PER_ERA = 4;
/** Science cost of a tech that overrides its era's cost. */
export const TECH_COST: Record<string, number> = { spaceProgram: 6000 };
/** each tech you already have from an era makes the next one from that era this much dearer */
export const TECH_ESCALATE = 0.2;
/** stacked penalties never take a stat below this share of its base value */
export const MOD_FLOOR = 0.1;
/** When an ally already has a tech, it costs you this much less (our co-op twist: shared knowledge). */
export const ALLY_TECH_DISCOUNT = 0.25;

export const TECHS: TechDef[] = [
  // ---- Era I — Industrial
  { id: 'deepMining', name: 'Deep Mining', era: 0, branch: 'economy', mods: [{ key: 'mineIncome', mul: 1.25 }], desc: 'Mines +25%.' },
  { id: 'oilRefining', name: 'Oil Refining', era: 0, branch: 'economy', mods: [{ key: 'derrickIncome', mul: 1.25 }], desc: 'Oil derricks +25%.' },
  { id: 'urbanPlanning', name: 'Urban Planning', era: 0, branch: 'economy', mods: [{ key: 'cityGrowth', mul: 1.25 }], desc: 'Cities grow 25% faster.' },
  { id: 'schooling', name: 'Schooling', era: 0, branch: 'science', mods: [{ key: 'cityScience', mul: 1.5 }], desc: 'Cities make 50% more science.' },
  { id: 'rocketry', name: 'Rocketry', era: 0, branch: 'land', desc: 'Unlocks Rocket Troopers.' },
  { id: 'fortification', name: 'Fortification', era: 0, branch: 'land', mods: [{ key: 'structureHp', mul: 1.25 }], desc: 'Unlocks Gun Turrets. Buildings +25% HP.' },
  { id: 'flight', name: 'Flight', era: 0, branch: 'air', desc: 'Unlocks the Airfield and Fighters.' },
  { id: 'shipbuilding', name: 'Shipbuilding', era: 0, branch: 'naval', desc: 'Unlocks the Dock, Patrol Boats and Transports.' },
  // ---- Era II — Mechanized
  { id: 'heavyArmor', name: 'Heavy Armor', era: 1, branch: 'land', desc: 'Unlocks Heavy Tanks.' },
  { id: 'artillery', name: 'Artillery', era: 1, branch: 'land', desc: 'Unlocks Artillery.' },
  { id: 'antiAir', name: 'Anti-Air', era: 1, branch: 'land', desc: 'Unlocks Flak Troopers, Flak Trucks and AA Guns.' },
  { id: 'bombers', name: 'Bombers', era: 1, branch: 'air', needs: ['flight'], desc: 'Unlocks Bombers.' },
  { id: 'navalDoctrine', name: 'Naval Doctrine', era: 1, branch: 'naval', needs: ['shipbuilding'], desc: 'Unlocks Destroyers and Coastal Batteries.' },
  { id: 'banking', name: 'Banking', era: 1, branch: 'economy', mods: [{ key: 'cityCash', mul: 1.25 }], desc: 'Cities make 25% more cash.' },
  { id: 'logistics', name: 'Logistics', era: 1, branch: 'economy', mods: [{ key: 'supply', add: 20 }, { key: 'production', mul: 1.1 }], desc: '+20 supply, production 10% faster.' },
  { id: 'radar', name: 'Radar', era: 1, branch: 'science', desc: 'Unlocks the Radar.' },
  // ---- Era III — Modern
  { id: 'rotorcraft', name: 'Rotorcraft', era: 2, branch: 'air', needs: ['flight'], desc: 'Unlocks Attack Helicopters.' },
  { id: 'jetEngines', name: 'Jet Engines', era: 2, branch: 'air', needs: ['flight'], mods: [{ key: 'aircraftSpeed', mul: 1.3 }], desc: 'Aircraft 30% faster.' },
  { id: 'submarines', name: 'Submarines', era: 2, branch: 'naval', needs: ['navalDoctrine'], desc: 'Unlocks Submarines.' },
  { id: 'dreadnoughts', name: 'Dreadnoughts', era: 2, branch: 'naval', needs: ['navalDoctrine'], desc: 'Unlocks Battleships.' },
  { id: 'compositeArmor', name: 'Composite Armor', era: 2, branch: 'land', mods: [{ key: 'vehicleHp', mul: 1.2 }], desc: 'Vehicles +20% HP.' },
  { id: 'massTransit', name: 'Mass Transit', era: 2, branch: 'economy', mods: [{ key: 'cityGrowth', mul: 1.25 }, { key: 'citySupply', add: 4 }], desc: 'Cities grow 25% faster and give +4 supply each.' },
  { id: 'computing', name: 'Computing', era: 2, branch: 'science', mods: [{ key: 'allScience', mul: 1.25 }], desc: 'All science +25%.' },
  { id: 'robotics', name: 'Industrial Robotics', era: 2, branch: 'economy', mods: [{ key: 'production', mul: 1.2 }], desc: 'Production 20% faster.' },
  // ---- Era IV — Future
  { id: 'globalMarkets', name: 'Global Markets', era: 3, branch: 'economy', mods: [{ key: 'allCash', mul: 1.2 }, { key: 'tradeRate', mul: 1.2 }], desc: 'All cash +20%; exchange trades give 20% more.' },
  { id: 'precision', name: 'Precision Guidance', era: 3, branch: 'land', mods: [{ key: 'artilleryRange', mul: 1.25 }, { key: 'navalRange', mul: 1.25 }], desc: 'Artillery and battleship range +25%.' },
  { id: 'avionics', name: 'Advanced Avionics', era: 3, branch: 'air', needs: ['flight'], mods: [{ key: 'aircraftHp', mul: 1.25 }], desc: 'Aircraft +25% HP.' },
  { id: 'satellites', name: 'Satellites', era: 3, branch: 'science', reveal: { every: 90, duration: 10 }, desc: 'Reveals the whole map for 10 s every 90 s.' },
  { id: 'spaceProgram', name: 'Space Program', era: 3, branch: 'science', needs: ['computing'], desc: 'Unlocks the Launch Site: science victory.' },
];

/** Doctrine verbs: things a doctrine changes about how units behave, beyond stat changes. */
export type Perk = 'autoDig' | 'allWeather' | 'stormFlight' | 'freeFourth' | 'stealResearch' | 'warSpoils' | 'cityRockets' | 'cheapPowers';
export interface DoctrineDef { id: string; name: string; era: number; mods: Mod[]; perk?: Perk; desc: string }

/** Entrenchment: idle infantry dig in on their own, checked this often (seconds). */
export const AUTO_DIG_EVERY = 5;
/**
 * Doctrine perk numbers: Mass Production makes every `freeEvery`-th unit free; Scientific Method
 * steals `stealResearch` of a rival's current research when you take one of their cities; Total
 * War heals a unit `warSpoils` of its HP when it kills; Networked Warfare cuts power costs by
 * `powerDiscount` (never below 1).
 */
export const PERKS = { freeEvery: 4, stealResearch: 0.25, warSpoils: 0.15, powerDiscount: 1 };

/** Offered when you enter era 1, 2 and 3 (Mechanized, Modern, Future). Pick one per era. */
export const DOCTRINES: DoctrineDef[] = [
  { id: 'blitz', name: 'Blitzkrieg', era: 1, mods: [{ key: 'vehicleSpeed', mul: 1.15 }, { key: 'vehicleDamage', mul: 1.1 }, { key: 'structureHp', mul: 0.9 }], perk: 'allWeather', desc: 'Vehicles 15% faster, hit 10% harder and ignore rain. Buildings -10% HP.' },
  { id: 'entrench', name: 'Entrenchment', era: 1, mods: [{ key: 'structureHp', mul: 1.3 }, { key: 'infantryHp', mul: 1.15 }, { key: 'vehicleSpeed', mul: 0.95 }], perk: 'autoDig', desc: 'Idle infantry dig in by themselves. Buildings +30% HP, infantry +15% HP. Vehicles 5% slower.' },
  { id: 'mercantile', name: 'Mercantilism', era: 1, mods: [{ key: 'cityCash', mul: 1.3 }, { key: 'cpRate', mul: 1.25 }, { key: 'tradeRate', mul: 1.3 }, { key: 'unitCost', mul: 1.05 }], desc: 'Cities +30% cash, Command Points +25%, exchange trades give 30% more. Units cost 5% more.' },
  { id: 'airPower', name: 'Air Power', era: 2, mods: [{ key: 'aircraftCost', mul: 0.8 }, { key: 'aircraftSpeed', mul: 1.1 }], perk: 'stormFlight', desc: 'Aircraft 20% cheaper, 10% faster, and fly and fight in storms.' },
  { id: 'massProduction', name: 'Mass Production', era: 2, mods: [{ key: 'production', mul: 1.25 }, { key: 'vehicleHp', mul: 0.92 }], perk: 'freeFourth', desc: 'Production 25% faster; every 4th unit you train is free. Vehicles -8% HP.' },
  { id: 'scientific', name: 'Scientific Method', era: 2, mods: [{ key: 'allScience', mul: 1.25 }], perk: 'stealResearch', desc: 'All science +25%. Taking a rival\'s city steals a quarter of their current research.' },
  { id: 'totalWar', name: 'Total War', era: 3, mods: [{ key: 'infantryDamage', mul: 1.15 }, { key: 'vehicleDamage', mul: 1.15 }, { key: 'allScience', mul: 0.85 }], perk: 'warSpoils', desc: 'Infantry and vehicles deal 15% more damage; every unit heals 15% when it makes a kill. Science -15%.' },
  { id: 'urbanism', name: 'Urbanism', era: 3, mods: [{ key: 'citySupply', add: 4 }, { key: 'cityGrowth', mul: 1.5 }, { key: 'captureSpeed', mul: 1.5 }], perk: 'cityRockets', desc: 'Cities +4 supply, grow 50% faster, capture 50% faster; big cities train Rocket Troopers too.' },
  { id: 'networked', name: 'Networked Warfare', era: 3, mods: [{ key: 'sight', mul: 1.2 }, { key: 'artilleryRange', mul: 1.15 }, { key: 'cpRate', mul: 1.25 }], perk: 'cheapPowers', desc: 'Sight +20%, artillery range +15%, Command Points +25%; every power costs 1 CP less.' },
];

// Cities: levels, capture, growth, and specializations (our twist on capturing cities: at level 2
// the owner picks what the city becomes, and that choice shapes the map around it).

export interface CityLevel { name: string; cash: number; science: number; supply: number; grow: number; cp: number }

/** grow = seconds to reach the next level (0 at max). cp = command points per minute. */
export const CITY_LEVELS: CityLevel[] = [
  { name: 'Village', cash: 1.5, science: 0.2, supply: 4, grow: 150, cp: 0.25 },
  { name: 'Town', cash: 2.5, science: 0.35, supply: 8, grow: 270, cp: 0.5 },
  { name: 'City', cash: 3.5, science: 0.6, supply: 12, grow: 420, cp: 0.75 },
  { name: 'Metropolis', cash: 5, science: 0.9, supply: 16, grow: 600, cp: 1 },
  { name: 'Megacity', cash: 7, science: 1.3, supply: 20, grow: 0, cp: 1.25 },
];

/**
 * The assault ring: a group ordered onto a city (within `snap` tiles of its middle) takes spots
 * around it, none closer than `hole` tiles (plus `holePerLevel` for each city level above 1, as
 * bigger cities are drawn bigger), so the city and the fight for it stay readable and splash
 * damage doesn't land on one pile. Inside the capture radius, so they still capture.
 */
export const ASSAULT = { snap: 2, hole: 2, holePerLevel: 0.4 };

export const CAPTURE = {
  /** tiles from the city center, plus `radiusPerLevel` for each level above 1 */
  radius: 4,
  radiusPerLevel: 0.25,
  /** at most this many infantry speed up a capture; each one after the first adds `extraUnit` */
  maxUnits: 5,
  extraUnit: 0.4,
  /** seconds for one infantry to capture a level-1 city; +perLevel for each level above */
  baseSeconds: 30,
  perLevel: 12,
  /** progress lost per second while nobody is capturing (fraction of the bar) */
  decay: 0.04,
  /** levels lost when a city changes hands */
  levelLoss: 1,
  /** seconds after a capture before the city pays out (unrest) */
  unrest: 30,
  /** a city whose level is at least this can train Riflemen */
  trainLevel: 3,
};

export type SpecId = 'industry' | 'academy' | 'fortress' | 'market' | 'port';

export interface SpecDef {
  id: SpecId;
  name: string;
  desc: string;
  /** multipliers on this city's own output */
  cashMul?: number;
  scienceMul?: number;
  /** production speed bonus for the owner's buildings within `aura` tiles */
  productionAura?: number;
  aura?: number;
  /** capture takes this many times longer */
  captureMul?: number;
  /** the city fires like a turret */
  guns?: boolean;
  /** must be next to water */
  coastal?: boolean;
  /** extra command points per minute */
  cp?: number;
}

/** Picked once, when the city first reaches level 2 under an owner. Lost when it is captured. */
export const SPECS: Record<SpecId, SpecDef> = {
  industry: { id: 'industry', name: 'Industrial District', desc: '+25% production speed for your buildings within 10 tiles.', productionAura: 0.25, aura: 10 },
  academy: { id: 'academy', name: 'University Town', desc: 'Double science from this city.', scienceMul: 2 },
  fortress: { id: 'fortress', name: 'Fortress City', desc: 'Walls and guns: fires on enemies, capture takes twice as long.', captureMul: 2, guns: true },
  market: { id: 'market', name: 'Market Town', desc: '+60% cash from this city and +1 Command Point per minute.', cashMul: 1.6, cp: 1 },
  port: { id: 'port', name: 'Harbor', desc: 'Coastal only. Trains Patrol Boats, +30% cash.', cashMul: 1.3, coastal: true },
};

/**
 * City militia (our twist): a city that isn't in unrest shoots hostile ground units within
 * `range`, harder as it grows (dmg + dmgPerLevel x level). Neutral cities shoot only at whoever
 * is capturing them, so taking a big city needs a real squad.
 */
export const MILITIA = { cls: 'gun' as const, dmg: 4, dmgPerLevel: 3, range: 5, cd: 1.5, hits: ['ground' as const] };

/**
 * Neutral cities keep growing (our twist): a city nobody owns gains a level every `every` seconds,
 * up to `maxLevel`, unless it is a home village (within `homeRadius` tiles of a start). Waiting buys
 * a richer prize, at the price of a stronger militia.
 */
export const NEUTRAL_GROWTH = { every: 240, maxLevel: 4, homeRadius: 22 };

/** The fortress city's guns (replace the militia). */
export const FORTRESS_GUN = { cls: 'gun' as const, dmg: 20, range: 7, cd: 1, hits: ['ground' as const, 'naval' as const] };

/** Neutral city names; the map generator picks from these. */
export const CITY_NAMES = [
  'Ashford', 'Brightwater', 'Coldharbor', 'Dunmore', 'Eastgate', 'Falkreath', 'Greystone', 'Highmoor',
  'Ironbridge', 'Juniper', 'Kingsreach', 'Larkspur', 'Millbrook', 'Northwatch', 'Oakhollow', 'Pinecrest',
  'Queensfall', 'Redcliff', 'Saltmarsh', 'Thornbury', 'Umberlee', 'Valewood', 'Westmarch', 'Yarrow',
  'Zephyr Bay', 'Amberfield', 'Blackrock', 'Copperton', 'Driftwood', 'Emberly', 'Foxglove', 'Gullhaven',
  'Hearthstone', 'Ivywick', 'Jadeport', 'Kettlebury', 'Lowmere', 'Marrowgate', 'Nettlefield', 'Oldcastle',
];

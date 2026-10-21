// Computer player tuning: difficulty levels, personalities, build orders, research and army mixes.
// The AI code in src/sim/ai reads these; balance the AI here (CLAUDE.md rule 5).
import type { AiDifficulty, AiPersonality } from '../sim/types';
import type { SpecId } from './cities';

export interface AiLevel {
  /** ticks between decisions */
  think: number;
  /** Builders to keep (plus one per this many owned cities) */
  builders: number;
  buildersPerCity: number;
  /** seconds before the first attack wave */
  firstAttack: number;
  /** army value (cash + 2 x oil) needed to launch a wave; grows by `waveGrowth` per minute */
  waveValue: number;
  waveGrowth: number;
  /** a wave retreats when it falls below this share of its starting value */
  retreatAt: number;
  /** riflemen sent to capture each neutral city */
  captureSquad: number;
  /** how many capture squads at once */
  captureSquads: number;
  /** uses Command Powers and unit abilities */
  powers: boolean;
  /** production speed bonus (hard AI) */
  production: number;
  /** income multiplier (cash, oil and science): Hard plays a slightly richer game */
  income: number;
  /** cash kept back for the next building */
  reserve: number;
  /** most items queued per production building */
  queue: number;
  /** never uses more supply than this (keeps Easy armies small) */
  maxSupply: number;
  /**
   * Early raids: before `hqFrom` seconds a wave leaves an enemy's base alone (nothing within
   * AI_RESPONSE.baseRadius tiles of an HQ: it hits outlying mines, derricks, buildings and cities,
   * and with nothing else left goes home), and before `earlyUntil` seconds a wave takes at most
   * `earlyWave` army value (the rest stays home). A new player gets hurt by the first attacks
   * instead of knocked out, and keeps a base to rebuild from.
   */
  hqFrom: number;
  earlyUntil: number;
  earlyWave: number;
  /**
   * Siege: from `siegeFrom` seconds, a player in a last stand (they held cities and lost them all)
   * gets no early-raid sparing: their base can be finished. Never sooner, so a learner who loses
   * their first cities still has time to fight back from the HQ.
   */
  siegeFrom: number;
}

export const AI_LEVELS: Record<AiDifficulty, AiLevel> = {
  easy: { think: 60, builders: 3, buildersPerCity: 4, firstAttack: 900, waveValue: 1500, waveGrowth: 120, retreatAt: 0.25, captureSquad: 2, captureSquads: 1, powers: false, production: 0.7, income: 1, reserve: 0, queue: 1, maxSupply: 60, hqFrom: 1500, earlyUntil: 900, earlyWave: 2500, siegeFrom: 1500 },
  normal: { think: 20, builders: 4, buildersPerCity: 3, firstAttack: 420, waveValue: 2200, waveGrowth: 350, retreatAt: 0.3, captureSquad: 3, captureSquads: 2, powers: true, production: 1, income: 1, reserve: 100, queue: 2, maxSupply: 999, hqFrom: 1200, earlyUntil: 900, earlyWave: 4000, siegeFrom: 900 },
  hard: { think: 10, builders: 6, buildersPerCity: 2, firstAttack: 300, waveValue: 2000, waveGrowth: 450, retreatAt: 0.35, captureSquad: 3, captureSquads: 3, powers: true, production: 1.15, income: 1.1, reserve: 150, queue: 2, maxSupply: 999, hqFrom: 480, earlyUntil: 600, earlyWave: 6000, siegeFrom: 480 },
};

export type AiStyle = AiPersonality | 'balanced';

/** what a 'random' AI style is settled to at the start (from the seed: the same on every machine) */
export const AI_RANDOM_STYLES: (AiPersonality | undefined)[] = [undefined, 'militarist', 'expansionist', 'scientist'];

export interface AiPlan {
  /** buildings in order: [kind, how many, earliest second]. Mines and derricks are handled by the economy rules. */
  build: [string, number, number][];
  /** tech research priority (first unblocked one is researched) */
  research: string[];
  /** doctrine preference per era (first match wins) */
  doctrines: string[];
  /** city specialization preference: near home, and on the front line */
  specHome: SpecId[];
  specFront: SpecId[];
  /** relative weights of units to train */
  army: Record<string, number>;
  /** wave size multiplier (lower = attacks sooner) */
  aggression: number;
  /** extra capture squads */
  expand: number;
  /** most mines + derricks to own */
  maxMines: number;
  maxDerricks: number;
}

const ARMY_BALANCED = {
  rifleman: 4, rocket: 2, flaktrooper: 1, scout: 1, lighttank: 3, heavytank: 2, artillery: 2, flaktruck: 1,
  fighter: 1, bomber: 2, helicopter: 2, patrolboat: 1, destroyer: 2, submarine: 2, battleship: 2,
  // only picked with the oil already banked (they cost 1,500)
  megatank: 1, megaplane: 1,
};

export const AI_PLANS: Record<AiStyle, AiPlan> = {
  balanced: {
    build: [['barracks', 1, 20], ['lab', 1, 70], ['factory', 1, 120], ['barracks', 2, 300], ['lab', 2, 360], ['factory', 2, 480], ['airfield', 1, 600], ['radar', 1, 900], ['launch', 1, 1500]],
    research: ['rocketry', 'deepMining', 'urbanPlanning', 'flight', 'radar', 'oilRefining', 'fortification', 'schooling', 'shipbuilding', 'heavyArmor', 'antiAir', 'rotorcraft', 'logistics', 'artillery', 'banking', 'bombers', 'jetEngines', 'compositeArmor', 'robotics', 'massTransit', 'computing', 'navalDoctrine', 'globalMarkets', 'precision', 'avionics', 'satellites', 'spaceProgram'],
    doctrines: ['blitz', 'massProduction', 'totalWar'],
    specHome: ['industry', 'academy', 'market'],
    specFront: ['fortress', 'market'],
    army: ARMY_BALANCED,
    aggression: 1, expand: 0, maxMines: 6, maxDerricks: 3,
  },
  militarist: {
    build: [['barracks', 1, 15], ['barracks', 2, 90], ['factory', 1, 110], ['lab', 1, 150], ['factory', 2, 330], ['airfield', 1, 600], ['barracks', 3, 700]],
    research: ['rocketry', 'fortification', 'deepMining', 'oilRefining', 'heavyArmor', 'artillery', 'flight', 'antiAir', 'rotorcraft', 'logistics', 'urbanPlanning', 'compositeArmor', 'bombers', 'jetEngines', 'robotics', 'schooling', 'shipbuilding', 'navalDoctrine', 'precision', 'avionics', 'globalMarkets'],
    doctrines: ['blitz', 'massProduction', 'totalWar'],
    specHome: ['industry', 'market'],
    specFront: ['fortress', 'industry'],
    army: { ...ARMY_BALANCED, rifleman: 5, lighttank: 4, heavytank: 3, artillery: 2, megatank: 2 },
    aggression: 0.75, expand: 0, maxMines: 6, maxDerricks: 3,
  },
  expansionist: {
    build: [['barracks', 1, 20], ['lab', 1, 100], ['factory', 1, 150], ['barracks', 2, 240], ['factory', 2, 520], ['airfield', 1, 700], ['radar', 1, 800]],
    research: ['urbanPlanning', 'deepMining', 'rocketry', 'schooling', 'oilRefining', 'fortification', 'flight', 'radar', 'shipbuilding', 'banking', 'logistics', 'heavyArmor', 'antiAir', 'rotorcraft', 'massTransit', 'artillery', 'compositeArmor', 'computing', 'globalMarkets', 'robotics', 'bombers', 'jetEngines', 'satellites'],
    doctrines: ['mercantile', 'massProduction', 'urbanism'],
    specHome: ['market', 'industry', 'academy'],
    specFront: ['fortress', 'market'],
    army: { ...ARMY_BALANCED, rifleman: 6, scout: 2 },
    aggression: 1.15, expand: 2, maxMines: 8, maxDerricks: 4,
  },
  scientist: {
    build: [['barracks', 1, 25], ['lab', 1, 50], ['lab', 2, 160], ['factory', 1, 200], ['lab', 3, 420], ['radar', 1, 700], ['airfield', 1, 800], ['launch', 1, 1000]],
    research: ['schooling', 'urbanPlanning', 'deepMining', 'rocketry', 'fortification', 'oilRefining', 'flight', 'shipbuilding', 'radar', 'logistics', 'banking', 'antiAir', 'heavyArmor', 'computing', 'massTransit', 'robotics', 'compositeArmor', 'rotorcraft', 'spaceProgram', 'satellites', 'globalMarkets', 'precision'],
    doctrines: ['entrench', 'scientific', 'networked'],
    specHome: ['academy', 'industry', 'market'],
    specFront: ['fortress', 'academy'],
    army: { ...ARMY_BALANCED, rocket: 3, artillery: 2, flaktrooper: 2 },
    aggression: 1.4, expand: 0, maxMines: 5, maxDerricks: 3,
  },
};

/** Naval plan used when an enemy can't be reached on foot (islands, continents). */
export const AI_NAVAL = {
  /** idle warships attack enemy merchant ships within this many tiles */
  raidRange: 30,
  /** research these first */
  research: ['shipbuilding', 'flight', 'navalDoctrine', 'submarines', 'dreadnoughts'],
  docks: 2,
  /** one more transport per this much supply in use, up to `maxTransports` */
  transportPer: 40,
  maxTransports: 5,
  /** coastal batteries to build once enemy warships have been seen */
  coastal: 2,
  transports: 2,
  /** a loaded ferry waits for this many warships per ferry at sea (counting itself), or `escortWait` seconds */
  escorts: 2,
  escortWait: 90,
  /** wave value multiplier (ferrying is slow, so send more at once) */
  waveMul: 1.2,
  /** a sea landing to take a neutral city needs only this share of a wave */
  expandMul: 0.35,
  /** seconds a wave waits for its ferries before giving up */
  waveWait: 180,
  /** landed troops hold the beach until this share of the wave's value is ashore... */
  beachhead: 0.6,
  /** ...or this many seconds after the first boat landed (times `regroupWait` after falling back) */
  beachWait: 120,
  regroupWait: 2,
  /** a landing whose troops ashore are worth less than this share of the wave falls back to its beach */
  beachRetreat: 0.3,
  /** troops waiting on the beach stay within this many tiles of it */
  beachRadius: 5,
  /** land at least this many tiles beyond the range of known enemy guns */
  landingClear: 3,
  /** a landing with nobody ashore after this many seconds gives up... */
  landWait: 240,
  /** ...and its target (or one no boat can find a beach near) is skipped for this many seconds */
  noLandingFor: 300,
};

/** Command Power thresholds. */
export const AI_POWERS = {
  /** use a supply drop when cash is below this or the drop is worth at least `supplyDropWorth`,
   *  and never before this many seconds */
  supplyDropCash: 400,
  supplyDropWorth: 900,
  supplyDropAfter: 180,
  /** strike a clump of at least this many enemy units */
  strikeClump: 5,
  /** repair when this share of a group's HP is missing */
  repairMissing: 0.35,
  /** fire a Call for Help when a raid on the base is worth this many times our defenders and at
   *  least `helpMinValue`, at most once every `helpGap` seconds */
  helpOutgunned: 1.5,
  helpMinValue: 600,
  helpGap: 120,
};

/**
 * Surrender: after `after` seconds, an AI with no city left, no living ally and an army worth less
 * than `share` of the strongest enemy's for `wait` seconds gives up (no dead time at the end).
 */
export const AI_SURRENDER = { after: 720, share: 0.1, wait: 60 };

/** The AI's ace (a ground unit or aircraft) under `retreatAt` of its HP leaves the fight for home ground, where it heals. */
export const AI_ACE = { retreatAt: 0.4 };

/** Exchange use: buy oil when short (only when rich: it's dear), fund research with a surplus when the army is at its cap, sell spare oil when broke. */
export const AI_TRADE = { lowOil: 150, buyOilCash: 4000, fundCash: 2500, sellOilAbove: 800, lowCash: 300 };

/**
 * With more than `cash` banked, add production buildings (up to `maxProducers` in all). A unit
 * costing `bigTicket` cash or more (a battleship) that a producer picks but can't pay for yet is
 * saved for: that producer goes first and its price is kept back from the others (otherwise the
 * factories spend every dollar first and it never comes), for up to `saveFor` seconds.
 */
export const AI_SPEND = { cash: 3000, maxProducers: 8, bigTicket: 800, saveFor: 120 };

/** After losing a building, don't build on a deposit within `lostRadius` tiles of it for `lostWait` s. */
export const AI_SITES = { lostWait: 150, lostRadius: 6 };

/** Infantry weights are divided by 1 + era x this (armies mechanize over time). */
export const AI_ERA_INFANTRY = 1.2;

/**
 * Anti-air: while enemy aircraft were seen lately, AA weights are multiplied by `boost` until our
 * AA supply reaches `cover` times the most enemy air supply seen (at least `minAir`); past that
 * they are multiplied by `enough`. Fighters get the boost only while enemy bombers were seen
 * lately (against helicopters, flak does the job); otherwise they too are multiplied by `enough`.
 */
export const AI_ANTI_AIR = { boost: 3, cover: 1.5, minAir: 4, enough: 0.1, memory: 180 };

/** Fraction of the map a base "owns" for threat detection (tiles from the HQ or a city). */
export const AI_DEFENSE = {
  baseRadius: 18,
  cityRadius: 8,
  /** send defenders worth this many times the threat (the rest stay where they are) */
  ratio: 1.5,
  /** when nobody attacks us, help an ally whose HQ is within this many tiles, with this share */
  allyRadius: 30,
  allyRatio: 0.75,
  /** share of the idle army sent to an ally's Call for Help flare */
  helpShare: 0.75,
};

/** How the AI answers a win that is counting down, and an army with nowhere to go. */
export const AI_RESPONSE = {
  /** infantry kept beside our own Launch Site so it can't be scrubbed */
  launchGuard: 6,
  /** an enemy team's cities score this many times more attractive while its supremacy clock runs */
  supremacyMul: 4,
  /** ... and waves need this share of their usual value */
  waveMul: 0.5,
  /** before AI_LEVELS.hqFrom a mine or derrick scores `econMul` times more as a target, and
   *  nothing within `baseRadius` tiles of an enemy HQ is one (except under siege: AiLevel.siegeFrom) */
  econMul: 1.5,
  baseRadius: 12,
  /** at this share of the supply limit for this many seconds, attack anyway */
  maxedShare: 0.95,
  maxedWave: 90,
  /**
   * Free-for-all: with 3+ teams alive, an enemy team whose score (the public one in the Stats
   * panel) is more than `leaderOver` times the average is the runaway leader, and its targets
   * score `leaderMul` times more attractive
   */
  leaderOver: 1.5,
  leaderMul: 2.5,
  /**
   * ...and before `preyUntil` seconds, a team scoring under `preyUnder` times the average is left
   * alone: its targets score `preyMul` as attractive (piling onto the weakest knocked friends out
   * of free-for-alls at minute 11–16)
   */
  preyUnder: 0.6,
  preyMul: 0.4,
  preyUntil: 1200,
};

/** Scouting: from this second on, one fast unit looks at start spots nobody has checked yet. */
export const AI_SCOUT = { from: 60, kinds: ['scout', 'rifleman'] };

/**
 * City contracts: the AI goes for a supply tender within `range` tiles of home when it is no more
 * than `short` cash from the lowest bid: it sends one ground unit there, holds the money back from
 * production, bids the least it can, and drops out above `maxBid` times the floor (so a player
 * who wants the city badly can outbid it). A hold job's city counts `holdPull` times nearer when
 * picking cities to capture, and a liberation target `liberatePull` times nearer when picking a
 * city to attack.
 */
export const AI_CONTRACT = { short: 300, range: 90, maxBid: 2, holdPull: 2.5, liberatePull: 2 };

/**
 * A knocked-out AI fighting on as an insurgent: it drops partisans where `take` (if its banked
 * squads and war chest can take the city past its guns, with `margin` to spare) plus `level` per
 * city level plus `neutral` (an unowned city) minus `danger` per enemy unit seen within `look`
 * tiles of the capture ring scores best (a few enemy units outweigh a takeable city: partisans
 * landing on an army die; with no teammate left it sees every unit, as a knocked-out human sees
 * the whole map), and always reinforces the city it is holding to re-found. With nothing
 * takeable it banks squads until the bank is full.
 */
export const AI_INSURGENCY = { take: 10, margin: 1.2, level: 2, neutral: 1, danger: 4, look: 3 };

// Match-wide tunables: start, supply, queues, map generation, weather, supply crates, victory.

export const START = {
  cash: 1000,
  /** enough for a first tank: more takes a Derrick */
  oil: 100,
  units: [['builder', 2], ['rifleman', 4]] as [string, number][],
};

export const SUPPLY = { max: 200 };

/** Sandbox: every tick, human players' cash, oil and science are topped up to these (and CP to full). */
export const SANDBOX = { cash: 999999, oil: 999999, science: 999999 };

/**
 * Building cap: a player may own at most `base` buildings plus `perCity` for each city they hold
 * (the HQ doesn't count; unfinished buildings do), so defenses can't be spammed without growing.
 */
export const BUILD_CAP = { base: 21, perCity: 4 };

export const PRODUCTION = {
  queueMax: 5,
  /** refund when a queued item or an unfinished building is cancelled */
  cancelRefund: 1,
  buildCancelRefund: 0.75,
  /** each Builder after the first adds this much construction speed */
  extraBuilder: 0.75,
  /** repairing costs this fraction of the building's cost for a full heal */
  repairCost: 0.3,
  /** seconds a Builder needs to repair a building from 0 to full, but never more than `repairMaxHps`
   *  HP a second each (so big buildings take longer); at most `repairCrew` Builders count */
  repairTime: 40,
  repairMaxHps: 40,
  repairCrew: 3,
  /** no repairs while an armed enemy is this close (tiles): a building under fire can't be patched */
  repairBlockRadius: 6,
  /** with no rally point, a new ground unit walks `exitWalk` tiles past the door, into one of
   *  `exitSpread` columns (two rows), so units don't pile up at the door */
  exitWalk: 3,
  exitSpread: 5,
  /** sell a finished building for this fraction of its cost */
  sellRefund: 0.5,
  /** sell (disband) a unit for this fraction of its cash and oil cost, times its share of full HP */
  unitSellRefund: 0.5,
  /**
   * Busy crews: every `autoEvery` ticks an idle Builder (no orders, not holding) of a human player
   * walks to the nearest unfinished building within `autoRadius` tiles that has the fewest
   * Builders on it, so every project gets one Builder before any gets a second.
   */
  autoEvery: 10,
  autoRadius: 60,
};

/**
 * Work zones (our twist on roaming crews): a Builder given a zone (the Zone order: click a spot, or
 * drag out its size) builds and repairs only your buildings inside it, walks back when it strays,
 * and with nothing to do walks the zone's edge: `points` stops at `edge` of the radius, resting
 * `pause` seconds at each. A plain click makes a zone of radius `r` tiles; a drag sets the radius, `min` to `max`.
 * Move and Stop orders free the Builder; build orders keep the zone (it comes back afterwards).
 */
export const WORK_ZONE = { r: 11.3, min: 4.2, max: 34, edge: 0.8, points: 6, pause: 3 };

/**
 * How far apart units keep. Infantry keep `infantry` times their touching distance from other
 * infantry, so squads read as squads instead of one blob; `maxStep` caps the push per tick (tiles).
 * A unit gives up a move after 6 s without getting closer along its path; while it is pressed
 * against friendly units on the move (queueing for a bridge), a tick counts only `queuePatience`.
 */
export const SEPARATION = { infantry: 1.3, maxStep: 0.08, queuePatience: 0.2 };

export const COMBAT = {
  /** how far an idle unit chases before returning (tiles) */
  leash: 8,
  /** idle units look for targets this often (seconds) */
  scan: 0.4,
  /** dig-in damage reduction */
  digIn: 0.4,
  /** damage reduction from range while standing in smoke */
  smoke: 0.5,
  /** seconds a destroyed oil derrick burns (damaging units on its tiles) */
  burnTime: 20,
  burnDps: 15,
};

export const MAP_SIZES = { small: 144, medium: 224, large: 288 } as const;
export type MapSize = keyof typeof MAP_SIZES;
export type MapType = 'pangaea' | 'continents' | 'islands' | 'lakes';

export const MAPGEN = {
  /** fraction of land by map type */
  land: { pangaea: 0.62, continents: 0.5, islands: 0.38, lakes: 0.8 } as Record<MapType, number>,
  /** share of land that is mountains / hills / forest */
  mountains: 0.05,
  hills: 0.1,
  forest: 0.16,
  /** neutral cities per player (besides the two near each start) */
  citiesPerPlayer: 3,
  /**
   * Fair starts: each neutral-city slot sits at the same offset from every start (an angle within
   * `maxAngle` of the way to the middle, `minDist` tiles out to `maxShare` of the way there).
   */
  fairCities: { maxAngle: 0.9, minDist: 20, maxShare: 0.85, tries: 60 },
  /** how far (tiles) a start may move toward better land on maps without separate landmasses */
  startNudge: 4,
  /** radius kept flat and clear around each start */
  startClear: 9,
  /** extra ore and oil per player scattered around the map */
  extraOre: 3,
  extraOil: 2,
  /** rich ore deposits in the middle (our twist: contested double-output veins) */
  richOre: 2,
  /**
   * Map types where every start gets its own landmass: water channels (`channel` tiles wide)
   * follow the borders between the starts and a neutral middle island. `home` caps the home
   * island's radius as a share of the map size; `shift` moves it toward the middle (tiles).
   */
  separate: {
    islands: { channel: 6, home: 0.12, shift: 4, middle: 0.7 },
    continents: { channel: 4, home: 0.2, shift: 4, middle: 0.9 },
  } as Partial<Record<MapType, { channel: number; home: number; shift: number; middle: number }>>,
  /** how far from a start its two home cities sit (tiles); `near` on the separated maps */
  homeCity: { far: 17, near: 13 },
  /**
   * A river across the land-war maps, crossed by two bridges. It runs from the map edge to the
   * middle and out again, each half along the gap between two neighbouring starts, so it splits
   * the players into two sides (as evenly as their number allows). `width` tiles of water,
   * wandering up to `meander` tiles; each bridge is `bridgeWidth` tiles wide, `bridgeAt` × the map
   * size from the middle, one on each half (the same distance, so neither side is favoured).
   */
  river: { on: ['pangaea', 'lakes'] as MapType[], width: 3, meander: 9, bridgeWidth: 3, bridgeAt: 0.2 },
};

/**
 * Day and night, and weather (our twist: the battlefield changes during a match).
 * Night cuts sight for everything except radar and cities; rain slows ground units; storms ground
 * aircraft.
 */
export const WEATHER = {
  dayLength: 360,
  nightLength: 120,
  nightSight: 0.65,
  rainSpeed: 0.85,
  /** chance per minute that a front moves in, and how long it lasts */
  rainChance: 0.18,
  rainTime: [60, 120] as [number, number],
  stormChance: 0.06,
  stormTime: [30, 60] as [number, number],
};

/**
 * Supply crates (our twist): every so often a crate parachutes into the open map. Everyone sees
 * it on the minimap; the first unit to touch it takes it.
 */
export const CRATES = {
  firstAt: 150,
  /** cash, oil and science rewards grow by this share per minute of match time */
  scalePerMin: 0.25,
  every: [70, 110] as [number, number],
  max: 3,
  rewards: [
    { kind: 'cash', amount: 400, weight: 4 },
    { kind: 'oil', amount: 120, weight: 3 },
    { kind: 'science', amount: 150, weight: 2 },
    { kind: 'cp', amount: 2, weight: 2 },
    { kind: 'veteran', amount: 1, weight: 1 },
  ] as { kind: 'cash' | 'oil' | 'science' | 'cp' | 'veteran'; amount: number; weight: number }[],
};

export type TradeId = 'buyOil' | 'sellOil' | 'fundResearch';
export interface TradeDef {
  name: string;
  payWith: 'cash' | 'oil';
  pay: number;
  gets: 'cash' | 'oil' | 'science';
  get: number;
  /** a finished building of this kind is needed */
  needs?: string;
  needsName?: string;
  hotkey: string;
  desc: string;
}

/**
 * The exchange (our twist), on the HQ's command card: trade spare cash for oil or science, or
 * spare oil for cash. Each trade makes the next of its kind `heat` (10%) dearer; prices cool
 * back by `cool` (30 points) per minute.
 */
export const EXCHANGE = {
  heat: 0.1,
  cool: 0.3,
  trades: {
    // oil is scarce on purpose: buying it costs five times what it once did, so Derricks are the way
    buyOil: { name: 'Buy Oil', payWith: 'cash', pay: 1250, gets: 'oil', get: 100, hotkey: 'KeyO', desc: 'Trade cash for oil. Dear: pumping your own is far cheaper.' },
    sellOil: { name: 'Sell Oil', payWith: 'oil', pay: 100, gets: 'cash', get: 150, hotkey: 'KeyL', desc: 'Trade spare oil for cash.' },
    fundResearch: { name: 'Fund Research', payWith: 'cash', pay: 400, gets: 'science', get: 100, needs: 'lab', needsName: 'Lab', hotkey: 'KeyJ', desc: 'Pay scientists to work overtime: cash for science.' },
  } as Record<TradeId, TradeDef>,
};

/**
 * Resistance (our twist): a city taken from a player who is still in the game resists for `time`
 * seconds. Every `every` seconds, while the occupier keeps fewer than `garrison` infantry in the
 * capture ring, a partisan (`kind`) rises there for the former owner, at most `max` per
 * occupation. Partisans capture like any infantry, so an unguarded conquest can be lost again.
 * Retaking your own city is a liberation: it doesn't resist you back.
 */
export const RESISTANCE = { time: 120, every: 20, max: 3, garrison: 2, kind: 'rifleman' };

/**
 * Government in exile (our twist): when the HQ falls, your largest city of at least `minLevel`
 * with no enemy unit within `safeRadius` tiles becomes the capital (the government flees the
 * attackers; with no safe city, the largest one, farthest from them). After `delay` seconds it
 * trains builders and pays the HQ's command points. The capital fights like a fortress, takes
 * `captureMul` times as long to capture, and raises a free partisan every `partisanEvery` seconds
 * while fewer than `partisans` are near it. You are out only when you have neither an HQ nor such a city.
 */
export const EXILE = { minLevel: 2, delay: 60, captureMul: 2.5, safeRadius: 10, partisans: 6, partisanEvery: 15, partisanKind: 'rifleman', partisanRadius: 8 };

/**
 * City contracts (our twist, a lobby option): from `first` seconds on, whenever no job is open
 * (and `every` seconds after the last one closed), a city posts a public job, open for `open`
 * seconds. It is one of the `choices` neutral cities most evenly placed between the players still
 * in (their home distances differ by at most `maxSpread` of the average), picked by the match's
 * seeded RNG.
 * - supply (a tender): open from the posting for `tender` seconds. A player with a ground unit
 *   inside the city's capture ring, or whose borders (Home Front claims) reach the city, bids; the
 *   first bid must be at least `floorMinutes` of the city's cash income, each later one `raise`
 *   more than the top bid. A bid with under `late` seconds left pushes the close to `late` seconds
 *   away (no last-second sniping). When it closes the highest bidder pays and the city joins them
 *   peacefully (its militia doesn't fight them).
 * - hold (only at cities up to level `holdMaxLevel`): the first player to hold the city for `hold`
 *   seconds (capture it, then keep it) earns `cash` plus `holdPerLevel` per city level over 1 plus
 *   `cashPerMin` per minute of match time, and `cp` Command Points.
 * - liberate: when no neutral city fits and at least `bountyTeams` teams are still in (with two,
 *   the leader is already everyone's target), a city of a runaway leader (a team whose public
 *   score is over `leaderOver` times the average) posts a bounty, open for `liberate` seconds:
 *   whoever takes it from them earns `liberateCash` plus `cashPerMin` per minute and
 *   `liberateCp`, and the city keeps its size.
 */
export const CONTRACTS = {
  first: 300, every: 150, open: 180, choices: 3, maxSpread: 0.25,
  floorMinutes: 2, tender: 90, late: 15, raise: 0.15,
  holdMaxLevel: 4, hold: 60, cash: 400, holdPerLevel: 100, cashPerMin: 15, cp: 2,
  bountyTeams: 3, leaderOver: 1.3, liberate: 240, liberateCash: 500, liberateCp: 3,
};

/**
 * Insurgency (our twist): a player knocked out of a match that goes on keeps fighting. `first`
 * seconds after the knockout they get a drop charge, and another every `every` seconds, banking up
 * to `maxCharges`. A drop spends them all: `squad` partisans (`kind`) per charge land at a neutral
 * city or at a city they once held, and the war chest (the cash they were knocked out with) pays
 * `chestCost` for one `chestKind` per charge while it lasts. They land hidden (like a submarine:
 * no gun, militia or eye without a detector sees them) for `hidden` seconds, or until they fire, so
 * a cell starts its capture unseen. Their units capture like anyone's;
 * holding a city of level `minLevel` or more for `hold` seconds re-founds their government there
 * (they are back in the match, governing in exile from that city). A player gets `comebacks` of
 * those in a match: knocked out again after that, they are out for good (no endless loops).
 */
export const INSURGENCY = { first: 30, every: 90, maxCharges: 3, squad: 3, kind: 'rifleman', chestKind: 'rocket', chestCost: 250, hidden: 15, hold: 180, minLevel: 2, comebacks: 1 };

/**
 * Coalition (our twist): when a team starts a supremacy clock or a launch, everyone else gets
 * `cp` Command Points at once and deals `damageVs` times damage to that team until it stops.
 */
export const COALITION = { cp: 4, damageVs: 1.15 };

/**
 * Wanted aces (our twist): each player's most experienced unit with every veteran star is their
 * one ace. It is named (from ACE_NAMES) and given a field promotion (healed to full, `hp` more
 * HP while it is the ace), allied units within `radius` tiles of it deal `aura` more damage, and
 * whoever kills it is paid `bountyCash` and `bountyCp`. Everyone hears when one falls.
 */
export const ACES = { radius: 5, aura: 0.15, hp: 0.25, bountyCash: 300, bountyCp: 2 };
export const ACE_NAMES = [
  'Iron Maud', 'Lucky Pip', 'Old Thunder', 'Bramble', 'Sgt. Wren', 'Hammerjack', 'Duchess', 'Blue Moth',
  'Kestrel', 'Dogged Dan', 'Saint Ash', 'Little Comet', 'Grim Hollis', 'Velvet', 'Bulldog Bea', 'Corporal Fen',
  'Stormcrow', 'Captain Tallow', 'Marigold', 'The Ox', 'Nightjar', 'Scrap Annie', 'Twice-Lucky', 'Granite Joe',
];

/**
 * Last Stand (our twist): a player who held cities and has lost them all, but keeps an HQ, has a
 * supply limit of at least `supply`, can train `units` at the HQ, and every `every` seconds the HQ
 * rallies a free `kind` while fewer than `max` of them stand within `radius` tiles.
 */
export const LAST_STAND = { supply: 40, units: ['rifleman', 'rocket'], every: 30, kind: 'rifleman', max: 6, radius: 8 };

/**
 * 'Under attack' alerts: a hit on one of your buildings, or on your unit on your own team's ground
 * by another player, alerts you, at most once per `area` tiles every `every` seconds (a fight you
 * started in the field doesn't nag).
 */
export const ALERTS = { every: 20, area: 20 };

export const VICTORY = {
  /**
   * fraction of all cities a team must hold, by how many teams started (index = team count: with
   * more rivals a smaller share is already dominant), and for how long (seconds); two teams of
   * `teamShareFrom` or more players in all need `teamShare` (more hands take cities faster). The
   * clock can't start before `supremacyFrom` plus the larger of `supremacyFromPerTeam` for every
   * team beyond two (a free-for-all needs time for the others to answer a runaway leader) and
   * `supremacyFromPerPlayer` for every player beyond two (a team game needs time to coordinate)
   */
  supremacyShares: [0.7, 0.7, 0.7, 0.67, 0.64, 0.6, 0.56],
  teamShare: 0.75,
  teamShareFrom: 4,
  supremacyTime: 240,
  supremacyFrom: 900,
  supremacyFromPerTeam: 300,
  supremacyFromPerPlayer: 150,
  /** launch countdown (seconds) */
  launchTime: 240,
  /**
   * The 'Auto' time limit (the lobby default): `autoLimit` seconds in a match of `autoLimitPlayers`
   * or more players or on an `autoLimitMaps` map (big free-for-alls and naval maps can stall),
   * none otherwise. In the last `scoreRace` seconds of any limit the tracker shows the score race.
   */
  autoLimit: 2700,
  autoLimitPlayers: 5,
  autoLimitMaps: ['islands', 'continents'],
  scoreRace: 600,
};

/**
 * Scrub (our twist): enemy infantry that hold the ground next to a Launch Site (within `radius`
 * tiles of its edge) for `time` seconds, with none of the owner's team's infantry there, push the
 * countdown back `delay` seconds. Again and again, until someone clears them out.
 */
export const SCRUB = { radius: 3, time: 10, delay: 60 };

/**
 * Merchant convoys (our twist): every owned coastal city sends a Merchant Ship (`kind`) to its
 * owner's nearest Dock every `every` seconds (a Harbor city every `portEvery`), while the owner
 * has fewer than `perPlayer` at sea. Within `arrive` tiles of the Dock it pays `cash` and `oil`;
 * whoever sinks one takes `loot` of that. It sets off from water within `coast` tiles of the city.
 */
export const CONVOY = { kind: 'merchant', every: 90, portEvery: 45, cash: 150, oil: 25, loot: 0.5, arrive: 3, perPlayer: 4, coast: 6 };

/**
 * Home Front (our twist): owned cities claim `cityBase + perLevel × level` tiles around them, an
 * HQ `hq` tiles. On your team's ground your units regain `regen` of their HP a second, and (with
 * `dig`) idle infantry dig in by themselves.
 */
export const HOME_FRONT = { cityBase: 8, perLevel: 2, hq: 12, regen: 0.01, dig: false };

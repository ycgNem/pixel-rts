// Shared sim types. Everything reachable from MatchState is plain JSON data (CLAUDE.md rule 7).
// Field names are short because snapshots of these objects go over the network.
import type { MapSize, MapType, TradeId } from '../data/rules';
import type { PowerId } from '../data/powers';
import type { SpecId } from '../data/cities';

export const TICK_RATE = 20;
export const DT = 1 / TICK_RATE;

export type AiDifficulty = 'easy' | 'normal' | 'hard';
export type AiPersonality = 'militarist' | 'expansionist' | 'scientist';

export interface PlayerSetup {
  name: string;
  team: number;
  color: number;
  kind: 'human' | 'ai' | 'passive';
  /** personality: undefined = balanced; 'random' is settled from the seed when the match is created */
  ai?: { difficulty: AiDifficulty; personality?: AiPersonality | 'random' };
}

export interface MatchSetup {
  seed: number;
  mapType: MapType;
  mapSize: MapSize;
  players: PlayerSetup[];
  fog: 'on' | 'explored' | 'off';
  victory: { conquest: boolean; supremacy: boolean; science: boolean };
  /** seconds; 0 = no limit, -1 = auto (VICTORY.autoLimit: see timeLimitOf) */
  timeLimit: number;
  weather: boolean;
  crates: boolean;
  /** starting cash multiplier */
  startMul?: number;
  /** knocked-out players fight on as insurgents (on unless false) */
  insurgency?: boolean;
  /** neutral cities post public jobs (on unless false) */
  contracts?: boolean;
  /** a river with two bridges across Pangaea and Lakes maps (on unless false) */
  river?: boolean;
  /** sandbox: human players have endless cash, oil, science and Command Points (SANDBOX) */
  sandbox?: boolean;
}

export interface Deposit { kind: 'ore' | 'oil'; x: number; y: number; rich?: boolean }
export interface CitySeed { x: number; y: number; level: number; name: string; coastal: boolean }

export interface GameMap {
  w: number;
  h: number;
  /** terrain id per tile, row-major */
  terrain: number[];
  deposits: Deposit[];
  starts: { x: number; y: number }[];
  cities: CitySeed[];
  /** river bridges: a deck from (x0, y0) to (x1, y1) in tiles, `w` tiles wide (drawn by the painter) */
  bridges?: Bridge[];
}

export interface Bridge { x0: number; y0: number; x1: number; y1: number; w: number }

export interface Research { cur: string | null; prog: number; queue: string[] }

export interface Player {
  id: number;
  name: string;
  team: number;
  color: number;
  kind: 'human' | 'ai' | 'passive';
  cash: number;
  oil: number;
  science: number;
  cp: number;
  alive: boolean;
  techs: string[];
  doctrines: string[];
  /** era index reached (0-3) */
  era: number;
  /** an era doctrine choice is waiting */
  doctrinePending: number;
  research: Research;
  /** tick each power is ready again */
  powerReady: Partial<Record<PowerId, number>>;
  stats: PlayerStats;
  surrendered: boolean;
  /** recent 'attacked' alerts as [x, y, tick] (one per area at a time: ALERTS) */
  alerts: [number, number, number][];
  /** government in exile: the capital city's id after the HQ fell (-1 while the HQ stands) */
  capital: number;
  /** tick the exiled capital starts working */
  capitalAt: number;
  /** ids of every city this player has held (insurgents may drop partisans at them) */
  held: number[];
  /** insurgency, while knocked out: tick the next partisan drop is ready */
  insurgeAt: number;
  /** insurgency: the city being held to re-found the government (-1 = none), and the tick it happens */
  rising: number;
  risingAt: number;
  /** insurgency: how many times this player has re-founded their government */
  comebacks: number;
  /** making a last stand (cities all lost, HQ standing: LAST_STAND) */
  lastStand: boolean;
  /** wanted aces: this player's ace (a unit id, -1 = none), and every name their aces have had (the last is the current ace's) */
  ace: number;
  aceNames: string[];
  /** exchange prices: how much each trade has been heated by recent use (0 = base price) */
  market: Partial<Record<TradeId, number>>;
}

export interface PlayerStats {
  unitsBuilt: number;
  unitsLost: number;
  kills: number;
  valueDestroyed: number;
  cashEarned: number;
  citiesCaptured: number;
  /** sampled every 30 s for the end screen: [army value, income/min, cities, techs] */
  history: [number, number, number, number][];
}

/** Unit orders. `q` on commands appends instead of replacing. */
export type Order =
  | { o: 'move'; x: number; y: number; gx: number; gy: number; am: boolean; grp: number }
  | { o: 'attack'; t: number }
  | { o: 'build'; t: number }
  | { o: 'load'; t: number }
  | { o: 'unload'; x: number; y: number; gx: number; gy: number }
  | { o: 'patrol'; ax: number; ay: number; bx: number; by: number; leg: number };

export interface EntBase {
  id: number;
  kind: string;
  owner: number;
  hp: number;
  /** center position in tiles */
  x: number;
  y: number;
}

export interface Unit extends EntBase {
  t: 'u';
  /** facing angle (radians, 0 = east, clockwise because y grows down) */
  dir: number;
  order: Order | null;
  queue: Order[];
  /** current target entity id (auto-acquired or ordered), 0 = none */
  tgt: number;
  /** weapon cooldowns in ticks */
  cd: number[];
  /** hold position stance */
  hold: boolean;
  /** dug in (rifleman ability) */
  dug: boolean;
  /** veterancy: destroyed value / own cost, and stars */
  xp: number;
  vet: number;
  /** ability ready tick, and active-until tick */
  abReady: number;
  abUntil: number;
  /** carried units (transport) */
  cargo: number[];
  /** inside a transport (not on the map) */
  inside: number;
  /** last tick this unit fired (stealth units reveal themselves) */
  fired: number;
  /** hidden like a submarine until this tick (partisans just landed; 0 = not): firing or capturing ends it */
  hide: number;
  /** guard point to return to after chasing */
  gx: number;
  gy: number;
  /** moving this tick (for render) */
  mv: boolean;
  /** a Builder's work zone (WORK_ZONE), if it has one */
  post?: WorkZone;
  /** internal: ticks without progress, best distance so far, group of the last finished move */
  _stuck: number;
  _best: number;
  _grp: number;
}

/** A Builder's work zone: center and radius in tiles, the edge stop it walks to next, and the tick it may set off. */
export interface WorkZone { x: number; y: number; r: number; leg: number; wait: number }

export interface ProdItem { kind: string; left: number; total: number }

export interface Building extends EntBase {
  t: 'b';
  /** top-left tile */
  tx: number;
  ty: number;
  /** construction progress 0..1 (1 = finished) */
  built: number;
  prod: ProdItem[];
  rally: [number, number] | null;
  /** deposit index for mines and derricks */
  dep: number;
  cd: number[];
  tgt: number;
  /** production blocked by supply this tick (for UI) */
  blocked: boolean;
}

export type Ent = Unit | Building;

export interface City {
  id: number;
  name: string;
  x: number;
  y: number;
  level: number;
  /** growth toward the next level 0..1 */
  grow: number;
  owner: number;
  coastal: boolean;
  spec: SpecId | null;
  /** waiting for the owner to choose a specialization */
  specPending: boolean;
  /** team currently capturing, and progress 0..1 */
  capTeam: number;
  cap: number;
  /** player credited with the capture */
  capBy: number;
  /** tick when unrest ends */
  calm: number;
  /** resistance: the player partisans rise for (-1 = none), until which tick, and how many rose */
  resistFor: number;
  resistUntil: number;
  risen: number;
  prod: ProdItem[];
  rally: [number, number] | null;
  cd: number[];
  tgt: number;
  contested: boolean;
}

/** A projectile in flight (shells, rockets, bombs). Hits a point when it lands. */
export interface Shot {
  owner: number;
  src: number;
  kind: string;
  w: number;
  x0: number;
  y0: number;
  x: number;
  y: number;
  /** target entity (homing until it lands) or 0 for a ground point */
  t: number;
  /** tick fired, and tick it lands */
  t0: number;
  land: number;
  dmg: number;
  splash: number;
  cls: string;
  hits: string[];
}

/** Map-wide timed effects: reveals, smoke clouds, rally zones, strike warnings, fires. */
export interface Effect {
  k: 'reveal' | 'smoke' | 'rally' | 'strike' | 'fire' | 'help';
  team: number;
  owner: number;
  x: number;
  y: number;
  r: number;
  until: number;
  /** strike: when the shells land */
  at?: number;
}

export interface Crate { id: number; x: number; y: number; reward: number; until: number }

export interface Weather {
  /** rain intensity 0..1 (time of day comes from the tick) */
  rain: number;
  storm: number;
  /** tick the current front ends */
  frontUntil: number;
}

export interface MatchState {
  v: 1;
  setup: MatchSetup;
  map: GameMap;
  tick: number;
  rng: number;
  nextId: number;
  players: Player[];
  ents: Record<number, Ent>;
  cities: City[];
  shots: Shot[];
  effects: Effect[];
  crates: Crate[];
  nextCrate: number;
  weather: Weather;
  /** team -> tick their supremacy timer started (or -1) */
  supremacy: Record<number, number>;
  /** active launch: building id, the tick it completes, and ticks of Scrub so far (SCRUB) */
  launch: { id: number; done: number; scrub: number } | null;
  /** the team everyone else has ganged up on (a win counting down), or -1 */
  coalition: number;
  /** bumps when building footprints change (nav caches rebuild) */
  navVer: number;
  over: { winners: number; reason: string; tick: number } | null;
  /** city contracts: the open job (or null), and the tick the next one is due */
  contract: Contract | null;
  nextContract: number;
}

export type ContractKind = 'supply' | 'hold' | 'liberate';

/**
 * A city's public job (CONTRACTS). `holder`/`since`: who holds a hold job's city, since when.
 * `bids`/`closes`: a supply tender's bids and the tick it closes (set when it is posted). `team`: the
 * runaway leader a liberation is against (-1 otherwise), and `level` the city's size while they
 * held it (a liberated city keeps it).
 */
export interface Contract {
  city: number;
  kind: ContractKind;
  until: number;
  holder: number;
  since: number;
  bids: { p: number; cash: number }[];
  closes: number;
  team: number;
  level: number;
}

// ---- commands (CLAUDE.md rule 2) ----

export type Command =
  | { t: 'move'; p: number; ids: number[]; x: number; y: number; q?: boolean; am?: boolean }
  | { t: 'attack'; p: number; ids: number[]; target: number; q?: boolean }
  | { t: 'stop'; p: number; ids: number[] }
  | { t: 'hold'; p: number; ids: number[] }
  | { t: 'patrol'; p: number; ids: number[]; x: number; y: number }
  /** give Builders a work zone (r = 0 frees them) */
  | { t: 'zone'; p: number; ids: number[]; x: number; y: number; r: number }
  | { t: 'build'; p: number; ids: number[]; kind: string; tx: number; ty: number; q?: boolean }
  | { t: 'assist'; p: number; ids: number[]; target: number; q?: boolean }
  | { t: 'train'; p: number; at: number; city?: boolean; kind: string; n: number }
  | { t: 'cancelTrain'; p: number; at: number; city?: boolean; index: number }
  | { t: 'rally'; p: number; at: number; city?: boolean; x: number; y: number }
  | { t: 'cancelBuild'; p: number; id: number }
  | { t: 'sell'; p: number; id: number }
  | { t: 'sellUnits'; p: number; ids: number[] }
  | { t: 'research'; p: number; tech: string }
  | { t: 'cancelResearch'; p: number; index: number }
  | { t: 'doctrine'; p: number; id: string }
  | { t: 'spec'; p: number; city: number; spec: SpecId }
  | { t: 'ability'; p: number; ids: number[]; x?: number; y?: number }
  | { t: 'power'; p: number; power: PowerId; x?: number; y?: number }
  | { t: 'trade'; p: number; trade: TradeId }
  | { t: 'load'; p: number; ids: number[]; target: number }
  | { t: 'unload'; p: number; ids: number[]; x: number; y: number }
  | { t: 'gift'; p: number; to: number; cash: number; oil: number }
  | { t: 'surrender'; p: number }
  | { t: 'insurge'; p: number; city: number }
  | { t: 'contract'; p: number; city: number; bid: number };

// ---- events (returned by step, used for effects, sounds and alerts) ----

export type SimEvent =
  | { e: 'shot'; src: number; owner: number; x0: number; y0: number; x1: number; y1: number; w: string; kind: string }
  | { e: 'hit'; x: number; y: number; cls: string; big: boolean }
  | { e: 'die'; id: number; kind: string; owner: number; x: number; y: number; b: boolean; dir: number }
  | { e: 'trained'; id: number; kind: string; owner: number }
  | { e: 'placed'; id: number; kind: string; owner: number }
  | { e: 'built'; id: number; kind: string; owner: number }
  | { e: 'capture'; city: number; owner: number; prev: number }
  | { e: 'grow'; city: number; level: number; owner: number }
  | { e: 'researched'; p: number; tech: string }
  | { e: 'era'; p: number; era: number }
  | { e: 'power'; p: number; power: PowerId; x: number; y: number }
  | { e: 'ability'; id: number; owner: number; ab: string; x: number; y: number }
  | { e: 'vet'; id: number; owner: number; stars: number }
  /** wanted aces: a player's new ace; an ace fell (`by` is paid the bounty, -1 = nobody) */
  | { e: 'ace'; p: number; id: number; kind: string; name: string; x: number; y: number }
  | { e: 'aceDown'; p: number; by: number; id: number; kind: string; name: string; x: number; y: number; cash: number; cp: number }
  | { e: 'crate'; id: number; x: number; y: number; p: number; reward: string; amount: number }
  | { e: 'crateDrop'; id: number; x: number; y: number }
  | { e: 'attacked'; p: number; x: number; y: number }
  | { e: 'eliminated'; p: number }
  /** a player lost their last city but keeps the HQ: a last stand begins */
  | { e: 'lastStand'; p: number }
  | { e: 'exile'; p: number; city: number }
  /** insurgency: partisans dropped at a city; a city held toward re-founding; the government re-founded */
  | { e: 'insurge'; p: number; city: number; n: number }
  | { e: 'rising'; p: number; city: number; at: number }
  | { e: 'refound'; p: number; city: number }
  /** city contracts: a job posted; done by a player; closed with nobody done */
  | { e: 'contract'; city: number; kind: ContractKind; until: number }
  | { e: 'bid'; p: number; city: number; cash: number }
  | { e: 'contractDone'; p: number; city: number; kind: ContractKind; cash: number; cp: number }
  | { e: 'contractEnd'; city: number }
  | { e: 'resist'; p: number; city: number }
  | { e: 'coalition'; team: number }
  | { e: 'over'; winners: number; reason: string }
  | { e: 'weather'; kind: 'rain' | 'storm' | 'clear' }
  | { e: 'launch'; p: number; x: number; y: number; done: number }
  | { e: 'scrub'; p: number; by: number; x: number; y: number; done: number }
  /** a merchant ship arrived (by = -1) or was sunk by player `by`, who took a share */
  | { e: 'convoy'; p: number; by: number; x: number; y: number; cash: number; oil: number }
  | { e: 'reject'; p: number; why: string };

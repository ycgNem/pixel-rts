// Computer players. They read the match state and return commands, exactly like a human's UI
// (CLAUDE.md rule 2), and run only on the host. Each AI keeps a little memory of its own (squads,
// waves, ferries, what it has seen); the match state never depends on it.
//
// Every think: research and choices → economy (builders, construction) → production →
// capture squads → defense → attack waves (by land, or by sea with transports) → powers.
// Tuning lives in src/data/ai.ts.
import { UNITS } from '../../data/units';
import { BUILDINGS } from '../../data/buildings';
import { AI_LEVELS, AI_PLANS, AI_NAVAL, AI_POWERS, AI_DEFENSE, AI_ERA_INFANTRY, AI_SCOUT, AI_TRADE, AI_RESPONSE, AI_ANTI_AIR, AI_SPEND, AI_SITES, AI_INSURGENCY, AI_CONTRACT, AI_SURRENDER, AI_ACE, type AiLevel, type AiPlan } from '../../data/ai';
import { tradeBlocked } from '../exchange';
import { powerCost, supplyDropCash } from '../powers';
import { POWERS, type PowerId } from '../../data/powers';
import { DOCTRINES, TECHS } from '../../data/techs';
import { SPECS, type SpecId } from '../../data/cities';
import { TERRAIN } from '../../data/terrain';
import { CONVOY, INSURGENCY, RESISTANCE } from '../../data/rules';
import type { AiDifficulty, AiPersonality, Building, City, Command, Ent, MatchState, Player, Unit } from '../types';
import { TICK_RATE } from '../types';
import { placementProblem } from '../commands';
import { nav, compOf, passable, nearestPassable, type Nav } from '../nav';
import { unitCost, hqOf, enemies, unitMaxHp, buildingCap, buildingCount, buildingMaxHp, insurgent, missingBuilding } from '../world';
import { charges, chestTroops, dropBlocked, squadProgress } from '../insurgency';
import { trainsAt } from '../laststand';
import { armyValue } from '../lifecycle';
import { bidBlocked, minBid, supplyFloor, topBid } from '../contracts';
import { supplyUsed, supplyCap, techBlocked } from '../economy';
import { captureRadius, cityTrains } from '../cities';
import { stealthy, tileVisible } from '../vision';
import { cargoSupply } from '../transport';
import { score } from '../victory';

export interface Ai {
  player: number;
  think(s: MatchState): Command[];
}

export function createAi(s: MatchState, player: number, difficulty: AiDifficulty, personality?: AiPersonality | 'random'): Ai {
  // (createMatch settles 'random'; an unsettled one plays balanced)
  return new Brain(s, player, difficulty, personality === 'random' ? undefined : personality);
}

const value = (kind: string) => UNITS[kind].cost.cash + 2 * UNITS[kind].cost.oil;
/** a target's identity across thinks (cities, buildings, start spots and flares share id ranges) */
const targetKey = (t: Target) => `${t.city ? 'c' : t.spot ? 's' : t.help ? 'h' : 'b'}${t.id}`;
/** units that can only shoot aircraft (fighters): no use in a ground attack */
const airOnly = (kind: string) => UNITS[kind].weapons.length > 0 && UNITS[kind].weapons.every((w) => w.hits.length === 1 && w.hits[0] === 'air');
const PRODUCERS = new Set(['barracks', 'factory', 'airfield', 'dock', 'hq']);
const PRODUCER_RANK: Record<string, number> = { factory: 0, airfield: 1, dock: 2, barracks: 3 };

/** an enemy city, a seen enemy building, (spot) a start spot nobody has looked at yet, or (help) an ally's flare */
interface Target { x: number; y: number; id: number; city: boolean; spot?: boolean; help?: number }
interface Wave {
  target: Target; ids: number[]; value0: number; started: number;
  /** across the sea, troops land at `beach` and wait there until `go` (or `beachWait` after the first landing) */
  go: boolean; need: number; beach: [number, number] | null; landed: number;
  /** a landing that fell back to its beach once already */
  regroup?: boolean;
}
interface Ferry { phase: 'load' | 'sail' | 'back'; ids: number[]; since: number; dest: [number, number] }

class Brain implements Ai {
  private lv: AiLevel;
  private plan: AiPlan;
  private out: Command[] = [];
  private p!: Player;
  private hq: Building | undefined;
  /** the exiled capital, when the HQ is gone */
  private capital: City | undefined;
  /** where we govern from: the HQ, or the exiled capital */
  private home: { x: number; y: number } | undefined;
  private units: Unit[] = [];
  private buildings: Building[] = [];
  private foes: Unit[] = [];
  private foeBuildings: Building[] = [];
  /** the open sea (the largest body of water; -2 = not worked out yet) */
  private sea = -2;
  /** targets no boat of ours could find a beach near lately (target key → tick) */
  private noLanding = new Map<string, number>();
  /** our buildings at the last look (id → spot), and where we lost some lately */
  private sites = new Map<number, [number, number]>();
  private losses: { x: number; y: number; tick: number }[] = [];
  private n!: Nav;
  private homeComp = -1;
  /** capture squads: city id → unit ids */
  private squads = new Map<number, number[]>();
  /** city id → infantry holding down its resistance (kept out of waves until it ends) */
  private garrisons = new Map<number, number[]>();
  private garrisoned = new Set<number>();
  /** Call for Help flares already answered */
  private answered = new Set<number>();
  /** where an attack too big for our defenders is, this think */
  private outgunned: { x: number; y: number } | null = null;
  private calledHelp = -1e9;
  private wave: Wave | null = null;
  private lastWave = 0;
  /** tick since when the army has been at the supply limit (-1 = it isn't) */
  private maxedSince = -1;
  /** enemy buildings this AI's team has seen (ids) */
  private seen = new Set<number>();
  /** start spots (indexes into map.starts) that might hold an enemy base and haven't been seen */
  private unchecked: number[] | null = null;
  private scoutId = 0;
  private ferries = new Map<number, Ferry>();
  /** cash being saved for a building, and cash already spent this think */
  private saving = 0;
  private spent = 0;
  private island = false;
  private sawAir = 0;
  private sawBombers = 0;
  /** since when this AI has been hopeless (-1 = it isn't): AI_SURRENDER */
  private hopeless = -1;
  /** the producer saving for a big-ticket unit, since when (AI_SPEND.bigTicket) */
  private bigSave: { id: number; since: number } | null = null;
  private sawArmor = 0;
  private sawShips = 0;
  /** the most enemy air supply seen at once lately */
  private airPeak = 0;
  /** the unit on its way to a city's supply contract */
  private courier = 0;

  constructor(s: MatchState, public player: number, difficulty: AiDifficulty, personality?: AiPersonality) {
    this.lv = AI_LEVELS[difficulty];
    this.plan = AI_PLANS[personality ?? 'balanced'];
    void s;
  }

  think(s: MatchState): Command[] {
    // players think at evenly spread ticks, so no seat always reacts just before its neighbour
    if ((s.tick + Math.floor((this.player * this.lv.think) / s.players.length)) % this.lv.think !== 0) return [];
    this.p = s.players[this.player];
    if (!this.p || s.over) return [];
    if (!this.p.alive) return insurgent(s, this.p) ? this.insurge(s) : [];
    this.out = [];
    this.spent = 0;
    this.scan(s);
    if (!this.home) return [];
    this.choices(s);
    this.research(s);
    this.economy(s);
    this.contracts(s);
    this.production(s);
    this.trade(s);
    this.garrison(s);
    this.capture(s);
    this.starts = s.map.starts;
    const threat = this.defense(s);
    this.guardLaunch(s);
    this.attack(s, threat);
    // after the attack orders, so a flare's orders win this think
    if (!threat) this.answerHelp(s);
    this.scout(s);
    this.raid(s);
    if (this.island) this.ferry(s);
    if (this.lv.powers) { this.powers(s); this.abilities(s); }
    this.spareBases(s);
    this.saveAce(s);
    this.surrender(s);
    return this.out;
  }

  /**
   * Early on, units that picked a building in a spared enemy base on their own (auto-targeting on
   * the way) walk on: the wave's units to its target, the rest home. No base kills before hqFrom.
   */
  private spareBases(s: MatchState) {
    if (!this.sparing(s)) return;
    const bases = this.enemyBases(s);
    if (!bases.length) return;
    const inBase = (x: number, y: number) => bases.some(([bx, by]) => Math.hypot(x - bx, y - by) < AI_RESPONSE.baseRadius);
    const wave: number[] = [], home: number[] = [];
    for (const u of this.units) {
      const t = u.tgt ? s.ents[u.tgt] : undefined;
      if (!t || t.t !== 'b' || !inBase(t.x, t.y) || (u.order?.o === 'move' && !u.order.am)) continue;
      (this.inWave(u.id) ? wave : home).push(u.id);
    }
    const w = this.wave;
    if (wave.length && w) this.send({ t: 'move', p: this.player, ids: wave, x: w.target.x, y: w.target.y + (w.target.city ? 1 : 0) });
    if (home.length) { const [rx, ry] = this.rally(); this.send({ t: 'move', p: this.player, ids: home, x: rx, y: ry }); }
  }

  /** A badly hurt ace leaves the fight for home ground (where it heals): a named veteran is worth keeping. */
  private saveAce(s: MatchState) {
    const a = this.p.ace >= 0 ? s.ents[this.p.ace] : undefined;
    if (!a || a.t !== 'u' || a.inside || UNITS[a.kind].layer === 'naval' || a.hp >= unitMaxHp(s, a) * AI_ACE.retreatAt) return;
    if (this.wave) this.wave.ids = this.wave.ids.filter((id) => id !== a.id);
    const [rx, ry] = this.rally();
    const o = a.order;
    if (Math.hypot(a.x - rx, a.y - ry) < 3 || (o?.o === 'move' && !o.am && Math.hypot(o.x - rx, o.y - ry) < 1)) return;
    this.send({ t: 'move', p: this.player, ids: [a.id], x: rx, y: ry });
  }

  /** A hopeless AI (no city, no ally, a fraction of the strongest enemy's army for a while) gives up. */
  private surrender(s: MatchState) {
    const p = this.p;
    const alone = !s.players.some((o) => o.id !== p.id && o.alive && o.team === p.team);
    const strongest = Math.max(0, ...s.players.filter((o) => o.alive && enemies(s, this.player, o.id)).map((o) => armyValue(s, o.id)));
    const hopeless = s.tick >= AI_SURRENDER.after * TICK_RATE && alone && !s.cities.some((c) => c.owner === p.id)
      && armyValue(s, p.id) < strongest * AI_SURRENDER.share;
    if (!hopeless) { this.hopeless = -1; return; }
    if (this.hopeless < 0) this.hopeless = s.tick;
    if (s.tick - this.hopeless >= AI_SURRENDER.wait * TICK_RATE) this.send({ t: 'surrender', p: this.player });
  }

  private send(c: Command) {
    this.out.push(c);
  }

  /** Knocked out: drop partisans where they can take a city, and send idle ones to the nearest city not ours. */
  private insurge(s: MatchState): Command[] {
    const me = this.player, p = this.p, team = p.team;
    const out: Command[] = [];
    const cities = s.cities.filter((c) => !dropBlocked(s, p, c));
    const n = charges(s, p);
    // with no teammate left in the match it sees the whole map, as a knocked-out human does
    const seesAll = !s.players.some((o) => o.alive && o.team === team);
    if (cities.length) {
      const rising = p.rising >= 0 ? cities.find((c) => c.id === p.rising) : undefined;
      let best = rising, bestScore = -Infinity, takes = !!rising;
      if (!best)
        for (const c of cities) {
          const r = captureRadius(c) + AI_INSURGENCY.look;
          let danger = 0;
          for (const id in s.ents) {
            const e = s.ents[id];
            if (e.t === 'u' && !e.inside && e.owner >= 0 && enemies(s, me, e.owner) && Math.hypot(e.x - c.x - 0.5, e.y - c.y - 0.5) <= r && (seesAll || tileVisible(s, team, e.x, e.y))) danger++;
          }
          const can = squadProgress(s, c, n, chestTroops(p, n), p.id) >= AI_INSURGENCY.margin;
          const sc = (can ? AI_INSURGENCY.take : 0) + c.level * AI_INSURGENCY.level + (c.owner < 0 ? AI_INSURGENCY.neutral : 0) - danger * AI_INSURGENCY.danger;
          if (sc > bestScore) { bestScore = sc; best = c; takes = can; }
        }
      // nothing one drop could take yet: bank another charge first (unless the bank is full)
      if (best && (takes || n >= INSURGENCY.maxCharges)) out.push({ t: 'insurge', p: me, city: best.id });
    }
    // idle partisans away from every city: on to the nearest one that isn't ours
    const idle: Unit[] = [];
    for (const id in s.ents) {
      const e = s.ents[id];
      if (e.t === 'u' && e.owner === me && !e.inside && !e.order && !s.cities.some((c) => Math.hypot(e.x - c.x - 0.5, e.y - c.y - 0.5) <= captureRadius(c))) idle.push(e);
    }
    if (idle.length) {
      const u = idle[0];
      let goal: City | undefined, bd = Infinity;
      for (const c of s.cities) {
        if (c.owner >= 0 && !enemies(s, me, c.owner)) continue;
        const d = Math.hypot(u.x - c.x, u.y - c.y);
        if (d < bd) { bd = d; goal = c; }
      }
      if (goal) out.push({ t: 'move', p: me, ids: idle.map((e) => e.id), x: goal.x + 0.5, y: goal.y + 0.5, am: true });
    }
    return out;
  }

  // ---------------------------------------------------------------- what's going on

  private scan(s: MatchState) {
    const me = this.player, team = this.p.team;
    this.units = [];
    this.buildings = [];
    this.foes = [];
    this.foeBuildings = [];
    this.hq = hqOf(s, me);
    const cap = s.players[me].capital;
    this.capital = !this.hq && cap >= 0 && s.cities[cap].owner === me ? s.cities[cap] : undefined;
    this.home = this.hq ? { x: this.hq.x, y: this.hq.y } : this.capital ? { x: this.capital.x + 0.5, y: this.capital.y + 0.5 } : undefined;
    this.n = nav(s);
    let air = 0;
    for (const id in s.ents) {
      const e = s.ents[id];
      if (e.owner === me) {
        if (e.t === 'u') { if (!e.inside) this.units.push(e); }
        else this.buildings.push(e);
      } else if (e.owner >= 0 && enemies(s, me, e.owner)) {
        if (e.t === 'b') {
          const d = BUILDINGS[e.kind];
          if (this.seen.has(e.id) || tileVisible(s, team, e.tx + d.w / 2, e.ty + d.h / 2)) {
            this.seen.add(e.id);
            this.foeBuildings.push(e);
          }
        } else if (!e.inside && tileVisible(s, team, e.x, e.y) && !stealthy(s, e)) {
          this.foes.push(e);
          // only aircraft that can hurt us on the ground or at sea call for anti-air (fighters hunting fighters is a waste)
          if (UNITS[e.kind].layer === 'air' && !airOnly(e.kind)) { this.sawAir = Math.max(this.sawAir, s.tick); air += UNITS[e.kind].supply; }
          if (e.kind === 'bomber') this.sawBombers = Math.max(this.sawBombers, s.tick);
          if (UNITS[e.kind].layer === 'naval' && UNITS[e.kind].weapons.length) this.sawShips = Math.max(this.sawShips, s.tick);
          if (e.kind === 'heavytank' || e.kind === 'lighttank') this.sawArmor = Math.max(this.sawArmor, s.tick);
        }
      }
    }
    if (s.tick - this.sawAir > AI_ANTI_AIR.memory * TICK_RATE) this.airPeak = 0;
    this.airPeak = Math.max(this.airPeak, air);
    // buildings of ours gone since the last look: something out there kills what we put there
    const sites = new Map<number, [number, number]>(this.buildings.map((b) => [b.id, [b.x, b.y]]));
    for (const [id, [x, y]] of this.sites) if (!sites.has(id)) this.losses.push({ x, y, tick: s.tick });
    this.sites = sites;
    this.losses = this.losses.filter((l) => s.tick - l.tick < AI_SITES.lostWait * TICK_RATE);
    // start spots are public; which enemy is where (and whether they're still there) has to be seen
    if (!this.unchecked) this.unchecked = s.map.starts.map((_, i) => i).filter((i) => i !== me && enemies(s, me, i));
    this.unchecked = this.unchecked.filter((i) => !tileVisible(s, team, s.map.starts[i].x, s.map.starts[i].y));
    if (this.home) {
      this.homeComp = compOf(this.n, 'ground', Math.floor(this.home.x), Math.floor(this.home.y + (this.hq ? 2.5 : 1.5)));
      // an island game: no enemy start can be reached on foot
      const foeStarts = s.map.starts.filter((_, i) => i !== me && enemies(s, me, i));
      this.island = foeStarts.length > 0 && foeStarts.every((st) => !this.reachable(st.x, st.y + BUILDINGS.hq.h / 2 + 1));
    }
  }

  private reachable(x: number, y: number): boolean {
    for (let r = 0; r <= 3; r++)
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          const tx = Math.floor(x) + dx, ty = Math.floor(y) + dy;
          if (passable(this.n, 'ground', tx, ty) && compOf(this.n, 'ground', tx, ty) === this.homeComp) return true;
        }
    return false;
  }

  private minutes(s: MatchState) {
    return s.tick / TICK_RATE / 60;
  }

  private army(): Unit[] {
    return this.units.filter((u) => {
      const d = UNITS[u.kind];
      return d.weapons.length > 0 && !d.builds && !this.garrisoned.has(u.id);
    });
  }

  private inSquad(id: number): boolean {
    for (const ids of this.squads.values()) if (ids.includes(id)) return true;
    return false;
  }

  private inFerry(id: number): boolean {
    for (const f of this.ferries.values()) if (f.ids.includes(id)) return true;
    return false;
  }

  // ---------------------------------------------------------------- doctrines, specialties, research

  private choices(s: MatchState) {
    const p = this.p;
    if (p.doctrinePending) {
      const opts = DOCTRINES.filter((d) => d.era === p.doctrinePending);
      const pick = this.plan.doctrines.map((id) => opts.find((d) => d.id === id)).find(Boolean) ?? opts[0];
      if (pick) this.send({ t: 'doctrine', p: this.player, id: pick.id });
    }
    for (const c of s.cities) {
      if (c.owner !== this.player || !c.specPending) continue;
      const home = this.home ? Math.hypot(c.x - this.home.x, c.y - this.home.y) : 0;
      const foe = Math.min(...this.foeBuildings.filter((b) => b.kind === 'hq').map((b) => Math.hypot(c.x - b.x, c.y - b.y)), 9999);
      const order = foe < home ? this.plan.specFront : this.plan.specHome;
      // an industrial district only pays with our production buildings near it
      const fits = (id: SpecId) => (!SPECS[id].coastal || c.coastal)
        && (!SPECS[id].aura || this.buildings.some((b) => PRODUCERS.has(b.kind) && b.kind !== 'hq' && Math.hypot(b.x - c.x - 0.5, b.y - c.y - 0.5) <= SPECS[id].aura!));
      const spec = [...order, 'market' as SpecId].find(fits)!;
      this.send({ t: 'spec', p: this.player, city: c.id, spec });
    }
  }

  private research(s: MatchState) {
    const r = this.p.research;
    if (r.queue.length >= 1 && r.cur) return;
    // its plan's path first, then whatever is left (in the tech tree's order)
    const list = [...(this.island ? [...AI_NAVAL.research, ...this.plan.research] : this.plan.research), ...TECHS.map((t) => t.id)];
    const queued = new Set([r.cur, ...r.queue]);
    for (const id of list) {
      if (queued.has(id) || techBlocked(this.p, id)) continue;
      if (id === 'spaceProgram' && !s.setup.victory.science) continue;
      this.send({ t: 'research', p: this.player, tech: id });
      return;
    }
  }

  // ---------------------------------------------------------------- economy

  private economy(s: MatchState) {
    const p = this.p, hq = this.hq, capital = this.capital;
    const builders = this.units.filter((u) => UNITS[u.kind].builds);
    const cities = s.cities.filter((c) => c.owner === this.player).length;
    const want = this.lv.builders + Math.floor(cities / this.lv.buildersPerCity);
    const queuedBuilders = (hq?.prod ?? capital?.prod ?? []).filter((f) => f.kind === 'builder').length;
    if (builders.length + queuedBuilders < want && queuedBuilders === 0 && p.cash >= unitCost(s, this.player, 'builder').cash) {
      if (hq) this.send({ t: 'train', p: this.player, at: hq.id, kind: 'builder', n: 1 });
      else if (capital && cityTrains(s, capital, 'builder')) this.send({ t: 'train', p: this.player, at: capital.id, city: true, kind: 'builder', n: 1 });
      this.spent += unitCost(s, this.player, 'builder').cash;
    }
    const idle = builders.filter((u) => !u.order);
    if (!idle.length) { this.saving = 0; return; }
    // finish what was started, then repair
    const crews = new Map<number, number>();
    for (const u of builders) if (u.order?.o === 'build') crews.set(u.order.t, (crews.get(u.order.t) ?? 0) + 1);
    for (const b of this.buildings) {
      if (!idle.length) return;
      const hurt = b.built >= 1 && b.hp < buildingMaxHp(s, b) * 0.6;
      if ((b.built < 1 || hurt) && !crews.get(b.id)) {
        const u = this.nearest(idle, b.x, b.y);
        idle.splice(idle.indexOf(u), 1);
        this.send({ t: 'assist', p: this.player, ids: [u.id], target: b.id });
        crews.set(b.id, 1);
      }
    }
    if (!idle.length) return;
    // something new (unless the building cap is reached)
    this.saving = 0;
    if (buildingCount(s, this.player) >= buildingCap(s, this.player)) return;
    const kind = this.nextBuilding(s);
    if (!kind) return;
    const d = BUILDINGS[kind];
    if (p.cash - this.spent < d.cost.cash || p.oil < d.cost.oil) { this.saving = d.cost.cash; return; }
    const spot = d.on ? this.depositSpot(s, d.on, idle[0]) : this.findSpot(s, kind);
    if (!spot) return;
    const crew = idle.slice(0, d.w * d.h >= 9 && idle.length > 1 ? 2 : 1).map((u) => u.id);
    this.send({ t: 'build', p: this.player, ids: crew, kind, tx: spot[0], ty: spot[1] });
    this.spent += d.cost.cash;
  }

  private count(kind: string): number {
    return this.buildings.filter((b) => b.kind === kind).length;
  }

  private nextBuilding(s: MatchState): string | null {
    const p = this.p, t = s.tick / TICK_RATE;
    const mines = this.count('mine'), derricks = this.count('derrick');
    const unlocked = (k: string) => (!BUILDINGS[k].tech || p.techs.includes(BUILDINGS[k].tech!)) && !missingBuilding(s, this.player, k);
    const freeOre = () => this.freeDeposits(s, 'ore').length > 0;
    const freeOil = () => this.freeDeposits(s, 'oil').length > 0;
    if (mines < 2 && freeOre()) return 'mine';
    for (const [kind, n, at] of this.plan.build) {
      if (t < at || this.count(kind) >= n || !unlocked(kind)) continue;
      if (kind === 'launch' && !s.setup.victory.science) continue;
      if (kind === 'airfield' && this.count('factory') === 0) continue;
      return kind;
    }
    if (this.island && unlocked('dock') && this.seaDocks().length < AI_NAVAL.docks && this.findSpot(s, 'dock')) return 'dock';
    if (derricks < 1 && this.count('barracks') > 0 && freeOil()) return 'derrick';
    if (mines < this.plan.maxMines && freeOre()) return 'mine';
    if (derricks < this.plan.maxDerricks && freeOil()) return 'derrick';
    if (this.sawAir && s.tick - this.sawAir < 120 * TICK_RATE && unlocked('aagun') && this.count('aagun') < 2) return 'aagun';
    if (this.sawShips && unlocked('coastal') && this.count('coastal') < AI_NAVAL.coastal && this.findSpot(s, 'coastal')) return 'coastal';
    // money piling up: more places to spend it
    const producers = this.count('barracks') + this.count('factory') + this.count('airfield');
    if (p.cash - this.spent > AI_SPEND.cash && producers < AI_SPEND.maxProducers && this.count('barracks') > 0) {
      if (this.count('factory') > 0 && unlocked('airfield') && this.count('airfield') < Math.ceil(this.count('factory') / 2)) return 'airfield';
      return this.count('factory') <= this.count('barracks') && unlocked('factory') ? 'factory' : 'barracks';
    }
    if (unlocked('turret') && this.count('turret') < Math.min(4, Math.floor(this.minutes(s) / 5))) return 'turret';
    return null;
  }

  /** Deposits nobody has built on, near home or a city we own, away from enemies. */
  private freeDeposits(s: MatchState, kind: 'ore' | 'oil'): number[] {
    const hq = this.home!;
    const anchors: [number, number, number][] = [[hq.x, hq.y, 30]];
    for (const c of s.cities) if (c.owner === this.player) anchors.push([c.x, c.y, 12]);
    const out: [number, number][] = [];
    s.map.deposits.forEach((d, i) => {
      if (d.kind !== kind) return;
      if (this.n.occ[d.y * s.map.w + d.x]) return;
      const dist = Math.min(...anchors.map(([x, y, r]) => (Math.hypot(d.x + 1 - x, d.y + 1 - y) <= r ? Math.hypot(d.x + 1 - hq.x, d.y + 1 - hq.y) : Infinity)));
      if (!isFinite(dist)) return;
      if (!this.reachable(d.x + 1, d.y + 1)) return;
      if (this.foes.some((f) => Math.hypot(f.x - d.x, f.y - d.y) < 10)) return;
      if (this.foeBuildings.some((b) => Math.hypot(b.x - d.x, b.y - d.y) < 14)) return;
      if (this.losses.some((l) => Math.hypot(l.x - d.x - 1, l.y - d.y - 1) < AI_SITES.lostRadius)) return;
      out.push([i, dist]);
    });
    return out.sort((a, b) => a[1] - b[1] || a[0] - b[0]).map((o) => o[0]);
  }

  private depositSpot(s: MatchState, kind: 'ore' | 'oil', _builder: Unit): [number, number] | null {
    for (const i of this.freeDeposits(s, kind)) {
      const d = s.map.deposits[i];
      const bk = kind === 'ore' ? 'mine' : 'derrick';
      if (!placementProblem(s, this.player, bk, d.x, d.y)) return [d.x, d.y];
    }
    return null;
  }

  /** A free spot near the HQ (or the coast, for docks) that leaves a lane around the building. */
  private findSpot(s: MatchState, kind: string): [number, number] | null {
    const d = BUILDINGS[kind], hq = this.home!, n = this.n, { w, h } = s.map;
    const cx = Math.floor(hq.x), cy = Math.floor(hq.y);
    const quick = (tx: number, ty: number) => {
      if (tx < 2 || ty < 2 || tx + d.w > w - 2 || ty + d.h > h - 2) return false;
      for (let y = ty - 1; y <= ty + d.h; y++)
        for (let x = tx - 1; x <= tx + d.w; x++) {
          if (n.occ[y * w + x]) return false;
          const inside = x >= tx && x < tx + d.w && y >= ty && y < ty + d.h;
          if (inside && !TERRAIN[s.map.terrain[y * w + x]].buildable) return false;
        }
      // keep the HQ's front door clear
      if (Math.abs(tx + d.w / 2 - hq.x) < 3 + d.w / 2 && ty > hq.y && ty < hq.y + 5) return false;
      return true;
    };
    const maxR = d.coastal ? 30 : 22;
    for (let r = 3; r <= maxR; r++) {
      // ring r, in a fixed order (deterministic)
      for (let i = -r; i <= r; i++)
        for (const [dx, dy] of [[i, -r], [i, r], [-r, i], [r, i]] as [number, number][]) {
          const tx = cx + dx - Math.floor(d.w / 2), ty = cy + dy - Math.floor(d.h / 2);
          if (!quick(tx, ty)) continue;
          if (!this.reachable(tx + d.w / 2, ty + d.h + 0.5) && !this.reachable(tx - 0.5, ty + d.h / 2)) continue;
          // a Dock or a battery on a lake at home is no use: it has to face the open sea
          if (d.coastal && !this.onSea(tx, ty, d.w, d.h)) continue;
          if (placementProblem(s, this.player, kind, tx, ty)) continue;
          return [tx, ty];
        }
    }
    return null;
  }

  /** Does water of the open sea lie within 2 tiles of this footprint? */
  private onSea(tx: number, ty: number, bw: number, bh: number): boolean {
    const n = this.n;
    if (this.sea === -2) {
      const size = new Map<number, number>();
      for (let i = 0; i < n.w * n.h; i++) if (n.naval[i]) size.set(n.compNaval[i], (size.get(n.compNaval[i]) ?? 0) + 1);
      let best = -1, most = 0;
      for (const [c, k] of [...size].sort((a, b) => a[0] - b[0])) if (k > most) { best = c; most = k; }
      this.sea = best;
    }
    for (let y = ty - 2; y < ty + bh + 2; y++)
      for (let x = tx - 2; x < tx + bw + 2; x++) if (passable(n, 'naval', x, y) && compOf(n, 'naval', x, y) === this.sea) return true;
    return false;
  }

  /** Our finished-or-not Docks that face the open sea. */
  private seaDocks(): Building[] {
    return this.buildings.filter((b) => b.kind === 'dock' && this.onSea(b.tx, b.ty, BUILDINGS.dock.w, BUILDINGS.dock.h));
  }

  private nearest<T extends Ent>(list: T[], x: number, y: number): T {
    let best = list[0], bd = Infinity;
    for (const e of list) {
      const d = Math.hypot(e.x - x, e.y - y);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  // ---------------------------------------------------------------- production

  private production(s: MatchState) {
    const p = this.p;
    const cap = Math.min(this.lv.maxSupply, supplyCap(s, this.player)), used = supplyUsed(s, this.player);
    if (used >= cap) return;
    const counts = new Map<string, number>();
    for (const u of this.units) counts.set(u.kind, (counts.get(u.kind) ?? 0) + 1);
    for (const b of this.buildings) for (const f of b.prod) counts.set(f.kind, (counts.get(f.kind) ?? 0) + 1);
    let budget = p.cash - this.spent - this.saving - (this.saving ? this.lv.reserve : 0);
    let oil = p.oil;
    let room = cap - used;
    const weights = this.weights(s);
    // across the sea an army is stuck without boats: keep supply free for the transports we lack
    const lacking = this.island ? Math.max(0, AI_NAVAL.transports - (counts.get('transport') ?? 0)) : 0;
    const reserve = lacking * UNITS.transport.supply;
    // vehicles, aircraft and ships get first pick of the money (a producer saving for a big-ticket unit before them)
    if (this.bigSave && s.tick - this.bigSave.since > AI_SPEND.saveFor * TICK_RATE) this.bigSave = null;
    const first = (b: Building) => (this.bigSave?.id === b.id ? -1 : PRODUCER_RANK[b.kind] ?? 9);
    const order = [...this.buildings].sort((a, b) => first(a) - first(b) || a.id - b.id);
    // a producer with one unit to offer would train it forever: fighters (anti-air only) also
    // keep to their share of the whole army
    const unlocked = Object.keys(weights).filter((k) => !UNITS[k].tech || p.techs.includes(UNITS[k].tech!));
    const wAll = unlocked.reduce((a, k) => a + weights[k], 0) || 1;
    const armyN = this.units.filter((u) => !UNITS[u.kind].builds).length + 1;
    const overShare = (k: string) => airOnly(k) && (counts.get(k) ?? 0) / armyN >= weights[k] / wAll;
    for (const b of order) {
      if (b.built < 1 || !PRODUCERS.has(b.kind) || (b.kind === 'hq' && !p.lastStand) || b.prod.length >= this.lv.queue) continue;
      if (b.kind === 'dock' && !this.seaDocks().includes(b)) continue;
      const options = Object.keys(weights).filter((k) => trainsAt(s, b, k) && (!UNITS[k].tech || p.techs.includes(UNITS[k].tech!)));
      if (!options.length) continue;
      const total = options.reduce((a, k) => a + (counts.get(k) ?? 0), 0) + 1;
      const wsum = options.reduce((a, k) => a + weights[k], 0);
      let best = '', bestGap = -Infinity;
      for (const k of options) {
        const gap = weights[k] / wsum - (counts.get(k) ?? 0) / total;
        if (gap > bestGap) { bestGap = gap; best = k; }
      }
      // a dock replaces missing transports before anything else
      if (lacking && options.includes('transport') && (counts.get('transport') ?? 0) < AI_NAVAL.transports) best = 'transport';
      if (overShare(best)) continue;
      const cost = unitCost(s, this.player, best);
      if ((budget < cost.cash || oil < cost.oil) && cost.cash >= AI_SPEND.bigTicket && room >= UNITS[best].supply) {
        // save for it: keep its price back from the producers after this one
        if (this.bigSave?.id !== b.id) this.bigSave = { id: b.id, since: s.tick };
        budget -= Math.min(budget, cost.cash);
        oil -= Math.min(oil, cost.oil);
        continue;
      }
      if (budget < cost.cash || oil < cost.oil || room < UNITS[best].supply) continue;
      if (this.bigSave?.id === b.id) this.bigSave = null;
      if (best !== 'transport' && room - UNITS[best].supply < reserve) continue;
      if (best === 'transport' && (counts.get('transport') ?? 0) >= Math.min(AI_NAVAL.maxTransports, AI_NAVAL.transports + Math.floor(used / AI_NAVAL.transportPer))) continue;
      this.send({ t: 'train', p: this.player, at: b.id, kind: best, n: 1 });
      budget -= cost.cash;
      oil -= cost.oil;
      room -= UNITS[best].supply;
      counts.set(best, (counts.get(best) ?? 0) + 1);
    }
    // big cities train riflemen when there's spare cash, while riflemen are short of their share
    const all = [...counts.values()].reduce((a, n) => a + n, 0) + 1;
    const wall = Object.values(weights).reduce((a, n) => a + n, 0);
    for (const c of s.cities) {
      if ((counts.get('rifleman') ?? 0) / all >= (weights.rifleman ?? 0) / wall) break;
      if (c.owner !== this.player || c.prod.length || !cityTrains(s, c, 'rifleman')) continue;
      const cost = unitCost(s, this.player, 'rifleman');
      if (budget < cost.cash * 3 || room - 1 < reserve) continue;
      this.send({ t: 'train', p: this.player, at: c.id, city: true, kind: 'rifleman', n: 1 });
      budget -= cost.cash;
      room--;
      counts.set('rifleman', (counts.get('rifleman') ?? 0) + 1);
    }
  }

  /** Unit weights, adjusted to what the enemy fields and to island maps. */
  private weights(s: MatchState): Record<string, number> {
    const w: Record<string, number> = { ...this.plan.army };
    // infantry matters less as the eras go by
    for (const k of Object.keys(w)) if (UNITS[k].cls === 'infantry') w[k] /= 1 + this.p.era * AI_ERA_INFANTRY;
    const recent = (t: number) => t && s.tick - t < AI_ANTI_AIR.memory * TICK_RATE;
    if (recent(this.sawAir)) {
      // enough anti-air for the air force we've seen, and no more
      const aa = this.units.filter((u) => u.kind === 'flaktrooper' || u.kind === 'flaktruck' || u.kind === 'fighter').reduce((a, u) => a + UNITS[u.kind].supply, 0);
      const k = aa < AI_ANTI_AIR.cover * Math.max(AI_ANTI_AIR.minAir, this.airPeak) ? AI_ANTI_AIR.boost : AI_ANTI_AIR.enough;
      w.flaktrooper *= k; w.flaktruck *= k;
      // fighters are for bombers: against helicopters, flak does the job
      w.fighter *= recent(this.sawBombers) ? k : AI_ANTI_AIR.enough;
    } else w.fighter *= AI_ANTI_AIR.enough;
    if (recent(this.sawArmor)) { w.rocket *= 2; w.helicopter *= 1.5; }
    if (this.island) {
      w.transport = 2;
      for (const k of ['patrolboat', 'destroyer', 'submarine', 'battleship', 'bomber', 'helicopter']) w[k] = (w[k] ?? 1) * 2.5;
    } else {
      for (const k of ['patrolboat', 'destroyer', 'submarine', 'battleship']) w[k] = (w[k] ?? 0) * 0.3;
    }
    return w;
  }

  // ---------------------------------------------------------------- capturing cities

  /** Cities we took resist for a while: keep RESISTANCE.garrison infantry in each until it ends. */
  private garrison(s: MatchState) {
    const resisting = (cid: number) => {
      const c = s.cities[cid];
      return c.owner === this.player && c.resistFor >= 0 && s.tick < c.resistUntil;
    };
    for (const [cid, ids] of this.garrisons) {
      if (!resisting(cid)) { this.garrisons.delete(cid); continue; }
      this.garrisons.set(cid, ids.filter((id) => s.ents[id]?.owner === this.player));
    }
    const taken = new Set<number>();
    for (const ids of this.garrisons.values()) for (const id of ids) taken.add(id);
    for (const c of s.cities) {
      if (!resisting(c.id)) continue;
      const ids = this.garrisons.get(c.id) ?? [];
      while (ids.length < RESISTANCE.garrison) {
        const pool = this.units.filter((u) => UNITS[u.kind].captures && !taken.has(u.id) && !this.inSquad(u.id) && !this.inFerry(u.id)
          && Math.hypot(u.x - c.x, u.y - c.y) < AI_DEFENSE.allyRadius);
        if (!pool.length) break;
        const u = this.nearest(pool, c.x, c.y);
        ids.push(u.id);
        taken.add(u.id);
        if (this.wave) this.wave.ids = this.wave.ids.filter((id) => id !== u.id);
      }
      if (ids.length) this.garrisons.set(c.id, ids);
    }
    this.garrisoned = taken;
    for (const [cid, ids] of this.garrisons) {
      const c = s.cities[cid];
      const away = ids.filter((id) => {
        const u = s.ents[id] as Unit;
        return Math.hypot(u.x - c.x - 0.5, u.y - c.y - 0.5) > captureRadius(c) - 1 && u.order?.o !== 'move';
      });
      if (away.length) this.send({ t: 'move', p: this.player, ids: away, x: c.x + 0.5, y: c.y + 1.5, am: true });
    }
  }

  private capture(s: MatchState) {
    const alive = (id: number) => s.ents[id] && s.ents[id].owner === this.player;
    // tidy squads
    for (const [cid, ids] of this.squads) {
      const c = s.cities[cid];
      const left = ids.filter(alive);
      if (!left.length || c.owner === this.player || (c.owner >= 0 && !enemies(s, this.player, c.owner))) { this.squads.delete(cid); continue; }
      this.squads.set(cid, left);
      for (const id of left) {
        const u = s.ents[id] as Unit;
        if (!u.order && Math.hypot(u.x - c.x, u.y - c.y) > captureRadius(c) - 1) this.send({ t: 'move', p: this.player, ids: [id], x: c.x + 0.5, y: c.y + 1.5, am: true });
      }
    }
    const slots = this.lv.captureSquads + this.plan.expand + (supplyUsed(s, this.player) >= supplyCap(s, this.player) - 2 ? 1 : 0);
    if (this.squads.size >= slots) return;
    const free = this.units.filter((u) => UNITS[u.kind].captures && !this.inSquad(u.id) && !this.inWave(u.id) && !this.inFerry(u.id) && !this.garrisoned.has(u.id) && !u.order);
    if (free.length < this.lv.captureSquad) return;
    const hq = this.home!;
    // nearer and bigger is better; a city with a hold contract open is worth the trip
    const hold = s.contract?.kind === 'hold' ? s.contract.city : -1;
    const pull = (c: City) => Math.hypot(c.x - hq.x, c.y - hq.y) / (1 + c.level * 0.15) / (c.id === hold ? AI_CONTRACT.holdPull : 1);
    const targets = s.cities
      .filter((c) => c.owner < 0 && !this.squads.has(c.id) && this.reachable(c.x, c.y + 1))
      .filter((c) => !this.foes.some((f) => Math.hypot(f.x - c.x, f.y - c.y) < 8))
      .sort((a, b) => pull(a) - pull(b) || a.id - b.id);
    const c = targets[0];
    if (!c) return;
    const squad: Unit[] = [];
    const pool = [...free];
    while (squad.length < this.lv.captureSquad && pool.length) {
      const u = this.nearest(pool, c.x, c.y);
      pool.splice(pool.indexOf(u), 1);
      squad.push(u);
    }
    this.squads.set(c.id, squad.map((u) => u.id));
    this.send({ t: 'move', p: this.player, ids: squad.map((u) => u.id), x: c.x + 0.5, y: c.y + 1.5, am: true });
  }

  /** A supply tender we can afford: walk a unit into the city's ring, then bid (up to a cap). */
  private contracts(s: MatchState) {
    const k = s.contract;
    if (!k || k.kind !== 'supply') { this.courier = 0; return; }
    const c = s.cities[k.city], hq = this.home!;
    if (Math.hypot(c.x - hq.x, c.y - hq.y) > AI_CONTRACT.range) return;
    // ours is the top bid: keep the money for when the tender closes
    const top = topBid(k);
    if (top?.p === this.player) { this.spent += top.cash; return; }
    const bid = minBid(s);
    if (bid > supplyFloor(c) * AI_CONTRACT.maxBid) return;
    // a city for the price of a few units: keep the money back from production while a unit walks there
    const cash = this.p.cash - this.spent;
    if (cash >= bid && !bidBlocked(s, this.p, c, bid)) {
      this.spent += bid;
      this.send({ t: 'contract', p: this.player, city: c.id, bid });
      return;
    }
    if (cash < bid - AI_CONTRACT.short) return;
    this.spent += Math.min(cash, bid);
    const on = this.courier ? s.ents[this.courier] : undefined;
    if (on && on.t === 'u' && on.owner === this.player) {
      if (!on.order) this.send({ t: 'move', p: this.player, ids: [on.id], x: c.x + 0.5, y: c.y + 1.5 });
      return;
    }
    if (!this.reachable(c.x, c.y + 1)) return;
    const free = this.units.filter((u) => UNITS[u.kind].layer === 'ground' && !UNITS[u.kind].builds && !this.inSquad(u.id) && !this.inWave(u.id) && !this.inFerry(u.id) && !this.garrisoned.has(u.id));
    if (!free.length) return;
    const u = this.nearest(free, c.x, c.y);
    this.courier = u.id;
    this.send({ t: 'move', p: this.player, ids: [u.id], x: c.x + 0.5, y: c.y + 1.5 });
  }

  // ---------------------------------------------------------------- defense

  /** Send nearby forces at enemies inside our territory. Returns the threat value. */
  private defense(s: MatchState): number {
    const hq = this.home!;
    const mine = s.cities.filter((c) => c.owner === this.player);
    // a merchant ship sailing past is no threat (an unarmed transport may be full of troops)
    const threats = this.foes.filter((f) => (UNITS[f.kind].weapons.length > 0 || !!UNITS[f.kind].carries) && (
      Math.hypot(f.x - hq.x, f.y - hq.y) < AI_DEFENSE.baseRadius ||
      mine.some((c) => Math.hypot(f.x - c.x, f.y - c.y) < AI_DEFENSE.cityRadius) ||
      this.buildings.some((b) => Math.hypot(f.x - b.x, f.y - b.y) < 6)));
    this.outgunned = null;
    if (!threats.length) {
      this.helpAllies(s);
      return 0;
    }
    const t = this.nearest(threats, hq.x, hq.y);
    const threatValue = threats.reduce((a, f) => a + value(f.kind), 0);
    const airRaid = threats.some((f) => UNITS[f.kind].layer === 'air');
    const defenders = this.army().filter((u) => !this.inWave(u.id) && !this.inFerry(u.id) && !this.inSquad(u.id) && UNITS[u.kind].layer !== 'naval' && (airRaid || !airOnly(u.kind)));
    // send the nearest defenders, worth about AI_DEFENSE.ratio times the threat
    defenders.sort((a, b) => Math.hypot(a.x - t.x, a.y - t.y) - Math.hypot(b.x - t.x, b.y - t.y) || a.id - b.id);
    const picked: Unit[] = [];
    let sent = 0;
    for (const u of defenders) {
      if (sent >= threatValue * AI_DEFENSE.ratio) break;
      picked.push(u);
      sent += value(u.kind);
    }
    const send = picked.filter((u) => !(u.order?.o === 'move' && u.order.am && Math.hypot(u.order.x - t.x, u.order.y - t.y) < 6));
    if (send.length) this.send({ t: 'move', p: this.player, ids: send.map((u) => u.id), x: t.x, y: t.y, am: true });
    // a big raid on the base calls the wave home
    const defValue = defenders.reduce((a, u) => a + value(u.kind), 0);
    // only a big raid on the base itself is worth calling the team for
    if (threatValue > defValue * AI_POWERS.helpOutgunned && threatValue >= AI_POWERS.helpMinValue
      && Math.hypot(t.x - hq.x, t.y - hq.y) < AI_DEFENSE.baseRadius) this.outgunned = { x: t.x, y: t.y };
    if (this.wave && threatValue > defValue * 1.2 && Math.hypot(t.x - hq.x, t.y - hq.y) < AI_DEFENSE.baseRadius) {
      const ids = this.wave.ids.filter((id) => s.ents[id]);
      this.send({ t: 'move', p: this.player, ids, x: t.x, y: t.y, am: true });
      this.wave = null;
      this.lastWave = s.tick;
    }
    return threatValue;
  }

  /** Nobody is attacking us: send some of the army to an ally nearby who is under attack. */
  private helpAllies(s: MatchState) {
    const home = this.home!;
    for (const ally of s.players) {
      if (ally.id === this.player || !ally.alive || ally.team !== this.p.team) continue;
      const base = hqOf(s, ally.id);
      if (!base || Math.hypot(base.x - home.x, base.y - home.y) > AI_DEFENSE.allyRadius) continue;
      const cities = s.cities.filter((c) => c.owner === ally.id);
      const threats = this.foes.filter((f) =>
        Math.hypot(f.x - base.x, f.y - base.y) < AI_DEFENSE.baseRadius ||
        cities.some((c) => Math.hypot(f.x - c.x, f.y - c.y) < AI_DEFENSE.cityRadius));
      if (!threats.length) continue;
      const t = this.nearest(threats, base.x, base.y);
      const threatValue = threats.reduce((a, f) => a + value(f.kind), 0);
      const helpers = this.army().filter((u) => !this.inWave(u.id) && !this.inFerry(u.id) && !this.inSquad(u.id) && !airOnly(u.kind)
        && UNITS[u.kind].layer !== 'naval' && (UNITS[u.kind].layer === 'air' || this.reachableFrom(u, t)));
      helpers.sort((a, b) => Math.hypot(a.x - t.x, a.y - t.y) - Math.hypot(b.x - t.x, b.y - t.y) || a.id - b.id);
      const picked: Unit[] = [];
      let sent = 0;
      for (const u of helpers) {
        if (sent >= threatValue * AI_DEFENSE.allyRatio) break;
        picked.push(u);
        sent += value(u.kind);
      }
      const send = picked.filter((u) => !(u.order?.o === 'move' && u.order.am && Math.hypot(u.order.x - t.x, u.order.y - t.y) < 6));
      if (send.length) this.send({ t: 'move', p: this.player, ids: send.map((u) => u.id), x: t.x, y: t.y, am: true });
      return;
    }
  }

  /** Our launch is counting down: keep infantry beside the site so nobody can scrub it. */
  private guardLaunch(s: MatchState) {
    const site = s.launch ? s.ents[s.launch.id] : null;
    if (!site || site.owner !== this.player) return;
    const r = BUILDINGS.launch.w / 2 + 1;
    const there = this.units.filter((u) => UNITS[u.kind].captures && Math.max(Math.abs(u.x - site.x), Math.abs(u.y - site.y)) <= r + 1);
    const need = AI_RESPONSE.launchGuard - there.length;
    if (need <= 0) return;
    const spare = this.army().filter((u) => UNITS[u.kind].captures && !there.includes(u) && !this.inWave(u.id) && !this.inSquad(u.id) && !this.inFerry(u.id)
      && !(u.order?.o === 'move' && Math.hypot(u.order.x - site.x, u.order.y - site.y) < r + 1) && this.reachableFrom(u, site));
    spare.sort((a, b) => Math.hypot(a.x - site.x, a.y - site.y) - Math.hypot(b.x - site.x, b.y - site.y) || a.id - b.id);
    const ids = spare.slice(0, need).map((u) => u.id);
    if (ids.length) this.send({ t: 'move', p: this.player, ids, x: site.x, y: site.y + r, am: true });
  }

  /** An ally fired a Call for Help flare: the wave (or most of the idle army) fights there while it burns. */
  private answerHelp(s: MatchState) {
    for (const fx of s.effects) {
      if (fx.k !== 'help' || fx.team !== this.p.team || fx.owner === this.player || fx.until <= s.tick) continue;
      const key = fx.owner * 1e7 + fx.until;
      if (this.answered.has(key)) continue;
      this.answered.add(key);
      const target: Target = { x: fx.x, y: fx.y, id: -1, city: false, help: fx.until };
      const go = this.army().filter((u) => !this.inWave(u.id) && !this.inSquad(u.id) && !this.inFerry(u.id) && !airOnly(u.kind)
        && UNITS[u.kind].layer !== 'naval' && (UNITS[u.kind].layer === 'air' || this.reachableFrom(u, target)));
      const ids = go.slice(0, Math.ceil(go.length * AI_DEFENSE.helpShare)).map((u) => u.id);
      // a wave turns to the flare when it is nearer than the wave's own target
      const w = this.wave;
      if (w) {
        const [cx, cy] = this.centroid(w.ids.map((id) => s.ents[id]).filter(Boolean));
        if (Math.hypot(fx.x - cx, fx.y - cy) < Math.hypot(w.target.x - cx, w.target.y - cy)) {
          w.target = target;
          w.ids.push(...ids);
          ids.splice(0, ids.length, ...w.ids);
        }
      } else if (ids.length) {
        this.wave = { target, ids, value0: Math.max(1, ids.reduce((a, id) => a + value(s.ents[id].kind), 0)), started: s.tick, go: true, need: 0, beach: null, landed: -1 };
      }
      if (ids.length) this.send({ t: 'move', p: this.player, ids, x: fx.x, y: fx.y, am: true });
      return;
    }
  }

  /** A win counting down that we must stop now: an enemy launch site (everyone is told where). */
  private emergency(s: MatchState): Target | null {
    if (!s.launch) return null;
    const site = s.ents[s.launch.id];
    if (!site || !enemies(s, this.player, site.owner)) return null;
    return { x: site.x, y: site.y, id: site.id, city: false };
  }

  /** Is this enemy team's supremacy clock running? */
  private racing(s: MatchState, owner: number): boolean {
    return owner >= 0 && enemies(s, this.player, owner) && (s.supremacy[s.players[owner].team] ?? -1) >= 0;
  }

  // ---------------------------------------------------------------- attacking

  private inWave(id: number): boolean {
    return !!this.wave && this.wave.ids.includes(id);
  }

  /**
   * Free-for-all standings from the public score: the runaway leader (an enemy team far ahead,
   * AI_RESPONSE.leaderOver, else -1) and, early on, the struggling teams to leave alone.
   */
  private standings(s: MatchState): { lead: number; weak: Set<number> } {
    const weak = new Set<number>();
    const teams = [...new Set(s.players.filter((p) => p.alive).map((p) => p.team))].sort((a, b) => a - b);
    if (teams.length < 3) return { lead: -1, weak };
    const sc = teams.map((t) => score(s, t));
    const avg = sc.reduce((a, v) => a + v, 0) / teams.length;
    let best = -1, bv = 0;
    teams.forEach((t, i) => {
      if (t === this.p.team) return;
      if (sc[i] > bv) { best = t; bv = sc[i]; }
      if (s.tick < AI_RESPONSE.preyUntil * TICK_RATE && sc[i] < avg * AI_RESPONSE.preyUnder) weak.add(t);
    });
    return { lead: best >= 0 && bv > avg * AI_RESPONSE.leaderOver ? best : -1, weak };
  }

  private chooseTarget(s: MatchState, from: [number, number]): Target | null {
    const cands: Target[] = [];
    for (const c of s.cities) if (c.owner >= 0 && enemies(s, this.player, c.owner)) cands.push({ x: c.x + 0.5, y: c.y + 0.5, id: c.id, city: true });
    // overseas neutral cities can only be taken by a landing
    if (this.island) for (const c of s.cities) if (c.owner < 0 && !this.reachable(c.x, c.y + 1)) cands.push({ x: c.x + 0.5, y: c.y + 0.5, id: c.id, city: true });
    for (const b of this.foeBuildings) cands.push({ x: b.x, y: b.y, id: b.id, city: false });
    for (const i of this.unchecked ?? []) cands.push({ x: s.map.starts[i].x, y: s.map.starts[i].y + 3, id: i, city: false, spot: true });
    // early on, nothing in an enemy's base: a player who loses a battle keeps a base to rebuild from
    const spareHq = this.sparing(s);
    if (spareHq) {
      const bases = this.enemyBases(s);
      for (let i = cands.length - 1; i >= 0; i--) {
        const t = cands[i];
        if (t.spot || bases.some(([x, y]) => Math.hypot(t.x - x, t.y - y) < AI_RESPONSE.baseRadius)) cands.splice(i, 1);
      }
    }
    // overseas targets no boat of ours could land near lately wait their turn
    if (this.island) for (let i = cands.length - 1; i >= 0; i--) if (this.cantLand(s, cands[i])) cands.splice(i, 1);
    if (!cands.length) return null;
    const { lead, weak } = this.standings(s);
    const ownerOf = (t: Target) => t.city ? s.cities[t.id].owner : t.spot ? t.id : s.ents[t.id]?.owner ?? -1;
    const score = (t: Target) => {
      const d = Math.hypot(t.x - from[0], t.y - from[1]);
      const reach = this.island || this.reachable(t.x, t.y) ? 1 : 3;
      // an exiled government is the way to finish a player off
      const capital = t.city && s.players[s.cities[t.id].owner]?.capital === t.id;
      // a team racing for supremacy has to be stopped: its cities come first
      const race = t.city && this.racing(s, s.cities[t.id].owner) ? AI_RESPONSE.supremacyMul : 1;
      // everyone turns on a runaway leader
      const o = ownerOf(t);
      const team = o >= 0 ? s.players[o].team : -1;
      const runaway = lead >= 0 && team === lead ? AI_RESPONSE.leaderMul : weak.has(team) ? AI_RESPONSE.preyMul : 1;
      // early on, raid the economy and the cities rather than go for the HQ
      const kind = !t.city && !t.spot && !t.help ? s.ents[t.id]?.kind : undefined;
      const early = spareHq && (kind === 'mine' || kind === 'derrick') ? AI_RESPONSE.econMul : 1;
      // a bounty on the leader's city: worth the trip
      const bounty = t.city && s.contract?.kind === 'liberate' && s.contract.city === t.id ? AI_CONTRACT.liberatePull : 1;
      return (d * reach) / ((capital ? 3 : t.city ? 1.4 : 1) * race * runaway * early * bounty);
    };
    return cands.sort((a, b) => score(a) - score(b) || a.id - b.id)[0];
  }

  /** Before AI_LEVELS.hqFrom, waves leave enemy bases alone. */
  private sparing(s: MatchState): boolean {
    return s.tick < this.lv.hqFrom * TICK_RATE && !this.emergency(s);
  }

  /** Where the HQs of the enemies spared early on stand (not one under siege: a last stand from `siegeFrom`). */
  private enemyBases(s: MatchState): [number, number][] {
    const out: [number, number][] = [];
    for (const p of s.players) {
      if (!p.alive || !enemies(s, this.player, p.id) || (p.lastStand && s.tick >= this.lv.siegeFrom * TICK_RATE)) continue;
      const hq = hqOf(s, p.id);
      if (hq) out.push([hq.x, hq.y]);
    }
    return out;
  }

  private cantLand(s: MatchState, t: Target): boolean {
    const at = this.noLanding.get(targetKey(t));
    return at !== undefined && s.tick - at < AI_NAVAL.noLandingFor * TICK_RATE;
  }

  private targetAlive(s: MatchState, t: Target): boolean {
    if (t.spot) return !!this.unchecked?.includes(t.id);
    // an ally's flare: until it burns out
    if (t.help) return s.tick < t.help;
    if (t.city) {
      const c = s.cities[t.id];
      return c.owner < 0 || enemies(s, this.player, c.owner);
    }
    return !!s.ents[t.id];
  }

  private rally(): [number, number] {
    const hq = this.home!;
    const foe = this.foeBuildings.find((b) => b.kind === 'hq') ?? this.unchecked?.map((i) => this.startOf(i)).sort((a, b) => Math.hypot(a.x - hq.x, a.y - hq.y) - Math.hypot(b.x - hq.x, b.y - hq.y))[0];
    if (!foe) return [hq.x, hq.y + 5];
    const dx = foe.x - hq.x, dy = foe.y - hq.y, d = Math.hypot(dx, dy) || 1;
    return [hq.x + (dx / d) * 9, hq.y + (dy / d) * 9];
  }

  private starts: { x: number; y: number }[] = [];
  private startOf(i: number) {
    return this.starts[i];
  }

  /** One fast unit visits start spots nobody has seen yet. */
  /** Idle warships go after enemy merchant ships they can see and reach (convoy raiding). */
  private raid(s: MatchState) {
    const prey = this.foes.filter((f) => f.kind === CONVOY.kind);
    if (!prey.length) return;
    const n = this.n;
    for (const u of this.units) {
      const d = UNITS[u.kind];
      if (d.layer !== 'naval' || !d.weapons.length || u.order || u.tgt || this.inWave(u.id) || this.inFerry(u.id)) continue;
      const comp = compOf(n, 'naval', Math.floor(u.x), Math.floor(u.y));
      const m = this.nearest(prey.filter((f) => Math.hypot(f.x - u.x, f.y - u.y) <= AI_NAVAL.raidRange
        && compOf(n, 'naval', Math.floor(f.x), Math.floor(f.y)) === comp), u.x, u.y);
      if (m) this.send({ t: 'attack', p: this.player, ids: [u.id], target: m.id });
    }
  }

  private scout(s: MatchState) {
    this.starts = s.map.starts;
    if (s.tick < AI_SCOUT.from * TICK_RATE || !this.unchecked?.length) return;
    const cur = s.ents[this.scoutId] as Unit | undefined;
    if (cur && cur.owner === this.player && cur.order) return;
    let u = cur && cur.owner === this.player ? cur : undefined;
    for (const kind of AI_SCOUT.kinds) {
      if (u) break;
      u = this.units.find((k) => k.kind === kind && !k.order && !this.inSquad(k.id) && !this.inWave(k.id) && !this.inFerry(k.id));
    }
    if (!u) return;
    const spots = this.unchecked.map((i) => s.map.starts[i]).filter((st) => this.island || this.reachableFrom(u!, st));
    if (!spots.length) return;
    const st = spots.sort((a, b) => Math.hypot(a.x - u!.x, a.y - u!.y) - Math.hypot(b.x - u!.x, b.y - u!.y))[0];
    this.scoutId = u.id;
    this.send({ t: 'move', p: this.player, ids: [u.id], x: st.x, y: st.y + 4 });
  }

  /** The exchange: oil when short, science from a surplus, cash from spare oil. */
  private trade(s: MatchState) {
    const p = this.p;
    const cash = p.cash - this.spent - this.saving;
    const capped = supplyUsed(s, this.player) >= Math.min(this.lv.maxSupply, supplyCap(s, this.player)) - 2;
    const id = p.oil < AI_TRADE.lowOil && cash > AI_TRADE.buyOilCash ? 'buyOil'
      : capped && cash > AI_TRADE.fundCash ? 'fundResearch'
      : p.oil > AI_TRADE.sellOilAbove && cash < AI_TRADE.lowCash ? 'sellOil' : null;
    if (id && !tradeBlocked(s, p, id)) this.send({ t: 'trade', p: this.player, trade: id });
  }

  private attack(s: MatchState, threat: number) {
    // fighters stay home to guard the sky; they'd only hover over a ground fight
    const army = this.army().filter((u) => !this.inSquad(u.id) && !this.inFerry(u.id) && u.kind !== 'transport' && !airOnly(u.kind));
    const minutes = this.minutes(s);
    // an enemy launch beats everything else: every unit goes, nobody retreats
    const urgent = this.emergency(s);
    const used = supplyUsed(s, this.player), cap = Math.min(supplyCap(s, this.player), this.lv.maxSupply);
    if (used >= cap * AI_RESPONSE.maxedShare) { if (this.maxedSince < 0) this.maxedSince = s.tick; }
    else this.maxedSince = -1;
    const maxed = this.maxedSince >= 0 && s.tick - this.maxedSince >= AI_RESPONSE.maxedWave * TICK_RATE;
    if (this.wave) {
      const w = this.wave;
      w.ids = w.ids.filter((id) => s.ents[id]?.owner === this.player);
      if (urgent && w.target.id !== urgent.id) {
        w.target = urgent;
        if (w.ids.length) this.send({ t: 'move', p: this.player, ids: w.ids, x: urgent.x, y: urgent.y, am: true });
      }
      const v = w.ids.reduce((a, id) => a + value(s.ents[id].kind), 0);
      w.value0 = Math.max(w.value0, v);
      // overseas there's no walking home: when too few are left ashore to win, the landing falls back
      // to its beach and waits for the boats to bring the next push (not a trickle into the guns)
      const beach = w.beach;
      if (this.island && w.go && !urgent && beach) {
        const back = w.ids.filter((id) => UNITS[s.ents[id].kind].layer === 'ground' && this.reachableFrom(s.ents[id] as Unit, { x: beach[0], y: beach[1] }));
        if (back.length && back.reduce((a, id) => a + value(s.ents[id].kind), 0) < w.need * AI_NAVAL.beachRetreat) {
          w.go = false;
          w.landed = s.tick;
          w.regroup = true;
          this.send({ t: 'move', p: this.player, ids: back, x: beach[0], y: beach[1] });
          return;
        }
      }
      // across the sea, troops arrive by ferry: an empty wave waits for them a while
      const waiting = this.island && !w.ids.length && s.tick - w.started < AI_NAVAL.waveWait * TICK_RATE;
      if ((!w.ids.length && !waiting) || (!urgent && !(this.island && beach) && v < w.value0 * this.lv.retreatAt)) {
        const [rx, ry] = this.rally();
        if (w.ids.length) this.send({ t: 'move', p: this.player, ids: w.ids, x: rx, y: ry });
        this.wave = null;
        this.lastWave = s.tick;
        return;
      }
      if (!this.targetAlive(s, w.target)) {
        const c = this.centroid(w.ids.map((id) => s.ents[id]));
        const next = this.chooseTarget(s, c);
        if (!next) {
          // nothing left to hit (an HQ spared early on, say): home
          const [rx, ry] = this.rally();
          if (w.ids.length) this.send({ t: 'move', p: this.player, ids: w.ids, x: rx, y: ry });
          this.wave = null;
          this.lastWave = s.tick;
          return;
        }
        w.target = next;
        // the next boat finds a beach near the new target
        w.beach = null;
      }
      // a landing waits on the beach until enough troops are ashore, so they don't arrive one boat at a time
      if (!w.go) {
        // nobody got ashore (no beach our boats can reach, say): give up and try somewhere else
        if (w.landed < 0 && (this.cantLand(s, w.target) || s.tick - w.started > AI_NAVAL.landWait * TICK_RATE)) {
          this.noLanding.set(targetKey(w.target), s.tick);
          const [rx, ry] = this.rally();
          if (w.ids.length) this.send({ t: 'move', p: this.player, ids: w.ids, x: rx, y: ry });
          this.wave = null;
          this.lastWave = s.tick;
          return;
        }
        const ashore = w.ids.map((id) => s.ents[id] as Unit).filter((u) => UNITS[u.kind].layer === 'ground' && this.reachableFrom(u, w.target));
        const landed = ashore.reduce((a, u) => a + value(u.kind), 0);
        const wait = AI_NAVAL.beachWait * (w.regroup ? AI_NAVAL.regroupWait : 1);
        if (landed >= w.need * AI_NAVAL.beachhead || (w.landed >= 0 && s.tick - w.landed > wait * TICK_RATE)) {
          w.go = true;
          const ids = w.ids.filter((id) => UNITS[s.ents[id].kind].layer !== 'naval');
          if (ids.length) this.send({ t: 'move', p: this.player, ids, x: w.target.x, y: w.target.y, am: true });
        } else {
          const b = w.beach;
          const stray = b ? ashore.filter((u) => !u.order && !u.tgt && Math.hypot(u.x - b[0], u.y - b[1]) > AI_NAVAL.beachRadius) : [];
          if (stray.length) this.send({ t: 'move', p: this.player, ids: stray.map((u) => u.id), x: b![0], y: b![1], am: true });
          return;
        }
      }
      // keep idle wave units moving on the target
      const idle = w.ids.map((id) => s.ents[id] as Unit).filter((u) => !u.order && !u.tgt && !(this.island && UNITS[u.kind].layer === 'ground' && !this.reachableFrom(u, w.target)));
      if (idle.length) {
        const t = w.target;
        const b = !t.city && !t.spot ? s.ents[t.id] : null;
        const close = idle.filter((u) => b && Math.hypot(u.x - t.x, u.y - t.y) < 12 && UNITS[u.kind].weapons.some((wp) => wp.hits.includes('ground')));
        if (close.length && b) this.send({ t: 'attack', p: this.player, ids: close.map((u) => u.id), target: b.id });
        const rest = idle.filter((u) => !close.includes(u));
        if (rest.length) this.send({ t: 'move', p: this.player, ids: rest.map((u) => u.id), x: t.x, y: t.y + (t.city ? 1 : 0), am: true });
      }
      // reinforcements join the wave
      const fresh = army.filter((u) => !w.ids.includes(u.id) && !u.order && (UNITS[u.kind].layer !== 'ground' || !this.island));
      // (an early raid stays a raid: no reinforcements past its value)
      const raid = !urgent && s.tick < this.lv.earlyUntil * TICK_RATE && v >= this.lv.earlyWave;
      if (fresh.length && !raid && (urgent || (fresh.length >= 4 && !threat))) {
        w.ids.push(...fresh.map((u) => u.id));
        this.send({ t: 'move', p: this.player, ids: fresh.map((u) => u.id), x: w.target.x, y: w.target.y, am: true });
      }
      return;
    }
    // idle army gathers at the rally point
    const [rx, ry] = this.rally();
    const loose = army.filter((u) => !u.order && !u.tgt && Math.hypot(u.x - rx, u.y - ry) > 8 && UNITS[u.kind].layer !== 'naval');
    if (loose.length && !threat && !urgent) this.send({ t: 'move', p: this.player, ids: loose.map((u) => u.id), x: rx, y: ry });
    if (threat && !urgent) return;
    if (!urgent && s.tick < this.lv.firstAttack * TICK_RATE * this.plan.aggression) return;
    if (!urgent && s.tick - this.lastWave < 45 * TICK_RATE) return;
    const v = army.reduce((a, u) => a + value(u.kind), 0);
    const target = urgent ?? this.chooseTarget(s, [this.home!.x, this.home!.y]);
    if (!target) return;
    const neutral = target.city && s.cities[target.id].owner < 0;
    const race = target.city && this.racing(s, s.cities[target.id].owner) ? AI_RESPONSE.waveMul : 1;
    const need = (this.lv.waveValue + this.lv.waveGrowth * minutes) * this.plan.aggression * (this.island ? AI_NAVAL.waveMul : 1) * (neutral ? AI_NAVAL.expandMul : 1) * race;
    const full = used >= cap * 0.85;
    if (!urgent && !maxed && v < need && !(full && v > need * 0.5)) return;
    let ids = army.filter((u) => !this.island || UNITS[u.kind].layer !== 'ground' || this.reachableFrom(u, target)).map((u) => u.id);
    // early waves are raids: the ones nearest the target go, up to a value; the rest stay home
    if (!urgent && s.tick < this.lv.earlyUntil * TICK_RATE) {
      const near = ids.map((id) => s.ents[id]).sort((a, b) => Math.hypot(a.x - target.x, a.y - target.y) - Math.hypot(b.x - target.x, b.y - target.y) || a.id - b.id);
      let v = 0;
      ids = near.filter((u) => (v += value(u.kind)) - value(u.kind) < this.lv.earlyWave).map((u) => u.id);
    }
    if (!ids.length && !this.island) return;
    // overseas: the aircraft wait for the landing, and only the warships set off now
    const go = !this.island || !!urgent || this.reachable(target.x, target.y);
    this.wave = { target, ids, value0: Math.max(1, ids.reduce((a, id) => a + value(s.ents[id].kind), 0)), started: s.tick, go, need, beach: null, landed: -1 };
    const now = go ? ids : ids.filter((id) => UNITS[s.ents[id].kind].layer === 'naval');
    if (now.length) this.send({ t: 'move', p: this.player, ids: now, x: target.x, y: target.y, am: true });
  }

  private reachableFrom(u: Unit, t: { x: number; y: number }): boolean {
    const n = this.n;
    const c = compOf(n, 'ground', Math.floor(u.x), Math.floor(u.y));
    for (let r = 0; r <= 3; r++)
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          const tx = Math.floor(t.x) + dx, ty = Math.floor(t.y) + dy;
          if (passable(n, 'ground', tx, ty) && compOf(n, 'ground', tx, ty) === c) return true;
        }
    return false;
  }

  private centroid(es: Ent[]): [number, number] {
    let x = 0, y = 0;
    for (const e of es) { x += e.x; y += e.y; }
    return es.length ? [x / es.length, y / es.length] : [this.home!.x, this.home!.y];
  }

  // ---------------------------------------------------------------- by sea

  private ferry(s: MatchState) {
    const transports = this.units.filter((u) => UNITS[u.kind].carries);
    const dock = this.seaDocks().find((b) => b.built >= 1);
    for (const id of [...this.ferries.keys()]) if (!s.ents[id]) this.ferries.delete(id);
    const target = this.wave?.target ?? null;
    // ferries load beside the dock
    const berth = dock ? nearestPassable(this.n, 'naval', Math.floor(dock.x), Math.floor(dock.y), 6) : null;
    const home = (t: Unit) => !!berth && Math.hypot(t.x - berth[0] - 0.5, t.y - berth[1] - 0.5) < 6;
    const goHome = (t: Unit) => { if (berth) this.send({ t: 'move', p: this.player, ids: [t.id], x: berth[0] + 0.5, y: berth[1] + 0.5 }); };
    for (const t of transports) {
      const f = this.ferries.get(t.id);
      const cap = UNITS[t.kind].carries!;
      if (!f) {
        if (!target || !dock || !berth) continue;
        if (!home(t)) { if (!t.order) goHome(t); continue; }
        // pick up the nearest ground troops that can walk to the dock but not to the target
        const riders = this.army().filter((u) => UNITS[u.kind].layer === 'ground' && !this.inSquad(u.id) && !this.inFerry(u.id) && !this.reachableFrom(u, target) && compOf(this.n, 'ground', Math.floor(u.x), Math.floor(u.y)) === this.homeComp);
        riders.sort((a, b) => Math.hypot(a.x - t.x, a.y - t.y) - Math.hypot(b.x - t.x, b.y - t.y) || a.id - b.id);
        const pick: number[] = [];
        let room = cap;
        for (const u of riders) {
          if (UNITS[u.kind].supply > room) continue;
          pick.push(u.id);
          room -= UNITS[u.kind].supply;
        }
        if (cap - room < Math.min(4, cap)) continue;
        // every boat of a waiting landing uses the same beach
        const w = this.wave;
        const dest = (w && !w.go && w.beach) || this.landing(s, target, t);
        if (!dest) { this.noLanding.set(targetKey(target), s.tick); continue; }
        if (w && !w.beach) w.beach = dest;
        this.ferries.set(t.id, { phase: 'load', ids: pick, since: s.tick, dest });
        this.send({ t: 'load', p: this.player, ids: pick, target: t.id });
        continue;
      }
      if (f.phase === 'load') {
        const aboard = cargoSupply(s, t);
        const waiting = f.ids.filter((id) => s.ents[id] && !(s.ents[id] as Unit).inside);
        // a loaded ferry waits for its escorts (a while): warships for every ferry at sea
        const warships = this.units.filter((u) => UNITS[u.kind].layer === 'naval' && UNITS[u.kind].weapons.length).length;
        const sailing = [...this.ferries.values()].filter((o) => o.phase === 'sail').length;
        const escorted = warships >= AI_NAVAL.escorts * (sailing + 1) || s.tick - f.since > AI_NAVAL.escortWait * TICK_RATE;
        if (escorted && (aboard >= cap - 1 || !waiting.length || s.tick - f.since > 40 * TICK_RATE)) {
          if (!aboard) { this.ferries.delete(t.id); continue; }
          f.phase = 'sail';
          f.since = s.tick;
          this.send({ t: 'unload', p: this.player, ids: [t.id], x: f.dest[0], y: f.dest[1] });
        }
      } else if (f.phase === 'sail') {
        if (!t.cargo.length) {
          const landed = f.ids.filter((id) => s.ents[id] && !(s.ents[id] as Unit).inside);
          if (target && landed.length) {
            const w = this.wave;
            // a waiting landing holds the beach; otherwise straight on
            if (w && !w.go) { if (w.landed < 0) w.landed = s.tick; }
            else this.send({ t: 'move', p: this.player, ids: landed, x: target.x, y: target.y, am: true });
            w?.ids.push(...landed);
          }
          f.phase = 'back';
          f.ids = [];
          f.since = s.tick;
          goHome(t);
        } else if (!t.order && s.tick - f.since > 20 * TICK_RATE) {
          this.send({ t: 'unload', p: this.player, ids: [t.id], x: f.dest[0], y: f.dest[1] });
          f.since = s.tick;
        }
      } else if (f.phase === 'back') {
        if (home(t) || s.tick - f.since > 90 * TICK_RATE) this.ferries.delete(t.id);
        else if (!t.order) goHome(t);
      }
    }
  }

  /**
   * A beach near the target that our ships can reach, on the target's own island, and out of reach
   * of the enemy guns we know about (if there is no such beach, the nearest one under fire).
   */
  private landing(s: MatchState, target: Target, boat: Unit): [number, number] | null {
    const n = this.n, w = s.map.w;
    const sea = compOf(n, 'naval', Math.floor(boat.x), Math.floor(boat.y));
    const tx = Math.floor(target.x), ty = Math.floor(target.y);
    const land = this.groundCompNear(target.x, target.y);
    const guns = this.foeBuildings.filter((b) => BUILDINGS[b.kind].weapons?.some((wp) => wp.hits.includes('ground')))
      .map((b) => ({ x: b.x, y: b.y, r: Math.max(...BUILDINGS[b.kind].weapons!.map((wp) => wp.range)) + AI_NAVAL.landingClear }));
    let fallback: [number, number] | null = null;
    for (let r = 1; r <= 40; r++)
      for (let i = -r; i <= r; i++)
        for (const [dx, dy] of [[i, -r], [i, r], [-r, i], [r, i]] as [number, number][]) {
          const x = tx + dx, y = ty + dy;
          if (!passable(n, 'ground', x, y) || (land >= 0 && compOf(n, 'ground', x, y) !== land)) continue;
          for (const [ax, ay] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            if (!passable(n, 'naval', x + ax, y + ay) || n.compNaval[(y + ay) * w + x + ax] !== sea) continue;
            if (!guns.some((g) => Math.hypot(g.x - x - 0.5, g.y - y - 0.5) < g.r)) return [x + 0.5, y + 0.5];
            fallback ??= [x + 0.5, y + 0.5];
          }
        }
    return fallback;
  }

  /** The ground area at or just beside (x, y) (a building's own tiles aren't walkable), or -1. */
  private groundCompNear(x: number, y: number): number {
    for (let r = 0; r <= 3; r++)
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          const tx = Math.floor(x) + dx, ty = Math.floor(y) + dy;
          if (passable(this.n, 'ground', tx, ty)) return compOf(this.n, 'ground', tx, ty);
        }
    return -1;
  }

  // ---------------------------------------------------------------- powers and abilities

  private ready(s: MatchState, id: PowerId): boolean {
    const def = POWERS[id];
    return this.p.era >= def.era && this.p.cp >= powerCost(this.p, id) && (this.p.powerReady[id] ?? 0) <= s.tick;
  }

  private powers(s: MatchState) {
    const p = this.p;
    if (this.ready(s, 'supplyDrop') && s.tick >= AI_POWERS.supplyDropAfter * TICK_RATE
      && (p.cash < AI_POWERS.supplyDropCash || supplyDropCash(s, this.player) >= AI_POWERS.supplyDropWorth)) {
      this.send({ t: 'power', p: this.player, power: 'supplyDrop' });
      return;
    }
    // too big a raid: call our allies (they see the flare; allied AIs answer it)
    if (this.outgunned && this.ready(s, 'help') && s.tick - this.calledHelp >= AI_POWERS.helpGap * TICK_RATE && s.players.some((o) => o.id !== this.player && o.alive && o.team === p.team)) {
      this.send({ t: 'power', p: this.player, power: 'help', x: this.outgunned.x, y: this.outgunned.y });
      this.calledHelp = s.tick;
      return;
    }
    const urgent = this.emergency(s);
    if (urgent) {
      const seen = tileVisible(s, p.team, urgent.x, urgent.y);
      // riflemen dropped beside a launch site scrub it (SCRUB)
      const beside = urgent.y + BUILDINGS.launch.h / 2 + 1;
      if (tileVisible(s, p.team, urgent.x, beside) && this.ready(s, 'paradrop')) { this.send({ t: 'power', p: this.player, power: 'paradrop', x: urgent.x, y: beside }); return; }
      if (seen && this.ready(s, 'strike')) { this.send({ t: 'power', p: this.player, power: 'strike', x: urgent.x, y: urgent.y }); return; }
      if (!seen && this.ready(s, 'recon')) { this.send({ t: 'power', p: this.player, power: 'recon', x: urgent.x, y: urgent.y }); return; }
    }
    // an enemy start nobody can walk to: fly a recon over it to find the HQ
    if (this.island && this.unchecked?.length && s.tick >= AI_SCOUT.from * TICK_RATE && this.ready(s, 'recon')) {
      const st = s.map.starts[this.unchecked[0]];
      this.send({ t: 'power', p: this.player, power: 'recon', x: st.x, y: st.y });
      return;
    }
    if (this.ready(s, 'strike')) {
      for (const f of this.foes) {
        let n = 0, own = 0;
        for (const g of this.foes) if (Math.hypot(g.x - f.x, g.y - f.y) < 3) n++;
        for (const u of this.units) if (Math.hypot(u.x - f.x, u.y - f.y) < 4) own++;
        if (n >= AI_POWERS.strikeClump && !own) { this.send({ t: 'power', p: this.player, power: 'strike', x: f.x, y: f.y }); return; }
      }
    }
    if (this.ready(s, 'repair')) {
      const hurt = this.buildings.filter((b) => b.built >= 1 && b.hp < buildingMaxHp(s, b) * (1 - AI_POWERS.repairMissing));
      if (hurt.length) {
        const b = hurt.sort((a, c) => a.hp / buildingMaxHp(s, a) - c.hp / buildingMaxHp(s, c) || a.id - c.id)[0];
        this.send({ t: 'power', p: this.player, power: 'repair', x: b.x, y: b.y });
        return;
      }
    }
    if (this.wave && this.ready(s, 'rally')) {
      const fighting = this.wave.ids.map((id) => s.ents[id] as Unit).filter((u) => u && u.tgt);
      if (fighting.length >= 5) {
        const [x, y] = this.centroid(fighting);
        this.send({ t: 'power', p: this.player, power: 'rally', x, y });
        return;
      }
    }
    if (this.wave && this.ready(s, 'paradrop') && p.cp >= POWERS.paradrop.cost + 1) {
      const t = this.wave.target;
      // the drop point itself must be seen (a city's middle can be in sight while 2 tiles below isn't)
      if (tileVisible(s, p.team, t.x, t.y + 2)) { this.send({ t: 'power', p: this.player, power: 'paradrop', x: t.x, y: t.y + 2 }); return; }
    }
    if (this.wave && this.ready(s, 'recon') && p.cp >= 6) {
      const t = this.wave.target;
      if (!tileVisible(s, p.team, t.x, t.y)) this.send({ t: 'power', p: this.player, power: 'recon', x: t.x, y: t.y });
    }
  }

  private abilities(s: MatchState) {
    const use: number[] = [];
    for (const u of this.units) {
      const ab = UNITS[u.kind].ability;
      if (!ab || s.tick < u.abReady || !u.tgt) continue;
      if (ab === 'smoke' && u.hp < unitMaxHp(s, u) * 0.5) use.push(u.id);
      else if (ab === 'barrage' || ab === 'sonar' || ab === 'afterburner') use.push(u.id);
    }
    if (use.length) this.send({ t: 'ability', p: this.player, ids: use });
  }
}


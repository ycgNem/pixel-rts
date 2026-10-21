// Title screen (with an AI-vs-AI battle running behind it), the skirmish setup screen (which is
// also the online lobby), and the "play online" screen.
import type { MatchSetup, PlayerSetup, AiDifficulty, AiPersonality, GameMap } from '../sim/types';
import { MAPGEN, VICTORY, type MapSize, type MapType } from '../data/rules';
import { timeLimitOf } from '../sim/victory';
import { FieldGuide } from '../ui/guide';
import { TEAM_COLORS, PALETTE_RGB } from '../data/palette';
import { TERRAIN } from '../data/terrain';
import { createMatch } from '../sim/match';
import { generateMap } from '../sim/mapgen';
import { createAi } from '../sim/ai';
import { HostSession, type Session } from '../net/session';
import { LobbyClient, LobbyHost, MAX_PLAYERS, type Lobby } from '../net/online';
import { joinOnline, newRoomCode } from '../net/transport';
import { makeCanvas } from '../render/pixbuf';
import { NEUTRAL_UI } from '../render/colors';
import { drawText, textWidth, ellipsize } from '../ui/font';
import { COL } from '../ui/ui';
import { MatchScreen } from './match';
import { describeSave, readSave, type SaveFile } from './saves';
import type { App, Screen } from './app';

const GAME_TITLE = 'PIXEL RTS';
const SETUP_KEY = 'pixel-rts.setup.v1';
/** set once Boot Camp has been started: until then the title screen points new players at it */
const BOOT_CAMP_KEY = 'pixel-rts.bootcamp';
const NAME_KEY = 'pixel-rts.name';
/** a private random id for this browser: lets a player who reloads take their online seat back */
const ID_KEY = 'pixel-rts.id';

/** Pick up a saved match as an offline host: other people's seats are played by Normal AIs. */
function resumeSession(f: SaveFile): HostSession {
  const s = f.state;
  s.setup.players.forEach((p, i) => {
    if (i !== f.me && p.kind === 'human') { p.kind = 'ai'; p.ai = { difficulty: 'normal' }; }
  });
  const ais = s.setup.players.map((p, i) => (p.kind === 'ai' ? createAi(s, i, p.ai?.difficulty ?? 'normal', p.ai?.personality) : null)).filter((a) => a !== null);
  return new HostSession(s, f.me, ais);
}

function startSession(setup: MatchSetup, me: number): HostSession {
  const s = createMatch(setup);
  const ais = s.setup.players.map((p, i) => (p.kind === 'ai' ? createAi(s, i, p.ai?.difficulty ?? 'normal', p.ai?.personality) : null)).filter((a) => a !== null);
  return new HostSession(s, me, ais);
}

function demoSetup(): MatchSetup {
  const names = ['Ash', 'Brine', 'Cobalt', 'Dune'];
  return {
    seed: (Math.random() * 1e9) | 0, mapType: 'pangaea', mapSize: 'small', fog: 'off',
    victory: { conquest: true, supremacy: false, science: false }, timeLimit: 0, weather: true, crates: true, startMul: 2,
    players: names.map((name, i) => ({ name, team: i, color: i, kind: 'ai' as const, ai: { difficulty: 'normal' as AiDifficulty, personality: 'random' as const } })),
  };
}

/** kept per tab (sessionStorage): it survives a reload, but two tabs get different seats */
function playerToken(): string {
  let id: string | null = null;
  try { id = sessionStorage.getItem(ID_KEY); } catch { /* no storage */ }
  if (!id) {
    id = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('');
    try { sessionStorage.setItem(ID_KEY, id); } catch { /* no storage: no rejoin after a reload */ }
  }
  return id;
}

const store = {
  get(k: string): string | null {
    try { return localStorage.getItem(k); } catch { return null; }
  },
  set(k: string, v: string) {
    try { localStorage.setItem(k, v); } catch { /* no storage */ }
  },
};

export class TitleScreen implements Screen {
  private bg: MatchScreen;
  private t = 0;
  /** what "Continue" would load ('' = no save) */
  private saved = '';
  /** the Field Guide, while it is open */
  private guide: FieldGuide | null = null;

  constructor(private app: App) {
    const sess = startSession(demoSetup(), 0);
    this.bg = new MatchScreen(app, sess, { demo: true });
    app.loop.speed = 1;
    const f = readSave();
    if (f) this.saved = describeSave(f);
    // a shared link (?room=CODE) goes straight to joining
    const room = new URLSearchParams(location.search).get('room');
    if (room) queueMicrotask(() => app.show(new OnlineScreen(app, room)));
  }

  tick() {
    this.bg.tick();
    // restart the demo when it ends
    if (this.bg.session.state.over && this.bg.session.state.tick - this.bg.session.state.over.tick > 200) {
      this.bg.dispose();
      this.bg = new MatchScreen(this.app, startSession(demoSetup(), 0), { demo: true });
    }
  }

  frame(dt: number, alpha: number) {
    const app = this.app, ui = app.ui, ctx = app.ctx;
    this.t += dt;
    this.bg.frame(dt, alpha);
    ui.begin(ctx, app.input, app.uiScale);
    ctx.fillStyle = 'rgba(26,20,32,0.45)';
    ctx.fillRect(0, 0, app.canvas.width, app.canvas.height);
    // the Field Guide covers the menu while it is open
    if (this.guide) {
      if (!this.guide.draw(ui, this.t)) this.guide = null;
      ui.end();
      return;
    }
    const k = ui.s;
    const big = k * 5;
    const tw = textWidth(GAME_TITLE) * big;
    const ty = Math.round(ui.h * 0.22) * k;
    drawText(ctx, GAME_TITLE, Math.round((app.canvas.width - tw) / 2), ty, '#f9c22b', big, '#2e222f');
    ui.textCenter('Command armies. Capture cities. Out-think your rivals.', ui.w / 2, ui.h * 0.22 + 42, COL.text);
    const bw = 140, bx = Math.round(ui.w / 2 - bw / 2);
    let by = Math.round(ui.h * 0.5) - (this.saved ? 24 : 0);
    if (this.saved) {
      if (ui.button(bx, by, bw, 20, { label: 'Continue', tip: `Continue your saved game:\n${this.saved}`, color: COL.gold })) {
        const f = readSave();
        if (f) play(app, resumeSession(f));
        else this.saved = '';
      }
      by += 24;
    }
    if (ui.button(bx, by, bw, 20, { label: 'Skirmish vs AI', hotkey: 'Enter' })) app.show(new SetupScreen(app));
    by += 24;
    if (ui.button(bx, by, bw, 20, { label: 'Play online', tip: 'Co-op or versus with friends, peer to peer.\nHost a game and share the code, or join one.' })) app.show(new OnlineScreen(app));
    by += 24;
    if (ui.button(bx, by, bw, 20, { label: 'Quick battle', tip: 'You and an AI ally vs two AI rivals.' })) {
      const setup = loadSetup();
      setup.seed = (Math.random() * 1e9) | 0;
      setup.players = presetPlayers('2v2');
      launch(app, setup);
    }
    by += 24;
    // new here? Boot Camp is lit up until it's been tried
    const fresh = !store.get(BOOT_CAMP_KEY);
    if (ui.button(bx, by, bw, 20, {
      label: fresh ? 'Boot Camp - new? start here' : 'Boot Camp', color: fresh ? COL.gold : undefined,
      tip: 'Tutorial: a first match against an Easy AI,\nwith one step at a time to learn the game.',
    })) {
      store.set(BOOT_CAMP_KEY, '1');
      play(app, startSession(tutorialSetup(), 0), { tutorial: true });
    }
    by += 24;
    if (ui.button(bx, by, bw, 20, { label: 'Field Guide', hotkey: 'KeyG', tip: 'Every unit and building:\nwhat it costs, what it does, and what it beats.' })) this.guide = new FieldGuide();
    // a plate behind the credit line keeps it readable over dark mountains
    const credit = 'An original game inspired by classic Roblox RTS games.';
    ctx.fillStyle = 'rgba(26,20,32,0.7)';
    ctx.fillRect(Math.round((ui.w / 2 - textWidth(credit) / 2 - 4) * k), (ui.h - 17) * k, (textWidth(credit) + 8) * k, 13 * k);
    ui.textCenter(credit, ui.w / 2, ui.h - 14, COL.text);
    ui.end();
  }

  dispose() {
    this.bg.dispose();
  }
}

// ---------------------------------------------------------------- setup

type PresetKind = '1v1' | '2v2' | '3v3' | 'ffa4' | 'ffa6' | 'coop';

function presetPlayers(kind: PresetKind): PlayerSetup[] {
  const you: PlayerSetup = { name: 'You', team: 0, color: 0, kind: 'human' };
  const ai = (name: string, team: number, color: number, difficulty: AiDifficulty = 'normal', personality: AiPersonality | 'random' | undefined = 'random'): PlayerSetup => ({ name, team, color, kind: 'ai', ai: { difficulty, personality } });
  switch (kind) {
    case '1v1': return [you, ai('General Rust', 1, 1)];
    // allies get a warm color far from the enemies' (yellow beside blue; red and purple across)
    case '2v2': return [you, ai('Ally Gold', 0, 2), ai('General Rust', 1, 1), ai('Admiral Plum', 1, 3)];
    case '3v3': return [you, ai('Ally Gold', 0, 2), ai('Ally Teal', 0, 4), ai('General Rust', 1, 1), ai('Admiral Plum', 1, 3), ai('Major Rose', 1, 5)];
    case 'ffa4': return [{ ...you }, ai('General Rust', 1, 1), ai('Marshal Gold', 2, 2), ai('Admiral Plum', 3, 3)];
    case 'ffa6': return [{ ...you }, ai('General Rust', 1, 1), ai('Marshal Gold', 2, 2), ai('Admiral Plum', 3, 3), ai('Colonel Teal', 4, 4), ai('Major Rose', 5, 5)];
    case 'coop': return [you, ai('Ally Gold', 0, 2), ai('General Rust', 1, 1, 'hard'), ai('Admiral Plum', 1, 3, 'hard'), ai('Baron Frost', 1, 5, 'hard')];
  }
}

function defaultSetup(): MatchSetup {
  return {
    seed: (Math.random() * 1e9) | 0, mapType: 'pangaea', mapSize: 'small', fog: 'on',
    victory: { conquest: true, supremacy: true, science: true }, timeLimit: -1, weather: true, crates: true, startMul: 1,
    // a first skirmish is against an Easy AI; the setup remembers whatever the player picks after
    players: presetPlayers('1v1').map((p) => (p.ai ? { ...p, ai: { ...p.ai, difficulty: 'easy' as AiDifficulty } } : p)),
  };
}

function loadSetup(): MatchSetup {
  const raw = store.get(SETUP_KEY);
  if (raw) try { return { ...defaultSetup(), ...JSON.parse(raw) }; } catch { /* bad data */ }
  return defaultSetup();
}

function saveSetup(s: MatchSetup) {
  store.set(SETUP_KEY, JSON.stringify(s));
}

function launch(app: App, setup: MatchSetup) {
  saveSetup(setup);
  const me = setup.players.findIndex((p) => p.kind === 'human');
  const sess = startSession(setup, Math.max(0, me));
  play(app, sess);
}

/** Start a skirmish straight away (the e2e scripts and the console use this). */
export function quickMatch(app: App, over: Partial<MatchSetup> = {}) {
  launch(app, { ...defaultSetup(), ...over });
}

function play(app: App, sess: Session, opts: { tutorial?: boolean; online?: boolean } = {}) {
  app.show(new MatchScreen(app, sess, {
    tutorial: opts.tutorial,
    onQuit: () => app.show(new TitleScreen(app)),
    // the same setup again; a new map gets a new seed (offline only: a rematch with friends goes
    // back through the lobby, so everyone gets the new start)
    onRematch: opts.online ? undefined : (sameMap) => {
      const setup = structuredClone(sess.state.setup);
      if (!sameMap) setup.seed = (Math.random() * 1e9) | 0;
      play(app, startSession(setup, sess.me), opts);
    },
  }));
}

/** Boot Camp: a small map picked for ore, oil and a city close to your start, and an Easy AI. */
function tutorialSetup(): MatchSetup {
  return {
    seed: 274, mapType: 'pangaea', mapSize: 'small', fog: 'on',
    // (no city contracts: the lesson has its own goals)
    victory: { conquest: true, supremacy: true, science: true }, timeLimit: 0, weather: false, crates: true, startMul: 1.5, contracts: false,
    players: [
      { name: 'You', team: 0, color: 0, kind: 'human' },
      { name: 'Sergeant Rook', team: 1, color: 1, kind: 'ai', ai: { difficulty: 'easy' } },
    ],
  };
}

const MAP_TYPES: MapType[] = ['pangaea', 'continents', 'islands', 'lakes'];
const MAP_SIZES: MapSize[] = ['small', 'medium', 'large'];
const DIFFS: AiDifficulty[] = ['easy', 'normal', 'hard'];
const PERS: (AiPersonality | 'random' | undefined)[] = ['random', undefined, 'militarist', 'expansionist', 'scientist'];
const AI_NAMES = ['General Rust', 'Marshal Gold', 'Admiral Plum', 'Colonel Teal', 'Captain Snow', 'Major Rose', 'Commander Ember'];
const capWord = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const cycle = <T,>(arr: readonly T[], cur: T) => arr[(arr.indexOf(cur) + 1) % arr.length];

/** The skirmish setup. With a lobby it is the online lobby: the host edits, guests pick seats. */
export class SetupScreen implements Screen {
  private local: MatchSetup;
  private preview: HTMLCanvasElement | null = null;
  private previewKey = '';
  private previewMap: GameMap | null = null;
  private chatText = '';

  constructor(private app: App, private lobby: Lobby | null = null) {
    this.local = loadSetup();
    if (lobby) lobby.onStart = (sess) => play(app, sess, { online: true });
  }

  private get setup(): MatchSetup {
    return this.lobby?.lobby?.setup ?? this.local;
  }

  /** May this screen change the match options? */
  private get editor(): boolean {
    return !this.lobby || this.lobby.isHost;
  }

  frame() {
    const app = this.app, ui = app.ui, ctx = app.ctx, lob = this.lobby;
    ui.begin(ctx, app.input, app.uiScale);
    ctx.fillStyle = '#1a1420';
    ctx.fillRect(0, 0, app.canvas.width, app.canvas.height);
    const w = Math.min(ui.w - 8, 600), h = Math.min(ui.h - 8, 340);
    const x = Math.round((ui.w - w) / 2), y = Math.round((ui.h - h) / 2);
    ui.panel(x, y, w, h);
    const st = this.setup;
    if (lob && !lob.lobby) {
      ui.text('Online', x + 8, y + 6, COL.gold);
      ui.textCenter(lob.status || 'Connecting...', x + w / 2, y + h / 2 - 10, COL.text);
      if (lob instanceof LobbyClient && lob.refused) ui.textCenter(lob.refused, x + w / 2, y + h / 2 + 4, COL.red);
      if (ui.button(x + 8, y + h - 24, 70, 18, { label: 'Back', hotkey: 'Escape' })) { lob.leave(); app.show(new OnlineScreen(app)); }
      ui.end();
      return;
    }
    ui.text(lob ? `Online lobby - room ${lob.lobby!.code}` : 'Skirmish', x + 8, y + 6, COL.gold);
    if (lob?.status) ui.textRight(lob.status, x + w - 8, y + 6, COL.red);

    // ---- options (left column)
    let oy = y + 22;
    const ox = x + 8;
    const ed = this.editor;
    const row = (label: string, value: string, next: (() => void) | null, tip = '') => {
      ui.text(label, ox, oy + 4, COL.light);
      if (ui.button(ox + 70, oy, 90, 15, { label: value, tip: tip || (ed ? 'Click to change' : 'The host sets this'), disabled: !ed || !next }) && next) { next(); this.changed(); }
      oy += 17;
    };
    row('Map', capWord(st.mapType), () => (st.mapType = cycle(MAP_TYPES, st.mapType)), 'Pangaea: one big landmass. Lakes: land with inland seas.\nContinents: each start on its own land, across narrow straits.\nIslands: the same across wide, deep channels. Both need ships or aircraft.');
    const rivers = MAPGEN.river.on.includes(st.mapType);
    row('River', !rivers ? 'None' : st.river !== false ? 'On' : 'Off', rivers ? () => (st.river = st.river === false) : null,
      rivers ? 'On: a river splits the map in two, crossed only by two bridges.\nOff: open land all the way across.' : 'Only Pangaea and Lakes maps have a river.');
    row('Size', capWord(st.mapSize), () => (st.mapSize = cycle(MAP_SIZES, st.mapSize)));
    row('Fog of war', capWord(st.fog), () => (st.fog = cycle(['on', 'explored', 'off'] as const, st.fog)), 'On: classic fog. Explored: terrain known from the start. Off: see everything.');
    row('Conquest', 'Always on', null, 'Win by knocking out every enemy (their HQ and every level 2+ city).\nAlways on, so every match can end.');
    row('Supremacy', st.victory.supremacy ? 'On' : 'Off', () => (st.victory.supremacy = !st.victory.supremacy), `Win by holding most of the cities for ${VICTORY.supremacyTime / 60} minutes: ${VICTORY.supremacyShares[2] * 100}% with two teams (${VICTORY.teamShare * 100}% in a team game), down to ${VICTORY.supremacyShares[6] * 100}% with six\n(the clock starts at minute ${VICTORY.supremacyFrom / 60}, ${VICTORY.supremacyFromPerTeam / 60} later for each team beyond two, or ${VICTORY.supremacyFromPerPlayer / 60} for each player beyond two if that's later).`);
    row('Science', st.victory.science ? 'On' : 'Off', () => (st.victory.science = !st.victory.science), 'Win by researching the Space Program and surviving the launch countdown.');
    const auto = timeLimitOf({ ...st, timeLimit: -1 });
    row('Time limit', st.timeLimit < 0 ? `Auto: ${auto ? auto / 60 + ' min' : 'none'}` : st.timeLimit ? `${st.timeLimit / 60} min` : 'None', () => (st.timeLimit = cycle([-1, 0, 1200, 1800, 2700, 3600], st.timeLimit)),
      `When time runs out, the highest score wins.\nAuto: ${VICTORY.autoLimit / 60} min with ${VICTORY.autoLimitPlayers}+ players or on Continents and Islands (big and naval games can stall), none otherwise.`);
    row('Weather', st.weather ? 'On' : 'Off', () => (st.weather = !st.weather), 'Day and night, rain and storms.');
    row('Supply crates', st.crates ? 'On' : 'Off', () => (st.crates = !st.crates), 'Crates parachute into the open map. First to touch one takes it.');
    row('City contracts', st.contracts !== false ? 'On' : 'Off', () => (st.contracts = st.contracts === false), 'Cities post public jobs: a tender (the top bid buys the city),\na hold (keep it a minute for cash and CP), or a bounty on a runaway leader\'s city.');
    row('Insurgency', st.insurgency !== false ? 'On' : 'Off', () => (st.insurgency = st.insurgency === false), 'Knocked-out players fight on: they drop partisans at cities,\nand come back by holding a town for a few minutes.');
    row('Start money', st.startMul === 2 ? 'High' : st.startMul === 0.5 ? 'Low' : 'Normal', () => (st.startMul = cycle([1, 2, 0.5], st.startMul ?? 1)));
    ui.text('Seed', ox, oy + 4, COL.light);
    ui.text(String(st.seed), ox + 72, oy + 4, COL.text);
    if (ed && ui.button(ox + 130, oy, 30, 15, { label: 'New', tip: 'Roll a new map' })) { st.seed = (Math.random() * 1e9) | 0; this.changed(); }
    oy += 17;

    // ---- players (middle)
    const teams = this.players(x + 176, y + 22);

    // ---- map preview (right)
    this.drawPreview(x + w - 112, y + 22, 104);

    // ---- chat (online)
    if (lob) this.chat(x + 176, y + h - 110, w - 176 - 120, 80);

    // ---- bottom buttons
    if (ui.button(x + 8, y + h - 24, 70, 18, { label: lob ? 'Leave' : 'Back', hotkey: ui.focus ? undefined : 'Escape' })) {
      if (lob) { lob.leave(); app.show(new OnlineScreen(app)); }
      else { saveSetup(st); app.show(new TitleScreen(app)); }
    }
    if (lob instanceof LobbyClient) {
      const seat = lob.lobby!.seats[lob.seatIndex];
      if (seat && ui.button(x + w - 108, y + h - 24, 100, 18, { label: seat.ready ? 'Ready!' : 'Ready?', active: seat.ready, color: COL.gold })) lob.seat({ ready: !seat.ready });
    } else {
      const waiting = lob ? lob.lobby!.seats.filter((s) => s.peer && !s.ready).length : 0;
      const label = waiting ? `Start (${waiting} not ready)` : 'Start battle';
      if (ui.button(x + w - 128, y + h - 24, 120, 18, { label, hotkey: ui.focus ? undefined : 'Enter', disabled: teams < 2, color: COL.gold, tip: waiting ? 'Some players are not ready yet; you can start anyway.' : undefined })) {
        if (lob instanceof LobbyHost) { saveSetup(st); play(app, lob.start(), { online: true }); }
        else launch(app, st);
      }
    }
    ui.end();
  }

  /** The player list. Returns how many teams there are. */
  private players(px: number, top: number): number {
    const ui = this.app.ui, st = this.setup, lob = this.lobby;
    let py = top;
    ui.text('Players', px, py - 10, COL.gold);
    const seats = lob?.lobby?.seats;
    const usedColors = new Set(st.players.map((p) => p.color));
    const nextColor = (cur: number) => {
      let n = cur;
      for (let k = 0; k < TEAM_COLORS.length; k++) { n = (n + 1) % TEAM_COLORS.length; if (!usedColors.has(n)) return n; }
      return cur;
    };
    st.players.forEach((p, i) => {
      const seat = seats?.[i];
      const human = seat ? !!seat.peer : p.kind === 'human';
      const isMe = seat ? seat.peer === lob!.t.self : p.kind === 'human';
      const canEdit = isMe || (this.editor && !human);
      const c = TEAM_COLORS[seat?.color ?? p.color];
      const sw = PALETTE_RGB[c.ui];
      const setSeat = (change: { color?: number; team?: number }) => {
        if (lob instanceof LobbyClient) lob.seat(change);
        else if (lob instanceof LobbyHost && seat) { Object.assign(seat, change); lob.publish(); }
        else Object.assign(p, change);
      };
      if (ui.button(px, py, 14, 15, { tip: `Color: ${c.name}`, disabled: !canEdit })) setSeat({ color: nextColor(p.color) });
      ui.rect(px + 3, py + 3, 8, 9, `rgb(${sw[0]},${sw[1]},${sw[2]})`);
      const name = isMe && !lob ? 'You' : (seat?.name ?? p.name);
      ui.text(ellipsize(name + (seat?.peer && seat.ready ? ' \u0004' : ''), 76), px + 18, py + 4, isMe ? COL.gold : COL.white);
      if (!human) {
        if (ui.button(px + 98, py, 44, 15, { label: capWord(p.ai?.difficulty ?? 'normal'), disabled: !this.editor, tip: 'AI difficulty\nEasy: slow and forgiving. Hard: fast, and its economy gets a bonus.' })) {
          p.ai = { ...p.ai, difficulty: cycle(DIFFS, p.ai?.difficulty ?? 'normal') };
          this.changed();
        }
        if (ui.button(px + 144, py, 58, 15, { label: p.ai?.personality ? capWord(p.ai.personality).slice(0, 9) : 'Balanced', disabled: !this.editor, tip: 'AI style\nMilitarist: attacks early. Expansionist: grabs cities.\nScientist: techs up and goes for the launch.\nRandom: one of the four, kept secret until the end.' })) {
          p.ai = { difficulty: p.ai?.difficulty ?? 'normal', personality: cycle(PERS, p.ai?.personality) };
          this.changed();
        }
      } else if (seat?.peer) ui.text(isMe ? '(you)' : 'human', px + 100, py + 4, COL.dim);
      const team = seat?.team ?? p.team;
      if (ui.button(px + 204, py, 40, 15, { label: `Team ${team + 1}`, disabled: !canEdit, tip: 'Players on the same team are allies.' })) setSeat({ team: (team + 1) % 6 });
      if (!human && this.editor && st.players.length > 2 && ui.button(px + 246, py, 14, 15, { label: '\u0015', tip: 'Remove' })) {
        st.players.splice(i, 1);
        seats?.splice(i, 1);
        this.changed();
      }
      py += 17;
    });
    if (this.editor && st.players.length < MAX_PLAYERS && ui.button(px, py, 80, 15, { label: '+ Add AI' })) {
      const free = TEAM_COLORS.findIndex((_, k) => !usedColors.has(k));
      const name = AI_NAMES.find((n) => !st.players.some((p) => p.name === n)) ?? `AI ${st.players.length}`;
      const teamsNow = new Set(st.players.map((p) => p.team));
      let team = 0;
      while (teamsNow.has(team)) team++;
      const pl: PlayerSetup = { name, team: Math.min(5, team), color: Math.max(0, free), kind: 'ai', ai: { difficulty: 'normal', personality: 'random' } };
      st.players.push(pl);
      seats?.push({ peer: '', name, team: pl.team, color: pl.color, ready: true });
      this.changed();
    }
    py += 22;
    if (!lob) {
      ui.text('Presets', px, py, COL.light);
      py += 11;
      const preset = (label: string, k: PresetKind, tip: string, bx: number, by: number) => {
        if (ui.button(bx, by, 60, 15, { label, tip })) {
          st.players = presetPlayers(k);
          // six starts on a small map leaves no room to grow
          if (st.players.length > 4 && st.mapSize === 'small') st.mapSize = 'medium';
          this.changed();
        }
      };
      preset('1 v 1', '1v1', 'You against one AI.', px, py);
      preset('2 v 2', '2v2', 'You and an AI ally against two AIs.', px + 62, py);
      preset('3 v 3', '3v3', 'You and two AI allies against three AIs.\n(A small map becomes medium.)', px + 124, py);
      preset('FFA 4', 'ffa4', 'Four players, everyone for themselves.', px, py + 17);
      preset('FFA 6', 'ffa6', 'Six players, everyone for themselves.\n(A small map becomes medium.)', px + 62, py + 17);
      preset('Co-op', 'coop', 'You and an AI ally against three hard AIs.\n(A small map becomes medium.)', px + 124, py + 17);
      py += 17;
    } else {
      const code = lob.lobby!.code;
      ui.text(`Room code: ${code}`, px, py, COL.white);
      if (ui.button(px + 120, py - 3, 70, 14, { label: 'Copy link', tip: 'Copy a link that joins this room' })) {
        const url = `${location.origin}${location.pathname}?room=${code}`;
        void navigator.clipboard?.writeText(url).catch(() => {});
      }
    }
    const teams = new Set((seats ?? st.players).map((p) => p.team));
    if (teams.size < 2) ui.text('Everyone is on one team: no one to fight!', px, py + 20, COL.red);
    return teams.size;
  }

  private chat(x: number, y: number, w: number, h: number) {
    const ui = this.app.ui, lob = this.lobby!;
    ui.frame(x, y, w, h, COL.shadow);
    const lines = lob.chat.slice(-6);
    lines.forEach((l, i) => ui.text(ellipsize(l.name ? `${l.name}: ${l.text}` : l.text, w - 8), x + 4, y + 4 + i * 10, l.name ? COL.text : COL.dim));
    const r = ui.textField('chat', x, y + h + 2, w, 15, this.chatText, { placeholder: 'Chat (Enter to send)', max: 120 });
    this.chatText = r.value;
    if (r.submitted && this.chatText.trim()) { lob.say(this.chatText.trim()); this.chatText = ''; }
  }

  private changed() {
    if (this.lobby instanceof LobbyHost) this.lobby.publish();
    else if (!this.lobby) saveSetup(this.setup);
  }

  private drawPreview(x: number, y: number, size: number) {
    const ui = this.app.ui, st = this.setup;
    const key = `${st.seed}|${st.mapType}|${st.mapSize}|${st.players.length}|${st.river !== false}`;
    if (key !== this.previewKey) {
      this.previewKey = key;
      const map = generateMap(st);
      this.previewMap = map;
      const c = makeCanvas(map.w, map.h);
      const cx = c.getContext('2d')!;
      const img = cx.createImageData(map.w, map.h);
      for (let i = 0; i < map.w * map.h; i++) {
        const [r, g, b] = PALETTE_RGB[TERRAIN[map.terrain[i]].mini];
        img.data.set([r, g, b, 255], i * 4);
      }
      cx.putImageData(img, 0, 0);
      this.preview = c;
    }
    ui.frame(x - 2, y - 2, size + 4, size + 4);
    if (!this.preview || !this.previewMap) return;
    const k = ui.s, ctx = ui.ctx, map = this.previewMap;
    ctx.drawImage(this.preview, x * k, y * k, size * k, size * k);
    const sc = size / map.w;
    for (const c of map.cities) ui.rect(x + c.x * sc - 1, y + c.y * sc - 1, 2, 2, NEUTRAL_UI);
    const seats = this.lobby?.lobby?.seats;
    map.starts.forEach((s, i) => {
      const p = st.players[i];
      if (!p) return;
      const [r, g, b] = PALETTE_RGB[TEAM_COLORS[seats?.[i]?.color ?? p.color].ui];
      ui.rect(x + s.x * sc - 3, y + s.y * sc - 3, 6, 6, '#1a1420');
      ui.rect(x + s.x * sc - 2, y + s.y * sc - 2, 4, 4, `rgb(${r},${g},${b})`);
    });
    ui.text(`${map.w}x${map.h} tiles, ${map.cities.length} cities`, x, y + size + 5, COL.dim);
  }
}

// ---------------------------------------------------------------- online

/** Enter a name, then host a room or join one by its code. */
export class OnlineScreen implements Screen {
  private name: string;
  private code: string;
  private busy = '';

  constructor(private app: App, code = '') {
    this.name = store.get(NAME_KEY) ?? '';
    this.code = code.toUpperCase();
    if (code && this.name) void this.join();
  }

  private async host() {
    this.busy = 'Opening a room...';
    store.set(NAME_KEY, this.name);
    try {
      const code = newRoomCode();
      const t = await joinOnline(code);
      const setup = loadSetup();
      setup.players = setup.players.filter((p) => p.kind === 'ai');
      this.app.show(new SetupScreen(this.app, new LobbyHost(t, this.name || 'Host', code, setup)));
    } catch (e) {
      this.busy = `Could not go online: ${(e as Error).message}`;
    }
  }

  private async join() {
    if (this.code.length < 4) { this.busy = 'Enter the 5-letter room code'; return; }
    this.busy = 'Joining...';
    store.set(NAME_KEY, this.name);
    try {
      const t = await joinOnline(this.code);
      this.app.show(new SetupScreen(this.app, new LobbyClient(t, this.name || 'Guest', playerToken())));
    } catch (e) {
      this.busy = `Could not go online: ${(e as Error).message}`;
    }
  }

  frame() {
    const app = this.app, ui = app.ui, ctx = app.ctx;
    ui.begin(ctx, app.input, app.uiScale);
    ctx.fillStyle = '#1a1420';
    ctx.fillRect(0, 0, app.canvas.width, app.canvas.height);
    const w = 260, h = 170;
    const x = Math.round((ui.w - w) / 2), y = Math.round((ui.h - h) / 2);
    ui.panel(x, y, w, h);
    ui.text('Play online', x + 8, y + 6, COL.gold);
    ui.text('Your name', x + 10, y + 26, COL.light);
    this.name = ui.textField('name', x + 80, y + 22, w - 90, 15, this.name, { placeholder: 'Commander', max: 16 }).value;
    if (ui.button(x + 10, y + 48, w - 20, 20, { label: 'Host a game', tip: 'Open a room and share its code with friends.\nYou set the map and add AI players.' })) void this.host();
    ui.text('Room code', x + 10, y + 82, COL.light);
    const r = ui.textField('code', x + 80, y + 78, 80, 15, this.code, { placeholder: 'ABCDE', max: 5, upper: true });
    this.code = r.value.replace(/[^A-Z]/g, '');
    if (ui.button(x + 166, y + 78, w - 176, 15, { label: 'Join' }) || r.submitted) void this.join();
    ui.para('Games connect peer to peer through public relays. The host runs the match, so the host should have the best connection.', x + 10, y + 102, w - 20, COL.dim);
    if (this.busy) ui.textCenter(this.busy, x + w / 2, y + h - 34, COL.gold);
    if (ui.button(x + 8, y + h - 22, 60, 16, { label: 'Back', hotkey: ui.focus ? undefined : 'Escape' })) app.show(new TitleScreen(app));
    ui.end();
  }
}

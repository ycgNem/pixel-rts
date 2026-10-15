// The match screen: wires a Session to the renderer, the controls and the HUD.
import type { Session } from '../net/session';
import { Camera } from '../render/view';
import { Fog } from '../render/fog';
import { Minimap } from '../render/minimap';
import { Fx } from '../render/fx';
import { WorldRenderer, type WorldView } from '../render/world';
import { Controller } from '../ui/control';
import { Hud } from '../ui/hud';
import { hqOf } from '../sim/world';
import type { SimEvent } from '../sim/types';
import { UNITS } from '../data/units';
import { TILE } from '../render/view';
import { audio } from '../engine/audio';
import { viewer } from '../render/colors';
import type { App, Screen } from './app';
import { AUTOSAVE_SECONDS, clearSave, writeSave } from './saves';
import { Tutorial, ordersWanted } from '../ui/tutorial';
import { TICK_RATE } from '../sim/types';

/** the start view keeps clear of the top bar and the bottom panels (UI units) */
const START_VIEW = { top: 16, bottom: 90 };

export interface MatchOptions {
  /** title-screen demo: no HUD, the camera drifts on its own */
  demo?: boolean;
  /** Boot Camp: step-by-step guidance on top of an ordinary match */
  tutorial?: boolean;
  onQuit?: () => void;
  /** play again (offline): the same map, or a new seed */
  onRematch?: (sameMap: boolean) => void;
}

export class MatchScreen implements Screen {
  cam = new Camera();
  fog: Fog;
  minimap: Minimap;
  fx = new Fx();
  world: WorldRenderer;
  ctl: Controller;
  hud: Hud;
  private time = 0;
  private intensity = 0;
  private drift = { a: 0, x: 0, y: 0 };
  /** the tick of the last save (-1 once the match is over and the save is gone) */
  private savedAt: number;

  constructor(private app: App, public session: Session, private opts: MatchOptions = {}) {
    const s = session.state;
    this.fog = new Fog(s.map.w, s.map.h);
    this.minimap = new Minimap(s);
    this.world = new WorldRenderer(s);
    this.cam.mw = s.map.w;
    this.cam.mh = s.map.h;
    this.sizeCamera();
    this.cam.z = app.canvas.height >= 600 ? 2 : 1;
    const hq = hqOf(s, session.me);
    const st = s.map.starts[session.me] ?? { x: s.map.w / 2, y: s.map.h / 2 };
    const bx = hq ? hq.x : st.x, by = hq ? hq.y : st.y;
    // frame the HQ and the nearest ore (the first job) in the open area: below the top bar and
    // clear of the selection panel and command card along the bottom
    const k = app.uiScale, px = TILE * this.cam.z;
    const free = { top: START_VIEW.top * k, bottom: app.canvas.height - START_VIEW.bottom * k };
    const ore = s.map.deposits.filter((d) => d.kind === 'ore').map((d) => ({ x: d.x + 0.5, y: d.y + 0.5 }))
      .sort((a, b) => Math.hypot(a.x - bx, a.y - by) - Math.hypot(b.x - bx, b.y - by))[0];
    const fits = !!ore && Math.abs(ore.x - bx) * px < app.canvas.width * 0.6 && Math.abs(ore.y - by) * px < (free.bottom - free.top) * 0.7;
    const fx = fits ? (bx + ore.x) / 2 : bx, fy = fits ? (by + ore.y) / 2 : by;
    this.cam.centerOn(fx, fy + (app.canvas.height - free.top - free.bottom) / 2 / px);
    if (opts.demo) {
      this.cam.z = 1;
      this.drift = { a: Math.random() * Math.PI * 2, x: s.map.w / 2, y: s.map.h / 2 };
      this.cam.centerOn(this.drift.x, this.drift.y);
    }
    this.ctl = new Controller(session, this.cam, app.input, this.fog);
    this.hud = new Hud({
      session, ctl: this.ctl, cam: this.cam, minimap: this.minimap, fog: this.fog, input: app.input, ui: app.ui, loop: app.loop,
      quit: () => this.quit(),
      save: session.host && !opts.demo ? () => this.save() : undefined,
      // Boot Camp in the tutorial match; First Orders in any other until a player has finished or hidden them
      tutorial: opts.tutorial ? new Tutorial('bootcamp') : !opts.demo && ordersWanted() ? new Tutorial('orders') : undefined,
      rematch: opts.onRematch && session.host && session.status() === '' && !opts.demo ? (same) => opts.onRematch!(same) : undefined,
    });
    this.savedAt = s.tick;
    this.fog.update(s, s.players[session.me].team, true);
  }

  private sizeCamera() {
    this.cam.w = this.app.canvas.width;
    this.cam.h = this.app.canvas.height;
  }

  quit() {
    this.session.dispose();
    this.opts.onQuit?.();
  }

  tick() {
    if (!this.session.host) return;
    this.session.tick();
    if (this.opts.demo || this.savedAt < 0) return;
    // the host keeps an autosave; a finished match leaves nothing to continue
    const s = this.session.state;
    if (s.over) { clearSave(); this.savedAt = -1; }
    else if (s.tick - this.savedAt >= AUTOSAVE_SECONDS * TICK_RATE) this.save();
  }

  /** Save the match to the one slot (the host only). */
  save(): boolean {
    this.savedAt = this.session.state.tick;
    return writeSave(this.session.state, this.session.me);
  }

  frame(dt: number, alpha: number) {
    const app = this.app, ctx = app.ctx, s = this.session.state;
    const now = performance.now();
    this.time += dt;
    this.sizeCamera();
    this.cam.clamp();
    viewer.me = this.opts.demo ? -1 : this.session.me;
    const a = this.session.host ? alpha : this.session.frame(dt);
    const me = this.session.me, team = s.players[me].team;

    const events = this.session.events.splice(0);
    this.fog.update(s, team, events.length > 0 && s.tick % 2 === 0);
    const vis = (x: number, y: number) => s.setup.fog === 'off' || this.fog.isVisible(x, y);
    this.fx.onEvents(events, vis, me, (id) => {
      const e = s.ents[id];
      return e ? [e.x, e.y] : null;
    }, (id) => [s.cities[id].x + 0.5, s.cities[id].y + 0.5]);
    if (!this.opts.demo) {
      this.hud.onEvents(events);
      this.sounds(events);
    }
    this.fx.update(dt);
    this.ctl.prune();

    app.ui.begin(ctx, app.input, app.uiScale);
    if (this.opts.demo) {
      // drift in tiles (the camera snaps to whole pixels, so slow pans need their own position)
      this.drift.a += dt * 0.05;
      this.drift.x = Math.max(12, Math.min(s.map.w - 12, this.drift.x + Math.cos(this.drift.a) * 0.6 * dt));
      this.drift.y = Math.max(8, Math.min(s.map.h - 8, this.drift.y + Math.sin(this.drift.a * 0.7) * 0.4 * dt));
      this.cam.centerOn(this.drift.x, this.drift.y);
    } else this.ctl.camera(dt, app.ui.mouseOverUI);

    const view: WorldView = {
      me, team, selected: this.ctl.selected, hover: this.ctl.hover, hoverCity: this.ctl.hoverCity, selectedCity: this.ctl.selCity,
      prev: this.session.prev, alpha: a, time: this.time, ui: app.uiScale,
    };
    ctx.save();
    if (this.fx.shake > 0.5) ctx.translate(Math.round((Math.random() - 0.5) * this.fx.shake), Math.round((Math.random() - 0.5) * this.fx.shake));
    this.world.draw(ctx, s, this.cam, this.fog, this.fx, view);
    this.fx.drawText(ctx, this.cam, app.uiScale);
    ctx.restore();
    if (this.opts.demo) {
      app.ui.end();
      return;
    }
    this.ctl.drawOverlay(ctx, now);
    this.hud.draw(now);
    const modal = this.hud.panel === 'menu' || this.hud.panel === 'help' || this.hud.panel === 'guide' || (!!s.over && !this.hud.hideEnd);
    if (!modal) {
      this.ctl.keys(now);
      this.ctl.pointer(a, this.session.prev, app.ui.mouseOverUI, now);
    }
    app.ui.end();
  }

  /** Sound for what happened, quieter with distance from the camera and panned left/right. */
  private sounds(events: SimEvent[]) {
    const s = this.session.state, me = this.session.me, team = s.players[me].team;
    const cx = this.cam.wx(this.cam.w / 2), cy = this.cam.wy(this.cam.h / 2);
    const span = Math.max(12, this.cam.w / (TILE * this.cam.z) * 0.7);
    const at = (x: number, y: number, base = 1): [number, number] => {
      const d = Math.hypot(x - cx, y - cy);
      const seen = s.setup.fog === 'off' || this.fog.isVisible(x, y) ? 1 : 0.25;
      return [base * seen * Math.max(0, 1 - d / (span * 1.6)), (x - cx) / span];
    };
    let fighting = 0;
    for (const e of events) {
      switch (e.e) {
        case 'shot': {
          const [v, pan] = at(e.x0, e.y0, 0.8);
          if (v > 0.2) fighting++;
          audio.sfx(e.kind === 'city' ? 'gun' : e.w, v, pan);
          break;
        }
        case 'hit': if (e.big) { const [v, pan] = at(e.x, e.y, 0.7); audio.sfx('boom', v, pan); } break;
        case 'die': {
          const [v, pan] = at(e.x, e.y);
          if (e.b) audio.sfx('bigboom', v, pan);
          else if (UNITS[e.kind]?.cls === 'infantry') { audio.sfx('thud', v * 0.6, pan); audio.sfx('scream', v * 0.5, pan); }
          else audio.sfx('boom', v, pan);
          break;
        }
        case 'trained': if (e.owner === me) audio.sfx('ready', 0.7); break;
        case 'built': if (e.owner === me) audio.sfx('built'); break;
        case 'capture': if (e.owner === me) audio.sfx('capture'); else if (e.prev === me) audio.sfx('lost'); break;
        case 'researched': if (e.p === me) audio.sfx('research'); break;
        case 'era': if (e.p === me) audio.sfx('era'); break;
        case 'attacked': if (e.p === me) audio.sfx('alert'); break;
        case 'crate': if (e.p === me) audio.sfx('crate'); break;
        // a city posts a job (everyone hears its bell); filling one rings like a crate; a rival tops your bid
        case 'contract': audio.sfx('bell'); break;
        case 'contractDone': if (e.p === me) audio.sfx('crate'); break;
        case 'bid': if (e.p !== me && s.contract?.bids.some((b) => b.p === me)) audio.sfx('outbid'); break;
        // a government falls (yours loudly), a city of yours rises against you
        case 'exile': case 'eliminated': if (!s.over) audio.sfx('fall', e.p === me ? 1 : 0.5); break;
        case 'resist': if (e.p === me) audio.sfx('unrest'); break;
        case 'lastStand': if (e.p === me) audio.sfx('alert'); break;
        case 'scrub': if (e.p === me) audio.sfx('lost'); else if (e.by === me) audio.sfx('crate'); break;
        // insurgency: partisans landing (in your city or an ally's: a drum roll), and a government back from the dead
        case 'insurge': if (e.p === me) audio.sfx('order'); else { const o = s.cities[e.city].owner; if (o >= 0 && s.players[o].team === team) audio.sfx('unrest'); } break;
        case 'refound': audio.sfx(e.p === me ? 'era' : 'alert'); break;
        // wanted aces: your new ace, a bounty collected, your ace lost
        case 'ace': if (e.p === me) audio.sfx('research'); break;
        case 'aceDown': if (e.by === me) audio.sfx('crate'); else if (e.p === me) audio.sfx('lost'); break;
        case 'power': { const [v, pan] = at(e.x, e.y); audio.sfx('power', Math.max(v, e.p === me ? 0.6 : 0), pan); break; }
        case 'weather': if (e.kind === 'storm') audio.sfx('thunder', 0.8); break;
        case 'launch': audio.sfx('siren'); break;
        case 'reject': if (e.p === me) audio.sfx('error'); break;
        case 'over': audio.sfx(e.winners === team ? 'victory' : 'defeat'); break;
      }
    }
    this.intensity = this.intensity * 0.97 + Math.min(1, fighting / 6) * 0.03;
    audio.setRain(s.weather.rain * (s.weather.storm > 0 ? 1.6 : 1));
    audio.music(Math.min(1, this.intensity * 4));
  }

  dispose() {
    this.session.dispose();
    audio.setRain(0);
  }
}

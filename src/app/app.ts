// The app shell: canvas sizing, the main loop, and screens (title, skirmish setup, match).
import { GameLoop } from '../engine/loop';
import { Input } from '../engine/input';
import { UI } from '../ui/ui';
import { audio } from '../engine/audio';
import { TICK_RATE } from '../sim/types';
import { loadSheets } from '../render/art';
import { buildProcedural } from '../render/procedural';
import { TitleScreen } from './title';

export interface Screen {
  /** fixed-rate update (20 Hz) */
  tick?(): void;
  frame(dt: number, alpha: number): void;
  dispose?(): void;
}

export class App {
  ctx: CanvasRenderingContext2D;
  input = new Input();
  ui = new UI();
  loop: GameLoop;
  screen: Screen | null = null;
  dpr = 1;

  constructor(public canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.input.attach(canvas);
    const unlock = () => audio.unlock();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    const resize = () => {
      this.dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.floor(window.innerWidth * this.dpr);
      canvas.height = Math.floor(window.innerHeight * this.dpr);
      this.input.scale = this.dpr;
      this.ctx.imageSmoothingEnabled = false;
    };
    window.addEventListener('resize', resize);
    resize();
    this.loop = new GameLoop(TICK_RATE, () => this.screen?.tick?.(), (dt, alpha) => this.frame(dt, alpha));
    this.boot();
  }

  /** UI scale: the largest whole number that keeps the UI at least ~600 x 320 UI pixels (a 1366 x 768 laptop with browser chrome gets 2). */
  get uiScale(): number {
    return Math.max(1, Math.floor(Math.min(this.canvas.width / 600, this.canvas.height / 320)));
  }

  private async boot() {
    this.ctx.fillStyle = '#1a1420';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    await loadSheets();
    buildProcedural();
    this.show(new TitleScreen(this));
    this.loop.start();
  }

  show(s: Screen) {
    this.screen?.dispose?.();
    this.screen = s;
    this.loop.paused = false;
    this.loop.speed = 1;
  }

  private frame(dt: number, alpha: number) {
    this.ctx.imageSmoothingEnabled = false;
    this.screen?.frame(dt, alpha);
    this.input.endFrame();
  }
}

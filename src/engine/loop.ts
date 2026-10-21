// Fixed-timestep loop decoupled from rendering (ported from Sprocket & Sprout). The sim ticks at
// TICK_RATE; frames run at the display rate with `alpha` = how far we are into the next tick.

export class GameLoop {
  private acc = 0;
  private last = 0;
  private raf = 0;
  /** game speed multiplier */
  speed = 1;
  paused = false;
  /** smoothed ms spent in ticks / frames, and fps (debug overlay) */
  tickMs = 0;
  frameMs = 0;
  fps = 60;

  constructor(
    private tickRate: number,
    private tick: () => void,
    private frame: (realDt: number, alpha: number) => void,
  ) {}

  /** Set while the sim is driven from elsewhere (an online client): frames only. */
  externalTicks = false;
  /**
   * Keep ticking while the tab is hidden (an online host: everyone else waits on its ticks).
   * Hidden tabs get no animation frames and main-thread timers slow to once a second, but a
   * worker's timer keeps its pace, so a tiny worker paces the ticks until the tab is back.
   */
  keepAlive = false;
  private worker: Worker | null = null;
  private bgLast = 0;

  start() {
    this.last = performance.now();
    const step = (now: number) => {
      this.raf = requestAnimationFrame(step);
      let realDt = (now - this.last) / 1000;
      this.last = now;
      if (realDt > 0.25) realDt = 0.25;
      this.fps = this.fps * 0.95 + (1 / Math.max(realDt, 0.001)) * 0.05;
      const t0 = performance.now();
      this.advance(realDt);
      const t1 = performance.now();
      this.tickMs = this.tickMs * 0.9 + (t1 - t0) * 0.1;
      this.frame(realDt, this.externalTicks ? 0 : Math.min(1, this.acc * this.tickRate));
      this.frameMs = this.frameMs * 0.9 + (performance.now() - t1) * 0.1;
    };
    this.raf = requestAnimationFrame(step);
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  stop() {
    cancelAnimationFrame(this.raf);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.stopBackground();
  }

  /** Run the ticks due after `realDt` seconds. */
  private advance(realDt: number) {
    if (this.paused || this.externalTicks) return;
    const dt = 1 / this.tickRate;
    this.acc += realDt * this.speed;
    let steps = 0;
    const maxSteps = Math.max(6, Math.ceil(this.speed * 3));
    while (this.acc >= dt && steps < maxSteps) {
      this.tick();
      this.acc -= dt;
      steps++;
    }
    if (steps >= maxSteps) this.acc = 0;
  }

  private onVisibility = () => {
    if (document.hidden && this.keepAlive) this.startBackground();
    else this.stopBackground();
  };

  private startBackground() {
    if (this.worker) return;
    const src = `setInterval(() => postMessage(0), ${Math.round(1000 / this.tickRate)});`;
    const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    this.worker = new Worker(url);
    URL.revokeObjectURL(url);
    this.bgLast = performance.now();
    this.worker.onmessage = () => {
      const now = performance.now();
      const realDt = Math.min(0.25, (now - this.bgLast) / 1000);
      this.bgLast = now;
      if (this.keepAlive) this.advance(realDt);
    };
  }

  private stopBackground() {
    if (!this.worker) return;
    this.worker.terminate();
    this.worker = null;
    // back to animation frames, without counting the hidden time twice
    this.last = performance.now();
  }
}

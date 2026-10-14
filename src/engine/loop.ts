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

  start() {
    this.last = performance.now();
    const dt = 1 / this.tickRate;
    const step = (now: number) => {
      this.raf = requestAnimationFrame(step);
      let realDt = (now - this.last) / 1000;
      this.last = now;
      if (realDt > 0.25) realDt = 0.25;
      this.fps = this.fps * 0.95 + (1 / Math.max(realDt, 0.001)) * 0.05;
      const t0 = performance.now();
      if (!this.paused && !this.externalTicks) {
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
      const t1 = performance.now();
      this.tickMs = this.tickMs * 0.9 + (t1 - t0) * 0.1;
      this.frame(realDt, this.externalTicks ? 0 : Math.min(1, this.acc / dt));
      this.frameMs = this.frameMs * 0.9 + (performance.now() - t1) * 0.1;
    };
    this.raf = requestAnimationFrame(step);
  }

  stop() {
    cancelAnimationFrame(this.raf);
  }
}

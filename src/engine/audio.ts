// Sound: every effect is synthesized with Web Audio (no samples, no dependencies), in the spirit of
// Sprocket & Sprout's procedural audio. Battle sounds are rate-limited per kind and fade with
// distance from the camera, so a 200-unit fight stays a rumble instead of white noise.

type Env = { a: number; d: number };

export interface AudioSettings { master: number; sfx: number; music: number }

export class Audio {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfxBus!: GainNode;
  private ambBus!: GainNode;
  private musicBus!: GainNode;
  private noiseBuf!: AudioBuffer;
  private last = new Map<string, number>();
  /** sounds started in the last ~100 ms (global cap) */
  private recent: number[] = [];
  private rain: { g: GainNode } | null = null;
  private musicTimer = 0;
  private musicStep = 0;
  vol: AudioSettings = { master: 0.8, sfx: 0.8, music: 0.4 };

  /** Browsers only allow sound after a user gesture: call on the first click or key. */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    try {
      const AC = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
        ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      const ctx = new AC();
      this.ctx = ctx;
      this.master = ctx.createGain();
      // a gentle compressor keeps big battles from clipping
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -18;
      comp.ratio.value = 4;
      this.master.connect(comp);
      comp.connect(ctx.destination);
      this.sfxBus = ctx.createGain();
      this.ambBus = ctx.createGain();
      this.musicBus = ctx.createGain();
      this.sfxBus.connect(this.master);
      this.ambBus.connect(this.master);
      this.musicBus.connect(this.master);
      const len = ctx.sampleRate * 2;
      this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.apply();
    } catch {
      this.ctx = null;
    }
  }

  apply() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.vol.master, t, 0.05);
    this.sfxBus.gain.setTargetAtTime(this.vol.sfx * 0.6, t, 0.05);
    this.ambBus.gain.setTargetAtTime(this.vol.sfx * 0.35, t, 0.05);
    this.musicBus.gain.setTargetAtTime(this.vol.music * 0.12, t, 0.05);
  }

  // ---------------------------------------------------------------- primitives

  private tone(freq: number, type: OscillatorType, env: Env, vol: number, t0 = 0, slide = 0, bus: AudioNode = this.sfxBus) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + t0;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + env.a + env.d);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + env.a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + env.a + env.d);
    o.connect(g);
    g.connect(bus);
    o.start(t);
    o.stop(t + env.a + env.d + 0.05);
  }

  private noise(dur: number, vol: number, type: BiquadFilterType, freq: number, q = 1, t0 = 0, sweep = 0, bus: AudioNode = this.sfxBus, pan = 0) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + t0;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 0.6 + Math.random() * 0.8;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (sweep) f.frequency.exponentialRampToValueAtTime(Math.max(30, freq * sweep), t + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
    if (pan && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      g.connect(p);
      p.connect(bus);
    } else g.connect(bus);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  /**
   * Play a sound. `v` scales loudness (distance), `pan` is -1..1. Each id has a minimum gap; the
   * whole mix is capped at a handful of new sounds per 100 ms.
   */
  sfx(id: string, v = 1, pan = 0) {
    const ctx = this.ctx;
    if (!ctx || v < 0.03 || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    const gap = GAP[id] ?? 0.04;
    if (now - (this.last.get(id) ?? -1) < gap) return;
    this.recent = this.recent.filter((t) => now - t < 0.1);
    if (this.recent.length >= 8 && !UI_SOUNDS.has(id)) return;
    this.recent.push(now);
    this.last.set(id, now);
    const r = () => 1 + (Math.random() - 0.5) * 0.1;
    switch (id) {
      // ---- weapons
      case 'gun': this.noise(0.06, 0.18 * v, 'bandpass', 2400 * r(), 1.5, 0, 0.5, undefined, pan); break;
      case 'cannon': this.noise(0.28, 0.4 * v, 'lowpass', 900 * r(), 1, 0, 0.3, undefined, pan); this.tone(90 * r(), 'sine', { a: 0.002, d: 0.2 }, 0.25 * v, 0, 0.5); break;
      case 'rocket': this.noise(0.35, 0.22 * v, 'bandpass', 1400, 1, 0, 0.4, undefined, pan); this.tone(500, 'sawtooth', { a: 0.01, d: 0.25 }, 0.04 * v, 0, 0.4); break;
      case 'missile': this.noise(0.3, 0.16 * v, 'highpass', 2500, 0.8, 0, 0.6, undefined, pan); break;
      case 'flak': this.noise(0.09, 0.2 * v, 'bandpass', 1800 * r(), 2, 0, 0.6, undefined, pan); this.noise(0.12, 0.12 * v, 'lowpass', 700, 1, 0.07, 0.5, undefined, pan); break;
      case 'shell': this.noise(0.45, 0.45 * v, 'lowpass', 600 * r(), 1, 0, 0.25, undefined, pan); this.tone(60, 'sine', { a: 0.003, d: 0.35 }, 0.3 * v, 0, 0.5); break;
      case 'bomb': this.tone(900, 'sine', { a: 0.01, d: 0.5 }, 0.04 * v, 0, 0.4); break;
      case 'torpedo': this.noise(0.5, 0.12 * v, 'lowpass', 400, 1, 0, 0.5, undefined, pan); break;
      case 'depth': this.noise(0.2, 0.1 * v, 'lowpass', 300, 1, 0, 0.5, undefined, pan); this.tone(70, 'sine', { a: 0.01, d: 0.3 }, 0.12 * v, 0.25, 0.5); break;
      // ---- impacts
      case 'boom': this.noise(0.6, 0.5 * v, 'lowpass', 700 * r(), 1, 0, 0.2, undefined, pan); this.tone(55, 'sine', { a: 0.005, d: 0.5 }, 0.35 * v, 0, 0.6); break;
      case 'bigboom': this.noise(1.3, 0.7 * v, 'lowpass', 500, 1, 0, 0.15, undefined, pan); this.tone(40, 'sine', { a: 0.01, d: 1.1 }, 0.5 * v, 0, 0.5); this.noise(0.4, 0.3 * v, 'highpass', 2000, 0.7, 0.05, 0.3, undefined, pan); break;
      case 'thud': this.noise(0.15, 0.2 * v, 'lowpass', 500, 1, 0, 0.5, undefined, pan); break;
      case 'scream': this.tone(700 * r(), 'triangle', { a: 0.01, d: 0.12 }, 0.025 * v, 0, 0.6); break;
      // ---- base and economy
      case 'place': this.tone(220, 'square', { a: 0.003, d: 0.06 }, 0.06 * v); this.noise(0.12, 0.15 * v, 'lowpass', 600, 1, 0.02); break;
      case 'built': [392, 523, 659].forEach((f, i) => this.tone(f, 'triangle', { a: 0.005, d: 0.18 }, 0.08 * v, i * 0.07)); break;
      case 'ready': this.tone(660, 'square', { a: 0.003, d: 0.06 }, 0.04 * v); this.tone(880, 'square', { a: 0.003, d: 0.09 }, 0.04 * v, 0.06); break;
      case 'research': [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 'sine', { a: 0.01, d: 0.3 }, 0.07 * v, i * 0.08)); break;
      case 'era': [392, 523, 659, 784, 1047].forEach((f, i) => this.tone(f, 'triangle', { a: 0.01, d: 0.45 }, 0.09 * v, i * 0.12)); this.tone(196, 'sawtooth', { a: 0.05, d: 0.9 }, 0.03 * v, 0.1); break;
      case 'capture': [440, 554, 659, 880].forEach((f, i) => this.tone(f, 'square', { a: 0.005, d: 0.16 }, 0.05 * v, i * 0.09)); break;
      case 'lost': [440, 370, 311].forEach((f, i) => this.tone(f, 'square', { a: 0.005, d: 0.22 }, 0.05 * v, i * 0.14)); break;
      case 'alert': for (let i = 0; i < 2; i++) { this.tone(620, 'sawtooth', { a: 0.01, d: 0.16 }, 0.06 * v, i * 0.3); this.tone(460, 'sawtooth', { a: 0.01, d: 0.16 }, 0.06 * v, i * 0.3 + 0.15); } break;
      case 'crate': [784, 988, 1175, 1568].forEach((f, i) => this.tone(f, 'square', { a: 0.002, d: 0.08 }, 0.04 * v, i * 0.05)); break;
      case 'power': this.noise(0.5, 0.15 * v, 'bandpass', 900, 2, 0, 3); this.tone(300, 'sawtooth', { a: 0.05, d: 0.4 }, 0.05 * v, 0, 2); break;
      case 'siren': this.tone(500, 'sawtooth', { a: 0.1, d: 1.2 }, 0.05 * v, 0, 1.6); this.tone(800, 'sawtooth', { a: 0.1, d: 1.2 }, 0.04 * v, 1.2, 0.6); break;
      // a city's bell: a job posted
      case 'bell': [1047, 1568, 1047].forEach((f, i) => this.tone(f, 'sine', { a: 0.003, d: 0.7 }, 0.06 * v, i * 0.22)); this.tone(523, 'sine', { a: 0.003, d: 1.2 }, 0.04 * v); break;
      // a government falls: a slow falling horn over a drum
      case 'fall': [294, 247, 196, 147].forEach((f, i) => this.tone(f, 'sawtooth', { a: 0.02, d: 0.45 }, 0.05 * v, i * 0.3)); this.noise(0.9, 0.25 * v, 'lowpass', 220, 1, 0, 0.4); break;
      // someone tops your bid
      case 'outbid': this.tone(660, 'square', { a: 0.003, d: 0.07 }, 0.045 * v); this.tone(494, 'square', { a: 0.003, d: 0.12 }, 0.045 * v, 0.08); break;
      // unrest: partisans rise or land in your city (a drum roll)
      case 'unrest': for (let i = 0; i < 6; i++) this.noise(0.07, (0.12 + i * 0.03) * v, 'bandpass', 900, 1.2, i * 0.07); this.tone(110, 'triangle', { a: 0.01, d: 0.5 }, 0.08 * v, 0.4); break;
      case 'thunder': this.noise(2.2, 0.5 * v, 'lowpass', 300, 1, 0, 0.3); break;
      case 'victory': [523, 659, 784, 1047, 784, 1047].forEach((f, i) => this.tone(f, 'triangle', { a: 0.01, d: 0.35 }, 0.1 * v, i * 0.15)); break;
      case 'defeat': [392, 349, 311, 262].forEach((f, i) => this.tone(f, 'triangle', { a: 0.01, d: 0.5 }, 0.09 * v, i * 0.25)); break;
      // ---- UI
      case 'click': this.tone(900, 'square', { a: 0.002, d: 0.035 }, 0.04 * v); break;
      case 'order': this.tone(520, 'square', { a: 0.002, d: 0.04 }, 0.035 * v); this.tone(780, 'square', { a: 0.002, d: 0.05 }, 0.03 * v, 0.04); break;
      case 'attack': this.tone(330, 'square', { a: 0.002, d: 0.05 }, 0.04 * v); this.tone(247, 'square', { a: 0.002, d: 0.07 }, 0.04 * v, 0.05); break;
      case 'select': this.tone(1200, 'sine', { a: 0.002, d: 0.04 }, 0.03 * v); break;
      case 'error': this.tone(150, 'square', { a: 0.005, d: 0.16 }, 0.05 * v, 0, 0.8); break;
    }
  }

  /** Rain bed: 0 = off, 1 = storm. */
  setRain(amount: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    if (amount > 0 && !this.rain) {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = 'highpass';
      f.frequency.value = 1200;
      const g = ctx.createGain();
      g.gain.value = 0;
      src.connect(f);
      f.connect(g);
      g.connect(this.ambBus);
      src.start();
      this.rain = { g };
    }
    if (this.rain) this.rain.g.gain.setTargetAtTime(amount * 0.25, ctx.currentTime, 0.8);
  }

  /**
   * A sparse marching-drum and bass pulse under the battle (our own tiny score). Called every frame;
   * schedules ahead. Intensity 0..1 thickens it when fighting is on screen.
   */
  music(intensity: number) {
    const ctx = this.ctx;
    if (!ctx || this.vol.music <= 0) return;
    const beat = 60 / 96 / 2;
    if (this.musicTimer < ctx.currentTime) this.musicTimer = ctx.currentTime + 0.05;
    while (this.musicTimer < ctx.currentTime + 0.3) {
      const t0 = this.musicTimer - ctx.currentTime;
      const s = this.musicStep % 32;
      const bar = Math.floor(this.musicStep / 32) % 4;
      const root = [110, 98, 87.3, 98][bar];
      if (s % 8 === 0) this.tone(root, 'triangle', { a: 0.01, d: beat * 3 }, 0.5, t0, 0, this.musicBus);
      if (s % 8 === 4) this.tone(root * 1.5, 'triangle', { a: 0.01, d: beat * 2 }, 0.3, t0, 0, this.musicBus);
      // snare roll pattern
      if ([2, 6, 10, 11, 14].includes(s % 16)) this.noise(0.08, (0.25 + intensity * 0.35) * (s % 16 === 11 ? 0.5 : 1), 'bandpass', 1800, 1.2, t0, 0, this.musicBus);
      if (intensity > 0.3 && s % 4 === 0) this.noise(0.15, 0.4 * intensity, 'lowpass', 160, 1, t0, 0, this.musicBus);
      // a bugle-ish motif every other phrase
      if (bar % 2 === 1 && [0, 3, 6, 8].includes(s)) {
        const f = root * [4, 5, 6, 8][[0, 3, 6, 8].indexOf(s)] / 2;
        this.tone(f, 'square', { a: 0.02, d: beat * 1.6 }, 0.12, t0, 0, this.musicBus);
      }
      this.musicTimer += beat;
      this.musicStep++;
    }
  }
}

/** minimum seconds between two plays of the same sound */
const GAP: Record<string, number> = {
  gun: 0.05, flak: 0.08, cannon: 0.09, rocket: 0.12, missile: 0.12, shell: 0.18, bomb: 0.2, torpedo: 0.3, depth: 0.3,
  boom: 0.1, bigboom: 0.25, thud: 0.06, scream: 0.25, ready: 1.5, alert: 3, siren: 5, thunder: 4, unrest: 3,
};
const UI_SOUNDS = new Set(['click', 'order', 'attack', 'select', 'error', 'built', 'research', 'era', 'capture', 'lost', 'alert', 'victory', 'defeat', 'bell', 'fall', 'outbid', 'unrest']);

export const audio = new Audio();

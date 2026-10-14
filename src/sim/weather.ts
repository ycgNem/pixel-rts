// Day and night, and weather fronts (our twist: the battlefield changes during a match).
// Time of day comes from the tick; fronts are rolled with the match RNG.
import { WEATHER } from '../data/rules';
import type { MatchState, SimEvent } from './types';
import { TICK_RATE } from './types';
import { rand, randRange } from './rng';
import { sec } from './world';

const CYCLE = WEATHER.dayLength + WEATHER.nightLength;

/** 0..1 through the day/night cycle; night is the last part of it. Starts at morning. */
export function dayPhase(tick: number): number {
  return ((tick / TICK_RATE + 30) % CYCLE) / CYCLE;
}

/** 0 = full day, 1 = deep night (smooth dusk and dawn). */
export function darkness(s: MatchState): number {
  if (!s.setup.weather) return 0;
  const t = ((s.tick / TICK_RATE + 30) % CYCLE);
  const nightStart = WEATHER.dayLength;
  const fade = 20;
  if (t < nightStart - fade) return t < fade ? 1 - t / fade : 0;
  if (t < nightStart) return (t - (nightStart - fade)) / fade;
  return 1;
}

/** Sight multiplier from night (radar and cities ignore it). */
export function sightMul(s: MatchState): number {
  return 1 - (1 - WEATHER.nightSight) * darkness(s);
}

/** Ground speed multiplier from rain. */
export function groundWeatherMul(s: MatchState): number {
  return 1 - (1 - WEATHER.rainSpeed) * s.weather.rain;
}

/** Aircraft can't take off or fly in a storm (they hover in place and can't attack). */
export function stormy(s: MatchState): boolean {
  return s.weather.storm > 0;
}

export function stepWeather(s: MatchState, ev: SimEvent[]) {
  if (!s.setup.weather) return;
  const w = s.weather;
  // fronts fade in and out over ~5 s
  const target = s.tick < w.frontUntil ? 1 : 0;
  if (s.tick >= w.frontUntil && (w.rain > 0 || w.storm > 0)) {
    w.storm = 0;
    w.rain = Math.max(0, w.rain - 1 / sec(5));
    if (w.rain === 0) ev.push({ e: 'weather', kind: 'clear' });
    return;
  }
  if (target && w.rain < 1) w.rain = Math.min(1, w.rain + 1 / sec(5));
  if (s.tick % TICK_RATE !== 0 || s.tick < w.frontUntil) return;
  // once a second, roll for a new front (chance is per minute)
  const r = rand(s);
  if (r < WEATHER.stormChance / 60) {
    w.frontUntil = s.tick + sec(randRange(s, ...WEATHER.stormTime));
    w.storm = 1;
    ev.push({ e: 'weather', kind: 'storm' });
  } else if (r < (WEATHER.stormChance + WEATHER.rainChance) / 60) {
    w.frontUntil = s.tick + sec(randRange(s, ...WEATHER.rainTime));
    ev.push({ e: 'weather', kind: 'rain' });
  }
}

// The game palette: Resurrect 64 by Kerrie Lake (https://lospec.com/palette-list/resurrect-64),
// the same palette as Sprocket & Sprout. Every pixel of art is snapped to this list
// (scripts/lib/pixel.mjs reads it from this file).

export const PALETTE = [
  // 0-4 warm neutrals (plum-black up to taupe)
  '#2e222f', '#3e3546', '#625565', '#966c6c', '#ab947a',
  // 5-9 cool neutrals (mauve up to white)
  '#694f62', '#7f708a', '#9babb2', '#c7dcd0', '#ffffff',
  // 10-13 reds, 14-15 crimson
  '#6e2727', '#b33831', '#ea4f36', '#f57d4a', '#ae2334', '#e83b3b',
  // 16-18 orange to gold
  '#fb6b1d', '#f79617', '#f9c22b',
  // 19-23 rust to amber
  '#7a3045', '#9e4539', '#cd683d', '#e6904e', '#fbb954',
  // 24-28 olive to pale yellow
  '#4c3e24', '#676633', '#a2a947', '#d5e04b', '#fbff86',
  // 29-33 greens
  '#165a4c', '#239063', '#1ebc73', '#91db69', '#cddf6c',
  // 34-38 sage (muted green-grays)
  '#313638', '#374e4a', '#547e64', '#92a984', '#b2ba90',
  // 39-43 teals
  '#0b5e65', '#0b8a8f', '#0eaf9b', '#30e1b9', '#8ff8e2',
  // 44-48 blues
  '#323353', '#484a77', '#4d65b4', '#4d9be6', '#8fd3ff',
  // 49-53 purples
  '#45293f', '#6b3e75', '#905ea9', '#a884f3', '#eaaded',
  // 54-57 roses
  '#753c54', '#a24b6f', '#cf657f', '#ed8099',
  // 58-63 magenta to peach
  '#831c5d', '#c32454', '#f04f78', '#f68181', '#fca790', '#fdcbb0',
] as const;

export const PALETTE_RGB: [number, number, number][] = PALETTE.map((h) => [
  parseInt(h.slice(1, 3), 16),
  parseInt(h.slice(3, 5), 16),
  parseInt(h.slice(5, 7), 16),
]);

export function rgba(i: number, a: number): string {
  const [r, g, b] = PALETTE_RGB[i];
  return `rgba(${r},${g},${b},${a})`;
}

/** Named palette indices used by code (no raw numbers in render/UI code). */
export const C = {
  ink: 0, plum: 1, slate: 2, dust: 3, taupe: 4, mauve: 5, stone: 6, pebble: 7, frost: 8, white: 9,
  blood: 10, brick: 11, red: 12, coral: 13, crimson: 14, scarlet: 15, ember: 16, orange: 17, gold: 18,
  wine: 19, rust: 20, copper: 21, apricot: 22, amber: 23,
  olive: 24, moss: 25, khaki: 26, lime: 27, cream: 28, pine: 29, green: 30, jade: 31, leaf: 32, spring: 33,
  shade: 34, fern: 35, sage: 36, celadon: 37, straw: 38,
  deep: 39, teal: 40, aqua: 41, seafoam: 42, mint: 43, navy: 44, dusk: 45, blue: 46, sky: 47, ice: 48,
  grape: 49, purple: 50, violet: 51, lilac: 52, orchid: 53,
} as const;

/**
 * Team colors. Unit and building art is drawn with blue team parts; the importer marks those
 * pixels as a 4-shade key ramp (dark → light) that is swapped for one of these per player. The
 * first six are the defaults: apart from each other, from the terrain greens, and readable for
 * colorblind players (the minimap also marks each player's HQ with its own shape, and there is a
 * friend-or-foe color option).
 */
export interface TeamColor { name: string; ramp: [number, number, number, number]; ui: number }
export const TEAM_COLORS: TeamColor[] = [
  { name: 'Blue', ramp: [45, 46, 47, 48], ui: 47 },
  { name: 'Red', ramp: [10, 11, 12, 13], ui: 12 },
  { name: 'Yellow', ramp: [25, 17, 18, 28], ui: 18 },
  { name: 'Purple', ramp: [50, 51, 52, 53], ui: 52 },
  { name: 'Teal', ramp: [39, 40, 42, 43], ui: 42 },
  { name: 'Pink', ramp: [58, 59, 60, 61], ui: 60 },
  { name: 'Orange', ramp: [20, 16, 17, 23], ui: 16 },
  // last: next to neutral grey it reads as nobody's, so it is only picked by choice
  { name: 'White', ramp: [2, 7, 8, 9], ui: 9 },
];
/** Unowned (neutral cities, rubble). */
export const NEUTRAL_RAMP: [number, number, number, number] = [1, 2, 6, 7];

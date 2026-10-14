// Armor and weapon classes and the damage table (GAME_DESIGN §6).
// Damage dealt = weapon damage × DAMAGE[weapon class][armor class]. 0 = can't hurt it.

export type ArmorClass = 'infantry' | 'light' | 'heavy' | 'air' | 'ship' | 'sub' | 'structure';
export type WeaponClass = 'gun' | 'cannon' | 'rocket' | 'flak' | 'shell' | 'bomb' | 'missile' | 'torpedo' | 'depth';
export type Layer = 'ground' | 'naval' | 'air';

export const ARMOR_CLASSES: ArmorClass[] = ['infantry', 'light', 'heavy', 'air', 'ship', 'sub', 'structure'];

// The naval triangle: destroyers (depth charges) beat submarines, battleships beat destroyers,
// submarines (torpedoes) beat battleships.
export const DAMAGE: Record<WeaponClass, Record<ArmorClass, number>> = {
  gun: { infantry: 1.0, light: 0.5, heavy: 0.15, air: 0, ship: 0.2, sub: 0.2, structure: 0.1 },
  cannon: { infantry: 0.5, light: 1.0, heavy: 1.0, air: 0, ship: 0.7, sub: 0.4, structure: 0.5 },
  rocket: { infantry: 0.3, light: 1.2, heavy: 1.35, air: 0, ship: 0.8, sub: 0.8, structure: 0.4 },
  flak: { infantry: 0.6, light: 0.4, heavy: 0, air: 1.5, ship: 0, sub: 0, structure: 0 },
  shell: { infantry: 1.0, light: 0.8, heavy: 0.6, air: 0, ship: 1.0, sub: 1.0, structure: 1.25 },
  bomb: { infantry: 0.8, light: 1.0, heavy: 1.0, air: 0, ship: 1.0, sub: 1.0, structure: 1.5 },
  missile: { infantry: 0, light: 0, heavy: 0, air: 1.5, ship: 0, sub: 0, structure: 0 },
  torpedo: { infantry: 0, light: 0, heavy: 0, air: 0, ship: 1.5, sub: 1.0, structure: 0 },
  depth: { infantry: 0, light: 0, heavy: 0, air: 0, ship: 0, sub: 1.6, structure: 0 },
};

/** Veterancy (our twist on plain RTS units): kills earn stars; each star adds these bonuses. */
export const VETERANCY = {
  /** destroyed enemy value needed for each star, in multiples of the unit's own cost */
  thresholds: [1.0, 3.0, 6.0],
  damagePerStar: 0.1,
  hpPerStar: 0.1,
  /** XP scale for a ground or sea unit hurting aircraft (flak would otherwise star up on cheap planes) */
  vsAir: 0.5,
};

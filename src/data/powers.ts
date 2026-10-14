// Command Powers (our twist on the HQ): the HQ and your cities charge Command Points, which you
// spend on map-wide powers. They give a player who is behind on army a way to swing a fight.

export type PowerId = 'recon' | 'supplyDrop' | 'strike' | 'rally' | 'repair' | 'paradrop' | 'help';

export interface PowerDef {
  id: PowerId;
  name: string;
  cost: number;
  /** seconds before it can be used again */
  cooldown: number;
  /** needs a target point on the map */
  targeted: boolean;
  /** needs your vision at the target */
  needsVision?: boolean;
  /** era required (0 = from the start) */
  era: number;
  radius?: number;
  duration?: number;
  hotkey: string;
  desc: string;
}

export const COMMAND = {
  /** Command Points per minute from a living HQ */
  hqRate: 1,
  /** most points you can bank */
  max: 10,
  /** start with this many */
  start: 2,
};

export const POWERS: Record<PowerId, PowerDef> = {
  recon: { id: 'recon', name: 'Recon Flight', cost: 2, cooldown: 30, targeted: true, era: 0, radius: 10, duration: 15, hotkey: 'Z', desc: 'Reveal a wide area for 15 s.' },
  supplyDrop: { id: 'supplyDrop', name: 'Supply Drop', cost: 3, cooldown: 90, targeted: false, era: 0, hotkey: 'X', desc: 'Lend-lease: $300 and 100 oil, plus a minute of the income gap to the richest enemy (up to $2,500 in all). Best when you are behind.' },
  repair: { id: 'repair', name: 'Field Repairs', cost: 2, cooldown: 45, targeted: true, era: 0, radius: 6, hotkey: 'C', desc: 'Your units and buildings in the area heal 35% of their HP.' },
  rally: { id: 'rally', name: 'Rally Cry', cost: 3, cooldown: 60, targeted: true, era: 1, radius: 8, duration: 20, hotkey: 'V', desc: 'Your units in the area: +30% speed and +15% damage for 20 s.' },
  strike: { id: 'strike', name: 'Artillery Strike', cost: 4, cooldown: 75, targeted: true, needsVision: true, era: 1, radius: 3, hotkey: 'G', desc: '8 shells land in the area after a 3 s warning everyone can see.' },
  help: { id: 'help', name: 'Call for Help', cost: 1, cooldown: 20, targeted: true, era: 0, radius: 6, duration: 30, hotkey: 'H', desc: 'Fire a flare only your team sees: allied AI armies come to that spot. (Only with allies.)' },
  paradrop: { id: 'paradrop', name: 'Paradrop', cost: 5, cooldown: 90, targeted: true, needsVision: true, era: 2, hotkey: 'P', desc: 'Drop 5 Riflemen anywhere you can see.' },
};

export const STRIKE = { shells: 8, delay: 3, dmg: 70, splash: 1.5 };
/**
 * Lend-lease: a supply drop pays `minCash` plus `gapSeconds` of the gap between the richest enemy's
 * cash income and yours (at most `maxCash` in all), plus oil. The leader gets the minimum; whoever
 * is behind gets help catching up.
 */
export const SUPPLY_DROP = { minCash: 300, gapSeconds: 60, maxCash: 2500, oil: 100 };
export const RALLY = { speed: 1.3, damage: 1.15 };
export const PARADROP = { unit: 'rifleman', count: 5 };
export const FIELD_REPAIR = 0.35;

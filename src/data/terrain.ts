// Terrain types. A map is a grid of these ids. Movement, building and sight rules read this table.

export const T = {
  DEEP: 0,
  WATER: 1,
  SAND: 2,
  GRASS: 3,
  FOREST: 4,
  HILL: 5,
  MOUNTAIN: 6,
  ROAD: 7,
  RICH: 8, // scorched rich-ore ground around a rich deposit (looks like dirt, behaves like grass)
  BRIDGE: 9, // a bridge over a river: troops cross on the deck, boats pass underneath
} as const;
export type TerrainId = (typeof T)[keyof typeof T];

export interface TerrainDef {
  name: string;
  /** ground speed multiplier; 0 = ground units can't enter */
  ground: number;
  /** ships can sail here */
  naval: boolean;
  buildable: boolean;
  /** extra sight (tiles) for ground units standing here */
  sight: number;
  /** pathfinding cost for ground units (lower is preferred) */
  cost: number;
  /** minimap color (palette index) */
  mini: number;
}

export const TERRAIN: TerrainDef[] = [
  { name: 'Deep water', ground: 0, naval: true, buildable: false, sight: 0, cost: 0, mini: 44 },
  { name: 'Water', ground: 0, naval: true, buildable: false, sight: 0, cost: 0, mini: 46 },
  { name: 'Shore', ground: 1, naval: false, buildable: true, sight: 0, cost: 10, mini: 38 },
  { name: 'Plains', ground: 1, naval: false, buildable: true, sight: 0, cost: 10, mini: 36 },
  { name: 'Forest', ground: 0.6, naval: false, buildable: false, sight: 0, cost: 17, mini: 35 },
  { name: 'Hills', ground: 0.75, naval: false, buildable: true, sight: 2, cost: 13, mini: 37 },
  { name: 'Mountains', ground: 0, naval: false, buildable: false, sight: 0, cost: 0, mini: 6 },
  { name: 'Road', ground: 1.3, naval: false, buildable: true, sight: 0, cost: 7, mini: 4 },
  { name: 'Rich ground', ground: 1, naval: false, buildable: true, sight: 0, cost: 10, mini: 3 },
  { name: 'Bridge', ground: 1.3, naval: true, buildable: false, sight: 0, cost: 7, mini: 7 },
];

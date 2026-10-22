/**
 * Real estate and the 3D town: a grid of land plots around the town square.
 * Companies buy plots and build on them block by block; every block is a real
 * item from their warehouse (bricks, glass, planks...). Houses and land can be
 * sold to other players.
 */
import type { ItemId } from './catalog';

/** The town is WORLD × WORLD plots. */
export const WORLD = 10;
/** Each plot is PLOT × PLOT blocks and up to HEIGHT blocks tall. */
export const PLOT = 8;
export const HEIGHT = 12;
/** Road width between plots (in blocks), for the 3D view. */
export const ROAD = 2;
export const MAX_OPS = 300;

export interface BlockType {
  id: number;
  name: string;
  item: ItemId;
  color: string;
  emoji: string;
  /** see-through (glass) */
  clear?: boolean;
}

export const BLOCKS: BlockType[] = [
  { id: 1, name: 'Brick', item: 'bricks', color: '#b5523b', emoji: '🧱' },
  { id: 2, name: 'Stone', item: 'ore', color: '#8d939c', emoji: '🪨' },
  { id: 3, name: 'Wood', item: 'planks', color: '#c08a52', emoji: '🟫' },
  { id: 4, name: 'Dark wood', item: 'planks', color: '#6b4423', emoji: '🪵' },
  { id: 5, name: 'Window', item: 'glass', color: '#9fd8f0', emoji: '🪟', clear: true },
  { id: 6, name: 'Steel', item: 'steel', color: '#aab4c2', emoji: '🔩' },
  { id: 7, name: 'Roof tile', item: 'fabric', color: '#c23b4a', emoji: '🔺' },
  { id: 8, name: 'Thatch', item: 'wheat', color: '#e0c068', emoji: '🌾' },
  { id: 9, name: 'White brick', item: 'bricks', color: '#efe9de', emoji: '⬜' },
];
export const blockType = (id: number) => BLOCKS.find((b) => b.id === id);

/** A block: [x, y, z, type]. x/z in 0..PLOT-1 across the plot, y is the floor (0 = ground). */
export type Block = [number, number, number, number];
export const blockKey = (x: number, y: number, z: number) => `${x},${y},${z}`;

export const plotId = (gx: number, gy: number) => `p${gx}_${gy}`;

/** Land costs more close to the town square in the middle. */
export function landPrice(gx: number, gy: number, base: number) {
  const c = (WORLD - 1) / 2;
  const d = Math.hypot(gx - c, gy - c);
  const max = Math.hypot(c, c);
  return Math.round((base * (1 + 1.5 * (1 - d / max))) / 10) * 10;
}

/** What a house adds to its plot's value: its materials, plus a builder's premium. */
export function buildingValue(blocks: Block[], price: (item: string) => number) {
  return Math.round(blocks.reduce((s, b) => s + (price(blockType(b[3])?.item ?? '') || 0), 0) * 1.5);
}

/** Can a block go here? Inside the plot, and resting on the ground or touching another block. */
export function supported(set: Set<string>, x: number, y: number, z: number) {
  if (y === 0) return true;
  return [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].some(([dx, dy, dz]) => set.has(blockKey(x + dx, y + dy, z + dz)));
}
export const inPlot = (x: number, y: number, z: number) => Number.isInteger(x) && Number.isInteger(y) && Number.isInteger(z) && x >= 0 && z >= 0 && y >= 0 && x < PLOT && z < PLOT && y < HEIGHT;

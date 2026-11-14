import { B, I } from '../world/registry';
import type { Inventory } from './inventory';

export interface Recipe {
  id: string;
  inputs: Array<[number, number]>;
  output: [number, number];
  bench: boolean; // requires the Tinker Bench
}

/** A deliberately small, coherent economy (survival-crafting skill: each tier opens the next). */
export const RECIPES: Recipe[] = [
  { id: 'planks', inputs: [[B.TIMBER, 1]], output: [B.PLANKS, 4], bench: false },
  { id: 'planks-pine', inputs: [[B.PINE_TIMBER, 1]], output: [B.PLANKS, 4], bench: false },
  { id: 'sticks', inputs: [[B.PLANKS, 2]], output: [I.STICK, 4], bench: false },
  { id: 'bench', inputs: [[B.PLANKS, 4]], output: [B.BENCH, 1], bench: false },
  { id: 'wood-pick', inputs: [[B.PLANKS, 3], [I.STICK, 2]], output: [I.WOOD_PICKAXE, 1], bench: true },
  { id: 'wood-axe', inputs: [[B.PLANKS, 3], [I.STICK, 2]], output: [I.WOOD_AXE, 1], bench: true },
  { id: 'wood-shovel', inputs: [[B.PLANKS, 1], [I.STICK, 2]], output: [I.WOOD_SHOVEL, 1], bench: true },
  { id: 'stone-pick', inputs: [[B.COBBLE, 3], [I.STICK, 2]], output: [I.STONE_PICKAXE, 1], bench: true },
  { id: 'stone-axe', inputs: [[B.COBBLE, 3], [I.STICK, 2]], output: [I.STONE_AXE, 1], bench: true },
  { id: 'stone-shovel', inputs: [[B.COBBLE, 1], [I.STICK, 2]], output: [I.STONE_SHOVEL, 1], bench: true },
  { id: 'copper-pick', inputs: [[I.COPPER, 3], [I.STICK, 2]], output: [I.COPPER_PICKAXE, 1], bench: true },
  { id: 'copper-axe', inputs: [[I.COPPER, 3], [I.STICK, 2]], output: [I.COPPER_AXE, 1], bench: true },
  { id: 'copper-shovel', inputs: [[I.COPPER, 1], [I.STICK, 2]], output: [I.COPPER_SHOVEL, 1], bench: true },
  { id: 'bricks', inputs: [[B.COBBLE, 4]], output: [B.STONE_BRICKS, 4], bench: true },
  { id: 'dunestone', inputs: [[B.SAND, 4]], output: [B.SANDSTONE, 1], bench: true },
  { id: 'glass', inputs: [[B.SAND, 2], [I.COAL, 1]], output: [B.GLASS, 2], bench: true },
  { id: 'lantern', inputs: [[I.CRYSTAL, 1], [B.PLANKS, 2], [I.COAL, 1]], output: [B.LANTERN, 2], bench: true },
  { id: 'lantern-copper', inputs: [[I.COPPER, 2], [I.COAL, 2], [B.GLASS, 1]], output: [B.LANTERN, 1], bench: true },
];

export type CraftResult = 'ok' | 'needs-bench' | 'missing' | 'no-room';

export function canCraft(r: Recipe, inv: Inventory, atBench: boolean): CraftResult {
  if (r.bench && !atBench) return 'needs-bench';
  for (const [id, n] of r.inputs) if (inv.count(id) < n) return 'missing';
  // Simulate removal to check room for the output (freed slots count).
  const snapshot = inv.slots.map((s) => (s ? { ...s } : null));
  inv.muted = true;
  for (const [id, n] of r.inputs) inv.remove(id, n);
  const fits = inv.room(r.output[0]) >= r.output[1];
  inv.slots = snapshot;
  inv.muted = false;
  return fits ? 'ok' : 'no-room';
}

/** Validates everything first, then consumes and adds as one step. */
export function craft(r: Recipe, inv: Inventory, atBench: boolean): CraftResult {
  const res = canCraft(r, inv, atBench);
  if (res !== 'ok') return res;
  for (const [id, n] of r.inputs) inv.remove(id, n);
  inv.add(r.output[0], r.output[1]);
  return 'ok';
}

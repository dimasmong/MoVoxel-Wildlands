/**
 * Block + item registry. Block IDs live in 0..63 and are stored in chunk Uint8Arrays.
 * Non-block items (tools, materials, food) use IDs >= 64 and only ever exist in inventories / drops.
 */

export type RenderKind = 'none' | 'opaque' | 'cutout' | 'cross' | 'water';
export type ToolType = 'none' | 'pickaxe' | 'axe' | 'shovel';
export type SoundKind = 'grass' | 'soil' | 'stone' | 'wood' | 'sand' | 'leaves' | 'glass';

export enum B {
  AIR = 0,
  GRASS = 1,
  SOIL = 2,
  STONE = 3,
  SAND = 4,
  TIMBER = 5,
  PLANKS = 6,
  LEAVES = 7,
  WATER = 8,
  COAL_ORE = 9,
  COPPER_ORE = 10,
  CRYSTAL_ORE = 11,
  COBBLE = 12,
  SANDSTONE = 13,
  GLASS = 14,
  BENCH = 15,
  STONE_BRICKS = 16,
  TALL_GRASS = 17,
  EMBERBLOOM = 18,
  SKYBELL = 19,
  CACTUS = 20,
  DEEPSTONE = 21,
  BERRY_BUSH = 22,
  MOSSY_COBBLE = 23,
  PINE_NEEDLES = 24,
  LANTERN = 25,
  DRY_SHRUB = 26,
  PINE_TIMBER = 27,
}

export enum I {
  STICK = 64,
  COAL = 65,
  COPPER = 66,
  CRYSTAL = 67,
  BERRIES = 68,
  HAUNCH = 69,
  WOOD_PICKAXE = 80,
  WOOD_AXE = 81,
  WOOD_SHOVEL = 82,
  STONE_PICKAXE = 83,
  STONE_AXE = 84,
  STONE_SHOVEL = 85,
  COPPER_PICKAXE = 86,
  COPPER_AXE = 87,
  COPPER_SHOVEL = 88,
}

/** Atlas tile indices (16 x 16 grid of 16px tiles). Painted procedurally in render/textures.ts. */
export enum T {
  GRASS_TOP, GRASS_SIDE, SOIL, STONE, SAND, TIMBER_SIDE, TIMBER_TOP, PLANKS,
  LEAVES, WATER, COAL_ORE, COPPER_ORE, CRYSTAL_ORE, COBBLE, SANDSTONE_SIDE, SANDSTONE_TOP,
  GLASS, BENCH_TOP, BENCH_SIDE, BENCH_FRONT, STONE_BRICKS, TALL_GRASS, EMBERBLOOM, SKYBELL,
  CACTUS_SIDE, CACTUS_TOP, DEEPSTONE, BERRY_BUSH, MOSSY_COBBLE, PINE_NEEDLES, LANTERN, DRY_SHRUB,
  PINE_SIDE, PINE_TOP,
  COUNT,
}

export interface Drop {
  id: number;
  count: number;
  chance?: number;
}

export interface BlockDef {
  id: number;
  name: string;
  render: RenderKind;
  solid: boolean; // collides with entities
  tiles: { top: number; bottom: number; side: number; front?: number };
  hardness: number; // seconds-ish base; <0 = unbreakable
  tool: ToolType;
  minTier: number; // 0 = anything harvests, 1 wood, 2 stone, 3 copper
  drops: Drop[];
  sound: SoundKind;
  replaceable?: boolean; // placing into this block overwrites it (plants)
  needsSoil?: boolean; // plants pop off when the block below vanishes
  emissive?: boolean;
}

const t3 = (all: number) => ({ top: all, bottom: all, side: all });

const blockList: BlockDef[] = [
  { id: B.AIR, name: 'Air', render: 'none', solid: false, tiles: t3(0), hardness: 0, tool: 'none', minTier: 0, drops: [], sound: 'grass', replaceable: true },
  { id: B.GRASS, name: 'Meadow Turf', render: 'opaque', solid: true, tiles: { top: T.GRASS_TOP, bottom: T.SOIL, side: T.GRASS_SIDE }, hardness: 0.6, tool: 'shovel', minTier: 0, drops: [{ id: B.SOIL, count: 1 }], sound: 'grass' },
  { id: B.SOIL, name: 'Loam', render: 'opaque', solid: true, tiles: t3(T.SOIL), hardness: 0.5, tool: 'shovel', minTier: 0, drops: [{ id: B.SOIL, count: 1 }], sound: 'soil' },
  { id: B.STONE, name: 'Slate', render: 'opaque', solid: true, tiles: t3(T.STONE), hardness: 1.5, tool: 'pickaxe', minTier: 1, drops: [{ id: B.COBBLE, count: 1 }], sound: 'stone' },
  { id: B.SAND, name: 'Shore Sand', render: 'opaque', solid: true, tiles: t3(T.SAND), hardness: 0.5, tool: 'shovel', minTier: 0, drops: [{ id: B.SAND, count: 1 }], sound: 'sand' },
  { id: B.TIMBER, name: 'Oakwood Log', render: 'opaque', solid: true, tiles: { top: T.TIMBER_TOP, bottom: T.TIMBER_TOP, side: T.TIMBER_SIDE }, hardness: 2, tool: 'axe', minTier: 0, drops: [{ id: B.TIMBER, count: 1 }], sound: 'wood' },
  { id: B.PLANKS, name: 'Planks', render: 'opaque', solid: true, tiles: t3(T.PLANKS), hardness: 2, tool: 'axe', minTier: 0, drops: [{ id: B.PLANKS, count: 1 }], sound: 'wood' },
  { id: B.LEAVES, name: 'Canopy Leaves', render: 'cutout', solid: true, tiles: t3(T.LEAVES), hardness: 0.25, tool: 'none', minTier: 0, drops: [{ id: I.STICK, count: 1, chance: 0.12 }, { id: I.BERRIES, count: 1, chance: 0.05 }], sound: 'leaves' },
  { id: B.WATER, name: 'Water', render: 'water', solid: false, tiles: t3(T.WATER), hardness: -1, tool: 'none', minTier: 0, drops: [], sound: 'sand', replaceable: true },
  { id: B.COAL_ORE, name: 'Cinder Ore', render: 'opaque', solid: true, tiles: t3(T.COAL_ORE), hardness: 3, tool: 'pickaxe', minTier: 1, drops: [{ id: I.COAL, count: 1 }], sound: 'stone' },
  { id: B.COPPER_ORE, name: 'Rustvein Ore', render: 'opaque', solid: true, tiles: t3(T.COPPER_ORE), hardness: 3, tool: 'pickaxe', minTier: 2, drops: [{ id: I.COPPER, count: 1 }], sound: 'stone' },
  { id: B.CRYSTAL_ORE, name: 'Glimmer Ore', render: 'opaque', solid: true, tiles: t3(T.CRYSTAL_ORE), hardness: 3.5, tool: 'pickaxe', minTier: 3, drops: [{ id: I.CRYSTAL, count: 1 }], sound: 'glass', emissive: true },
  { id: B.COBBLE, name: 'Rubblestone', render: 'opaque', solid: true, tiles: t3(T.COBBLE), hardness: 2, tool: 'pickaxe', minTier: 1, drops: [{ id: B.COBBLE, count: 1 }], sound: 'stone' },
  { id: B.SANDSTONE, name: 'Dunestone', render: 'opaque', solid: true, tiles: { top: T.SANDSTONE_TOP, bottom: T.SANDSTONE_TOP, side: T.SANDSTONE_SIDE }, hardness: 0.8, tool: 'pickaxe', minTier: 1, drops: [{ id: B.SANDSTONE, count: 1 }], sound: 'stone' },
  { id: B.GLASS, name: 'Clearpane', render: 'cutout', solid: true, tiles: t3(T.GLASS), hardness: 0.3, tool: 'none', minTier: 0, drops: [{ id: B.GLASS, count: 1 }], sound: 'glass' },
  { id: B.BENCH, name: 'Tinker Bench', render: 'opaque', solid: true, tiles: { top: T.BENCH_TOP, bottom: T.PLANKS, side: T.BENCH_SIDE, front: T.BENCH_FRONT }, hardness: 2.5, tool: 'axe', minTier: 0, drops: [{ id: B.BENCH, count: 1 }], sound: 'wood' },
  { id: B.STONE_BRICKS, name: 'Slate Bricks', render: 'opaque', solid: true, tiles: t3(T.STONE_BRICKS), hardness: 2, tool: 'pickaxe', minTier: 1, drops: [{ id: B.STONE_BRICKS, count: 1 }], sound: 'stone' },
  { id: B.TALL_GRASS, name: 'Wild Grass', render: 'cross', solid: false, tiles: t3(T.TALL_GRASS), hardness: 0, tool: 'none', minTier: 0, drops: [{ id: B.TALL_GRASS, count: 1, chance: 0.15 }], sound: 'leaves', replaceable: true, needsSoil: true },
  { id: B.EMBERBLOOM, name: 'Emberbloom', render: 'cross', solid: false, tiles: t3(T.EMBERBLOOM), hardness: 0, tool: 'none', minTier: 0, drops: [{ id: B.EMBERBLOOM, count: 1 }], sound: 'leaves', needsSoil: true },
  { id: B.SKYBELL, name: 'Skybell', render: 'cross', solid: false, tiles: t3(T.SKYBELL), hardness: 0, tool: 'none', minTier: 0, drops: [{ id: B.SKYBELL, count: 1 }], sound: 'leaves', needsSoil: true },
  { id: B.CACTUS, name: 'Spinecap', render: 'opaque', solid: true, tiles: { top: T.CACTUS_TOP, bottom: T.CACTUS_TOP, side: T.CACTUS_SIDE }, hardness: 0.4, tool: 'none', minTier: 0, drops: [{ id: B.CACTUS, count: 1 }], sound: 'leaves' },
  { id: B.DEEPSTONE, name: 'Deepstone', render: 'opaque', solid: true, tiles: t3(T.DEEPSTONE), hardness: -1, tool: 'none', minTier: 99, drops: [], sound: 'stone' },
  { id: B.BERRY_BUSH, name: 'Duskberry Bush', render: 'cross', solid: false, tiles: t3(T.BERRY_BUSH), hardness: 0.1, tool: 'none', minTier: 0, drops: [{ id: I.BERRIES, count: 2 }, { id: I.BERRIES, count: 1, chance: 0.5 }], sound: 'leaves', needsSoil: true },
  { id: B.MOSSY_COBBLE, name: 'Mossy Rubble', render: 'opaque', solid: true, tiles: t3(T.MOSSY_COBBLE), hardness: 2, tool: 'pickaxe', minTier: 1, drops: [{ id: B.MOSSY_COBBLE, count: 1 }], sound: 'stone' },
  { id: B.PINE_NEEDLES, name: 'Pine Boughs', render: 'cutout', solid: true, tiles: t3(T.PINE_NEEDLES), hardness: 0.25, tool: 'none', minTier: 0, drops: [{ id: I.STICK, count: 1, chance: 0.15 }], sound: 'leaves' },
  { id: B.LANTERN, name: 'Glimmer Lantern', render: 'opaque', solid: true, tiles: t3(T.LANTERN), hardness: 0.5, tool: 'none', minTier: 0, drops: [{ id: B.LANTERN, count: 1 }], sound: 'glass', emissive: true },
  { id: B.DRY_SHRUB, name: 'Tumbleshrub', render: 'cross', solid: false, tiles: t3(T.DRY_SHRUB), hardness: 0, tool: 'none', minTier: 0, drops: [{ id: I.STICK, count: 1, chance: 0.5 }], sound: 'leaves', replaceable: true, needsSoil: true },
  { id: B.PINE_TIMBER, name: 'Pinewood Log', render: 'opaque', solid: true, tiles: { top: T.PINE_TOP, bottom: T.PINE_TOP, side: T.PINE_SIDE }, hardness: 2, tool: 'axe', minTier: 0, drops: [{ id: B.PINE_TIMBER, count: 1 }], sound: 'wood' },
];

export const BLOCKS: BlockDef[] = [];
for (const b of blockList) BLOCKS[b.id] = b;
export const BLOCK_COUNT = 64;

// Fast lookup tables used by the mesher and physics (indexed by block id).
export const IS_SOLID = new Uint8Array(BLOCK_COUNT);
export const IS_OPAQUE = new Uint8Array(BLOCK_COUNT); // fully hides neighbour faces
export const RENDER_KIND = new Uint8Array(BLOCK_COUNT); // 0 none,1 opaque,2 cutout,3 cross,4 water
const kindCode: Record<RenderKind, number> = { none: 0, opaque: 1, cutout: 2, cross: 3, water: 4 };
for (const b of blockList) {
  IS_SOLID[b.id] = b.solid ? 1 : 0;
  IS_OPAQUE[b.id] = b.render === 'opaque' ? 1 : 0;
  RENDER_KIND[b.id] = kindCode[b.render];
}

export interface ToolInfo {
  type: ToolType;
  tier: number;
  speed: number;
  durability: number;
}

export interface ItemDef {
  id: number;
  name: string;
  maxStack: number;
  tool?: ToolInfo;
  food?: { hunger: number; heal: number };
  description?: string;
}

const itemList: ItemDef[] = [
  { id: I.STICK, name: 'Stick', maxStack: 64, description: 'Handles for tools.' },
  { id: I.COAL, name: 'Cinder Lump', maxStack: 64, description: 'Burns hot. Used for glass.' },
  { id: I.COPPER, name: 'Rustvein Chunk', maxStack: 64, description: 'Soft metal for sturdy tools.' },
  { id: I.CRYSTAL, name: 'Glimmer Shard', maxStack: 64, description: 'Holds a faint inner light.' },
  { id: I.BERRIES, name: 'Duskberries', maxStack: 64, food: { hunger: 3, heal: 0 }, description: 'Tart and filling. Eat with Place.' },
  { id: I.HAUNCH, name: 'Mossback Haunch', maxStack: 64, food: { hunger: 6, heal: 2 }, description: 'Hearty food. Eat with Place.' },
  { id: I.WOOD_PICKAXE, name: 'Wooden Pick', maxStack: 1, tool: { type: 'pickaxe', tier: 1, speed: 2, durability: 60 } },
  { id: I.WOOD_AXE, name: 'Wooden Hatchet', maxStack: 1, tool: { type: 'axe', tier: 1, speed: 2, durability: 60 } },
  { id: I.WOOD_SHOVEL, name: 'Wooden Spade', maxStack: 1, tool: { type: 'shovel', tier: 1, speed: 2, durability: 60 } },
  { id: I.STONE_PICKAXE, name: 'Rubble Pick', maxStack: 1, tool: { type: 'pickaxe', tier: 2, speed: 4, durability: 132 } },
  { id: I.STONE_AXE, name: 'Rubble Hatchet', maxStack: 1, tool: { type: 'axe', tier: 2, speed: 4, durability: 132 } },
  { id: I.STONE_SHOVEL, name: 'Rubble Spade', maxStack: 1, tool: { type: 'shovel', tier: 2, speed: 4, durability: 132 } },
  { id: I.COPPER_PICKAXE, name: 'Rustvein Pick', maxStack: 1, tool: { type: 'pickaxe', tier: 3, speed: 6, durability: 250 } },
  { id: I.COPPER_AXE, name: 'Rustvein Hatchet', maxStack: 1, tool: { type: 'axe', tier: 3, speed: 6, durability: 250 } },
  { id: I.COPPER_SHOVEL, name: 'Rustvein Spade', maxStack: 1, tool: { type: 'shovel', tier: 3, speed: 6, durability: 250 } },
];

export const ITEMS = new Map<number, ItemDef>();
for (const b of blockList) {
  if (b.id === B.AIR || b.id === B.WATER) continue;
  ITEMS.set(b.id, { id: b.id, name: b.name, maxStack: 64 });
}
for (const it of itemList) ITEMS.set(it.id, it);

export const isBlockItem = (id: number): boolean => id > 0 && id < BLOCK_COUNT && BLOCKS[id] !== undefined;
export const itemName = (id: number): string => ITEMS.get(id)?.name ?? `Item ${id}`;
export const maxStack = (id: number): number => ITEMS.get(id)?.maxStack ?? 64;

/** Blocks offered in the Creative palette. */
export const CREATIVE_PALETTE: number[] = [
  B.GRASS, B.SOIL, B.STONE, B.COBBLE, B.MOSSY_COBBLE, B.STONE_BRICKS, B.SAND, B.SANDSTONE,
  B.TIMBER, B.PINE_TIMBER, B.PLANKS, B.LEAVES, B.PINE_NEEDLES, B.GLASS, B.LANTERN, B.BENCH,
  B.COAL_ORE, B.COPPER_ORE, B.CRYSTAL_ORE, B.CACTUS, B.TALL_GRASS, B.EMBERBLOOM, B.SKYBELL,
  B.BERRY_BUSH, B.DRY_SHRUB,
  I.STICK, I.COAL, I.COPPER, I.CRYSTAL, I.BERRIES, I.HAUNCH,
  I.COPPER_PICKAXE, I.COPPER_AXE, I.COPPER_SHOVEL,
];

/** Seconds to break a block with a given held item (Minecraft-like formula, own tuning). */
export function breakTime(blockId: number, heldId: number): number {
  const def = BLOCKS[blockId];
  if (!def || def.hardness < 0) return Infinity;
  if (def.hardness === 0) return 0.05;
  const tool = ITEMS.get(heldId)?.tool;
  const toolMatches = !!tool && tool.type === def.tool;
  const tier = toolMatches ? tool!.tier : 0;
  const canHarvest = def.minTier === 0 || tier >= def.minTier;
  const speed = toolMatches ? tool!.speed : 1;
  return (def.hardness * (canHarvest ? 1.5 : 5)) / speed;
}

export function canHarvest(blockId: number, heldId: number): boolean {
  const def = BLOCKS[blockId];
  if (!def) return false;
  if (def.minTier === 0) return true;
  const tool = ITEMS.get(heldId)?.tool;
  return !!tool && tool.type === def.tool && tool.tier >= def.minTier;
}

# MoVoxel: Wildlands

**MoVoxel: Wildlands** is an original, standalone 3D voxel survival and building sandbox for Web, Desktop, and Android browsers, built with **Vite + TypeScript + Three.js (r187)**.

It captures the core gameplay loops of a block-based survival sandbox—procedural cubic terrain, first-person exploration, block mining and placement, resource gathering, tool progression, crafting, survival vitals, day/night atmosphere, and persistent local saves—with an **original visual identity**, **procedurally painted 16×16 pixel textures**, **original creatures** (*Mossback* & *Gloomling*), and **synthesized Web Audio**.

---

## Quick Start

```bash
cd movoxel-wildlands
npm install
npm run dev      # Starts local dev server at http://localhost:5178/
npm run build    # Type-checks (tsc --noEmit) and builds static bundle in dist/
npm run preview  # Previews the production build locally
```

The production output in `dist/` uses relative asset paths (`base: './'`) so it can be deployed directly to **Vercel**, **GitHub Pages**, or any static host with zero backend dependencies.

---

## Controls

### Desktop (Keyboard & Mouse)
| Input | Action |
|---|---|
| **W / A / S / D** (or Arrow Keys) | Move (physical keycodes; layout-independent) |
| **Mouse** (Pointer Lock) | First-person look & crosshair aim |
| **Space** | Jump / Swim up / **Double-tap Space** in Creative to toggle flight |
| **Left Shift** | Sprint (or fast flight) |
| **Left Ctrl / C** | Sneak / Crouch (prevents walking off block edges; lowers flight) |
| **Left Click (Hold)** | Mine targeted block / Attack creature |
| **Right Click** | Place selected block / Eat held food / Open **Tinker Bench** |
| **1 – 9** or **Mouse Wheel** | Select hotbar slot |
| **E** or **I** | Open / Close Field Pack & Crafting |
| **Q** | Toss 1 item from held stack |
| **F5** or **V** | Toggle First-Person / Third-Person Camera |
| **F3** | Toggle FPS, Draw Calls, Chunk & Biome Telemetry |
| **Esc** | Pause / Release Pointer Lock / Close Modal |

### Mobile / Android (Multi-Touch)
- **Left Virtual Joystick**: Analog movement with radial deadzone; push to outer ring to sprint.
- **Right Touch Region**: Drag to look around simultaneously while moving and jumping.
- **Action Buttons**: Accessible **Mine**, **Place**, **Jump**, **Sneak**, **Fly** (Creative), and **Pack** buttons.
- **Hotbar**: Tap any of the 9 slots directly with your thumb.
- **Portrait Notice**: Shows a non-blocking banner on narrow portrait screens suggesting landscape mode.

---

## Architecture & Coordinate Conventions

- **Coordinate Space**: `+Y` is up. `1` world unit = `1` cubic block. Block `(x, y, z)` occupies `[x, x+1) × [y, y+1) × [z, z+1)`.
- **Chunk Model**: `16 × 128 × 16` columns (`CHUNK_SIZE = 16`, `WORLD_HEIGHT = 128`, `SEA_LEVEL = 34`), stored in flat `Uint8Array(32768)` buffers indexed by `x + (z << 4) + (y << 8)` so vertical columns are contiguous.
- **Deterministic Seeded Generation (`src/world/generator.ts`)**:
  - Uses our own `mulberry32` PRNG, integer spatial hashes (`hash2`/`hash3`), and `SimplexNoise` instances with independent child seeds per noise field so elevation, temperature, and moisture never correlate into bands.
  - **Biomes**: Grassy Plains, Pine & Oakwood Forests, and Sunbleached Shores/Dunes with smooth transitions, ponds, cave tunnels, ore veins (*Cinder Ore*, *Rustvein Ore*, *Glimmer Ore*), and *Wardstone* ring landmarks.
  - Runs off-thread in a **Web Worker pool** (`src/world/generator.worker.ts`) with main-thread fallback.
- **Chunk Meshing (`src/world/mesher.ts`)**:
  - Emits **only exposed faces** between non-occluding neighbors across 3×3 padded chunk neighborhoods.
  - Separates geometry into three batched passes per chunk: **Opaque/Cutout** (`alphaTest: 0.5`), **Cross Foliage**, and **Transparent Water** (`depthWrite: false`), avoiding per-cube `THREE.Mesh` objects and keeping draw calls low.
  - Computes per-vertex ambient occlusion (4-level curve) and smoothed sky-exposure lighting, flipping quad diagonals when AO is anisotropic.
  - Rebuilds **only dirty chunks** and adjacent border chunks when blocks are mined or placed on a chunk boundary (`x = 0/15`, `z = 0/15`).
- **Physics & Collision (`src/game/player.ts`)**:
  - Runs on a **fixed 60 Hz timestep** (`FIXED_DT = 1/60`) with sub-stepped axis-separated AABB voxel collision so the player never tunnels through thin walls or falls through terrain.
  - Rendering interpolates between `prev` and current physics states each frame (`camera-systems` + `physics-tuning`).

---

## Save & Load Persistence (`src/save/db.ts`)

- **IndexedDB (`movoxel-wildlands`)** stores:
  - `worlds`: World metadata, seed, mode, player position/orientation/health/hunger/spawn, inventory stacks + tool durability, time-of-day, and `version: 1`.
  - `backups`: Previous good world snapshot written atomically in the same transaction before updating `worlds`, providing automatic fallback if a save record is corrupted.
  - `chunks`: Sparse per-chunk player block edits (`[localIndex, blockId, ...]`), so regenerating deterministic terrain + replaying edits reproduces every mined and placed block across page reloads.
- **Settings (`localStorage`)**: Stores lightweight preferences (`movoxel-wildlands.settings.v1`) such as FOV, sensitivity, render distance, quality preset, audio sliders, and accessibility toggles.

---

## Module Structure

```text
movoxel-wildlands/
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
└── src/
    ├── main.ts                  # Entry point
    ├── style.css                # Responsive HUD & menu styling
    ├── settings.ts              # Quality presets & localStorage settings
    ├── core/
    │   ├── constants.ts         # Chunk dimensions, tick rate, save version
    │   ├── rng.ts               # Deterministic FNV-1a, Mulberry32, spatial hashes
    │   └── noise.ts             # Seeded 2D/3D Simplex noise + fBm
    ├── world/
    │   ├── registry.ts          # Block & item definitions, hardness, tool tiers
    │   ├── generator.ts         # Biomes, caves, ores, trees, Wardstone landmarks
    │   ├── generator.worker.ts  # Background chunk generation worker
    │   ├── chunk.ts             # Compact Uint8Array chunk container
    │   ├── mesher.ts            # Exposed-face culling, vertex AO, sky lighting
    │   └── world.ts             # Chunk streaming, border dirtying, mesh disposal
    ├── render/
    │   ├── textures.ts          # Procedural 16x16 pixel-art atlas & crack stages
    │   ├── icons.ts             # Isometric block & pixel tool/item icons
    │   ├── materials.ts         # Nearest-neighbor sRGB materials & emissive map
    │   ├── sky.ts               # Day/night dome, sun, moon, stars, blocky clouds
    │   ├── effects.ts           # Selection wireframe, crack overlay, debris, fireflies
    │   └── hand.ts              # First-person arm & held item/block view-model
    ├── game/
    │   ├── player.ts            # Fixed-step AABB collision, crouch guard, flight
    │   ├── raycast.ts           # Amanatides & Woo DDA voxel raycaster
    │   ├── inventory.ts         # 9-slot hotbar + 27-slot backpack + durability
    │   ├── crafting.ts          # Atomic recipes (hand & Tinker Bench)
    │   ├── entities.ts          # Collectible drops + Mossback & Gloomling AI
    │   ├── input.ts             # Pointer lock, physical keys, multi-touch joystick
    │   └── game.ts              # Main loop, survival rules, camera & autosave
    ├── save/
    │   └── db.ts                # Versioned IndexedDB persistence + backup recovery
    └── audio/
        └── audio.ts             # Synthesized Web Audio SFX & dynamic wind/birds
```

import * as THREE from 'three';
import { IS_SOLID, I, isBlockItem, RENDER_KIND } from '../world/registry';
import type { World } from '../world/world';
import type { WorldMaterials } from '../render/materials';
import { itemObject } from '../render/hand';

/** Minimal voxel collision for small entities (axis-separated, sub-stepped). */
export interface Body {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  hw: number; h: number;
  onGround: boolean;
  hitWall: boolean;
}

function solid(world: World, x: number, y: number, z: number): boolean {
  const id = world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z));
  return id < 0 || IS_SOLID[id] === 1;
}

function boxHits(world: World, b: Body, x: number, y: number, z: number): boolean {
  const e = 1e-4;
  for (let by = Math.floor(y + e); by <= Math.floor(y + b.h - e); by++)
    for (let bz = Math.floor(z - b.hw + e); bz <= Math.floor(z + b.hw - e); bz++)
      for (let bx = Math.floor(x - b.hw + e); bx <= Math.floor(x + b.hw - e); bx++)
        if (solid(world, bx + 0.5, by + 0.5, bz + 0.5)) return true;
  return false;
}

export function moveBody(world: World, b: Body, dt: number, gravity: number): void {
  b.vy -= gravity * dt;
  if (b.vy < -40) b.vy = -40;
  const steps = Math.max(1, Math.ceil((Math.max(Math.abs(b.vx), Math.abs(b.vy), Math.abs(b.vz)) * dt) / 0.4));
  const sdt = dt / steps;
  b.onGround = false;
  b.hitWall = false;
  for (let s = 0; s < steps; s++) {
    const ny = b.y + b.vy * sdt;
    if (boxHits(world, b, b.x, ny, b.z)) {
      if (b.vy < 0) { b.y = Math.floor(ny) + 1; b.onGround = true; }
      b.vy = 0;
    } else b.y = ny;
    const nx = b.x + b.vx * sdt;
    if (boxHits(world, b, nx, b.y, b.z)) { b.vx = 0; b.hitWall = true; } else b.x = nx;
    const nz = b.z + b.vz * sdt;
    if (boxHits(world, b, b.x, b.y, nz)) { b.vz = 0; b.hitWall = true; } else b.z = nz;
  }
}

// ------------------------------------------------------------------------- dropped items
export interface DroppedItem {
  body: Body;
  id: number;
  count: number;
  dur?: number;
  age: number;
  mesh: THREE.Mesh;
  pickupDelay: number;
}

export class DropSystem {
  readonly items: DroppedItem[] = [];
  constructor(private scene: THREE.Scene, private materials: WorldMaterials) {}

  spawn(x: number, y: number, z: number, id: number, count: number, dur?: number, toss?: THREE.Vector3): void {
    if (this.items.length > 200) this.remove(this.items[0]);
    const mesh = itemObject(id, this.materials, 0.26, 0.42);
    mesh.castShadow = false;
    this.scene.add(mesh);
    const body: Body = {
      x, y, z,
      vx: toss ? toss.x : (Math.random() - 0.5) * 2.2,
      vy: toss ? toss.y : 3 + Math.random() * 1.5,
      vz: toss ? toss.z : (Math.random() - 0.5) * 2.2,
      hw: 0.13, h: 0.26, onGround: false, hitWall: false,
    };
    this.items.push({ body, id, count, dur, age: 0, mesh, pickupDelay: toss ? 1.2 : 0.35 });
  }

  private remove(it: DroppedItem): void {
    const i = this.items.indexOf(it);
    if (i >= 0) this.items.splice(i, 1);
    this.scene.remove(it.mesh);
    it.mesh.geometry.dispose();
  }

  /** Updates physics; calls `collect` for items near the player and removes them if fully taken. */
  update(dt: number, world: World, px: number, py: number, pz: number, collect: (it: DroppedItem) => number, camera: THREE.Camera): void {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.age += dt;
      it.pickupDelay -= dt;
      const b = it.body;
      if (!world.isLoadedAt(b.x, b.z)) continue;
      // Fall out if trapped inside a block (e.g. placed over).
      if (boxHits(world, b, b.x, b.y, b.z)) b.y += dt * 4;
      moveBody(world, b, dt, 18);
      if (b.onGround) { b.vx *= Math.exp(-8 * dt); b.vz *= Math.exp(-8 * dt); }
      const dx = px - b.x, dy = py + 0.6 - b.y, dz = pz - b.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (it.pickupDelay <= 0 && d2 < 4.5) {
        // Magnet toward the player, then collect when close.
        const d = Math.sqrt(d2) || 1;
        b.vx += (dx / d) * 30 * dt;
        b.vz += (dz / d) * 30 * dt;
        b.vy += (dy / d) * 30 * dt;
        if (d2 < 0.8) {
          const left = collect(it);
          if (left <= 0) { this.remove(it); continue; }
          it.count = left;
          it.pickupDelay = 1;
        }
      }
      if (it.age > 300) { this.remove(it); continue; }
      const bob = Math.sin(it.age * 3) * 0.06;
      it.mesh.position.set(b.x, b.y + 0.18 + bob, b.z);
      if (isBlockItem(it.id) && RENDER_KIND[it.id] !== 3) it.mesh.rotation.y = it.age * 1.6;
      else it.mesh.quaternion.copy(camera.quaternion); // billboard sprites
    }
  }

  clear(): void {
    for (const it of [...this.items]) this.remove(it);
  }
}

// ------------------------------------------------------------------------- creatures
export type MobKind = 'mossback' | 'gloomling';

export interface Mob {
  kind: MobKind;
  body: Body;
  group: THREE.Group;
  health: number;
  yaw: number;
  targetYaw: number;
  wanderT: number;
  hurtT: number;
  attackCd: number;
  legs: THREE.Object3D[];
  walkT: number;
  fade: number; // gloomlings dissolve in daylight
  flashMats: THREE.MeshLambertMaterial[];
}

function lambert(color: number, emissive = 0x000000): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ color, emissive });
}

/** Mossback: a slow, round-shelled grazer with a garden growing on its back (original design). */
function buildMossback(): { group: THREE.Group; legs: THREE.Object3D[]; mats: THREE.MeshLambertMaterial[] } {
  const g = new THREE.Group();
  const shell = lambert(0x7a5a3a), moss = lambert(0x5d9a44), belly = lambert(0xd9c49a), skin = lambert(0x9c8a6a), eye = lambert(0x1a1410);
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.5, 1.1), shell);
  body.position.y = 0.55;
  const mossTop = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.16, 1.0), moss);
  mossTop.position.y = 0.88;
  const flower = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.18, 0.12), lambert(0xe86a3a, 0x220800));
  flower.position.set(0.18, 1.04, -0.2);
  const sprout = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.22, 0.08), moss);
  sprout.position.set(-0.22, 1.06, 0.25);
  const under = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.12, 1.0), belly);
  under.position.y = 0.3;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.36, 0.36), skin);
  head.position.set(0, 0.62, -0.68);
  const e1 = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.02), eye);
  e1.position.set(0.12, 0.68, -0.865);
  const e2 = e1.clone();
  e2.position.x = -0.12;
  g.add(body, mossTop, flower, sprout, under, head, e1, e2);
  const legs: THREE.Object3D[] = [];
  for (const [x, z] of [[0.3, 0.38], [-0.3, 0.38], [0.3, -0.38], [-0.3, -0.38]]) {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.3, z);
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.3, 0.2), skin);
    leg.position.y = -0.15;
    pivot.add(leg);
    g.add(pivot);
    legs.push(pivot);
  }
  return { group: g, legs, mats: [shell, moss, belly, skin] };
}

/** Gloomling: a hopping shadow-cube with lantern eyes that only roams at night (original design). */
function buildGloomling(): { group: THREE.Group; legs: THREE.Object3D[]; mats: THREE.MeshLambertMaterial[] } {
  const g = new THREE.Group();
  const body = lambert(0x2a2240, 0x0a0614), rim = lambert(0x463a6a, 0x0c0818), eyeM = lambert(0xbfffe0, 0x9fffd0);
  const cube = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.8), body);
  cube.position.y = 0.4;
  const crown = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.18, 0.5), rim);
  crown.position.y = 0.88;
  const e1 = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, 0.04), eyeM);
  e1.position.set(0.18, 0.5, -0.41);
  const e2 = e1.clone();
  e2.position.x = -0.18;
  g.add(cube, crown, e1, e2);
  return { group: g, legs: [cube], mats: [body, rim] };
}

export class MobSystem {
  readonly mobs: Mob[] = [];
  private spawnTimer = 3;

  constructor(private scene: THREE.Scene) {}

  private add(kind: MobKind, x: number, y: number, z: number): Mob {
    const built = kind === 'mossback' ? buildMossback() : buildGloomling();
    built.group.traverse((o) => { if (o instanceof THREE.Mesh) o.castShadow = true; });
    this.scene.add(built.group);
    const mob: Mob = {
      kind,
      body: { x, y, z, vx: 0, vy: 0, vz: 0, hw: kind === 'mossback' ? 0.45 : 0.4, h: kind === 'mossback' ? 1.0 : 0.85, onGround: false, hitWall: false },
      group: built.group,
      health: kind === 'mossback' ? 8 : 10,
      yaw: Math.random() * Math.PI * 2,
      targetYaw: 0,
      wanderT: 0,
      hurtT: 0,
      attackCd: 0,
      legs: built.legs,
      walkT: 0,
      fade: 1,
      flashMats: built.mats,
    };
    this.mobs.push(mob);
    return mob;
  }

  remove(m: Mob): void {
    const i = this.mobs.indexOf(m);
    if (i >= 0) this.mobs.splice(i, 1);
    this.scene.remove(m.group);
    m.group.traverse((o) => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
  }

  clear(): void {
    for (const m of [...this.mobs]) this.remove(m);
  }

  /** Ray vs mob AABB; returns nearest mob and distance. */
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxD: number): { mob: Mob; dist: number } | null {
    let best: { mob: Mob; dist: number } | null = null;
    for (const m of this.mobs) {
      const b = m.body;
      const min = [b.x - b.hw, b.y, b.z - b.hw], max = [b.x + b.hw, b.y + b.h, b.z + b.hw];
      const o = [ox, oy, oz], d = [dx, dy, dz];
      let t0 = 0, t1 = maxD, ok = true;
      for (let a = 0; a < 3; a++) {
        if (Math.abs(d[a]) < 1e-9) { if (o[a] < min[a] || o[a] > max[a]) { ok = false; break; } continue; }
        let ta = (min[a] - o[a]) / d[a], tb = (max[a] - o[a]) / d[a];
        if (ta > tb) [ta, tb] = [tb, ta];
        t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
        if (t0 > t1) { ok = false; break; }
      }
      if (ok && (!best || t0 < best.dist)) best = { mob: m, dist: t0 };
    }
    return best;
  }

  /** Returns true if the mob died. */
  hit(m: Mob, damage: number, fromX: number, fromZ: number): boolean {
    m.health -= damage;
    m.hurtT = 0.35;
    const dx = m.body.x - fromX, dz = m.body.z - fromZ;
    const d = Math.hypot(dx, dz) || 1;
    m.body.vx = (dx / d) * 6;
    m.body.vz = (dz / d) * 6;
    m.body.vy = 5;
    if (m.kind === 'mossback') m.wanderT = 4; // flee
    return m.health <= 0;
  }

  update(
    dt: number,
    world: World,
    player: { x: number; y: number; z: number },
    night: number,
    allowHostile: boolean,
    onPlayerHit: (dmg: number, fromX: number, fromZ: number) => void,
  ): void {
    // ---- spawning around the player, capped
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = 4;
      const passive = this.mobs.filter((m) => m.kind === 'mossback').length;
      const hostile = this.mobs.length - passive;
      if (passive < 5) this.trySpawn(world, player, 'mossback');
      if (allowHostile && night > 0.7 && hostile < 4) this.trySpawn(world, player, 'gloomling');
    }

    for (const m of [...this.mobs]) {
      const b = m.body;
      const dx = player.x - b.x, dz = player.z - b.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 80 || !world.isLoadedAt(b.x, b.z)) { this.remove(m); continue; }
      m.hurtT = Math.max(0, m.hurtT - dt);
      m.attackCd = Math.max(0, m.attackCd - dt);
      let speed = 0;
      if (m.kind === 'mossback') {
        m.wanderT -= dt;
        if (m.wanderT <= 0) {
          m.wanderT = 2 + Math.random() * 5;
          m.targetYaw = Math.random() * Math.PI * 2;
          speed = 0;
        }
        const fleeing = m.hurtT > 0 || (m.wanderT > 3.5 && m.health < 8);
        if (fleeing) m.targetYaw = Math.atan2(-dx, -dz) + Math.PI;
        speed = fleeing ? 3.2 : m.wanderT > 1.2 ? 1.1 : 0;
        if (Math.random() < dt * 0.05 && dist < 16) (m as Mob & { cry?: boolean }).cry = true;
      } else {
        // Gloomling: hop toward the player when close, dissolve in daylight.
        if (night < 0.4) m.fade -= dt * 0.5;
        if (m.fade <= 0) { this.remove(m); continue; }
        if (dist < 18 && Math.abs(player.y - b.y) < 8) {
          m.targetYaw = Math.atan2(-dx, -dz);
          speed = 2.6;
          if (b.onGround && Math.random() < dt * 2.5) b.vy = 6.5;
        } else {
          m.wanderT -= dt;
          if (m.wanderT <= 0) { m.wanderT = 3 + Math.random() * 3; m.targetYaw = Math.random() * Math.PI * 2; }
          speed = 0.8;
        }
        if (dist < 1.1 && Math.abs(player.y - b.y) < 1.6 && m.attackCd <= 0) {
          m.attackCd = 1.1;
          onPlayerHit(3, b.x, b.z);
        }
        for (const mat of m.flashMats) { mat.transparent = m.fade < 1; mat.opacity = m.fade; }
      }
      // Turn smoothly toward the target heading.
      let dy = m.targetYaw - m.yaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      m.yaw += dy * (1 - Math.exp(-5 * dt));
      if (m.hurtT <= 0.2) {
        const k = 1 - Math.exp(-6 * dt);
        b.vx += (-Math.sin(m.yaw) * speed - b.vx) * k;
        b.vz += (-Math.cos(m.yaw) * speed - b.vz) * k;
      }
      moveBody(world, b, dt, 26);
      if (b.hitWall && b.onGround) b.vy = 7.5; // hop up single steps
      if (b.y < -10) { this.remove(m); continue; }

      // Animate
      const hv = Math.hypot(b.vx, b.vz);
      m.walkT += dt * hv * 4;
      m.group.position.set(b.x, b.y, b.z);
      m.group.rotation.y = m.yaw;
      if (m.kind === 'mossback') {
        m.legs.forEach((l, i) => (l.rotation.x = Math.sin(m.walkT + (i % 2 === 0 ? 0 : Math.PI)) * 0.6 * Math.min(1, hv)));
      } else {
        const squash = b.onGround ? 1 : 1.12;
        m.legs[0].scale.set(1 / Math.sqrt(squash), squash, 1 / Math.sqrt(squash));
      }
      const red = m.hurtT > 0 ? 0.6 : 0;
      for (const mat of m.flashMats) mat.emissive.setRGB(red, 0, 0);
    }
  }

  private trySpawn(world: World, player: { x: number; y: number; z: number }, kind: MobKind): void {
    for (let attempt = 0; attempt < 6; attempt++) {
      const ang = Math.random() * Math.PI * 2;
      const r = kind === 'mossback' ? 16 + Math.random() * 20 : 14 + Math.random() * 16;
      const x = Math.floor(player.x + Math.cos(ang) * r);
      const z = Math.floor(player.z + Math.sin(ang) * r);
      if (!world.isLoadedAt(x, z)) continue;
      const y = world.surfaceY(x, z);
      if (y < 0) continue;
      const ground = world.getBlock(x, y, z);
      if (kind === 'mossback' && ground !== 1) continue; // grass only
      if (ground === 8 || ground < 0) continue;
      if (IS_SOLID[world.getBlock(x, y + 1, z)] || IS_SOLID[world.getBlock(x, y + 2, z)]) continue;
      this.add(kind, x + 0.5, y + 1, z + 0.5);
      return;
    }
  }

  static dropFor(kind: MobKind): Array<[number, number]> {
    return kind === 'mossback' ? [[I.HAUNCH, 1 + Math.floor(Math.random() * 2)]] : [[I.COAL, 1]];
  }
}

import { BLOCKS, IS_SOLID, B } from '../world/registry';
import type { World } from '../world/world';

export interface MoveInput {
  forward: number; // -1..1
  right: number; // -1..1
  jump: boolean; // held
  sprint: boolean;
  crouch: boolean;
}

const HALF_W = 0.3;
const STAND_H = 1.8;
const CROUCH_H = 1.5;
const EPS = 1e-4;

export const PLAYER_TUNING = {
  walk: 4.4,
  sprint: 5.9,
  crouch: 1.6,
  fly: 11,
  flySprint: 20,
  gravity: 30,
  jumpVel: 9.1,
  groundAccel: 20,
  airAccel: 6,
  terminal: 52,
  swimUp: 4.2,
};

/**
 * Kinematic AABB player that moves axis-by-axis through the voxel grid (physics-tuning skill:
 * simulate on a fixed step, clamp per-step travel below one block so it can never tunnel).
 */
export class Player {
  x = 0; y = 80; z = 0;
  vx = 0; vy = 0; vz = 0;
  prevX = 0; prevY = 80; prevZ = 0;
  yaw = 0;
  pitch = 0;
  onGround = false;
  inWater = false;
  headInWater = false;
  flying = false;
  crouching = false;
  sprinting = false;
  height = STAND_H;
  private fallStartY = 0;
  private wasOnGround = false;
  /** Set when landing; read and cleared by the game for fall damage / landing feedback. */
  landedFall = -1;
  stepDistance = 0;

  get eyeHeight(): number {
    return this.height - 0.18;
  }

  teleport(x: number, y: number, z: number): void {
    this.x = this.prevX = x;
    this.y = this.prevY = y;
    this.z = this.prevZ = z;
    this.vx = this.vy = this.vz = 0;
    this.fallStartY = y;
  }

  private solidAt(world: World, bx: number, by: number, bz: number): boolean {
    const id = world.getBlock(bx, by, bz);
    if (id < 0) return true; // unloaded chunks are walls, never a void to fall into
    return IS_SOLID[id] === 1;
  }

  private collides(world: World, x: number, y: number, z: number, h: number): boolean {
    const x0 = Math.floor(x - HALF_W + EPS), x1 = Math.floor(x + HALF_W - EPS);
    const y0 = Math.floor(y + EPS), y1 = Math.floor(y + h - EPS);
    const z0 = Math.floor(z - HALF_W + EPS), z1 = Math.floor(z + HALF_W - EPS);
    for (let by = y0; by <= y1; by++)
      for (let bz = z0; bz <= z1; bz++)
        for (let bx = x0; bx <= x1; bx++) if (this.solidAt(world, bx, by, bz)) return true;
    return false;
  }

  /** Does the AABB at (x, z) have ground directly beneath it? Used for crouch edge-guard. */
  private supported(world: World, x: number, z: number): boolean {
    return this.collides(world, x, this.y - 0.08, z, 0.07);
  }

  /** Whether a block cell intersects the player's body (placement guard). */
  intersectsBlock(bx: number, by: number, bz: number): boolean {
    return (
      bx + 1 > this.x - HALF_W && bx < this.x + HALF_W &&
      by + 1 > this.y && by < this.y + this.height &&
      bz + 1 > this.z - HALF_W && bz < this.z + HALF_W
    );
  }

  step(dt: number, input: MoveInput, world: World, canFly: boolean): void {
    this.prevX = this.x;
    this.prevY = this.y;
    this.prevZ = this.z;
    const T = PLAYER_TUNING;

    const feetBlock = world.getBlock(Math.floor(this.x), Math.floor(this.y + 0.2), Math.floor(this.z));
    const headBlock = world.getBlock(Math.floor(this.x), Math.floor(this.y + this.eyeHeight), Math.floor(this.z));
    this.inWater = feetBlock === B.WATER;
    this.headInWater = headBlock === B.WATER;
    if (!canFly) this.flying = false;

    // Crouch with headroom check before standing back up.
    const wantCrouch = input.crouch && !this.flying;
    if (wantCrouch) {
      this.crouching = true;
      this.height = CROUCH_H;
    } else if (this.crouching) {
      if (!this.collides(world, this.x, this.y, this.z, STAND_H)) {
        this.crouching = false;
        this.height = STAND_H;
      }
    }

    // Desired horizontal velocity in world space.
    let f = input.forward, r = input.right;
    const len = Math.hypot(f, r);
    if (len > 1) { f /= len; r /= len; }
    this.sprinting = input.sprint && f > 0.3 && !this.crouching;
    let speed = this.flying ? (input.sprint ? T.flySprint : T.fly) : this.crouching ? T.crouch : this.sprinting ? T.sprint : T.walk;
    if (this.inWater && !this.flying) speed *= 0.55;
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    // Camera looks down -Z at yaw 0.
    const tx = (-sin * f + cos * r) * speed;
    const tz = (-cos * f - sin * r) * speed;
    const accel = this.flying ? 10 : this.onGround ? T.groundAccel : this.inWater ? 8 : T.airAccel;
    const k = 1 - Math.exp(-accel * dt);
    this.vx += (tx - this.vx) * k;
    this.vz += (tz - this.vz) * k;

    if (this.flying) {
      const vyT = (input.jump ? 1 : 0) - (input.crouch ? 1 : 0);
      this.vy += (vyT * T.fly * 0.8 - this.vy) * (1 - Math.exp(-10 * dt));
    } else if (this.inWater) {
      this.vy -= T.gravity * 0.25 * dt;
      if (input.jump) this.vy = Math.min(this.vy + 30 * dt, T.swimUp);
      this.vy = Math.max(this.vy, -4);
      this.vy *= 1 - Math.min(1, 2 * dt);
    } else {
      if (input.jump && this.onGround) {
        this.vy = T.jumpVel;
        this.onGround = false;
      }
      this.vy -= T.gravity * dt;
      if (this.vy < -T.terminal) this.vy = -T.terminal;
    }

    // Integrate with sub-steps so no single move exceeds 0.45 blocks.
    const maxD = Math.max(Math.abs(this.vx), Math.abs(this.vy), Math.abs(this.vz)) * dt;
    const steps = Math.max(1, Math.ceil(maxD / 0.45));
    const sdt = dt / steps;
    this.onGround = false;
    const startX = this.x, startZ = this.z;
    for (let s = 0; s < steps; s++) {
      this.moveAxis(world, 1, this.vy * sdt);
      const guard = this.crouching && (this.wasOnGround || this.onGround) && !this.flying;
      this.moveAxis(world, 0, this.vx * sdt, guard);
      this.moveAxis(world, 2, this.vz * sdt, guard);
    }
    if (this.onGround || this.flying || this.inWater) {
      if (this.onGround && !this.wasOnGround && !this.flying && !this.inWater) {
        this.landedFall = this.fallStartY - this.y;
      }
      this.fallStartY = this.y;
    } else if (this.y > this.fallStartY) {
      this.fallStartY = this.y;
    }
    if (this.onGround) this.stepDistance += Math.hypot(this.x - startX, this.z - startZ);
    this.wasOnGround = this.onGround;
    if (this.onGround && this.flying) this.flying = false;
  }

  private moveAxis(world: World, axis: 0 | 1 | 2, d: number, edgeGuard = false): void {
    if (d === 0) return;
    if (axis === 1) {
      const ny = this.y + d;
      if (!this.collides(world, this.x, ny, this.z, this.height)) {
        this.y = ny;
        return;
      }
      if (d < 0) {
        this.y = Math.floor(ny) + 1 + EPS * 0; // land on top of block
        // Ensure we don't sink when the collision was more than one block below.
        while (this.collides(world, this.x, this.y, this.z, this.height) && this.y < 200) this.y += 1;
        this.onGround = true;
      } else {
        this.y = Math.floor(ny + this.height) - this.height - EPS;
      }
      this.vy = 0;
      return;
    }
    const nx = axis === 0 ? this.x + d : this.x;
    const nz = axis === 2 ? this.z + d : this.z;
    if (!this.collides(world, nx, this.y, nz, this.height)) {
      if (edgeGuard && !this.supported(world, nx, nz)) {
        if (axis === 0) this.vx = 0; else this.vz = 0;
        return;
      }
      this.x = nx;
      this.z = nz;
      return;
    }
    if (axis === 0) {
      this.x = d > 0 ? Math.floor(nx + HALF_W) - HALF_W - EPS : Math.floor(nx - HALF_W) + 1 + HALF_W + EPS;
      this.vx = 0;
    } else {
      this.z = d > 0 ? Math.floor(nz + HALF_W) - HALF_W - EPS : Math.floor(nz - HALF_W) + 1 + HALF_W + EPS;
      this.vz = 0;
    }
  }

  /** Push the player up out of any solid blocks (after spawn / chunk arrival). */
  resolveStuck(world: World): void {
    let guard = 0;
    while (this.collides(world, this.x, this.y, this.z, this.height) && guard++ < 140) this.y += 1;
    this.prevY = this.y;
  }

  /** Name of the surface material under the player's feet, for footstep audio. */
  groundSound(world: World): string | null {
    const id = world.getBlock(Math.floor(this.x), Math.floor(this.y - 0.1), Math.floor(this.z));
    if (id <= 0) return null;
    return BLOCKS[id]?.sound ?? 'stone';
  }
}

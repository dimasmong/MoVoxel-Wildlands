import * as THREE from 'three';
import { BLOCKS } from '../world/registry';
import { buildAtlas } from './textures';
import type { WorldMaterials } from './materials';

/** Target-block outline plus the crack overlay that shows mining progress. */
export class Selection {
  readonly outline: THREE.LineSegments;
  readonly crack: THREE.Mesh;
  private crackMat: THREE.MeshBasicMaterial;

  constructor(scene: THREE.Scene, private materials: WorldMaterials) {
    const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.004, 1.004, 1.004));
    this.outline = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x101010, transparent: true, opacity: 0.55 }));
    this.outline.visible = false;
    this.outline.renderOrder = 5;
    this.crackMat = new THREE.MeshBasicMaterial({
      map: materials.cracks[0],
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    this.crack = new THREE.Mesh(new THREE.BoxGeometry(1.002, 1.002, 1.002), this.crackMat);
    this.crack.visible = false;
    this.crack.renderOrder = 4;
    scene.add(this.outline, this.crack);
  }

  show(x: number, y: number, z: number, plant: boolean): void {
    this.outline.visible = true;
    this.outline.position.set(x + 0.5, y + 0.5, z + 0.5);
    const s = plant ? 0.72 : 1;
    this.outline.scale.set(s, plant ? 0.9 : 1, s);
    if (plant) this.outline.position.y = y + 0.45;
  }

  hide(): void {
    this.outline.visible = false;
    this.crack.visible = false;
  }

  setProgress(x: number, y: number, z: number, p: number): void {
    if (p <= 0) {
      this.crack.visible = false;
      return;
    }
    const stage = Math.min(7, Math.floor(p * 8));
    this.crackMat.map = this.materials.cracks[stage];
    this.crack.position.set(x + 0.5, y + 0.5, z + 0.5);
    this.crack.visible = true;
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.outline, this.crack);
    this.outline.geometry.dispose();
    this.crack.geometry.dispose();
  }
}

const MAX_PARTICLES = 220;

/** Block-break debris: one InstancedMesh, pooled, coloured from the block's own texture pixels. */
export class Debris {
  private mesh: THREE.InstancedMesh;
  private pos = new Float32Array(MAX_PARTICLES * 3);
  private vel = new Float32Array(MAX_PARTICLES * 3);
  private life = new Float32Array(MAX_PARTICLES);
  private size = new Float32Array(MAX_PARTICLES);
  private next = 0;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();
  private v = new THREE.Vector3();
  private c = new THREE.Color();
  density = 1;

  constructor(scene: THREE.Scene) {
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: 0xffffff }), MAX_PARTICLES);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.m.makeScale(0, 0, 0);
    for (let i = 0; i < MAX_PARTICLES; i++) {
      this.mesh.setMatrixAt(i, this.m);
      this.mesh.setColorAt(i, this.c.setRGB(1, 1, 1));
    }
    scene.add(this.mesh);
  }

  burst(x: number, y: number, z: number, blockId: number, count: number, sideways = 1): void {
    const def = BLOCKS[blockId];
    if (!def) return;
    const tile = buildAtlas().tiles[def.tiles.side];
    const n = Math.max(1, Math.round(count * this.density));
    for (let k = 0; k < n; k++) {
      const i = this.next;
      this.next = (this.next + 1) % MAX_PARTICLES;
      this.pos[i * 3] = x + 0.2 + Math.random() * 0.6;
      this.pos[i * 3 + 1] = y + 0.2 + Math.random() * 0.6;
      this.pos[i * 3 + 2] = z + 0.2 + Math.random() * 0.6;
      this.vel[i * 3] = (Math.random() - 0.5) * 4 * sideways;
      this.vel[i * 3 + 1] = Math.random() * 4 + 1;
      this.vel[i * 3 + 2] = (Math.random() - 0.5) * 4 * sideways;
      this.life[i] = 0.5 + Math.random() * 0.5;
      this.size[i] = 0.07 + Math.random() * 0.08;
      // Sample an opaque pixel from the block's texture for the debris colour.
      let r = 255, g = 255, b = 255;
      for (let tries = 0; tries < 8; tries++) {
        const px = Math.floor(Math.random() * 256) * 4;
        if (tile.data[px + 3] > 0) { r = tile.data[px]; g = tile.data[px + 1]; b = tile.data[px + 2]; break; }
      }
      this.c.setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace);
      this.mesh.setColorAt(i, this.c);
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  update(dt: number, solidAt: (x: number, y: number, z: number) => boolean): void {
    let any = false;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (this.life[i] <= 0) continue;
      any = true;
      this.life[i] -= dt;
      const i3 = i * 3;
      this.vel[i3 + 1] -= 18 * dt;
      const nx = this.pos[i3] + this.vel[i3] * dt;
      const ny = this.pos[i3 + 1] + this.vel[i3 + 1] * dt;
      const nz = this.pos[i3 + 2] + this.vel[i3 + 2] * dt;
      if (solidAt(nx, ny, nz)) {
        this.vel[i3] *= 0.3; this.vel[i3 + 2] *= 0.3; this.vel[i3 + 1] = 0;
      } else {
        this.pos[i3] = nx; this.pos[i3 + 1] = ny; this.pos[i3 + 2] = nz;
      }
      const sc = this.life[i] > 0 ? this.size[i] * Math.min(1, this.life[i] * 4) : 0;
      this.s.set(sc, sc, sc);
      this.v.set(this.pos[i3], this.pos[i3 + 1], this.pos[i3 + 2]);
      this.m.compose(this.v, this.q, this.s);
      this.mesh.setMatrixAt(i, this.m);
    }
    if (any) this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh.dispose();
  }
}

/** Fireflies near forests at dusk/night and sparse pollen motes by day. */
export class Ambience {
  private points: THREE.Points;
  private mat: THREE.PointsMaterial;
  private base: Float32Array;
  private phase: Float32Array;
  private count = 70;
  private t = 0;
  intensity = 1;

  constructor(scene: THREE.Scene) {
    const g = new THREE.BufferGeometry();
    this.base = new Float32Array(this.count * 3);
    this.phase = new Float32Array(this.count);
    const pos = new Float32Array(this.count * 3);
    for (let i = 0; i < this.count; i++) {
      this.base[i * 3] = (Math.random() - 0.5) * 36;
      this.base[i * 3 + 1] = Math.random() * 5 + 0.5;
      this.base[i * 3 + 2] = (Math.random() - 0.5) * 36;
      this.phase[i] = Math.random() * 100;
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const c = document.createElement('canvas');
    c.width = c.height = 16;
    const ctx = c.getContext('2d')!;
    const grad = ctx.createRadialGradient(8, 8, 0, 8, 8, 8);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.35, 'rgba(255,255,255,0.6)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 16, 16);
    this.mat = new THREE.PointsMaterial({
      size: 0.35, map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, color: 0xd8ff7a,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  update(dt: number, cx: number, cy: number, cz: number, night: number, forest: number, surfaceY: number): void {
    this.t += dt;
    const fireflies = night * Math.min(1, forest * 1.6);
    const pollen = (1 - night) * 0.6;
    const mode = fireflies > 0.15 ? 'fly' : 'pollen';
    const strength = (mode === 'fly' ? fireflies : pollen) * this.intensity;
    this.points.visible = strength > 0.05 && Math.abs(cy - surfaceY) < 14;
    if (!this.points.visible) return;
    this.mat.color.set(mode === 'fly' ? 0xd8ff7a : 0xfff4d0);
    this.mat.size = mode === 'fly' ? 0.3 : 0.09;
    this.mat.opacity = mode === 'fly' ? strength : strength * 0.7;
    this.mat.blending = mode === 'fly' ? THREE.AdditiveBlending : THREE.NormalBlending;
    const arr = (this.points.geometry.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
    const visibleCount = mode === 'fly' ? this.count : Math.floor(this.count * 0.4);
    for (let i = 0; i < this.count; i++) {
      const p = this.phase[i];
      const i3 = i * 3;
      if (i >= visibleCount) { arr[i3 + 1] = -999; continue; }
      // Wrap motes around the camera so they're always nearby.
      const wx = ((((this.base[i3] - cx) % 36) + 54) % 36) - 18 + cx;
      const wz = ((((this.base[i3 + 2] - cz) % 36) + 54) % 36) - 18 + cz;
      arr[i3] = wx + Math.sin(this.t * 0.7 + p) * 0.8;
      arr[i3 + 1] = surfaceY + this.base[i3 + 1] + Math.sin(this.t * 0.9 + p * 2) * 0.5;
      arr[i3 + 2] = wz + Math.cos(this.t * 0.6 + p) * 0.8;
    }
    (this.points.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.points);
    this.points.geometry.dispose();
  }
}

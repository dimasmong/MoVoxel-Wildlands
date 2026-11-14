import * as THREE from 'three';
import { BLOCKS, RENDER_KIND, isBlockItem } from '../world/registry';
import { tileUV } from './textures';
import { itemSpriteCanvas } from './icons';
import type { WorldMaterials } from './materials';

/** Builds a unit cube geometry whose faces use the block's atlas tiles. */
export function blockGeometry(id: number, size = 1): THREE.BufferGeometry {
  const def = BLOCKS[id];
  const g = new THREE.BoxGeometry(size, size, size);
  // BoxGeometry face order: +X, -X, +Y, -Y, +Z, -Z (4 verts each).
  const tiles = [def.tiles.side, def.tiles.side, def.tiles.top, def.tiles.bottom, def.tiles.front ?? def.tiles.side, def.tiles.front ?? def.tiles.side];
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let f = 0; f < 6; f++) {
    const [u0, v0, u1, v1] = tileUV(tiles[f]);
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
    }
  }
  return g;
}

const spriteMats = new Map<number, THREE.MeshLambertMaterial>();
export function spriteMaterial(id: number): THREE.MeshLambertMaterial {
  let m = spriteMats.get(id);
  if (!m) {
    const tex = new THREE.CanvasTexture(itemSpriteCanvas(id));
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.colorSpace = THREE.SRGBColorSpace;
    m = new THREE.MeshLambertMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide });
    spriteMats.set(id, m);
  }
  return m;
}

/** Creates the 3D representation of an item: a mini block, or a flat pixel sprite. */
export function itemObject(id: number, materials: WorldMaterials, blockSize: number, spriteSize: number): THREE.Mesh {
  if (isBlockItem(id) && RENDER_KIND[id] !== 3) {
    const mat = RENDER_KIND[id] === 2 ? materials.cross : materials.opaque;
    const m = new THREE.Mesh(blockGeometry(id, blockSize), mat);
    // Hand / drop meshes have no vertex colours; use a plain material clone that ignores them.
    m.material = plainBlockMaterial(materials, RENDER_KIND[id] === 2);
    return m;
  }
  return new THREE.Mesh(new THREE.PlaneGeometry(spriteSize, spriteSize), spriteMaterial(id));
}

let plainOpaque: THREE.MeshLambertMaterial | null = null;
let plainCutout: THREE.MeshLambertMaterial | null = null;
function plainBlockMaterial(materials: WorldMaterials, cutout: boolean): THREE.MeshLambertMaterial {
  if (!plainOpaque) {
    plainOpaque = new THREE.MeshLambertMaterial({ map: materials.atlas, alphaTest: 0.5, emissive: 0xffffff, emissiveMap: materials.opaque.emissiveMap, emissiveIntensity: 0.9 });
    plainCutout = new THREE.MeshLambertMaterial({ map: materials.atlas, alphaTest: 0.5, side: THREE.DoubleSide });
  }
  return cutout ? plainCutout! : plainOpaque;
}

/**
 * First-person arm + held item. Lives in its own scene layer rendered after the world with a
 * cleared depth buffer, so it never clips into walls.
 */
export class Hand {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private root = new THREE.Group();
  private arm: THREE.Group;
  private held: THREE.Object3D | null = null;
  private heldId = -1;
  private swing = 0; // 0..1 progress of current swing
  private swinging = false;
  private equip = 0; // 0 = lowered, 1 = raised
  private bobT = 0;
  private landKick = 0;
  readonly sun: THREE.DirectionalLight;
  readonly fill: THREE.HemisphereLight;
  reduceMotion = false;

  constructor(private materials: WorldMaterials) {
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.01, 10);
    this.sun = new THREE.DirectionalLight(0xffffff, 1.6);
    this.sun.position.set(0.5, 1, 0.6);
    this.fill = new THREE.HemisphereLight(0xdde8ff, 0x665544, 1.1);
    this.scene.add(this.sun, this.fill, this.root);
    this.root.position.set(0.42, -0.42, -0.62);

    this.arm = new THREE.Group();
    const skin = new THREE.MeshLambertMaterial({ color: 0xc89470 });
    const sleeve = new THREE.MeshLambertMaterial({ color: 0x3f6f5a });
    const cuff = new THREE.MeshLambertMaterial({ color: 0xd8b25a });
    const hand = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.17, 0.26), skin);
    hand.position.set(0, 0, -0.1);
    const sl = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.19, 0.4), sleeve);
    sl.position.set(0, 0, 0.22);
    const cf = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.04), cuff);
    cf.position.set(0, 0, 0.03);
    this.arm.add(hand, sl, cf);
    this.arm.rotation.set(-0.35, 0.18, 0.05);
    this.root.add(this.arm);
  }

  resize(aspect: number, fov: number): void {
    this.camera.aspect = aspect;
    this.camera.fov = Math.min(80, fov);
    this.camera.updateProjectionMatrix();
  }

  setHeld(id: number): void {
    if (id === this.heldId) return;
    this.heldId = id;
    if (this.held) {
      this.root.remove(this.held);
      if (this.held instanceof THREE.Mesh) this.held.geometry.dispose();
      this.held = null;
    }
    this.equip = 0;
    if (id <= 0) {
      this.arm.visible = true;
      return;
    }
    const obj = itemObject(id, this.materials, 0.32, 0.5);
    if (isBlockItem(id) && RENDER_KIND[id] !== 3) {
      obj.position.set(-0.02, 0.06, -0.22);
      obj.rotation.set(0.1, 0.7, 0);
    } else {
      obj.position.set(0.02, 0.14, -0.2);
      obj.rotation.set(0, Math.PI / 2 - 0.25, 0.3);
    }
    this.held = obj;
    this.root.add(obj);
    this.arm.visible = true;
  }

  triggerSwing(): void {
    if (!this.swinging || this.swing > 0.5) {
      this.swing = 0;
      this.swinging = true;
    }
  }

  land(strength: number): void {
    if (!this.reduceMotion) this.landKick = Math.min(0.12, strength * 0.025);
  }

  update(dt: number, moving: number, sprinting: boolean, daylight: number): void {
    this.equip = Math.min(1, this.equip + dt * 6);
    if (this.swinging) {
      this.swing += dt * 4.2;
      if (this.swing >= 1) {
        this.swing = 0;
        this.swinging = false;
      }
    }
    const bobAmt = this.reduceMotion ? 0.25 : 1;
    if (moving > 0.1) this.bobT += dt * (sprinting ? 13 : 9) * moving;
    const bx = Math.sin(this.bobT) * 0.018 * moving * bobAmt;
    const by = Math.abs(Math.cos(this.bobT)) * 0.02 * moving * bobAmt;
    this.landKick *= Math.exp(-10 * dt);
    const s = Math.sin(this.swing * Math.PI);
    const s2 = Math.sin(Math.sqrt(this.swing) * Math.PI);
    this.root.position.set(0.42 + bx - s2 * 0.14, -0.42 - by - (1 - this.equip) * 0.4 - this.landKick + s * 0.06, -0.62 - s * 0.12);
    this.root.rotation.set(-s * 0.9, s2 * 0.35, s2 * 0.15);
    this.sun.intensity = 0.4 + 1.3 * daylight;
    this.fill.intensity = 0.45 + 0.75 * daylight;
  }
}

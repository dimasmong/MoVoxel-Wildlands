import * as THREE from 'three';
import { buildAtlas, buildCrackCanvases, tileCanvas } from './textures';
import { T } from '../world/registry';

export interface WorldMaterials {
  opaque: THREE.MeshLambertMaterial;
  cross: THREE.MeshLambertMaterial;
  water: THREE.MeshLambertMaterial;
  atlas: THREE.Texture;
  waterTex: THREE.Texture;
  cracks: THREE.Texture[];
}

const pixelTexture = (canvas: HTMLCanvasElement): THREE.CanvasTexture => {
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
};

let shared: WorldMaterials | null = null;

export function getWorldMaterials(): WorldMaterials {
  if (shared) return shared;
  const { color, emissive } = buildAtlas();
  const atlas = pixelTexture(color);
  const emissiveTex = pixelTexture(emissive);

  const opaque = new THREE.MeshLambertMaterial({
    map: atlas,
    vertexColors: true,
    alphaTest: 0.5,
    emissive: new THREE.Color(0xffffff),
    emissiveMap: emissiveTex,
    emissiveIntensity: 0.9,
  });
  opaque.name = 'terrain-opaque';

  const cross = new THREE.MeshLambertMaterial({
    map: atlas,
    vertexColors: true,
    alphaTest: 0.5,
    side: THREE.DoubleSide,
  });
  cross.name = 'terrain-cross';

  const waterTex = pixelTexture(tileCanvas(T.WATER));
  waterTex.wrapS = waterTex.wrapT = THREE.RepeatWrapping;
  const water = new THREE.MeshLambertMaterial({
    map: waterTex,
    vertexColors: true,
    transparent: true,
    opacity: 0.78,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  water.name = 'terrain-water';

  const cracks = buildCrackCanvases().map(pixelTexture);
  shared = { opaque, cross, water, atlas, waterTex, cracks };
  return shared;
}

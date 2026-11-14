import * as THREE from 'three';
import { mulberry32 } from '../core/rng';

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const C = (hex: number) => new THREE.Color(hex);
const PALETTE = {
  dayTop: C(0x4f9be0), dayHorizon: C(0xb9dcf2),
  duskTop: C(0x3d5a9a), duskHorizon: C(0xf0a066),
  nightTop: C(0x070b1c), nightHorizon: C(0x18233f),
  sunDay: C(0xfff1d6), sunDusk: C(0xffb070), moon: C(0x9fb4e8),
};

/**
 * Sky dome, sun, moon, stars, blocky clouds and the light rig, all driven by one time-of-day value.
 * time: 0 = sunrise, 0.25 = noon, 0.5 = sunset, 0.75 = midnight.
 */
export class Sky {
  readonly group = new THREE.Group();
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly ambient: THREE.AmbientLight;
  daylight = 1;
  private dome: THREE.Mesh;
  private domeMat: THREE.ShaderMaterial;
  private sunMesh: THREE.Mesh;
  private moonMesh: THREE.Mesh;
  private stars: THREE.Points;
  private clouds: THREE.Mesh;
  private cloudMat: THREE.MeshLambertMaterial;
  private cloudSpan: number;
  private cloudDrift = 0;
  private tmpTop = new THREE.Color();
  private tmpHor = new THREE.Color();
  readonly fogColor = new THREE.Color();
  readonly sunDir = new THREE.Vector3();

  constructor(private scene: THREE.Scene) {
    this.domeMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        top: { value: new THREE.Color() },
        horizon: { value: new THREE.Color() },
        sunDir: { value: new THREE.Vector3(0, 1, 0) },
        glow: { value: new THREE.Color(0xffc080) },
        glowAmt: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position.z = gl_Position.w * 0.99995; // pin to far plane
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 top; uniform vec3 horizon; uniform vec3 sunDir; uniform vec3 glow; uniform float glowAmt;
        varying vec3 vDir;
        void main() {
          float h = clamp(vDir.y, -1.0, 1.0);
          float t = pow(clamp(h, 0.0, 1.0), 0.55);
          vec3 col = mix(horizon, top, t);
          col = mix(col, horizon * 0.55, clamp(-h * 3.0, 0.0, 1.0));
          float s = max(dot(normalize(vDir), normalize(sunDir)), 0.0);
          col += glow * glowAmt * (pow(s, 8.0) * 0.6 + pow(s, 64.0) * 0.6) * (1.0 - t * 0.6);
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(500, 24, 16), this.domeMat);
    this.dome.renderOrder = -10;
    this.dome.frustumCulled = false;
    this.group.add(this.dome);

    // Square, pixel-styled sun and moon.
    this.sunMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(46, 46),
      new THREE.MeshBasicMaterial({ color: 0xfff4d0, fog: false, depthWrite: false, transparent: true }),
    );
    this.moonMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(30, 30),
      new THREE.MeshBasicMaterial({ map: moonTexture(), fog: false, depthWrite: false, transparent: true }),
    );
    this.sunMesh.renderOrder = this.moonMesh.renderOrder = -9;
    this.group.add(this.sunMesh, this.moonMesh);

    // Stars
    const rand = mulberry32(42);
    const starPos = new Float32Array(700 * 3);
    for (let i = 0; i < 700; i++) {
      const u = rand() * 2 - 1, th = rand() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      starPos[i * 3] = r * Math.cos(th) * 450;
      starPos[i * 3 + 1] = Math.abs(u) * 450;
      starPos[i * 3 + 2] = r * Math.sin(th) * 450;
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xe8eeff, size: 1.6, sizeAttenuation: false, fog: false, transparent: true, depthWrite: false }));
    this.stars.renderOrder = -9;
    this.stars.frustumCulled = false;
    this.group.add(this.stars);

    // Blocky clouds with a periodic pattern so the layer can wrap around the player seamlessly.
    const { geometry, span } = buildCloudGeometry();
    this.cloudSpan = span;
    this.cloudMat = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.82, emissive: 0x333333, depthWrite: false });
    this.clouds = new THREE.Mesh(geometry, this.cloudMat);
    this.clouds.frustumCulled = false;
    this.clouds.renderOrder = 3;
    scene.add(this.clouds);

    // Light rig: one shadow-casting directional light (sun by day, moon by night) + sky fill.
    this.sun = new THREE.DirectionalLight(0xffffff, 2.4);
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.04;
    const cam = this.sun.shadow.camera;
    cam.left = -56; cam.right = 56; cam.top = 56; cam.bottom = -56; cam.near = 1; cam.far = 260;
    scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xbfdcff, 0x5a4a38, 1.1);
    scene.add(this.hemi);
    this.ambient = new THREE.AmbientLight(0xffffff, 0.25);
    scene.add(this.ambient);
    scene.add(this.group);
  }

  setCloudsVisible(v: boolean): void {
    this.clouds.visible = v;
  }

  update(time: number, dt: number, camPos: THREE.Vector3, underwater: boolean): void {
    const ang = time * Math.PI * 2;
    const sy = Math.sin(ang);
    this.sunDir.set(Math.cos(ang), sy, 0.28).normalize();
    this.daylight = smooth(-0.14, 0.22, sy);
    const dusk = Math.max(0, 1 - Math.abs(sy) / 0.32) * (1 - smooth(0.3, 0.6, sy));

    this.tmpTop.copy(PALETTE.nightTop).lerp(PALETTE.dayTop, this.daylight);
    this.tmpHor.copy(PALETTE.nightHorizon).lerp(PALETTE.dayHorizon, this.daylight);
    this.tmpTop.lerp(PALETTE.duskTop, dusk * 0.5);
    this.tmpHor.lerp(PALETTE.duskHorizon, dusk * 0.75);
    const u = this.domeMat.uniforms;
    (u.top.value as THREE.Color).copy(this.tmpTop);
    (u.horizon.value as THREE.Color).copy(this.tmpHor);
    (u.sunDir.value as THREE.Vector3).copy(this.sunDir);
    u.glowAmt.value = 0.25 + dusk * 1.2;
    this.fogColor.copy(this.tmpHor).lerp(this.tmpTop, 0.15);
    if (underwater) this.fogColor.setRGB(0.07, 0.2, 0.42);

    this.group.position.copy(camPos);
    this.sunMesh.position.copy(this.sunDir).multiplyScalar(400);
    this.sunMesh.lookAt(0, 0, 0);
    this.moonMesh.position.copy(this.sunDir).multiplyScalar(-400);
    this.moonMesh.lookAt(0, 0, 0);
    (this.sunMesh.material as THREE.MeshBasicMaterial).color.copy(PALETTE.sunDay).lerp(PALETTE.sunDusk, dusk);
    (this.stars.material as THREE.PointsMaterial).opacity = Math.max(0, 1 - this.daylight * 1.6);
    this.stars.rotation.y = time * 0.6;

    // Directional light follows the dominant body (sun above horizon, else moon).
    const sunUp = sy > -0.05;
    const lightDir = sunUp ? this.sunDir : this.sunDir.clone().negate();
    const elev = Math.max(0.15, lightDir.y);
    this.sun.position.set(camPos.x + lightDir.x * 120, camPos.y + Math.max(elev, 0.15) * 120, camPos.z + lightDir.z * 120);
    this.sun.target.position.copy(camPos);
    if (sunUp) {
      this.sun.color.copy(PALETTE.sunDay).lerp(PALETTE.sunDusk, dusk);
      this.sun.intensity = 2.3 * smooth(-0.05, 0.25, sy);
    } else {
      this.sun.color.copy(PALETTE.moon);
      this.sun.intensity = 0.38 * smooth(-0.05, -0.3, sy);
    }
    this.hemi.intensity = 0.32 + 0.95 * this.daylight;
    this.hemi.color.copy(this.tmpTop).lerp(new THREE.Color(0xffffff), 0.45);
    this.ambient.intensity = 0.12 + 0.18 * this.daylight;

    // Clouds drift slowly and wrap so they always surround the player.
    this.cloudDrift += dt * 1.6;
    const span = this.cloudSpan;
    const ox = Math.floor((camPos.x - this.cloudDrift) / span) * span + this.cloudDrift - span;
    const oz = Math.floor(camPos.z / span) * span - span;
    this.clouds.position.set(ox, 118, oz);
    this.cloudMat.color.setScalar(0.35 + 0.65 * this.daylight).lerp(PALETTE.duskHorizon, dusk * 0.25);
    this.cloudMat.emissive.setScalar(0.12 + 0.18 * this.daylight);
  }

  dispose(): void {
    this.scene.remove(this.group, this.clouds, this.sun, this.sun.target, this.hemi, this.ambient);
    this.clouds.geometry.dispose();
    this.dome.geometry.dispose();
  }
}

function moonTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#dfe6ff';
  ctx.fillRect(1, 1, 14, 14);
  ctx.fillStyle = '#b9c2e6';
  for (const [x, y, w] of [[4, 4, 3], [9, 7, 2], [5, 10, 2], [11, 3, 1], [10, 11, 2]]) ctx.fillRect(x, y, w, w);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function buildCloudGeometry(): { geometry: THREE.BufferGeometry; span: number } {
  const N = 28; // cells per period
  const CELL = 12;
  const rand = mulberry32(777);
  let grid = new Float32Array(N * N).map(() => rand());
  for (let pass = 0; pass < 2; pass++) {
    const next = new Float32Array(N * N);
    for (let z = 0; z < N; z++)
      for (let x = 0; x < N; x++) {
        let s = 0;
        for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) s += grid[((x + dx + N) % N) + ((z + dz + N) % N) * N];
        next[x + z * N] = s / 9;
      }
    grid = next;
  }
  const on = (x: number, z: number) => grid[((x % N) + N) % N + (((z % N) + N) % N) * N] > 0.54;
  const pos: number[] = [], nor: number[] = [];
  const H = 4;
  const quad = (a: number[], b: number[], c: number[], d: number[], n: number[]) => {
    pos.push(...a, ...b, ...c, ...a, ...c, ...d);
    for (let i = 0; i < 6; i++) nor.push(...n);
  };
  const cells = N * 3;
  for (let z = 0; z < cells; z++) {
    for (let x = 0; x < cells; x++) {
      if (!on(x, z)) continue;
      const x0 = x * CELL, x1 = x0 + CELL, z0 = z * CELL, z1 = z0 + CELL;
      quad([x0, H, z1], [x1, H, z1], [x1, H, z0], [x0, H, z0], [0, 1, 0]);
      quad([x0, 0, z0], [x1, 0, z0], [x1, 0, z1], [x0, 0, z1], [0, -1, 0]);
      if (!on(x + 1, z)) quad([x1, 0, z1], [x1, 0, z0], [x1, H, z0], [x1, H, z1], [1, 0, 0]);
      if (!on(x - 1, z)) quad([x0, 0, z0], [x0, 0, z1], [x0, H, z1], [x0, H, z0], [-1, 0, 0]);
      if (!on(x, z + 1)) quad([x0, 0, z1], [x1, 0, z1], [x1, H, z1], [x0, H, z1], [0, 0, 1]);
      if (!on(x, z - 1)) quad([x1, 0, z0], [x0, 0, z0], [x0, H, z0], [x1, H, z0], [0, 0, -1]);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return { geometry: g, span: N * CELL };
}

import * as THREE from 'three';
import {
  DAY_LENGTH_SECONDS,
  FIXED_DT,
  GENERATOR_VERSION,
  SAVE_VERSION,
  WORLD_HEIGHT,
} from '../core/constants';
import { seedFromInput } from '../core/rng';
import {
  B,
  BLOCKS,
  CREATIVE_PALETTE,
  I,
  IS_SOLID,
  ITEMS,
  breakTime,
  canHarvest,
  isBlockItem,
  itemName,
} from '../world/registry';
import { World } from '../world/world';
import { getWorldMaterials, type WorldMaterials } from '../render/materials';
import { Sky } from '../render/sky';
import { Ambience, Debris, Selection } from '../render/effects';
import { Hand } from '../render/hand';
import { Player } from './player';
import { raycastVoxel, type RayHit } from './raycast';
import { Inventory } from './inventory';
import { DropSystem, MobSystem } from './entities';
import { InputManager } from './input';
import { UIManager } from '../ui/ui';
import {
  type GameMode,
  type WorldMeta,
  newWorldId,
  saveStore,
} from '../save/db';
import { QUALITY, type Settings, loadSettings } from '../settings';
import { audio } from '../audio/audio';

const REACH_DISTANCE = 5.5;
const AUTOSAVE_INTERVAL = 45;

export class Game {
  readonly canvas: HTMLCanvasElement;
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly timer: THREE.Timer;

  settings: Settings;
  materials: WorldMaterials;
  sky: Sky;
  selection: Selection;
  debris: Debris;
  ambience: Ambience;
  hand: Hand;
  player = new Player();
  inv = new Inventory();
  drops: DropSystem;
  mobs: MobSystem;
  input: InputManager;
  ui: UIManager;

  world: World | null = null;
  meta: WorldMeta | null = null;
  playing = false;
  thirdPerson = false;
  private avatarGroup: THREE.Group;

  // Survival state
  health = 20;
  hunger = 20;
  private hungerTimer = 0;
  private regenTimer = 0;
  private starveTimer = 0;

  // Mining / placing state
  private currentHit: RayHit | null = null;
  private miningBlockKey = '';
  private miningProgress = 0;
  private digSoundTimer = 0;
  private placeCooldown = 0;
  private footstepDist = 0;

  // Camera juice & interpolation (game-feel + camera-systems skills)
  private trauma = 0;
  private shakeTime = 0;
  private bobPhase = 0;
  private camPos = new THREE.Vector3();
  private camDir = new THREE.Vector3();

  // Panorama state when on title menu
  private panoramaAngle = 0;
  private panoramaCenter = { x: 0, y: 58, z: 0 };

  // Loop & telemetry
  private accum = 0;
  private autosaveTimer = AUTOSAVE_INTERVAL;
  private loadingCheckTimer = 0;
  private fpsFrames = 0;
  private fpsTime = 0;
  fps = 60;
  frameMs = 16.7;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.settings = loadSettings();
    const q = QUALITY[this.settings.quality];

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: q.antialias,
      powerPreference: 'high-performance',
    });
    this.renderer.autoClear = false;
    this.renderer.info.autoReset = false;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0xb9dcf2, 0.009);

    this.camera = new THREE.PerspectiveCamera(
      this.settings.fov,
      window.innerWidth / window.innerHeight,
      0.1,
      450,
    );
    this.camera.rotation.order = 'YXZ';

    this.materials = getWorldMaterials();
    this.sky = new Sky(this.scene);
    this.selection = new Selection(this.scene, this.materials);
    this.debris = new Debris(this.scene);
    this.ambience = new Ambience(this.scene);
    this.hand = new Hand(this.materials);
    this.drops = new DropSystem(this.scene, this.materials);
    this.mobs = new MobSystem(this.scene);

    this.avatarGroup = this.buildPlayerAvatar();
    this.avatarGroup.visible = false;
    this.scene.add(this.avatarGroup);

    this.input = new InputManager(this.canvas);
    this.ui = new UIManager(this.inv, this.settings, {
      onCreateWorld: (name, seed, mode, dayCycle) =>
        void this.startNewWorld(name, seed, mode, dayCycle),
      onQuickPlay: () => void this.quickPlay(),
      onLoadWorld: (meta) => void this.loadWorld(meta),
      onDeleteWorld: (id) => saveStore.deleteWorld(id),
      onResume: () => this.resumeGame(),
      onSaveNow: () => this.saveCurrentWorld(true),
      onExitToTitle: () => this.exitToTitle(),
      onRespawn: () => this.respawnPlayer(),
      onSettingsChanged: (s) => this.applySettings(s),
      onToggleCamera: () => this.toggleCameraMode(),
      onPauseToggle: () => this.togglePause(),
      getWorlds: () => saveStore.listWorlds(),
    });

    this.input.bindTouchElements(this.ui.touchElements);
    this.wireInputCallbacks();
    this.applySettings(this.settings);
    this.onResize();
    window.addEventListener('resize', () => this.onResize());

    // Expose for automated verification & smoke tests (threejs-scene-setup skill)
    Object.assign(window, {
      renderer: this.renderer,
      scene: this.scene,
      camera: this.camera,
      game: this,
    });

    this.timer = new THREE.Timer();
    this.timer.connect(document);

    void this.initTitlePanorama();
    this.renderer.setAnimationLoop(() => this.tickFrame());
  }

  private buildPlayerAvatar(): THREE.Group {
    const g = new THREE.Group();
    const tunic = new THREE.MeshLambertMaterial({ color: 0x3f6f5a });
    const skin = new THREE.MeshLambertMaterial({ color: 0xc89470 });
    const hair = new THREE.MeshLambertMaterial({ color: 0x422c1e });
    const trousers = new THREE.MeshLambertMaterial({ color: 0x493b32 });
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.46, 0.46), skin);
    head.position.y = 1.52;
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.16, 0.48), hair);
    cap.position.y = 1.72;
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.68, 0.26), tunic);
    body.position.y = 0.95;
    const legs = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.6, 0.24), trousers);
    legs.position.y = 0.3;
    g.add(head, cap, body, legs);
    return g;
  }

  private wireInputCallbacks(): void {
    this.input.onEscape = () => {
      if (!this.playing) return;
      if (this.ui.screen === 'inventory') {
        this.resumeGame();
      } else if (this.ui.screen === 'hud') {
        this.pauseGame();
      } else if (this.ui.screen === 'pause' && !this.input.pointerLocked) {
        // Already paused
      }
    };

    this.input.onInventoryToggle = () => {
      if (!this.playing || !this.meta) return;
      if (this.ui.screen === 'hud') {
        this.input.exitPointerLock();
        this.ui.openInventory(false, this.meta.mode);
        this.ui.updateTouchVisibility(false);
      } else if (this.ui.screen === 'inventory') {
        this.resumeGame();
      }
    };

    this.input.onHotbarSelect = (slot) => {
      if (!this.playing) return;
      this.inv.select(slot);
    };

    this.input.onToggleDebug = () => {
      this.settings.showFps = !this.settings.showFps;
      this.ui.syncSettingsInputs();
    };

    this.input.onToggleCamera = () => {
      if (this.playing && this.ui.screen === 'hud') this.toggleCameraMode();
    };

    this.input.canLockPointer = () => this.playing && this.ui.screen === 'hud';

    this.input.onDropHeld = () => {
      if (!this.playing || this.ui.screen !== 'hud' || !this.world) return;
      const held = this.inv.held;
      if (!held) return;
      const id = held.id;
      const dur = held.dur;
      this.inv.consumeSelected(1);
      const toss = new THREE.Vector3(
        -Math.sin(this.player.yaw) * Math.cos(this.player.pitch) * 5,
        Math.sin(this.player.pitch) * 4 + 2,
        -Math.cos(this.player.yaw) * Math.cos(this.player.pitch) * 5,
      );
      this.drops.spawn(
        this.player.x - Math.sin(this.player.yaw) * 0.6,
        this.player.y + 1.2,
        this.player.z - Math.cos(this.player.yaw) * 0.6,
        id,
        1,
        dur,
        toss,
      );
    };
  }

  private async initTitlePanorama(): Promise<void> {
    await saveStore.open();
    if (saveStore.warning) this.ui.setStorageWarning(saveStore.warning);
    this.mountPanoramaWorld();
  }

  private mountPanoramaWorld(): void {
    this.disposeWorld();
    const seed = seedFromInput('movoxel-wildlands-vista');
    this.world = new World(seed, this.materials, new Map());
    this.world.renderDistance = Math.min(5, this.settings.renderDistance);
    this.scene.add(this.world.group);
    const sp = this.world.generator.findSpawn();
    this.panoramaCenter = { x: sp.x, y: sp.y + 14, z: sp.z };
    this.world.ensureLoadedSync(sp.x, sp.z, 2);
    this.world.update(sp.x, sp.z, 25);
  }

  private async quickPlay(): Promise<void> {
    const { worlds } = await saveStore.listWorlds();
    if (worlds.length > 0) {
      await this.loadWorld(worlds[0]);
    } else {
      await this.startNewWorld('Sunlit Reach', 'wildlands-7', 'survival', true);
    }
  }

  private async startNewWorld(
    name: string,
    seedInput: string,
    mode: GameMode,
    daylightCycle: boolean,
  ): Promise<void> {
    const seed = seedFromInput(seedInput);
    const meta: WorldMeta = {
      id: newWorldId(),
      name,
      seed,
      seedText: seedInput || String(seed),
      mode,
      created: Date.now(),
      lastPlayed: Date.now(),
      version: SAVE_VERSION,
      generatorVersion: GENERATOR_VERSION,
      player: null,
      inventory: [],
      selected: 0,
      time: 0.18, // warm morning sun
      day: 0,
      daylightCycle,
    };
    await this.loadWorld(meta, true);
  }

  private async loadWorld(meta: WorldMeta, isNew = false): Promise<void> {
    this.ui.showScreen('loading');
    this.ui.setLoadingProgress(0.1, `Opening "${meta.name}"…`);
    await new Promise((r) => setTimeout(r, 30));

    this.disposeWorld();
    const edits = isNew ? new Map() : await saveStore.loadEdits(meta.id);
    this.meta = meta;
    this.world = new World(meta.seed, this.materials, edits);
    this.world.renderDistance = this.settings.renderDistance;
    this.world.setShadowCasting(QUALITY[this.settings.quality].shadows);
    this.scene.add(this.world.group);

    let spawn = meta.player?.spawn;
    if (!spawn) {
      spawn = this.world.generator.findSpawn();
    }
    this.world.ensureLoadedSync(spawn.x, spawn.z, 2);

    if (meta.player) {
      this.world.ensureLoadedSync(meta.player.x, meta.player.z, 2);
      this.player.teleport(meta.player.x, meta.player.y, meta.player.z);
      this.player.yaw = meta.player.yaw;
      this.player.pitch = meta.player.pitch;
      this.player.flying = meta.mode === 'creative' && meta.player.flying;
      this.health = meta.player.health;
      this.hunger = meta.player.hunger;
    } else {
      const sy = this.world.surfaceY(Math.floor(spawn.x), Math.floor(spawn.z));
      const py = (sy > 0 ? sy : spawn.y) + 1.05;
      spawn = { x: Math.floor(spawn.x) + 0.5, y: py, z: Math.floor(spawn.z) + 0.5 };
      this.player.teleport(spawn.x, spawn.y, spawn.z);
      this.player.yaw = 0;
      this.player.pitch = -0.08;
      this.player.flying = false;
      this.health = 20;
      this.hunger = 20;
      meta.player = {
        x: this.player.x,
        y: this.player.y,
        z: this.player.z,
        yaw: 0,
        pitch: -0.08,
        health: 20,
        hunger: 20,
        flying: false,
        spawn,
      };
    }

    this.player.resolveStuck(this.world);

    if (isNew && meta.mode === 'creative') {
      this.inv.clear();
      for (let i = 0; i < 9; i++) {
        this.inv.slots[i] = { id: CREATIVE_PALETTE[i], count: 64 };
      }
      this.inv.emit();
    } else if (isNew && meta.mode === 'survival') {
      this.inv.clear();
      // Give the player a couple Duskberries for the road; everything else is gathered
      this.inv.add(I.BERRIES, 3);
      this.inv.select(0);
    } else {
      this.inv.load(meta.inventory, meta.selected);
    }

    this.world.update(this.player.x, this.player.z, 40);
    await this.saveCurrentWorld(false);

    this.playing = true;
    this.loadingCheckTimer = 0;
    this.ui.updateVitals(this.health, this.hunger, meta.mode, this.player.flying);
    this.enterGameplayHUD();
  }

  private enterGameplayHUD(): void {
    this.ui.showScreen('hud');
    this.ui.updateTouchVisibility(true);
    this.input.requestPointerLock();
  }

  private pauseGame(): void {
    if (!this.playing || !this.meta) return;
    this.input.exitPointerLock();
    this.ui.updateTouchVisibility(false);
    this.ui.setPauseSummary(
      `${this.meta.name} · ${this.meta.mode.toUpperCase()} · Seed: ${this.meta.seedText} · Day ${this.meta.day + 1}`,
    );
    this.ui.showScreen('pause');
    void this.saveCurrentWorld(false);
  }

  private togglePause(): void {
    if (this.ui.screen === 'hud') this.pauseGame();
    else if (this.ui.screen === 'pause') this.resumeGame();
  }

  private resumeGame(): void {
    if (!this.playing) return;
    this.enterGameplayHUD();
  }

  private async saveCurrentWorld(notify: boolean): Promise<void> {
    if (!this.world || !this.meta) return;
    this.meta.player = {
      x: this.player.x,
      y: this.player.y,
      z: this.player.z,
      yaw: this.player.yaw,
      pitch: this.player.pitch,
      health: this.health,
      hunger: this.hunger,
      flying: this.player.flying,
      spawn: this.meta.player?.spawn ?? {
        x: this.player.x,
        y: this.player.y,
        z: this.player.z,
      },
    };
    this.meta.inventory = this.inv.serialize();
    this.meta.selected = this.inv.selected;
    await saveStore.saveWorld(
      this.meta,
      this.world.edits,
      this.world.dirtyEditChunks,
    );
    this.world.dirtyEditChunks.clear();
    this.ui.markSaved('Saved');
    if (notify) this.ui.toast('World saved to local database');
  }

  private async exitToTitle(): Promise<void> {
    await this.saveCurrentWorld(false);
    this.playing = false;
    this.input.exitPointerLock();
    this.ui.updateTouchVisibility(false);
    this.selection.hide();
    this.drops.clear();
    this.mobs.clear();
    this.avatarGroup.visible = false;
    this.ui.showScreen('title');
    this.mountPanoramaWorld();
  }

  private respawnPlayer(): void {
    if (!this.world || !this.meta) return;
    const sp = this.meta.player?.spawn ?? this.world.generator.findSpawn();
    this.world.ensureLoadedSync(sp.x, sp.z, 1);
    const sy = this.world.surfaceY(Math.floor(sp.x), Math.floor(sp.z));
    this.player.teleport(sp.x, (sy > 0 ? sy : sp.y) + 1.1, sp.z);
    this.player.resolveStuck(this.world);
    this.health = 20;
    this.hunger = 20;
    this.ui.updateVitals(this.health, this.hunger, this.meta.mode, this.player.flying);
    this.enterGameplayHUD();
  }

  private toggleCameraMode(): void {
    this.thirdPerson = !this.thirdPerson;
    this.avatarGroup.visible = this.thirdPerson;
    this.ui.toast(this.thirdPerson ? 'Third-person camera' : 'First-person camera');
  }

  applySettings(s: Settings): void {
    this.settings = s;
    const q = QUALITY[s.quality];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.dprCap));
    this.renderer.shadowMap.enabled = q.shadows;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.sky.sun.castShadow = q.shadows;
    if (q.shadows && q.shadowSize > 0) {
      this.sky.sun.shadow.mapSize.set(q.shadowSize, q.shadowSize);
      this.sky.sun.shadow.map?.dispose();
      this.sky.sun.shadow.map = null;
    }
    this.sky.setCloudsVisible(q.clouds);
    this.debris.density = q.particles;
    this.ambience.intensity = q.particles;
    this.hand.reduceMotion = s.reduceMotion;

    this.camera.fov = s.fov;
    this.camera.updateProjectionMatrix();
    this.hand.resize(window.innerWidth / window.innerHeight, s.fov);

    const fogDist = s.renderDistance * 16;
    this.camera.far = Math.max(220, fogDist + 80);
    this.camera.updateProjectionMatrix();
    (this.scene.fog as THREE.FogExp2).density = 1.65 / Math.max(48, fogDist);

    if (this.world && this.playing) {
      this.world.renderDistance = s.renderDistance;
      this.world.setShadowCasting(q.shadows);
    }
    audio.setVolumes(s.masterVolume, s.sfxVolume, s.ambientVolume);
    this.ui.updateTouchVisibility(this.playing && this.ui.screen === 'hud');
  }

  private onResize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.hand.resize(w / h, this.settings.fov);
  }

  private disposeWorld(): void {
    this.drops.clear();
    this.mobs.clear();
    if (this.world) {
      this.world.dispose();
      this.world = null;
    }
  }

  // ------------------------------------------------------------------ main frame loop
  private tickFrame(): void {
    this.timer.update();
    const rawDt = this.timer.getDelta();
    const dt = Math.min(Math.max(rawDt, 0), 0.1);

    // FPS measurement
    this.fpsFrames++;
    this.fpsTime += rawDt;
    if (this.fpsTime >= 0.5) {
      this.fps = Math.round(this.fpsFrames / this.fpsTime);
      this.frameMs = (this.fpsTime / this.fpsFrames) * 1000;
      this.fpsFrames = 0;
      this.fpsTime = 0;
    }

    // Animate water UVs subtly
    const wt = performance.now() * 0.00018;
    this.materials.waterTex.offset.set(wt, Math.sin(wt * 4) * 0.08);

    if (!this.playing || !this.world || !this.meta) {
      this.updateTitlePanorama(dt);
      this.renderScene();
      return;
    }

    const activeHUD = this.ui.screen === 'hud';

    // Handle loading progress overlay if still streaming initial chunks
    if (this.ui.screen === 'loading') {
      this.loadingCheckTimer += dt;
      this.world.update(this.player.x, this.player.z, 14);
      const r = this.world.readiness(this.player.x, this.player.z, 2);
      this.ui.setLoadingProgress(r);
      if (r >= 0.85 || this.loadingCheckTimer > 2.2) {
        this.enterGameplayHUD();
      }
      this.renderScene();
      return;
    }

    if (activeHUD) {
      this.handleLookAndHotbar();
      this.stepSimulation(dt);
    } else {
      this.input.consumeLook();
      this.input.consumeFrameEdges();
    }

    // Stream & mesh chunks within frame budget
    this.world.update(this.player.x, this.player.z, activeHUD ? 4.5 : 8);

    // Autosave periodically and on safe boundaries
    this.autosaveTimer -= dt;
    if (this.autosaveTimer <= 0) {
      this.autosaveTimer = AUTOSAVE_INTERVAL;
      void this.saveCurrentWorld(false);
    }

    this.updateCameraTransform(dt);
    this.sky.update(this.meta.time, dt, this.camPos, this.player.headInWater);
    (this.scene.fog as THREE.FogExp2).color.copy(this.sky.fogColor);
    (this.scene.fog as THREE.FogExp2).density = this.player.headInWater
      ? 0.065
      : 1.65 / Math.max(48, this.settings.renderDistance * 16);
    this.ui.setUnderwater(this.player.headInWater);

    // Update particles & ambience
    const col = this.world.generator.column(
      Math.floor(this.player.x),
      Math.floor(this.player.z),
    );
    this.debris.update(
      dt,
      (x, y, z) => IS_SOLID[this.world!.getBlock(Math.floor(x), Math.floor(y), Math.floor(z))] === 1,
    );
    this.ambience.update(
      dt,
      this.camPos.x,
      this.camPos.y,
      this.camPos.z,
      1 - this.sky.daylight,
      col.forest,
      col.height + 1,
    );
    const underground = this.player.y + 4 < col.height;
    audio.updateAmbience(dt, this.sky.daylight, this.player.y, underground);

    // First-person hand update
    const heldId = this.inv.held?.id ?? 0;
    this.hand.setHeld(heldId);
    const horizSpeed = Math.hypot(this.player.vx, this.player.vz);
    this.hand.update(
      dt,
      this.player.onGround ? Math.min(1, horizSpeed / 4.5) : 0,
      this.player.sprinting,
      this.sky.daylight,
    );

    this.renderScene();
    this.updateDebugTelemetry(col);
  }

  private updateTitlePanorama(dt: number): void {
    if (!this.world) return;
    this.panoramaAngle += dt * 0.07;
    const rad = 22;
    const cx = this.panoramaCenter.x + Math.cos(this.panoramaAngle) * rad;
    const cz = this.panoramaCenter.z + Math.sin(this.panoramaAngle) * rad;
    this.world.update(this.panoramaCenter.x, this.panoramaCenter.z, 6);
    this.camera.position.set(cx, this.panoramaCenter.y, cz);
    this.camera.lookAt(
      this.panoramaCenter.x,
      this.panoramaCenter.y - 5,
      this.panoramaCenter.z,
    );
    this.sky.update(0.2 + Math.sin(this.panoramaAngle * 0.5) * 0.08, dt, this.camera.position, false);
    (this.scene.fog as THREE.FogExp2).color.copy(this.sky.fogColor);
  }

  private handleLookAndHotbar(): void {
    const { dx, dy } = this.input.consumeLook();
    const sens = 0.0022 * this.settings.sensitivity;
    const inv = this.settings.invertY ? -1 : 1;
    this.player.yaw -= dx * sens;
    this.player.pitch = Math.max(
      -Math.PI * 0.49,
      Math.min(Math.PI * 0.49, this.player.pitch - dy * sens * inv),
    );

    const edges = this.input.consumeFrameEdges();
    if (edges.wheel !== 0) {
      this.inv.select(this.inv.selected + (edges.wheel > 0 ? 1 : -1));
    }
    if (edges.doubleSpace && this.meta?.mode === 'creative') {
      this.player.flying = !this.player.flying;
      this.ui.updateVitals(this.health, this.hunger, this.meta.mode, this.player.flying);
    }

    if (edges.justLeft) {
      this.hand.triggerSwing();
      this.tryHitMob();
    }
    if (edges.justRight) {
      this.handleRightClickAction();
      this.placeCooldown = 0.24;
    }
  }

  private stepSimulation(dt: number): void {
    const world = this.world!;
    const meta = this.meta!;

    // Advance day-night clock
    if (meta.daylightCycle) {
      const prev = meta.time;
      meta.time = (meta.time + dt / DAY_LENGTH_SECONDS) % 1;
      if (meta.time < prev) meta.day++;
    }

    // Fixed-timestep physics accumulator (physics-tuning skill)
    this.accum = Math.min(this.accum + dt, FIXED_DT * 5);
    const moveInput = {
      forward: this.input.forward,
      right: this.input.right,
      jump: this.input.jump,
      sprint: this.input.sprint,
      crouch: this.input.crouch,
    };

    const wasGround = this.player.onGround;
    const wasWater = this.player.inWater;
    while (this.accum >= FIXED_DT) {
      this.player.step(FIXED_DT, moveInput, world, meta.mode === 'creative');
      this.accum -= FIXED_DT;
    }
    if (wasGround && !this.player.onGround && this.player.vy > 0) {
      audio.jump();
    }
    if (!wasWater && this.player.inWater) {
      audio.splash();
    }

    // Footsteps
    if (this.player.stepDistance - this.footstepDist > 1.85) {
      this.footstepDist = this.player.stepDistance;
      const snd = this.player.groundSound(world);
      if (snd) audio.footstep(snd);
    }

    // Landing feedback + fall damage
    if (this.player.landedFall > 0) {
      const fall = this.player.landedFall;
      this.player.landedFall = -1;
      if (fall > 1.2) {
        audio.land(fall);
        this.hand.land(fall);
      }
      if (meta.mode === 'survival' && fall > 3.5) {
        const dmg = Math.floor(fall - 3);
        if (dmg > 0) this.damagePlayer(dmg);
      }
    }

    // Void safety net
    if (this.player.y < -15) {
      if (meta.mode === 'survival') {
        this.damagePlayer(20);
      } else {
        this.respawnPlayer();
      }
    }

    // Survival needs (survival-crafting skill)
    if (meta.mode === 'survival') {
      const moving = Math.hypot(this.player.vx, this.player.vz) > 0.5;
      const drainRate = this.player.sprinting ? 2.4 : moving ? 1.0 : 0.25;
      this.hungerTimer += dt * drainRate;
      if (this.hungerTimer >= 42) {
        this.hungerTimer = 0;
        this.hunger = Math.max(0, this.hunger - 1);
        this.ui.updateVitals(this.health, this.hunger, meta.mode, false);
      }
      if (this.hunger >= 16 && this.health < 20) {
        this.regenTimer += dt;
        if (this.regenTimer >= 4) {
          this.regenTimer = 0;
          this.health = Math.min(20, this.health + 1);
          this.ui.updateVitals(this.health, this.hunger, meta.mode, false);
        }
      } else {
        this.regenTimer = 0;
      }
      if (this.hunger === 0) {
        this.starveTimer += dt;
        if (this.starveTimer >= 5 && this.health > 2) {
          this.starveTimer = 0;
          this.damagePlayer(1);
        }
      } else {
        this.starveTimer = 0;
      }
    }

    // Raycast target block from eye position
    const eyeX = this.player.x;
    const eyeY = this.player.y + this.player.eyeHeight;
    const eyeZ = this.player.z;
    this.camera.getWorldDirection(this.camDir);
    this.currentHit = raycastVoxel(
      world,
      eyeX,
      eyeY,
      eyeZ,
      this.camDir.x,
      this.camDir.y,
      this.camDir.z,
      REACH_DISTANCE,
    );

    if (this.currentHit) {
      const b = BLOCKS[this.currentHit.id];
      this.selection.show(
        this.currentHit.x,
        this.currentHit.y,
        this.currentHit.z,
        b?.render === 'cross',
      );
      this.ui.updateTargetInfo(this.currentHit.id);
    } else {
      this.selection.hide();
      this.ui.updateTargetInfo(null);
    }

    // Mining & continuous placing
    this.updateMining(dt);
    if (this.input.placing) {
      this.placeCooldown -= dt;
      if (this.placeCooldown <= 0) {
        this.handleRightClickAction();
        this.placeCooldown = 0.22;
      }
    }

    // Dropped items & creatures
    this.drops.update(
      dt,
      world,
      this.player.x,
      this.player.y,
      this.player.z,
      (it) => {
        const left = this.inv.add(it.id, it.count, it.dur);
        if (left < it.count) audio.pickup();
        return left;
      },
      this.camera,
    );

    this.mobs.update(
      dt,
      world,
      this.player,
      1 - this.sky.daylight,
      meta.mode === 'survival',
      (dmg, fx, fz) => {
        if (meta.mode === 'survival') {
          this.damagePlayer(dmg);
          const dx = this.player.x - fx;
          const dz = this.player.z - fz;
          const d = Math.hypot(dx, dz) || 1;
          this.player.vx += (dx / d) * 6;
          this.player.vz += (dz / d) * 6;
          this.player.vy = 5;
        }
      },
    );
  }

  private updateMining(dt: number): void {
    const world = this.world!;
    const meta = this.meta!;
    if (!this.input.mining || !this.currentHit) {
      this.miningProgress = 0;
      this.miningBlockKey = '';
      if (this.currentHit) {
        this.selection.setProgress(this.currentHit.x, this.currentHit.y, this.currentHit.z, 0);
      }
      return;
    }

    const hit = this.currentHit;
    const key = `${hit.x},${hit.y},${hit.z}`;
    if (key !== this.miningBlockKey) {
      this.miningBlockKey = key;
      this.miningProgress = 0;
    }

    this.hand.triggerSwing();
    const def = BLOCKS[hit.id];
    if (!def || def.hardness < 0) return;

    const heldId = this.inv.held?.id ?? 0;
    const needed = meta.mode === 'creative' ? 0.06 : breakTime(hit.id, heldId);

    this.digSoundTimer -= dt;
    if (this.digSoundTimer <= 0) {
      this.digSoundTimer = 0.22;
      audio.dig(def.sound);
      this.debris.burst(hit.x, hit.y, hit.z, hit.id, 3, 0.5);
    }

    this.miningProgress += dt / needed;
    this.selection.setProgress(hit.x, hit.y, hit.z, this.miningProgress);

    if (this.miningProgress >= 1) {
      this.miningProgress = 0;
      this.miningBlockKey = '';
      this.selection.setProgress(hit.x, hit.y, hit.z, 0);
      this.breakBlockAt(hit.x, hit.y, hit.z, hit.id, heldId);
      // If a plant sat on top of this block, pop it off as well
      const aboveId = world.getBlock(hit.x, hit.y + 1, hit.z);
      if (aboveId > 0 && BLOCKS[aboveId]?.needsSoil) {
        this.breakBlockAt(hit.x, hit.y + 1, hit.z, aboveId, heldId);
      }
    }
  }

  private breakBlockAt(x: number, y: number, z: number, blockId: number, heldId: number): void {
    const world = this.world!;
    const meta = this.meta!;
    const def = BLOCKS[blockId];
    if (!world.setBlock(x, y, z, B.AIR)) return;
    world.rebuildNow(x, z);
    audio.breakBlock(def.sound);
    this.debris.burst(x, y, z, blockId, 16);
    this.addTrauma(0.12);

    if (meta.mode === 'survival') {
      if (canHarvest(blockId, heldId)) {
        for (const d of def.drops) {
          if (d.chance === undefined || Math.random() < d.chance) {
            this.drops.spawn(x + 0.5, y + 0.35, z + 0.5, d.id, d.count);
          }
        }
      }
      if (ITEMS.get(heldId)?.tool && def.hardness > 0) {
        if (this.inv.damageHeld()) {
          audio.toolBreak();
          this.ui.toast('Your tool broke!');
        }
      }
    }
  }

  private handleRightClickAction(): void {
    const world = this.world!;
    const meta = this.meta!;
    const hit = this.currentHit;

    // 1. Clicking a placed Tinker Bench opens the full crafting menu (unless sneaking to place on it)
    if (hit && hit.id === B.BENCH && !this.player.crouching) {
      this.input.exitPointerLock();
      this.ui.openInventory(true, meta.mode);
      this.ui.updateTouchVisibility(false);
      return;
    }

    const held = this.inv.held;
    if (!held) return;

    // 2. Eating food item in hand
    const itemDef = ITEMS.get(held.id);
    if (itemDef?.food) {
      if (meta.mode === 'survival' && (this.hunger < 20 || this.health < 20)) {
        audio.eat();
        this.hand.triggerSwing();
        this.hunger = Math.min(20, this.hunger + itemDef.food.hunger);
        this.health = Math.min(20, this.health + itemDef.food.heal);
        this.inv.consumeSelected(1);
        this.ui.updateVitals(this.health, this.hunger, meta.mode, false);
        this.ui.toast(`Ate ${itemName(held.id)}`);
      }
      return;
    }

    // 3. Placing a block
    if (!hit || !isBlockItem(held.id)) return;
    const targetBlock = BLOCKS[hit.id];
    // If clicking a replaceable plant (like Wild Grass), replace it in place
    const tx = targetBlock?.replaceable ? hit.x : hit.x + hit.nx;
    const ty = targetBlock?.replaceable ? hit.y : hit.y + hit.ny;
    const tz = targetBlock?.replaceable ? hit.z : hit.z + hit.nz;
    if (ty < 0 || ty >= WORLD_HEIGHT) return;

    const existing = world.getBlock(tx, ty, tz);
    if (existing < 0) return;
    if (existing !== B.AIR && !BLOCKS[existing]?.replaceable) return;

    const placeDef = BLOCKS[held.id];
    if (!placeDef) return;
    if (placeDef.needsSoil) {
      const below = world.getBlock(tx, ty - 1, tz);
      if (below !== B.GRASS && below !== B.SOIL && below !== B.SAND) return;
    }

    // Never place a solid block inside the player's body
    if (placeDef.solid && this.player.intersectsBlock(tx, ty, tz)) return;

    if (world.setBlock(tx, ty, tz, held.id)) {
      world.rebuildNow(tx, tz);
      this.hand.triggerSwing();
      audio.place(placeDef.sound);
      if (meta.mode === 'survival') {
        this.inv.consumeSelected(1);
      }
    }
  }

  private tryHitMob(): void {
    const eyeX = this.player.x;
    const eyeY = this.player.y + this.player.eyeHeight;
    const eyeZ = this.player.z;
    this.camera.getWorldDirection(this.camDir);
    const hit = this.mobs.raycast(
      eyeX,
      eyeY,
      eyeZ,
      this.camDir.x,
      this.camDir.y,
      this.camDir.z,
      3.8,
    );
    if (!hit) return;
    if (this.currentHit && this.currentHit.distance < hit.dist) return;
    const heldId = this.inv.held?.id ?? 0;
    const tool = ITEMS.get(heldId)?.tool;
    const dmg = tool ? 2 + tool.tier * 2 : 2;
    audio.hurt();
    this.addTrauma(0.25);
    const died = this.mobs.hit(hit.mob, dmg, this.player.x, this.player.z);
    if (died) {
      const b = hit.mob.body;
      this.debris.burst(b.x - 0.5, b.y, b.z - 0.5, B.SOIL, 14);
      for (const [dropId, cnt] of MobSystem.dropFor(hit.mob.kind)) {
        this.drops.spawn(b.x, b.y + 0.3, b.z, dropId, cnt);
      }
      this.mobs.remove(hit.mob);
    }
  }

  private damagePlayer(amount: number): void {
    if (!this.meta || this.meta.mode !== 'survival') return;
    this.health = Math.max(0, this.health - amount);
    audio.hurt();
    this.addTrauma(Math.min(0.75, 0.25 + amount * 0.08));
    this.ui.flashDamage();
    this.ui.updateVitals(this.health, this.hunger, this.meta.mode, false);
    if (this.health <= 0) {
      this.input.exitPointerLock();
      this.ui.updateTouchVisibility(false);
      this.ui.showScreen('dead');
    }
  }

  private addTrauma(amount: number): void {
    if (this.settings.reduceMotion) return;
    this.trauma = Math.min(1, this.trauma + amount);
  }

  private updateCameraTransform(dt: number): void {
    // Interpolate between fixed physics steps (physics-tuning + camera-systems skills)
    const alpha = Math.min(1, this.accum / FIXED_DT);
    const ix = this.player.prevX + (this.player.x - this.player.prevX) * alpha;
    const iy = this.player.prevY + (this.player.y - this.player.prevY) * alpha;
    const iz = this.player.prevZ + (this.player.z - this.player.prevZ) * alpha;

    // Subtle head bob
    const hSpeed = Math.hypot(this.player.vx, this.player.vz);
    if (this.player.onGround && hSpeed > 0.2 && !this.settings.reduceMotion) {
      this.bobPhase += dt * hSpeed * 1.9;
    }
    const bobAmt = this.player.onGround && !this.settings.reduceMotion ? Math.min(1, hSpeed / 4.5) : 0;
    const bobY = Math.abs(Math.sin(this.bobPhase)) * 0.045 * bobAmt;
    const bobX = Math.cos(this.bobPhase) * 0.025 * bobAmt;

    // Trauma-based screen shake
    let shakePitch = 0;
    let shakeYaw = 0;
    if (this.trauma > 0) {
      this.trauma = Math.max(0, this.trauma - 1.5 * dt);
      this.shakeTime += dt * 32;
      const sh = this.trauma * this.trauma;
      shakePitch = Math.sin(this.shakeTime * 1.7) * 0.04 * sh;
      shakeYaw = Math.cos(this.shakeTime * 2.3) * 0.04 * sh;
    }

    this.camera.rotation.set(
      this.player.pitch + shakePitch,
      this.player.yaw + shakeYaw,
      0,
      'YXZ',
    );

    const eyeX = ix + Math.cos(this.player.yaw) * bobX;
    const eyeY = iy + this.player.eyeHeight + bobY;
    const eyeZ = iz - Math.sin(this.player.yaw) * bobX;

    if (!this.thirdPerson) {
      this.camPos.set(eyeX, eyeY, eyeZ);
      this.camera.position.copy(this.camPos);
    } else {
      // Third-person camera with collision push-in so it never clips inside blocks
      this.avatarGroup.position.set(ix, iy, iz);
      this.avatarGroup.rotation.y = this.player.yaw;
      this.camera.getWorldDirection(this.camDir);
      let dist = 3.8;
      if (this.world) {
        const hit = raycastVoxel(
          this.world,
          eyeX,
          eyeY,
          eyeZ,
          -this.camDir.x,
          -this.camDir.y,
          -this.camDir.z,
          dist,
        );
        if (hit) dist = Math.max(0.4, hit.distance - 0.35);
      }
      this.camPos.set(
        eyeX - this.camDir.x * dist,
        eyeY - this.camDir.y * dist,
        eyeZ - this.camDir.z * dist,
      );
      this.camera.position.copy(this.camPos);
    }
  }

  private renderScene(): void {
    this.renderer.info.reset();
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    if (this.playing && !this.thirdPerson && this.ui.screen !== 'loading') {
      this.renderer.clearDepth();
      this.renderer.render(this.hand.scene, this.hand.camera);
    }
  }

  private updateDebugTelemetry(col: { desert: number; forest: number; plains: number }): void {
    if (!this.settings.showFps || !this.world || !this.meta) return;
    const st = this.world.stats();
    const info = this.renderer.info;
    const biome =
      col.desert > 0.45
        ? 'Sunbleached Shore / Dunes'
        : col.forest > 0.45
          ? 'Pine & Oakwood Forest'
          : 'Grassy Plains';
    const todHours = Math.floor(((this.meta.time + 0.25) % 1) * 24);
    const todMins = Math.floor(((((this.meta.time + 0.25) % 1) * 24) % 1) * 60);
    const clock = `${String(todHours).padStart(2, '0')}:${String(todMins).padStart(2, '0')}`;
    this.ui.updateDebug(
      `FPS: ${this.fps} (${this.frameMs.toFixed(1)} ms) | Draws: ${info.render.calls} | Tris: ${info.render.triangles}\n` +
        `XYZ: ${this.player.x.toFixed(1)}, ${this.player.y.toFixed(1)}, ${this.player.z.toFixed(1)} | Ground: ${this.player.onGround}\n` +
        `Chunks: ${st.meshed}/${st.loaded} meshed (q:${st.queued} w:${st.pending}) | Mesh: ${this.world.lastMeshMs.toFixed(1)} ms\n` +
        `Biome: ${biome} | Day ${this.meta.day + 1} (${clock}) | Seed: ${this.meta.seedText}`,
    );
  }
}

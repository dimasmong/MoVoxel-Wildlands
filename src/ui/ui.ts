import {
  BLOCKS,
  CREATIVE_PALETTE,
  ITEMS,
  itemName,
  maxStack,
} from '../world/registry';
import { HOTBAR_SIZE, INVENTORY_SIZE, type Inventory, type Slot } from '../game/inventory';
import { RECIPES, canCraft, craft, type Recipe } from '../game/crafting';
import { iconURL } from '../render/icons';
import { type GameMode, type WorldMeta } from '../save/db';
import { type Settings, isTouchDevice, saveSettings } from '../settings';
import { audio } from '../audio/audio';

export type ScreenName = 'title' | 'newworld' | 'loadworld' | 'loading' | 'hud' | 'inventory' | 'pause' | 'settings' | 'dead';

export interface UICallbacks {
  onCreateWorld: (name: string, seed: string, mode: GameMode, daylightCycle: boolean) => void;
  onQuickPlay: () => void;
  onLoadWorld: (meta: WorldMeta) => void;
  onDeleteWorld: (id: string) => Promise<void>;
  onResume: () => void;
  onSaveNow: () => Promise<void>;
  onExitToTitle: () => Promise<void>;
  onRespawn: () => void;
  onSettingsChanged: (s: Settings) => void;
  onToggleCamera: () => void;
  onOpenInventory: () => void;
  onPauseToggle: () => void;
  getWorlds: () => Promise<{ worlds: WorldMeta[]; broken: string[] }>;
}

/**
 * UI & HUD controller (game-ui-ux skill: screen stack, event-driven HUD updates, safe areas,
 * tactile original timber-and-slate aesthetic).
 */
export class UIManager {
  screen: ScreenName = 'title';
  private returnScreen: ScreenName = 'title';
  private atBench = false;
  private heldCursor: Slot | null = null;
  private cursorEl!: HTMLElement;
  private tooltipEl!: HTMLElement;
  private toastTimer = 0;

  // Cached DOM references
  readonly root: HTMLElement;
  private screens = new Map<ScreenName, HTMLElement>();
  private hotbarEl!: HTMLElement;
  private hotbarLabelEl!: HTMLElement;
  private heartsEl!: HTMLElement;
  private hungerEl!: HTMLElement;
  private modeBadgeEl!: HTMLElement;
  private targetInfoEl!: HTMLElement;
  private debugEl!: HTMLElement;
  private saveBadgeEl!: HTMLElement;
  private toastEl!: HTMLElement;
  private loadingBarEl!: HTMLElement;
  private loadingTextEl!: HTMLElement;
  private damageFlashEl!: HTMLElement;
  private underwaterEl!: HTMLElement;
  private invGridEl!: HTMLElement;
  private recipeListEl!: HTMLElement;
  private benchTagEl!: HTMLElement;
  private creativePanelEl!: HTMLElement;
  private worldListEl!: HTMLElement;
  private storageWarnEl!: HTMLElement;
  private touchOverlayEl!: HTMLElement;

  touchElements!: {
    stickZone: HTMLElement;
    stickKnob: HTMLElement;
    lookZone: HTMLElement;
    btnJump: HTMLElement;
    btnMine: HTMLElement;
    btnPlace: HTMLElement;
    btnCrouch: HTMLElement;
    btnInv: HTMLElement;
    btnFly: HTMLElement;
  };

  constructor(
    private inv: Inventory,
    private settings: Settings,
    private cb: UICallbacks,
  ) {
    this.root = document.getElementById('ui-root')!;
    this.buildDOM();
    this.inv.onChange(() => {
      this.renderHotbar();
      if (this.screen === 'inventory') {
        this.renderInventoryGrid();
        this.renderRecipes();
      }
    });
    window.addEventListener('mousemove', (e) => {
      if (this.heldCursor) {
        this.cursorEl.style.transform = `translate(${e.clientX + 10}px, ${e.clientY + 10}px)`;
      }
      if (this.tooltipEl.classList.contains('visible')) {
        const x = Math.min(window.innerWidth - 230, e.clientX + 14);
        const y = Math.min(window.innerHeight - 90, e.clientY + 14);
        this.tooltipEl.style.transform = `translate(${x}px, ${y}px)`;
      }
    });
  }

  private buildDOM(): void {
    this.root.innerHTML = `
      <div id="underwater-tint" class="underwater-tint"></div>
      <div id="damage-flash" class="damage-flash"></div>

      <div id="portrait-banner" class="portrait-banner">
        <span>Rotate device to landscape for the best Wildlands view</span>
        <button id="dismiss-portrait" class="mini-btn" type="button">Dismiss</button>
      </div>

      <!-- TITLE SCREEN -->
      <section id="screen-title" class="screen screen-title active">
        <div class="title-header">
          <div class="title-emblem">ORIGINAL VOXEL SURVIVAL SANDBOX</div>
          <h1 class="game-logo">MoVoxel<span>Wildlands</span></h1>
          <p class="game-tagline">Timber, slate, and glimmering stone across living cubic wilds</p>
        </div>
        <div class="menu-card title-menu">
          <button id="btn-quickplay" class="btn btn-primary" type="button">Play Wildlands</button>
          <button id="btn-newworld-open" class="btn" type="button">Create New World</button>
          <button id="btn-loadworld-open" class="btn" type="button">Saved Worlds</button>
          <button id="btn-title-settings" class="btn" type="button">Settings &amp; Controls</button>
          <div id="storage-warning" class="storage-warning hidden"></div>
        </div>
        <footer class="title-footer">
          <span>WASD Move · Mouse Look · Left Mine · Right Place/Use · E Pack &amp; Craft · F5 Camera · F3 Metrics</span>
        </footer>
      </section>

      <!-- NEW WORLD MODAL -->
      <section id="screen-newworld" class="screen modal-backdrop">
        <div class="menu-card modal-card">
          <div class="card-header">
            <h2>Forge a New World</h2>
            <p>Deterministic seeded terrain with plains, pinewood forests, shores, and wardstone rings.</p>
          </div>
          <label class="field">
            <span>World Name</span>
            <input id="inp-world-name" type="text" maxlength="32" value="Sunlit Reach" autocomplete="off" />
          </label>
          <label class="field">
            <span>World Seed <em>(optional — same seed builds the same terrain)</em></span>
            <div class="seed-row">
              <input id="inp-world-seed" type="text" maxlength="32" placeholder="Leave blank for random, e.g. wildlands-7" autocomplete="off" />
              <button id="btn-random-seed" class="btn btn-small" type="button">Random</button>
            </div>
          </label>
          <div class="field">
            <span>Expedition Mode</span>
            <div class="segmented" id="seg-mode">
              <button type="button" data-mode="survival" class="seg-btn active">
                <strong>Survival</strong>
                <small>Gather, craft tools, watch hunger &amp; night</small>
              </button>
              <button type="button" data-mode="creative" class="seg-btn">
                <strong>Creative</strong>
                <small>Unlimited blocks, instant break, double-jump fly</small>
              </button>
            </div>
          </div>
          <label class="field-check">
            <input id="chk-daycycle" type="checkbox" checked />
            <span>Dynamic Sun &amp; Moon Day/Night Cycle</span>
          </label>
          <div class="modal-actions">
            <button id="btn-newworld-back" class="btn" type="button">Back</button>
            <button id="btn-newworld-create" class="btn btn-primary" type="button">Enter World</button>
          </div>
        </div>
      </section>

      <!-- LOAD WORLD MODAL -->
      <section id="screen-loadworld" class="screen modal-backdrop">
        <div class="menu-card modal-card modal-wide">
          <div class="card-header">
            <h2>Saved Worlds</h2>
            <p>Stored locally in your browser via versioned IndexedDB snapshots.</p>
          </div>
          <div id="world-list" class="world-list"></div>
          <div class="modal-actions">
            <button id="btn-loadworld-back" class="btn" type="button">Back</button>
            <button id="btn-loadworld-new" class="btn btn-primary" type="button">+ New World</button>
          </div>
        </div>
      </section>

      <!-- LOADING SCREEN -->
      <section id="screen-loading" class="screen modal-backdrop">
        <div class="menu-card modal-card">
          <h2 id="loading-title">Shaping the Wildlands…</h2>
          <p id="loading-text">Carving valleys, planting timber, and meshing nearby chunks</p>
          <div class="progress-track">
            <div id="loading-bar" class="progress-fill"></div>
          </div>
        </div>
      </section>

      <!-- IN-GAME HUD -->
      <section id="screen-hud" class="screen hud-layer">
        <div class="hud-top-left">
          <div class="hud-chip">
            <span id="hud-mode-badge" class="mode-pill">SURVIVAL</span>
            <span id="hud-target-info" class="target-pill"></span>
          </div>
          <pre id="hud-debug" class="debug-panel hidden"></pre>
        </div>

        <div class="hud-top-right">
          <span id="hud-save-badge" class="save-pill">Saved</span>
          <button id="btn-hud-cam" class="hud-icon-btn" type="button" title="Toggle Camera (F5)">Cam</button>
          <button id="btn-hud-inv" class="hud-icon-btn" type="button" title="Pack &amp; Crafting (E)">Pack</button>
          <button id="btn-hud-pause" class="hud-icon-btn" type="button" title="Pause / Menu (Esc)">Menu</button>
        </div>

        <div class="crosshair" aria-hidden="true">
          <span class="ch-h"></span>
          <span class="ch-v"></span>
        </div>

        <!-- Mobile Touch Controls -->
        <div id="touch-overlay" class="touch-overlay hidden">
          <div id="touch-stick-zone" class="touch-stick-zone">
            <div class="touch-stick-ring">
              <div id="touch-stick-knob" class="touch-stick-knob"></div>
            </div>
          </div>
          <div id="touch-look-zone" class="touch-look-zone"></div>
          <div class="touch-actions">
            <button id="touch-btn-mine" class="touch-btn touch-btn-mine" type="button">Mine</button>
            <button id="touch-btn-place" class="touch-btn touch-btn-place" type="button">Place</button>
            <button id="touch-btn-jump" class="touch-btn touch-btn-jump" type="button">Jump</button>
            <button id="touch-btn-crouch" class="touch-btn touch-btn-sub" type="button">Sneak</button>
            <button id="touch-btn-fly" class="touch-btn touch-btn-sub hidden" type="button">Fly</button>
            <button id="touch-btn-inv" class="touch-btn touch-btn-sub" type="button">Pack</button>
          </div>
        </div>

        <div class="hud-bottom">
          <div id="hud-vitals" class="vitals-row">
            <div id="hud-hearts" class="vital-bar" aria-label="Health"></div>
            <div id="hud-hunger" class="vital-bar" aria-label="Stamina &amp; Hunger"></div>
          </div>
          <div id="hud-hotbar-label" class="hotbar-item-label"></div>
          <div id="hud-hotbar" class="hotbar" role="toolbar" aria-label="Hotbar"></div>
        </div>
      </section>

      <!-- INVENTORY & CRAFTING MODAL -->
      <section id="screen-inventory" class="screen modal-backdrop">
        <div class="menu-card inv-modal">
          <div class="inv-header">
            <div>
              <h2>Field Pack &amp; Crafting</h2>
              <span id="bench-status-tag" class="bench-tag">Hand Crafting (place &amp; right-click a Tinker Bench for tool recipes)</span>
            </div>
            <button id="btn-inv-close" class="btn btn-small" type="button">Close (E)</button>
          </div>

          <div class="inv-columns">
            <div class="inv-left">
              <h3>Backpack &amp; Hotbar <small>(Click or tap to move, right-click for half)</small></h3>
              <div id="inv-grid" class="inv-grid"></div>
              <div id="creative-panel" class="creative-drawer hidden">
                <h3>Creative Supply Catalog <small>(Click to add stack to pack)</small></h3>
                <div id="creative-grid" class="creative-grid"></div>
              </div>
            </div>

            <div class="inv-right">
              <h3>Crafting Recipes</h3>
              <div id="recipe-list" class="recipe-list"></div>
            </div>
          </div>
        </div>
      </section>

      <!-- PAUSE MODAL -->
      <section id="screen-pause" class="screen modal-backdrop">
        <div class="menu-card modal-card">
          <div class="card-header">
            <h2>Expedition Paused</h2>
            <p id="pause-world-summary"></p>
          </div>
          <div class="menu-stack">
            <button id="btn-pause-resume" class="btn btn-primary" type="button">Resume Game</button>
            <button id="btn-pause-save" class="btn" type="button">Save World Now</button>
            <button id="btn-pause-settings" class="btn" type="button">Settings &amp; Controls</button>
            <button id="btn-pause-exit" class="btn btn-danger" type="button">Save &amp; Exit to Title</button>
          </div>
        </div>
      </section>

      <!-- SETTINGS MODAL -->
      <section id="screen-settings" class="screen modal-backdrop">
        <div class="menu-card modal-card modal-wide">
          <div class="card-header">
            <h2>Settings &amp; Controls</h2>
            <p>Changes apply immediately and persist locally.</p>
          </div>
          <div class="settings-grid">
            <label class="field">
              <span>Field of View: <strong id="lbl-fov"></strong>°</span>
              <input id="rng-fov" type="range" min="55" max="105" step="1" />
            </label>
            <label class="field">
              <span>Look Sensitivity: <strong id="lbl-sens"></strong></span>
              <input id="rng-sens" type="range" min="0.2" max="2.5" step="0.05" />
            </label>
            <label class="field">
              <span>Render Distance: <strong id="lbl-rdist"></strong> chunks</span>
              <input id="rng-rdist" type="range" min="3" max="10" step="1" />
            </label>
            <label class="field">
              <span>Graphics Preset</span>
              <select id="sel-quality">
                <option value="low">Low (Mobile / Battery Saver)</option>
                <option value="medium">Medium (Balanced Shadows)</option>
                <option value="high">High (Crisp Shadows &amp; Foliage)</option>
              </select>
            </label>
            <label class="field">
              <span>Master Volume: <strong id="lbl-vol-master"></strong>%</span>
              <input id="rng-vol-master" type="range" min="0" max="1" step="0.05" />
            </label>
            <label class="field">
              <span>SFX Volume: <strong id="lbl-vol-sfx"></strong>%</span>
              <input id="rng-vol-sfx" type="range" min="0" max="1" step="0.05" />
            </label>
            <label class="field">
              <span>Ambience Volume: <strong id="lbl-vol-amb"></strong>%</span>
              <input id="rng-vol-amb" type="range" min="0" max="1" step="0.05" />
            </label>
            <label class="field">
              <span>Touch Overlay</span>
              <select id="sel-touch">
                <option value="auto">Auto-Detect Device</option>
                <option value="on">Always Show Touch Controls</option>
                <option value="off">Hide Touch Controls</option>
              </select>
            </label>
          </div>
          <div class="settings-toggles">
            <label class="field-check"><input id="chk-inverty" type="checkbox" /><span>Invert Look Y-Axis</span></label>
            <label class="field-check"><input id="chk-reducemotion" type="checkbox" /><span>Reduce Camera Motion &amp; Shake</span></label>
            <label class="field-check"><input id="chk-fps" type="checkbox" /><span>Show FPS &amp; Chunk Telemetry (F3)</span></label>
          </div>
          <div class="modal-actions">
            <button id="btn-fullscreen" class="btn" type="button">Toggle Fullscreen</button>
            <button id="btn-settings-back" class="btn btn-primary" type="button">Done</button>
          </div>
        </div>
      </section>

      <!-- DEATH / RESPAWN MODAL -->
      <section id="screen-dead" class="screen modal-backdrop">
        <div class="menu-card modal-card">
          <div class="card-header">
            <h2>You Succumbed to the Wilds</h2>
            <p>Your pack remains safe — respawn at your camp point to continue building.</p>
          </div>
          <div class="modal-actions">
            <button id="btn-respawn" class="btn btn-primary" type="button">Respawn at Camp</button>
            <button id="btn-dead-exit" class="btn" type="button">Save &amp; Exit</button>
          </div>
        </div>
      </section>

      <div id="held-cursor" class="held-cursor hidden"></div>
      <div id="ui-tooltip" class="ui-tooltip"></div>
      <div id="ui-toast" class="ui-toast"></div>
    `;

    const mapScreen = (n: ScreenName, id: string) => {
      this.screens.set(n, document.getElementById(id)!);
    };
    mapScreen('title', 'screen-title');
    mapScreen('newworld', 'screen-newworld');
    mapScreen('loadworld', 'screen-loadworld');
    mapScreen('loading', 'screen-loading');
    mapScreen('hud', 'screen-hud');
    mapScreen('inventory', 'screen-inventory');
    mapScreen('pause', 'screen-pause');
    mapScreen('settings', 'screen-settings');
    mapScreen('dead', 'screen-dead');

    this.hotbarEl = document.getElementById('hud-hotbar')!;
    this.hotbarLabelEl = document.getElementById('hud-hotbar-label')!;
    this.heartsEl = document.getElementById('hud-hearts')!;
    this.hungerEl = document.getElementById('hud-hunger')!;
    this.modeBadgeEl = document.getElementById('hud-mode-badge')!;
    this.targetInfoEl = document.getElementById('hud-target-info')!;
    this.debugEl = document.getElementById('hud-debug')!;
    this.saveBadgeEl = document.getElementById('hud-save-badge')!;
    this.toastEl = document.getElementById('ui-toast')!;
    this.loadingBarEl = document.getElementById('loading-bar')!;
    this.loadingTextEl = document.getElementById('loading-text')!;
    this.damageFlashEl = document.getElementById('damage-flash')!;
    this.underwaterEl = document.getElementById('underwater-tint')!;
    this.invGridEl = document.getElementById('inv-grid')!;
    this.recipeListEl = document.getElementById('recipe-list')!;
    this.benchTagEl = document.getElementById('bench-status-tag')!;
    this.creativePanelEl = document.getElementById('creative-panel')!;
    this.worldListEl = document.getElementById('world-list')!;
    this.storageWarnEl = document.getElementById('storage-warning')!;
    this.touchOverlayEl = document.getElementById('touch-overlay')!;
    this.cursorEl = document.getElementById('held-cursor')!;
    this.tooltipEl = document.getElementById('ui-tooltip')!;

    this.touchElements = {
      stickZone: document.getElementById('touch-stick-zone')!,
      stickKnob: document.getElementById('touch-stick-knob')!,
      lookZone: document.getElementById('touch-look-zone')!,
      btnJump: document.getElementById('touch-btn-jump')!,
      btnMine: document.getElementById('touch-btn-mine')!,
      btnPlace: document.getElementById('touch-btn-place')!,
      btnCrouch: document.getElementById('touch-btn-crouch')!,
      btnInv: document.getElementById('touch-btn-inv')!,
      btnFly: document.getElementById('touch-btn-fly')!,
    };

    this.wireEvents();
    this.buildCreativeCatalog();
    this.renderHotbar();
    this.syncSettingsInputs();
  }

  private wireEvents(): void {
    const click = (id: string, fn: () => void) => {
      document.getElementById(id)!.addEventListener('click', () => {
        audio.unlock();
        audio.click();
        fn();
      });
    };

    document.getElementById('dismiss-portrait')!.addEventListener('click', () => {
      document.getElementById('portrait-banner')!.classList.add('dismissed');
    });

    click('btn-quickplay', () => this.cb.onQuickPlay());
    click('btn-newworld-open', () => this.showScreen('newworld'));
    click('btn-loadworld-open', () => void this.openWorldList());
    click('btn-title-settings', () => {
      this.returnScreen = 'title';
      this.showScreen('settings');
    });

    // New world form
    let selectedMode: GameMode = 'survival';
    const segBtns = document.querySelectorAll<HTMLButtonElement>('#seg-mode .seg-btn');
    segBtns.forEach((b) => {
      b.addEventListener('click', () => {
        audio.click();
        segBtns.forEach((x) => x.classList.remove('active'));
        b.classList.add('active');
        selectedMode = (b.dataset.mode as GameMode) || 'survival';
      });
    });

    const seedNames = ['ember-valley', 'mossback-bay', 'wardstone-7', 'pine-ridge', 'cinder-cove', 'skybell-hollow'];
    click('btn-random-seed', () => {
      const pick = seedNames[Math.floor(Math.random() * seedNames.length)] + '-' + Math.floor(100 + Math.random() * 900);
      (document.getElementById('inp-world-seed') as HTMLInputElement).value = pick;
    });

    click('btn-newworld-back', () => this.showScreen('title'));
    click('btn-newworld-create', () => {
      const name = (document.getElementById('inp-world-name') as HTMLInputElement).value.trim() || 'Wildlands Expedition';
      const seed = (document.getElementById('inp-world-seed') as HTMLInputElement).value.trim();
      const dayCycle = (document.getElementById('chk-daycycle') as HTMLInputElement).checked;
      this.cb.onCreateWorld(name, seed, selectedMode, dayCycle);
    });

    click('btn-loadworld-back', () => this.showScreen('title'));
    click('btn-loadworld-new', () => this.showScreen('newworld'));

    // HUD top-right buttons
    click('btn-hud-cam', () => this.cb.onToggleCamera());
    click('btn-hud-inv', () => this.cb.onOpenInventory());
    click('btn-hud-pause', () => this.cb.onPauseToggle());

    click('btn-inv-close', () => this.cb.onResume());

    // Pause buttons
    click('btn-pause-resume', () => this.cb.onResume());
    click('btn-pause-save', () => void this.cb.onSaveNow());
    click('btn-pause-settings', () => {
      this.returnScreen = 'pause';
      this.showScreen('settings');
    });
    click('btn-pause-exit', () => void this.cb.onExitToTitle());

    // Respawn
    click('btn-respawn', () => this.cb.onRespawn());
    click('btn-dead-exit', () => void this.cb.onExitToTitle());

    // Settings
    const bindSetting = () => {
      const s = this.settings;
      s.fov = Number((document.getElementById('rng-fov') as HTMLInputElement).value);
      s.sensitivity = Number((document.getElementById('rng-sens') as HTMLInputElement).value);
      s.renderDistance = Number((document.getElementById('rng-rdist') as HTMLInputElement).value);
      s.quality = (document.getElementById('sel-quality') as HTMLSelectElement).value as Settings['quality'];
      s.masterVolume = Number((document.getElementById('rng-vol-master') as HTMLInputElement).value);
      s.sfxVolume = Number((document.getElementById('rng-vol-sfx') as HTMLInputElement).value);
      s.ambientVolume = Number((document.getElementById('rng-vol-amb') as HTMLInputElement).value);
      s.touchControls = (document.getElementById('sel-touch') as HTMLSelectElement).value as Settings['touchControls'];
      s.invertY = (document.getElementById('chk-inverty') as HTMLInputElement).checked;
      s.reduceMotion = (document.getElementById('chk-reducemotion') as HTMLInputElement).checked;
      s.showFps = (document.getElementById('chk-fps') as HTMLInputElement).checked;
      saveSettings(s);
      this.syncSettingsLabels();
      this.cb.onSettingsChanged(s);
    };

    for (const id of [
      'rng-fov',
      'rng-sens',
      'rng-rdist',
      'sel-quality',
      'rng-vol-master',
      'rng-vol-sfx',
      'rng-vol-amb',
      'sel-touch',
      'chk-inverty',
      'chk-reducemotion',
      'chk-fps',
    ]) {
      document.getElementById(id)!.addEventListener('input', bindSetting);
      document.getElementById(id)!.addEventListener('change', bindSetting);
    }

    click('btn-fullscreen', () => {
      if (!document.fullscreenElement) {
        void document.documentElement.requestFullscreen?.().catch(() => {});
      } else {
        void document.exitFullscreen?.().catch(() => {});
      }
    });

    click('btn-settings-back', () => {
      this.showScreen(this.returnScreen);
    });
  }

  syncSettingsInputs(): void {
    const s = this.settings;
    (document.getElementById('rng-fov') as HTMLInputElement).value = String(s.fov);
    (document.getElementById('rng-sens') as HTMLInputElement).value = String(s.sensitivity);
    (document.getElementById('rng-rdist') as HTMLInputElement).value = String(s.renderDistance);
    (document.getElementById('sel-quality') as HTMLSelectElement).value = s.quality;
    (document.getElementById('rng-vol-master') as HTMLInputElement).value = String(s.masterVolume);
    (document.getElementById('rng-vol-sfx') as HTMLInputElement).value = String(s.sfxVolume);
    (document.getElementById('rng-vol-amb') as HTMLInputElement).value = String(s.ambientVolume);
    (document.getElementById('sel-touch') as HTMLSelectElement).value = s.touchControls;
    (document.getElementById('chk-inverty') as HTMLInputElement).checked = s.invertY;
    (document.getElementById('chk-reducemotion') as HTMLInputElement).checked = s.reduceMotion;
    (document.getElementById('chk-fps') as HTMLInputElement).checked = s.showFps;
    this.syncSettingsLabels();
  }

  private syncSettingsLabels(): void {
    const s = this.settings;
    document.getElementById('lbl-fov')!.textContent = String(s.fov);
    document.getElementById('lbl-sens')!.textContent = s.sensitivity.toFixed(2);
    document.getElementById('lbl-rdist')!.textContent = String(s.renderDistance);
    document.getElementById('lbl-vol-master')!.textContent = String(Math.round(s.masterVolume * 100));
    document.getElementById('lbl-vol-sfx')!.textContent = String(Math.round(s.sfxVolume * 100));
    document.getElementById('lbl-vol-amb')!.textContent = String(Math.round(s.ambientVolume * 100));
    this.debugEl.classList.toggle('hidden', !s.showFps);
  }

  showScreen(next: ScreenName): void {
    // Return any cursor-held item back to the inventory when leaving the inventory screen
    if (this.screen === 'inventory' && next !== 'inventory' && this.heldCursor) {
      this.inv.add(this.heldCursor.id, this.heldCursor.count, this.heldCursor.dur);
      this.setHeldCursor(null);
    }
    this.hideTooltip();
    this.screen = next;
    for (const [k, el] of this.screens) {
      const keepHudUnderOverlay = k === 'hud' && (next === 'inventory' || next === 'pause' || next === 'dead' || (next === 'settings' && this.returnScreen === 'pause'));
      el.classList.toggle('active', k === next || keepHudUnderOverlay);
    }
  }

  setStorageWarning(msg: string): void {
    this.storageWarnEl.textContent = msg;
    this.storageWarnEl.classList.toggle('hidden', !msg);
  }

  setLoadingProgress(pct: number, text?: string): void {
    this.loadingBarEl.style.width = `${Math.round(Math.max(5, Math.min(100, pct * 100)))}%`;
    if (text) this.loadingTextEl.textContent = text;
  }

  openInventory(atBench: boolean, mode: GameMode = 'survival'): void {
    this.atBench = atBench;
    this.benchTagEl.textContent = atBench
      ? 'Tinker Bench Active — All tool & lantern recipes unlocked'
      : 'Hand Crafting — Place & right-click a Tinker Bench for advanced tools';
    this.benchTagEl.classList.toggle('bench-active', atBench);
    this.creativePanelEl.classList.toggle('hidden', mode !== 'creative');
    this.renderInventoryGrid();
    this.renderRecipes();
    this.showScreen('inventory');
  }

  async openWorldList(): Promise<void> {
    this.showScreen('loadworld');
    this.worldListEl.innerHTML = `<div class="empty-note">Loading saved worlds…</div>`;
    const { worlds, broken } = await this.cb.getWorlds();
    this.worldListEl.innerHTML = '';
    if (broken.length > 0) {
      const warn = document.createElement('div');
      warn.className = 'storage-warning';
      warn.textContent = `Recovered/skipped corrupted save entries: ${broken.join('; ')}`;
      this.worldListEl.appendChild(warn);
    }
    if (worlds.length === 0) {
      this.worldListEl.innerHTML += `<div class="empty-note">No saved worlds yet. Click "+ New World" to begin an expedition!</div>`;
      return;
    }
    for (const w of worlds) {
      const row = document.createElement('div');
      row.className = 'world-row';
      const dateStr = new Date(w.lastPlayed).toLocaleString();
      row.innerHTML = `
        <div class="world-meta">
          <strong></strong>
          <span>Mode: ${w.mode.toUpperCase()} · Seed: <code></code> · Day ${w.day + 1} · ${dateStr}</span>
        </div>
        <div class="world-actions">
          <button class="btn btn-small btn-primary btn-play" type="button">Play</button>
          <button class="btn btn-small btn-danger btn-del" type="button">Delete</button>
        </div>
      `;
      row.querySelector('strong')!.textContent = w.name;
      row.querySelector('code')!.textContent = w.seedText;
      row.querySelector('.btn-play')!.addEventListener('click', () => {
        audio.click();
        this.cb.onLoadWorld(w);
      });
      const delBtn = row.querySelector<HTMLButtonElement>('.btn-del')!;
      let armed = false;
      delBtn.addEventListener('click', async () => {
        audio.click();
        if (!armed) {
          armed = true;
          delBtn.textContent = 'Confirm Delete?';
          setTimeout(() => {
            armed = false;
            if (delBtn.isConnected) delBtn.textContent = 'Delete';
          }, 3000);
          return;
        }
        await this.cb.onDeleteWorld(w.id);
        await this.openWorldList();
      });
      this.worldListEl.appendChild(row);
    }
  }

  renderHotbar(): void {
    this.hotbarEl.innerHTML = '';
    for (let i = 0; i < HOTBAR_SIZE; i++) {
      const s = this.inv.slots[i];
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'slot-cell' + (i === this.inv.selected ? ' selected' : '');
      cell.innerHTML = `<span class="slot-key">${i + 1}</span>`;
      if (s) this.populateSlotDOM(cell, s);
      cell.addEventListener('click', (e) => {
        e.stopPropagation();
        this.inv.select(i);
      });
      cell.addEventListener(
        'touchstart',
        (e) => {
          e.stopPropagation();
          this.inv.select(i);
        },
        { passive: true },
      );
      this.hotbarEl.appendChild(cell);
    }
    const held = this.inv.held;
    this.hotbarLabelEl.textContent = held ? itemName(held.id) : '';
  }

  private populateSlotDOM(cell: HTMLElement, s: Slot): void {
    const img = document.createElement('img');
    img.src = iconURL(s.id);
    img.alt = itemName(s.id);
    img.draggable = false;
    cell.appendChild(img);
    if (s.count > 1) {
      const cnt = document.createElement('span');
      cnt.className = 'slot-count';
      cnt.textContent = String(s.count);
      cell.appendChild(cnt);
    }
    const tool = ITEMS.get(s.id)?.tool;
    if (tool && s.dur !== undefined && s.dur < tool.durability) {
      const bar = document.createElement('div');
      bar.className = 'slot-dur';
      const fill = document.createElement('div');
      const pct = Math.max(0, Math.min(1, s.dur / tool.durability));
      fill.style.width = `${Math.round(pct * 100)}%`;
      fill.style.background = pct > 0.5 ? '#58d66c' : pct > 0.25 ? '#f2b84b' : '#e8564a';
      bar.appendChild(fill);
      cell.appendChild(bar);
    }
  }

  private renderInventoryGrid(): void {
    this.invGridEl.innerHTML = '';
    // Show backpack (9..35) first, then hotbar (0..8) with a divider
    const order: number[] = [];
    for (let i = HOTBAR_SIZE; i < INVENTORY_SIZE; i++) order.push(i);
    for (let i = 0; i < HOTBAR_SIZE; i++) order.push(i);

    for (const idx of order) {
      const s = this.inv.slots[idx];
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'slot-cell' + (idx < HOTBAR_SIZE ? ' hotbar-row-slot' : '');
      if (idx < HOTBAR_SIZE) {
        cell.innerHTML = `<span class="slot-key">${idx + 1}</span>`;
      }
      if (s) {
        this.populateSlotDOM(cell, s);
        cell.addEventListener('mouseenter', () => this.showItemTooltip(s));
        cell.addEventListener('mouseleave', () => this.hideTooltip());
      }
      cell.addEventListener('click', (e) => {
        e.preventDefault();
        this.handleSlotClick(idx, false);
      });
      cell.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.handleSlotClick(idx, true);
      });
      this.invGridEl.appendChild(cell);
    }
  }

  private handleSlotClick(idx: number, rightClick: boolean): void {
    audio.click();
    const cur = this.inv.slots[idx];
    const held = this.heldCursor;
    if (!held) {
      if (!cur) return;
      if (rightClick && cur.count > 1) {
        const half = Math.ceil(cur.count / 2);
        cur.count -= half;
        this.setHeldCursor({ id: cur.id, count: half, dur: cur.dur });
      } else {
        this.inv.slots[idx] = null;
        this.setHeldCursor(cur);
      }
    } else {
      if (!cur) {
        if (rightClick && held.count > 1) {
          this.inv.slots[idx] = { id: held.id, count: 1, dur: held.dur };
          held.count -= 1;
          this.setHeldCursor(held);
        } else {
          this.inv.slots[idx] = held;
          this.setHeldCursor(null);
        }
      } else if (cur.id === held.id && maxStack(cur.id) > 1) {
        const max = maxStack(cur.id);
        const addAmt = rightClick ? 1 : held.count;
        const take = Math.min(max - cur.count, addAmt);
        cur.count += take;
        held.count -= take;
        this.setHeldCursor(held.count > 0 ? held : null);
      } else {
        this.inv.slots[idx] = held;
        this.setHeldCursor(cur);
      }
    }
    this.inv.emit();
  }

  private setHeldCursor(s: Slot | null): void {
    this.heldCursor = s;
    if (!s) {
      this.cursorEl.classList.add('hidden');
      this.cursorEl.innerHTML = '';
      return;
    }
    this.cursorEl.classList.remove('hidden');
    this.cursorEl.innerHTML = '';
    this.populateSlotDOM(this.cursorEl, s);
  }

  private buildCreativeCatalog(): void {
    const grid = document.getElementById('creative-grid')!;
    grid.innerHTML = '';
    for (const id of CREATIVE_PALETTE) {
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'slot-cell';
      const s: Slot = { id, count: 1 };
      this.populateSlotDOM(cell, s);
      cell.addEventListener('mouseenter', () => this.showItemTooltip(s));
      cell.addEventListener('mouseleave', () => this.hideTooltip());
      cell.addEventListener('click', () => {
        audio.pickup();
        const stack = maxStack(id) > 1 ? 16 : 1;
        this.inv.add(id, stack);
        this.toast(`Added ${stack}× ${itemName(id)}`);
      });
      grid.appendChild(cell);
    }
  }

  private renderRecipes(): void {
    const prevScroll = this.recipeListEl.scrollTop;
    this.recipeListEl.innerHTML = '';
    for (const r of RECIPES) {
      const status = canCraft(r, this.inv, this.atBench);
      const card = document.createElement('button');
      card.type = 'button';
      card.className = `recipe-row ${status === 'ok' ? 'craftable' : 'locked'}`;
      const [outId, outCount] = r.output;
      const inputsText = r.inputs
        .map(([id, n]) => `${this.inv.count(id)}/${n} ${itemName(id)}`)
        .join(' + ');
      card.innerHTML = `
        <img class="recipe-icon" src="${iconURL(outId)}" alt="" />
        <div class="recipe-info">
          <strong>${outCount}× ${itemName(outId)}</strong>
          <span>${inputsText}</span>
        </div>
        <span class="recipe-badge">${
          status === 'ok'
            ? 'Craft'
            : status === 'needs-bench'
              ? 'Bench'
              : status === 'no-room'
                ? 'Full'
                : 'Need'
        }</span>
      `;
      card.addEventListener('click', () => {
        this.handleCraftClick(r);
      });
      this.recipeListEl.appendChild(card);
    }
    this.recipeListEl.scrollTop = prevScroll;
  }

  private handleCraftClick(r: Recipe): void {
    const res = craft(r, this.inv, this.atBench);
    if (res === 'ok') {
      audio.craft();
      this.toast(`Crafted ${r.output[1]}× ${itemName(r.output[0])}`);
    } else if (res === 'needs-bench') {
      audio.click();
      this.toast('Requires a placed Tinker Bench (right-click the bench to use)');
    } else if (res === 'no-room') {
      audio.click();
      this.toast('Backpack is full!');
    } else {
      audio.click();
    }
  }

  private showItemTooltip(s: Slot): void {
    const def = ITEMS.get(s.id);
    const blk = BLOCKS[s.id];
    const lines: string[] = [`<strong>${itemName(s.id)}</strong>`];
    if (def?.tool) {
      lines.push(`Tool: ${def.tool.type} (Tier ${def.tool.tier}, ${def.tool.speed}× speed)`);
      lines.push(`Durability: ${s.dur ?? def.tool.durability} / ${def.tool.durability}`);
    }
    if (def?.food) {
      lines.push(`Food: restores +${def.food.hunger} hunger${def.food.heal ? `, +${def.food.heal} HP` : ''}`);
    }
    if (def?.description) lines.push(def.description);
    if (blk && blk.tool !== 'none') {
      lines.push(`Best tool: ${blk.tool}${blk.minTier > 0 ? ` (tier ${blk.minTier}+)` : ''}`);
    }
    this.tooltipEl.innerHTML = lines.join('<br/>');
    this.tooltipEl.classList.add('visible');
  }

  private hideTooltip(): void {
    this.tooltipEl.classList.remove('visible');
  }

  updateVitals(health: number, hunger: number, mode: GameMode, flying: boolean): void {
    this.modeBadgeEl.textContent = mode === 'creative' ? (flying ? 'CREATIVE · FLYING' : 'CREATIVE') : 'SURVIVAL';
    document.getElementById('hud-vitals')!.classList.toggle('hidden', mode === 'creative');
    this.touchElements.btnFly.classList.toggle('hidden', mode !== 'creative');
    if (mode === 'creative') return;

    const renderPips = (el: HTMLElement, val: number, fullCls: string, halfCls: string) => {
      let html = '';
      for (let i = 0; i < 10; i++) {
        const v = val - i * 2;
        const cls = v >= 2 ? fullCls : v >= 1 ? halfCls : 'pip-empty';
        html += `<span class="vital-pip ${cls}"></span>`;
      }
      if (el.dataset.last !== html) {
        el.dataset.last = html;
        el.innerHTML = html;
      }
    };
    renderPips(this.heartsEl, Math.round(health), 'heart-full', 'heart-half');
    renderPips(this.hungerEl, Math.round(hunger), 'food-full', 'food-half');
  }

  updateTargetInfo(blockId: number | null): void {
    if (!blockId || !BLOCKS[blockId]) {
      this.targetInfoEl.textContent = '';
      this.targetInfoEl.classList.add('hidden');
      return;
    }
    const b = BLOCKS[blockId];
    this.targetInfoEl.textContent = b.id === 15 ? `${b.name} (Right-click to use)` : b.name;
    this.targetInfoEl.classList.remove('hidden');
  }

  updateTouchVisibility(playing: boolean): void {
    const pref = this.settings.touchControls;
    const show = playing && (pref === 'on' || (pref === 'auto' && isTouchDevice()));
    this.touchOverlayEl.classList.toggle('hidden', !show);
  }

  setPauseSummary(text: string): void {
    document.getElementById('pause-world-summary')!.textContent = text;
  }

  flashDamage(): void {
    this.damageFlashEl.classList.add('active');
    setTimeout(() => this.damageFlashEl.classList.remove('active'), 220);
  }

  setUnderwater(under: boolean): void {
    this.underwaterEl.classList.toggle('active', under);
  }

  markSaved(label = 'Saved'): void {
    this.saveBadgeEl.textContent = label;
    this.saveBadgeEl.classList.add('pulse');
    setTimeout(() => this.saveBadgeEl.classList.remove('pulse'), 900);
  }

  toast(msg: string): void {
    this.toastEl.textContent = msg;
    this.toastEl.classList.add('visible');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('visible'), 2500);
  }

  updateDebug(text: string): void {
    if (!this.settings.showFps) return;
    this.debugEl.textContent = text;
  }
}

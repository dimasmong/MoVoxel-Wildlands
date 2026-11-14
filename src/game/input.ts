import { isTouchDevice } from '../settings';
import { audio } from '../audio/audio';

/**
 * Unified input layer (input-systems skill: gameplay reads named actions, physical keycodes
 * keep WASD in place on AZERTY/QWERTZ, radial deadzone on sticks, multi-touch tracked by
 * touch identifier so move + look + action buttons never conflict).
 */
export class InputManager {
  private keys = new Set<string>();
  private justPressed = new Set<string>();
  mouseDownLeft = false;
  mouseDownRight = false;
  justLeft = false;
  justRight = false;
  wheelDelta = 0;

  lookDX = 0;
  lookDY = 0;
  pointerLocked = false;

  // Touch state
  touchActive = false;
  stickX = 0;
  stickY = 0;
  touchJump = false;
  touchMine = false;
  touchPlace = false;
  touchCrouch = false;
  private stickTouchId: number | null = null;
  private stickOriginX = 0;
  private stickOriginY = 0;
  private lookTouchId: number | null = null;
  private lastLookX = 0;
  private lastLookY = 0;

  // Double-tap space detection for Creative flight toggle
  private lastSpaceTime = 0;
  doubleSpace = false;

  onEscape: (() => void) | null = null;
  onInventoryToggle: (() => void) | null = null;
  onHotbarSelect: ((slot: number) => void) | null = null;
  onToggleDebug: (() => void) | null = null;
  onToggleCamera: (() => void) | null = null;
  onDropHeld: (() => void) | null = null;
  canLockPointer: (() => boolean) | null = null;

  constructor(private canvas: HTMLCanvasElement) {
    this.touchActive = isTouchDevice();
    this.bindKeyboard();
    this.bindMouse();
    this.bindTouch();
  }

  private bindKeyboard(): void {
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      audio.unlock();
      const code = e.code;
      if (!this.keys.has(code)) {
        this.justPressed.add(code);
        if (code === 'Space') {
          const now = performance.now();
          if (now - this.lastSpaceTime < 300) {
            this.doubleSpace = true;
            this.lastSpaceTime = 0;
          } else {
            this.lastSpaceTime = now;
          }
        }
      }
      this.keys.add(code);

      if (code === 'Escape') {
        this.onEscape?.();
      } else if (code === 'KeyE' || code === 'KeyI') {
        e.preventDefault();
        this.onInventoryToggle?.();
      } else if (code === 'F3') {
        e.preventDefault();
        this.onToggleDebug?.();
      } else if (code === 'F5' || code === 'KeyV') {
        e.preventDefault();
        this.onToggleCamera?.();
      } else if (code === 'KeyQ') {
        this.onDropHeld?.();
      } else if (code.startsWith('Digit')) {
        const n = Number(code.slice(5));
        if (n >= 1 && n <= 9) this.onHotbarSelect?.(n - 1);
      }
    });

    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });

    window.addEventListener('blur', () => {
      this.keys.clear();
      this.mouseDownLeft = false;
      this.mouseDownRight = false;
    });
  }

  private bindMouse(): void {
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === this.canvas;
      if (!this.pointerLocked) {
        this.mouseDownLeft = false;
        this.mouseDownRight = false;
        this.onEscape?.();
      }
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.pointerLocked) return;
      // Guard against occasional Chromium huge spikes right on pointer lock acquire
      if (Math.abs(e.movementX) > 350 || Math.abs(e.movementY) > 350) return;
      this.lookDX += e.movementX;
      this.lookDY += e.movementY;
    });

    this.canvas.addEventListener('mousedown', (e) => {
      audio.unlock();
      if (!this.pointerLocked) {
        if (e.button === 0 && !this.touchActive && this.canLockPointer?.()) {
          this.requestPointerLock();
        }
        return;
      }
      if (e.button === 0) {
        this.mouseDownLeft = true;
        this.justLeft = true;
      } else if (e.button === 2) {
        this.mouseDownRight = true;
        this.justRight = true;
      }
    });

    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouseDownLeft = false;
      else if (e.button === 2) this.mouseDownRight = false;
    });

    window.addEventListener('contextmenu', (e) => {
      e.preventDefault();
    });

    window.addEventListener(
      'wheel',
      (e) => {
        if (!this.pointerLocked) return;
        e.preventDefault();
        this.wheelDelta += Math.sign(e.deltaY);
      },
      { passive: false },
    );
  }

  /** Wires virtual joystick + right-half touch look + mobile action buttons. */
  bindTouchElements(els: {
    stickZone: HTMLElement;
    stickKnob: HTMLElement;
    lookZone: HTMLElement;
    btnJump: HTMLElement;
    btnMine: HTMLElement;
    btnPlace: HTMLElement;
    btnCrouch: HTMLElement;
    btnInv: HTMLElement;
    btnFly: HTMLElement;
  }): void {
    const maxR = 46;
    const dead = 0.16;

    els.stickZone.addEventListener(
      'touchstart',
      (e) => {
        e.preventDefault();
        audio.unlock();
        this.touchActive = true;
        if (this.stickTouchId !== null) return;
        const t = e.changedTouches[0];
        this.stickTouchId = t.identifier;
        const rect = els.stickZone.getBoundingClientRect();
        this.stickOriginX = rect.left + rect.width / 2;
        this.stickOriginY = rect.top + rect.height / 2;
        this.updateStick(t.clientX, t.clientY, maxR, dead, els.stickKnob);
      },
      { passive: false },
    );

    const onStickMove = (e: TouchEvent) => {
      if (this.stickTouchId === null) return;
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        if (t.identifier === this.stickTouchId) {
          e.preventDefault();
          this.updateStick(t.clientX, t.clientY, maxR, dead, els.stickKnob);
          break;
        }
      }
    };

    const onStickEnd = (e: TouchEvent) => {
      if (this.stickTouchId === null) return;
      for (let i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === this.stickTouchId) {
          this.stickTouchId = null;
          this.stickX = 0;
          this.stickY = 0;
          els.stickKnob.style.transform = 'translate(0px, 0px)';
          break;
        }
      }
    };

    window.addEventListener('touchmove', onStickMove, { passive: false });
    window.addEventListener('touchend', onStickEnd);
    window.addEventListener('touchcancel', onStickEnd);

    // Look pad
    els.lookZone.addEventListener(
      'touchstart',
      (e) => {
        e.preventDefault();
        audio.unlock();
        this.touchActive = true;
        if (this.lookTouchId !== null) return;
        const t = e.changedTouches[0];
        this.lookTouchId = t.identifier;
        this.lastLookX = t.clientX;
        this.lastLookY = t.clientY;
      },
      { passive: false },
    );

    const onLookMove = (e: TouchEvent) => {
      if (this.lookTouchId === null) return;
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        if (t.identifier === this.lookTouchId) {
          e.preventDefault();
          this.lookDX += (t.clientX - this.lastLookX) * 2.2;
          this.lookDY += (t.clientY - this.lastLookY) * 2.2;
          this.lastLookX = t.clientX;
          this.lastLookY = t.clientY;
          break;
        }
      }
    };

    const onLookEnd = (e: TouchEvent) => {
      if (this.lookTouchId === null) return;
      for (let i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === this.lookTouchId) {
          this.lookTouchId = null;
          break;
        }
      }
    };

    window.addEventListener('touchmove', onLookMove, { passive: false });
    window.addEventListener('touchend', onLookEnd);
    window.addEventListener('touchcancel', onLookEnd);

    // Hold buttons
    const holdBtn = (el: HTMLElement, set: (v: boolean) => void, onDown?: () => void) => {
      el.addEventListener(
        'touchstart',
        (e) => {
          e.preventDefault();
          e.stopPropagation();
          audio.unlock();
          this.touchActive = true;
          el.classList.add('active');
          set(true);
          onDown?.();
        },
        { passive: false },
      );
      const end = (e: TouchEvent) => {
        e.preventDefault();
        el.classList.remove('active');
        set(false);
      };
      el.addEventListener('touchend', end, { passive: false });
      el.addEventListener('touchcancel', end, { passive: false });
    };

    holdBtn(els.btnJump, (v) => (this.touchJump = v));
    holdBtn(
      els.btnMine,
      (v) => (this.touchMine = v),
      () => (this.justLeft = true),
    );
    holdBtn(
      els.btnPlace,
      (v) => (this.touchPlace = v),
      () => (this.justRight = true),
    );
    els.btnCrouch.addEventListener(
      'touchstart',
      (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.touchCrouch = !this.touchCrouch;
        els.btnCrouch.classList.toggle('active', this.touchCrouch);
      },
      { passive: false },
    );
    els.btnInv.addEventListener(
      'touchstart',
      (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.onInventoryToggle?.();
      },
      { passive: false },
    );
    els.btnFly.addEventListener(
      'touchstart',
      (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.doubleSpace = true;
      },
      { passive: false },
    );
  }

  private updateStick(cx: number, cy: number, maxR: number, dead: number, knob: HTMLElement): void {
    const dx = cx - this.stickOriginX;
    const dy = cy - this.stickOriginY;
    const dist = Math.hypot(dx, dy);
    const clamped = Math.min(maxR, dist);
    const nx = dist > 0 ? dx / dist : 0;
    const ny = dist > 0 ? dy / dist : 0;
    knob.style.transform = `translate(${(nx * clamped).toFixed(1)}px, ${(ny * clamped).toFixed(1)}px)`;
    const mag = clamped / maxR;
    if (mag <= dead) {
      this.stickX = 0;
      this.stickY = 0;
    } else {
      const scaled = (mag - dead) / (1 - dead);
      this.stickX = nx * scaled;
      this.stickY = -ny * scaled; // up on screen = +forward
    }
  }

  private bindTouch(): void {
    window.addEventListener(
      'touchstart',
      () => {
        this.touchActive = true;
      },
      { passive: true },
    );
  }

  requestPointerLock(): void {
    if (this.touchActive) return;
    try {
      const p = this.canvas.requestPointerLock?.() as unknown as Promise<void> | undefined;
      p?.catch?.(() => {});
    } catch {
      /* ignore if browser blocks */
    }
  }

  exitPointerLock(): void {
    if (document.pointerLockElement === this.canvas) {
      document.exitPointerLock();
    }
  }

  get forward(): number {
    let f = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) f += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) f -= 1;
    return Math.max(-1, Math.min(1, f + this.stickY));
  }

  get right(): number {
    let r = 0;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) r += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) r -= 1;
    return Math.max(-1, Math.min(1, r + this.stickX));
  }

  get jump(): boolean {
    return this.keys.has('Space') || this.touchJump;
  }

  get sprint(): boolean {
    return (
      this.keys.has('ShiftLeft') ||
      this.keys.has('ShiftRight') ||
      Math.hypot(this.stickX, this.stickY) > 0.92
    );
  }

  get crouch(): boolean {
    return this.keys.has('ControlLeft') || this.keys.has('KeyC') || this.touchCrouch;
  }

  get mining(): boolean {
    return this.mouseDownLeft || this.touchMine;
  }

  get placing(): boolean {
    return this.mouseDownRight || this.touchPlace;
  }

  consumeLook(): { dx: number; dy: number } {
    const dx = this.lookDX;
    const dy = this.lookDY;
    this.lookDX = 0;
    this.lookDY = 0;
    return { dx, dy };
  }

  consumeFrameEdges(): {
    justLeft: boolean;
    justRight: boolean;
    wheel: number;
    doubleSpace: boolean;
  } {
    const out = {
      justLeft: this.justLeft,
      justRight: this.justRight,
      wheel: this.wheelDelta,
      doubleSpace: this.doubleSpace,
    };
    this.justLeft = false;
    this.justRight = false;
    this.wheelDelta = 0;
    this.doubleSpace = false;
    this.justPressed.clear();
    return out;
  }
}

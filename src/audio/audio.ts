import type { SoundKind } from '../world/registry';

/**
 * Procedural Web Audio: every sound is synthesised at runtime (no external files), so all audio
 * is original. The context is only created after the first user gesture (browser autoplay rules).
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private ambient!: GainNode;
  private noiseBuf!: AudioBuffer;
  private windGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private nextBird = 0;
  private nextCricket = 0;
  volumes = { master: 0.8, sfx: 0.9, ambient: 0.6 };

  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    try {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctx();
    } catch {
      return;
    }
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.sfx.connect(this.master);
    this.ambient = ctx.createGain();
    this.ambient.connect(this.master);
    this.applyVolumes();
    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.startWind();
  }

  setVolumes(master: number, sfx: number, ambient: number): void {
    this.volumes = { master, sfx, ambient };
    this.applyVolumes();
  }

  private applyVolumes(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    // Perceptual (squared) curve so the slider feels linear.
    this.master.gain.setTargetAtTime(this.volumes.master ** 2, t, 0.05);
    this.sfx.gain.setTargetAtTime(this.volumes.sfx ** 2, t, 0.05);
    this.ambient.gain.setTargetAtTime(this.volumes.ambient ** 2, t, 0.05);
  }

  suspend(): void {
    void this.ctx?.suspend();
  }

  resume(): void {
    void this.ctx?.resume();
  }

  private noise(dur: number, filterType: BiquadFilterType, freq: number, q: number, gain: number, attack = 0.005, out?: AudioNode, rate = 1): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = rate;
    const f = ctx.createBiquadFilter();
    f.type = filterType;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(out ?? this.sfx);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.05);
  }

  private tone(freq: number, dur: number, type: OscillatorType, gain: number, slideTo?: number, delay = 0): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.sfx);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private materialParams(kind: SoundKind | string): { type: BiquadFilterType; freq: number; q: number } {
    switch (kind) {
      case 'grass': return { type: 'bandpass', freq: 2400, q: 0.8 };
      case 'leaves': return { type: 'highpass', freq: 3000, q: 0.6 };
      case 'soil': return { type: 'lowpass', freq: 900, q: 0.7 };
      case 'sand': return { type: 'bandpass', freq: 3600, q: 0.5 };
      case 'wood': return { type: 'bandpass', freq: 700, q: 3 };
      case 'glass': return { type: 'highpass', freq: 4200, q: 4 };
      default: return { type: 'bandpass', freq: 1400, q: 1.6 };
    }
  }

  footstep(kind: string): void {
    const p = this.materialParams(kind);
    this.noise(0.09, p.type, p.freq * (0.85 + Math.random() * 0.3), p.q, 0.16);
  }

  dig(kind: string): void {
    const p = this.materialParams(kind);
    this.noise(0.12, p.type, p.freq * (0.8 + Math.random() * 0.4), p.q, 0.22);
    if (kind === 'stone') this.tone(180 + Math.random() * 60, 0.06, 'square', 0.03);
    if (kind === 'wood') this.tone(260 + Math.random() * 40, 0.08, 'triangle', 0.06);
  }

  breakBlock(kind: string): void {
    const p = this.materialParams(kind);
    this.noise(0.26, p.type, p.freq * 0.8, p.q, 0.32, 0.004, undefined, 0.8);
    if (kind === 'glass') {
      for (let i = 0; i < 4; i++) this.tone(2400 + Math.random() * 1800, 0.12, 'sine', 0.04, undefined, i * 0.03);
    }
  }

  place(kind: string): void {
    const p = this.materialParams(kind);
    this.noise(0.1, p.type, p.freq * 0.7, p.q, 0.26);
    this.tone(150, 0.07, 'sine', 0.12, 90);
  }

  jump(): void {
    this.noise(0.08, 'bandpass', 1200, 0.8, 0.07);
  }

  land(strength: number): void {
    this.noise(0.14, 'lowpass', 500, 0.8, Math.min(0.35, 0.1 + strength * 0.05));
  }

  pickup(): void {
    this.tone(880 + Math.random() * 120, 0.08, 'sine', 0.08, 1320);
  }

  craft(): void {
    this.tone(523, 0.12, 'triangle', 0.1);
    this.tone(659, 0.12, 'triangle', 0.1, undefined, 0.07);
    this.tone(784, 0.2, 'triangle', 0.1, undefined, 0.14);
  }

  hurt(): void {
    this.tone(220, 0.18, 'sawtooth', 0.08, 110);
    this.noise(0.12, 'lowpass', 600, 1, 0.2);
  }

  eat(): void {
    for (let i = 0; i < 3; i++) setTimeout(() => this.noise(0.07, 'bandpass', 1800, 1.5, 0.14), i * 110);
  }

  toolBreak(): void {
    this.tone(1200, 0.15, 'square', 0.05, 300);
    this.noise(0.2, 'highpass', 3000, 2, 0.15);
  }

  click(): void {
    this.tone(660, 0.04, 'square', 0.04);
  }

  splash(): void {
    this.noise(0.35, 'lowpass', 1400, 0.5, 0.2, 0.02);
  }

  creature(kind: 'passive' | 'hostile'): void {
    if (kind === 'passive') {
      this.tone(320 + Math.random() * 80, 0.18, 'sine', 0.06, 260);
      this.tone(420, 0.12, 'sine', 0.04, 360, 0.12);
    } else {
      this.tone(90, 0.4, 'sawtooth', 0.05, 60);
    }
  }

  private startWind(): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 400;
    const g = ctx.createGain();
    g.gain.value = 0.05;
    src.connect(f).connect(g).connect(this.ambient);
    src.start();
    this.windGain = g;
    this.windFilter = f;
  }

  /** Called every frame while playing to drive ambience by time of day and altitude. */
  updateAmbience(dt: number, daylight: number, altitude: number, underground: boolean): void {
    const ctx = this.ctx;
    if (!ctx || !this.windGain || !this.windFilter) return;
    const t = ctx.currentTime;
    const windAmt = underground ? 0.015 : 0.04 + Math.max(0, altitude - 50) * 0.002 + (Math.sin(t * 0.13) + 1) * 0.015;
    this.windGain.gain.setTargetAtTime(windAmt, t, 0.8);
    this.windFilter.frequency.setTargetAtTime(underground ? 200 : 300 + Math.sin(t * 0.21) * 120, t, 1);
    if (underground) return;
    this.nextBird -= dt;
    this.nextCricket -= dt;
    if (daylight > 0.6 && this.nextBird <= 0) {
      this.nextBird = 4 + Math.random() * 9;
      this.bird();
    }
    if (daylight < 0.3 && this.nextCricket <= 0) {
      this.nextCricket = 1.5 + Math.random() * 3;
      this.cricket();
    }
  }

  private bird(): void {
    const ctx = this.ctx!;
    const base = 1800 + Math.random() * 1400;
    const notes = 2 + Math.floor(Math.random() * 4);
    for (let i = 0; i < notes; i++) {
      const t = ctx.currentTime + i * (0.09 + Math.random() * 0.05);
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(base * (0.9 + Math.random() * 0.3), t);
      o.frequency.exponentialRampToValueAtTime(base * (1.2 + Math.random() * 0.3), t + 0.07);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.025, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
      const pan = ctx.createStereoPanner();
      pan.pan.value = Math.random() * 1.6 - 0.8;
      o.connect(g).connect(pan).connect(this.ambient);
      o.start(t);
      o.stop(t + 0.1);
    }
  }

  private cricket(): void {
    const ctx = this.ctx!;
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.random() * 2 - 1;
    pan.connect(this.ambient);
    for (let i = 0; i < 3; i++) {
      const t = ctx.currentTime + i * 0.07;
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = 4200 + Math.random() * 300;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.012, t + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);
      o.connect(g).connect(pan);
      o.start(t);
      o.stop(t + 0.06);
    }
  }
}

export const audio = new AudioEngine();

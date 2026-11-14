export type QualityPreset = 'low' | 'medium' | 'high';

export interface Settings {
  fov: number;
  sensitivity: number;
  renderDistance: number;
  quality: QualityPreset;
  masterVolume: number;
  sfxVolume: number;
  ambientVolume: number;
  invertY: boolean;
  reduceMotion: boolean;
  showFps: boolean;
  touchControls: 'auto' | 'on' | 'off';
}

const KEY = 'movoxel-wildlands.settings.v1';

export const isTouchDevice = (): boolean =>
  typeof window !== 'undefined' && (window.matchMedia?.('(pointer: coarse)').matches || 'ontouchstart' in window);

export function defaultSettings(): Settings {
  const mobile = isTouchDevice();
  return {
    fov: 75,
    sensitivity: 1,
    renderDistance: mobile ? 4 : 7,
    quality: mobile ? 'low' : 'high',
    masterVolume: 0.8,
    sfxVolume: 0.9,
    ambientVolume: 0.6,
    invertY: false,
    reduceMotion: false,
    showFps: false,
    touchControls: 'auto',
  };
}

export function loadSettings(): Settings {
  const def = defaultSettings();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return def;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    const s = { ...def, ...parsed };
    s.fov = clamp(Number(s.fov), 50, 110, def.fov);
    s.sensitivity = clamp(Number(s.sensitivity), 0.1, 3, def.sensitivity);
    s.renderDistance = Math.round(clamp(Number(s.renderDistance), 2, 12, def.renderDistance));
    if (!['low', 'medium', 'high'].includes(s.quality)) s.quality = def.quality;
    s.masterVolume = clamp(Number(s.masterVolume), 0, 1, def.masterVolume);
    s.sfxVolume = clamp(Number(s.sfxVolume), 0, 1, def.sfxVolume);
    s.ambientVolume = clamp(Number(s.ambientVolume), 0, 1, def.ambientVolume);
    if (!['auto', 'on', 'off'].includes(s.touchControls)) s.touchControls = 'auto';
    return s;
  } catch {
    return def;
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage full or blocked: settings stay in memory for this session */
  }
}

function clamp(v: number, lo: number, hi: number, def: number): number {
  if (!Number.isFinite(v)) return def;
  return Math.max(lo, Math.min(hi, v));
}

export const QUALITY = {
  low: { shadows: false, shadowSize: 0, dprCap: 1, clouds: true, particles: 0.4, antialias: false },
  medium: { shadows: true, shadowSize: 1024, dprCap: 1.25, clouds: true, particles: 0.7, antialias: false },
  high: { shadows: true, shadowSize: 2048, dprCap: 1.75, clouds: true, particles: 1, antialias: true },
} as const;

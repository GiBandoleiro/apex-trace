/**
 * Device classification and graphics quality tiers.
 *
 * The engine auto-detects mobile vs. desktop and picks a tier; the player can
 * override it from Settings. Every renderer/asset decision reads from here so
 * there is a single place that governs the performance/fidelity trade-off.
 */

export type QualityTier = 'low' | 'medium' | 'high' | 'ultra';
export type DeviceClass = 'mobile' | 'tablet' | 'desktop';

export interface QualityProfile {
  tier: QualityTier;
  /** Square size of the baked PBR maps for primary surfaces. */
  textureSize: number;
  /** Square size for secondary/decorative surfaces. */
  detailTextureSize: number;
  anisotropy: number;
  shadows: boolean;
  shadowMapSize: number;
  /** Renderer pixel ratio ceiling. */
  maxPixelRatio: number;
  /** Multiplier applied to every particle budget. */
  particleScale: number;
  /** Number of skid-mark quads kept alive in the pool. */
  skidPoolSize: number;
  /** Enables the trackside prop instancing pass (trees, stands, banners). */
  environmentDetail: 0 | 1 | 2 | 3;
  /** Subtle bloom / tone-mapped highlights. */
  postProcessing: boolean;
  /** Reflection probe resolution; 0 disables the probe entirely. */
  envMapSize: number;
  /** Track ribbon tessellation step, in metres. */
  trackSegmentLength: number;
}

const PROFILES: Record<QualityTier, Omit<QualityProfile, 'tier'>> = {
  low: {
    textureSize: 512,
    detailTextureSize: 256,
    anisotropy: 2,
    shadows: false,
    shadowMapSize: 512,
    maxPixelRatio: 1.35,
    particleScale: 0.35,
    skidPoolSize: 120,
    environmentDetail: 1,
    postProcessing: false,
    envMapSize: 0,
    trackSegmentLength: 4.5,
  },
  medium: {
    textureSize: 1024,
    detailTextureSize: 512,
    anisotropy: 4,
    shadows: true,
    shadowMapSize: 1024,
    maxPixelRatio: 1.75,
    particleScale: 0.65,
    skidPoolSize: 260,
    environmentDetail: 2,
    postProcessing: true,
    envMapSize: 128,
    trackSegmentLength: 3,
  },
  high: {
    textureSize: 1024,
    detailTextureSize: 512,
    anisotropy: 8,
    shadows: true,
    shadowMapSize: 2048,
    maxPixelRatio: 2,
    particleScale: 1,
    skidPoolSize: 420,
    environmentDetail: 3,
    postProcessing: true,
    envMapSize: 256,
    trackSegmentLength: 2.2,
  },
  ultra: {
    textureSize: 2048,
    detailTextureSize: 1024,
    anisotropy: 16,
    shadows: true,
    shadowMapSize: 2048,
    maxPixelRatio: 2,
    particleScale: 1.35,
    skidPoolSize: 600,
    environmentDetail: 3,
    postProcessing: true,
    envMapSize: 256,
    trackSegmentLength: 1.8,
  },
};

export const getProfile = (tier: QualityTier): QualityProfile => ({
  tier,
  ...PROFILES[tier],
});

const hasTouch = (): boolean =>
  typeof window !== 'undefined' &&
  ('ontouchstart' in window || navigator.maxTouchPoints > 0);

export const detectDeviceClass = (): DeviceClass => {
  if (typeof window === 'undefined') return 'desktop';
  const ua = navigator.userAgent;
  const touch = hasTouch();
  const minSide = Math.min(window.screen.width, window.screen.height);
  const isPhoneUA = /iPhone|iPod|Android.*Mobile|Windows Phone/i.test(ua);
  const isTabletUA =
    /iPad|Android(?!.*Mobile)|Tablet/i.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  if (isPhoneUA) return 'mobile';
  if (isTabletUA) return 'tablet';
  if (touch && minSide <= 500) return 'mobile';
  if (touch && minSide <= 900) return 'tablet';
  return 'desktop';
};

/**
 * Best-effort auto tier. We look at the device class, logical core count,
 * device memory and the reported WebGL renderer string (which identifies
 * software rasterisers and low-end integrated GPUs).
 */
export const detectQualityTier = (): QualityTier => {
  if (typeof window === 'undefined') return 'medium';

  const deviceClass = detectDeviceClass();
  const cores = navigator.hardwareConcurrency ?? 4;
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4;

  let renderer = '';
  try {
    const canvas = document.createElement('canvas');
    const gl = (canvas.getContext('webgl2') ??
      canvas.getContext('webgl')) as WebGLRenderingContext | null;
    if (gl) {
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      if (ext) renderer = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) ?? '');
      const lose = gl.getExtension('WEBGL_lose_context');
      lose?.loseContext();
    }
  } catch {
    /* renderer sniffing is optional */
  }

  const software = /swiftshader|llvmpipe|software|basic render/i.test(renderer);
  if (software) return 'low';

  if (deviceClass === 'mobile') {
    if (cores >= 6 && memory >= 4) return 'medium';
    return 'low';
  }
  if (deviceClass === 'tablet') {
    return cores >= 6 ? 'medium' : 'low';
  }

  // Desktop.
  if (cores >= 12 && memory >= 8) return 'ultra';
  if (cores >= 8 && memory >= 8) return 'high';
  if (cores >= 4) return 'medium';
  return 'low';
};

/** Live frame-rate watchdog used to drop a tier when a device struggles. */
export class PerformanceMonitor {
  private samples: number[] = [];
  private readonly window = 90;
  private cooldown = 0;

  sample(dt: number): void {
    if (dt <= 0 || dt > 0.5) return;
    this.samples.push(1 / dt);
    if (this.samples.length > this.window) this.samples.shift();
    if (this.cooldown > 0) this.cooldown -= dt;
  }

  get averageFps(): number {
    if (this.samples.length === 0) return 60;
    let sum = 0;
    for (const s of this.samples) sum += s;
    return sum / this.samples.length;
  }

  /** True when we have a confident, sustained reading below `threshold`. */
  shouldDowngrade(threshold = 34): boolean {
    if (this.samples.length < this.window || this.cooldown > 0) return false;
    if (this.averageFps < threshold) {
      this.cooldown = 12;
      this.samples.length = 0;
      return true;
    }
    return false;
  }

  reset(): void {
    this.samples.length = 0;
    this.cooldown = 4;
  }
}

export const lowerTier = (tier: QualityTier): QualityTier =>
  tier === 'ultra' ? 'high' : tier === 'high' ? 'medium' : 'low';

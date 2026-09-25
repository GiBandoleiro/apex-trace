/**
 * Central asset registry.
 *
 * Bakes every procedural texture once, builds the shared materials and exposes
 * them to the track/car builders. Baking is chunked and yields to the browser
 * between steps so the loading screen can animate a real progress bar instead
 * of freezing on a white frame.
 */

import * as THREE from 'three';
import {
  asphaltField,
  basaltField,
  bakePBR,
  concreteField,
  curbField,
  grassField,
  gravelField,
  metalField,
  sandField,
  snowField,
  type FieldFn,
  type PBRTextureSet,
} from './textureFactory';
import type { QualityProfile } from '@/systems/quality';
import type { TimeOfDay } from '@/tracks/types';

export type SurfaceId =
  | 'asphalt'
  | 'grass'
  | 'gravel'
  | 'concrete'
  | 'curbRed'
  | 'curbBlue'
  | 'curbYellow'
  | 'sand'
  | 'snow'
  | 'basalt'
  | 'metal';

export interface LoadStep {
  label: string;
  weight: number;
  run: () => void;
}

const SURFACE_LABELS: Record<SurfaceId, string> = {
  asphalt: 'Baking asphalt',
  grass: 'Growing grass',
  gravel: 'Laying gravel traps',
  concrete: 'Pouring concrete',
  curbRed: 'Painting curbs',
  curbBlue: 'Painting curbs',
  curbYellow: 'Painting curbs',
  sand: 'Sifting sand',
  snow: 'Packing snow',
  basalt: 'Cooling basalt',
  metal: 'Forging barriers',
};

const yieldToBrowser = (): Promise<void> =>
  new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve());
    else setTimeout(resolve, 0);
  });

export class AssetLibrary {
  private textures = new Map<SurfaceId, PBRTextureSet>();
  private materials = new Map<string, THREE.Material>();
  private profile: QualityProfile;
  private envMap: THREE.Texture | null = null;
  private pmrem: THREE.PMREMGenerator | null = null;
  private ready = false;

  constructor(profile: QualityProfile) {
    this.profile = profile;
  }

  get isReady(): boolean {
    return this.ready;
  }

  get quality(): QualityProfile {
    return this.profile;
  }

  /** Bakes all surfaces, reporting normalised progress 0..1. */
  async build(
    renderer: THREE.WebGLRenderer,
    onProgress: (progress: number, label: string) => void,
  ): Promise<void> {
    const q = this.profile;
    const big = q.textureSize;
    const small = q.detailTextureSize;

    const jobs: Array<{ id: SurfaceId; field: FieldFn; size: number; strength: number }> = [
      { id: 'asphalt', field: asphaltField(17), size: big, strength: 2.1 },
      { id: 'grass', field: grassField(44), size: small, strength: 2.6 },
      { id: 'curbRed', field: curbField([0.62, 0.075, 0.07], [0.82, 0.8, 0.78], 120), size: small, strength: 2.8 },
      { id: 'gravel', field: gravelField(61), size: small, strength: 1.9 },
      { id: 'concrete', field: concreteField(88), size: small, strength: 1.8 },
      { id: 'metal', field: metalField(500), size: small, strength: 1.2 },
      { id: 'curbBlue', field: curbField([0.08, 0.16, 0.5], [0.82, 0.8, 0.78], 121), size: small, strength: 2.8 },
      { id: 'curbYellow', field: curbField([0.72, 0.56, 0.06], [0.07, 0.07, 0.08], 122), size: small, strength: 2.8 },
      { id: 'sand', field: sandField(204), size: small, strength: 2.2 },
      { id: 'snow', field: snowField(311), size: small, strength: 2 },
      { id: 'basalt', field: basaltField(402), size: small, strength: 2.6 },
    ];

    const total = jobs.length + 2;
    let done = 0;

    onProgress(0.02, 'Preparing materials');
    await yieldToBrowser();

    for (const job of jobs) {
      onProgress(done / total, SURFACE_LABELS[job.id]);
      await yieldToBrowser();
      this.textures.set(
        job.id,
        bakePBR(job.field, job.size, this.profile.anisotropy, job.strength, true),
      );
      done++;
    }

    onProgress(done / total, 'Lighting the circuit');
    await yieldToBrowser();
    this.buildEnvironment(renderer, 'day');
    done++;

    onProgress(done / total, 'Assembling shaders');
    await yieldToBrowser();
    this.buildMaterials();
    done++;

    this.ready = true;
    onProgress(1, 'Ready');
  }

  /**
   * Procedural equirectangular sky, filtered through PMREM so every PBR
   * material gets a believable ambient/reflection response per time-of-day.
   */
  buildEnvironment(renderer: THREE.WebGLRenderer, time: TimeOfDay): THREE.Texture | null {
    if (this.profile.envMapSize === 0) return null;

    this.envMap?.dispose();
    if (!this.pmrem) {
      this.pmrem = new THREE.PMREMGenerator(renderer);
      this.pmrem.compileEquirectangularShader();
    }

    const w = 256;
    const h = 128;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;

    const palettes: Record<TimeOfDay, { top: string; horizon: string; ground: string; sun: string; sunY: number }> = {
      day: { top: '#3f78c8', horizon: '#bfd4e8', ground: '#4c5158', sun: '#fff3d8', sunY: 0.3 },
      sunset: { top: '#1d2a54', horizon: '#ff9a52', ground: '#3a2a26', sun: '#ffd9a0', sunY: 0.46 },
      night: { top: '#050810', horizon: '#141c2e', ground: '#0b0d12', sun: '#2a3550', sunY: 0.2 },
    };
    const p = palettes[time];

    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, p.top);
    grad.addColorStop(0.48, p.horizon);
    grad.addColorStop(0.52, p.ground);
    grad.addColorStop(1, p.ground);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // Sun / key light disc with falloff.
    const sunX = w * 0.68;
    const sunY = h * p.sunY;
    const sun = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, w * 0.26);
    sun.addColorStop(0, p.sun);
    sun.addColorStop(0.18, p.sun);
    sun.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = sun;
    ctx.fillRect(0, 0, w, h);

    if (time === 'night') {
      // Sparse stars plus a warm city glow on the horizon.
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      for (let i = 0; i < 90; i++) {
        const x = (i * 97.13) % w;
        const y = ((i * 41.7) % (h * 0.45));
        ctx.fillRect(x, y, 1, 1);
      }
      const glow = ctx.createLinearGradient(0, h * 0.36, 0, h * 0.52);
      glow.addColorStop(0, 'rgba(0,0,0,0)');
      glow.addColorStop(1, 'rgba(255,170,90,0.28)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, h * 0.36, w, h * 0.16);
    }
    ctx.globalCompositeOperation = 'source-over';

    const equirect = new THREE.CanvasTexture(canvas);
    equirect.mapping = THREE.EquirectangularReflectionMapping;
    equirect.colorSpace = THREE.SRGBColorSpace;
    equirect.needsUpdate = true;

    const target = this.pmrem.fromEquirectangular(equirect);
    equirect.dispose();
    this.envMap = target.texture;
    this.applyEnvToMaterials();
    return this.envMap;
  }

  get environment(): THREE.Texture | null {
    return this.envMap;
  }

  private applyEnvToMaterials(): void {
    for (const mat of this.materials.values()) {
      const m = mat as THREE.MeshStandardMaterial;
      if ('envMap' in m) {
        m.envMap = this.envMap;
        m.needsUpdate = true;
      }
    }
  }

  private surfaceMaterial(
    id: SurfaceId,
    repeat: [number, number],
    overrides: Partial<THREE.MeshStandardMaterialParameters> = {},
  ): THREE.MeshStandardMaterial {
    const set = this.textures.get(id);
    const mat = new THREE.MeshStandardMaterial({
      roughness: 1,
      metalness: 0,
      ...overrides,
    });
    if (set) {
      const clone = (t: THREE.Texture): THREE.Texture => {
        const c = t.clone();
        c.wrapS = THREE.RepeatWrapping;
        c.wrapT = THREE.RepeatWrapping;
        c.repeat.set(repeat[0], repeat[1]);
        c.needsUpdate = true;
        return c;
      };
      mat.map = clone(set.map);
      mat.normalMap = clone(set.normalMap);
      mat.roughnessMap = clone(set.roughnessMap);
      if (set.aoMap) {
        mat.aoMap = clone(set.aoMap);
        mat.aoMapIntensity = 0.85;
      }
      mat.normalScale = new THREE.Vector2(1, 1);
    }
    mat.envMap = this.envMap;
    return mat;
  }

  private buildMaterials(): void {
    this.materials.set('asphalt', this.surfaceMaterial('asphalt', [1, 1], { roughness: 0.92 }));
    this.materials.set('grass', this.surfaceMaterial('grass', [1, 1]));
    this.materials.set('gravel', this.surfaceMaterial('gravel', [1, 1]));
    this.materials.set('concrete', this.surfaceMaterial('concrete', [1, 1]));
    this.materials.set('sand', this.surfaceMaterial('sand', [1, 1]));
    this.materials.set('snow', this.surfaceMaterial('snow', [1, 1], { roughness: 0.6 }));
    this.materials.set('basalt', this.surfaceMaterial('basalt', [1, 1]));
    this.materials.set('curbRed', this.surfaceMaterial('curbRed', [1, 1], { roughness: 0.55 }));
    this.materials.set('curbBlue', this.surfaceMaterial('curbBlue', [1, 1], { roughness: 0.55 }));
    this.materials.set('curbYellow', this.surfaceMaterial('curbYellow', [1, 1], { roughness: 0.55 }));
    this.materials.set(
      'metal',
      this.surfaceMaterial('metal', [1, 1], { metalness: 0.85, roughness: 0.42 }),
    );
  }

  /** Returns a fresh material instance with UV repeats tuned for the caller. */
  makeSurface(
    id: SurfaceId,
    repeat: [number, number],
    overrides: Partial<THREE.MeshStandardMaterialParameters> = {},
  ): THREE.MeshStandardMaterial {
    return this.surfaceMaterial(id, repeat, overrides);
  }

  getTexture(id: SurfaceId): PBRTextureSet | undefined {
    return this.textures.get(id);
  }

  setProfile(profile: QualityProfile): void {
    this.profile = profile;
  }

  dispose(): void {
    for (const set of this.textures.values()) {
      set.map.dispose();
      set.normalMap.dispose();
      set.roughnessMap.dispose();
      set.aoMap?.dispose();
    }
    this.textures.clear();
    for (const mat of this.materials.values()) mat.dispose();
    this.materials.clear();
    this.envMap?.dispose();
    this.pmrem?.dispose();
    this.pmrem = null;
    this.ready = false;
  }
}

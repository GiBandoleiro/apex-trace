/**
 * Runtime PBR texture authoring.
 *
 * Every surface material in the game is generated procedurally into offscreen
 * canvases - base colour, height-derived normal, roughness and ambient occlusion.
 * This keeps the build free of binary assets, guarantees perfectly seamless
 * tiling and lets us scale resolution by device class (see `quality.ts`).
 */

import * as THREE from 'three';
import { clamp01, lerp } from '@/utils/math';
import { fbm, warpedFbm, worley, valueNoise } from '@/utils/noise';

export interface PBRTextureSet {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  roughnessMap: THREE.Texture;
  aoMap?: THREE.Texture;
}

interface Field {
  /** Linear RGB 0..1 */
  r: number;
  g: number;
  b: number;
  /** Height 0..1 - used to derive the normal map. */
  h: number;
  /** Roughness 0..1 */
  rough: number;
  /** Ambient occlusion 0..1 (1 = fully open). */
  ao: number;
}

export type FieldFn = (u: number, v: number) => Field;

const createCanvas = (size: number): HTMLCanvasElement => {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  return c;
};

const toTexture = (
  canvas: HTMLCanvasElement,
  srgb: boolean,
  anisotropy: number,
): THREE.Texture => {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.anisotropy = anisotropy;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
};

/** Linear -> sRGB transfer (IEC 61966-2-1). */
const encodeSRGB = (linear: number): number => {
  const v = clamp01(linear);
  return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
};

/** Bakes a field function into a complete seamless PBR texture set. */
export const bakePBR = (
  field: FieldFn,
  size: number,
  anisotropy: number,
  normalStrength = 2.4,
  withAO = true,
): PBRTextureSet => {
  const albedo = createCanvas(size);
  const normal = createCanvas(size);
  const rough = createCanvas(size);
  const ao = withAO ? createCanvas(size) : null;

  const aCtx = albedo.getContext('2d')!;
  const nCtx = normal.getContext('2d')!;
  const rCtx = rough.getContext('2d')!;
  const oCtx = ao ? ao.getContext('2d')! : null;

  const aImg = aCtx.createImageData(size, size);
  const nImg = nCtx.createImageData(size, size);
  const rImg = rCtx.createImageData(size, size);
  const oImg = oCtx ? oCtx.createImageData(size, size) : null;

  const heights = new Float32Array(size * size);
  const occl = new Float32Array(size * size);

  // Pass 1: evaluate the field.
  // Field colours are authored in LINEAR space (0.05 really is dark asphalt),
  // but the albedo canvas is sampled as sRGB, so encode on the way out.
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const f = field(x / size, y / size);
      const o = i * 4;
      aImg.data[o] = Math.round(encodeSRGB(f.r) * 255);
      aImg.data[o + 1] = Math.round(encodeSRGB(f.g) * 255);
      aImg.data[o + 2] = Math.round(encodeSRGB(f.b) * 255);
      aImg.data[o + 3] = 255;
      const rv = Math.round(clamp01(f.rough) * 255);
      rImg.data[o] = rv;
      rImg.data[o + 1] = rv;
      rImg.data[o + 2] = rv;
      rImg.data[o + 3] = 255;
      heights[i] = f.h;
      occl[i] = f.ao;
    }
  }

  // Pass 2: Sobel the height buffer into a tangent-space normal map (wrapping).
  const at = (x: number, y: number): number =>
    heights[(((y % size) + size) % size) * size + (((x % size) + size) % size)];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx =
        at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) -
        (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1));
      const dy =
        at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) -
        (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1));
      let nx = -dx * normalStrength;
      let ny = -dy * normalStrength;
      const len = Math.hypot(nx, ny, 1);
      nx /= len;
      ny /= len;
      const o = (y * size + x) * 4;
      nImg.data[o] = Math.round((nx * 0.5 + 0.5) * 255);
      nImg.data[o + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      nImg.data[o + 2] = Math.round((1 / len) * 0.5 * 255 + 127.5);
      nImg.data[o + 3] = 255;

      if (oImg) {
        // Cheap curvature-based cavity term folded into the authored AO.
        const local = heights[y * size + x];
        const avg =
          (at(x + 2, y) + at(x - 2, y) + at(x, y + 2) + at(x, y - 2) +
            at(x + 1, y + 1) + at(x - 1, y - 1) + at(x + 1, y - 1) + at(x - 1, y + 1)) / 8;
        const cavity = clamp01(1 - Math.max(0, avg - local) * 3.2);
        const v = Math.round(clamp01(occl[y * size + x] * cavity) * 255);
        oImg.data[o] = v;
        oImg.data[o + 1] = v;
        oImg.data[o + 2] = v;
        oImg.data[o + 3] = 255;
      }
    }
  }

  aCtx.putImageData(aImg, 0, 0);
  nCtx.putImageData(nImg, 0, 0);
  rCtx.putImageData(rImg, 0, 0);
  if (oCtx && oImg) oCtx.putImageData(oImg, 0, 0);

  return {
    map: toTexture(albedo, true, anisotropy),
    normalMap: toTexture(normal, false, anisotropy),
    roughnessMap: toTexture(rough, false, anisotropy),
    aoMap: ao ? toTexture(ao, false, anisotropy) : undefined,
  };
};

/* ------------------------------------------------------------------ */
/* Surface definitions                                                 */
/* ------------------------------------------------------------------ */

/**
 * Racing circuit asphalt: dark grey binder, fine aggregate, rubbered-in
 * racing line, hairline cracks, oil staining and weathering.
 */
export const asphaltField =
  (seed = 17): FieldFn =>
  (u, v) => {
    const P = 8;
    const x = u * P;
    const y = v * P;

    // Fine aggregate: worley grains at two scales.
    const grainA = worley(x * 26, y * 26, P * 26, seed);
    const grainB = worley(x * 58, y * 58, P * 58, seed + 91);
    const grain = grainA * 0.62 + grainB * 0.38;

    const binder = fbm(x * 3.1, y * 3.1, P * 3.1, 4, seed + 5);
    const macro = warpedFbm(x * 0.9, y * 0.9, P * 0.9, 4, seed + 13, 0.8);

    // Base tone - slightly blue-grey bitumen.
    let base = 0.078 + binder * 0.035 + macro * 0.062 + (1 - grain) * 0.035;

    // Hairline cracks: thin worley ridges.
    const crackField = worley(x * 4.2, y * 4.2, P * 4.2, seed + 311);
    const crack = clamp01(1 - Math.abs(crackField - 0.42) * 26) * clamp01(macro * 1.6 - 0.35);
    base -= crack * 0.038;

    // Oil / fluid stains.
    const stain = clamp01(warpedFbm(x * 1.4, y * 1.4, P * 1.4, 3, seed + 707, 1.1) * 1.9 - 1.05);

    // Rubbered-in tyre marks (soft banding).
    const rubberBand = clamp01(fbm(x * 0.7, y * 2.6, P * 2.6, 3, seed + 404) * 1.8 - 0.75);

    // Slightly cool bias so the surface still reads as asphalt rather than
    // dirt when a low, very warm sun is doing most of the lighting.
    let r = base * 0.98;
    let g = base * 0.99;
    let b = base * 1.02;

    // Stains push slightly warm and much glossier.
    r = lerp(r, r * 0.72, stain);
    g = lerp(g, g * 0.68, stain);
    b = lerp(b, b * 0.66, stain);

    // Rubber darkens and dulls.
    const rubber = rubberBand * 0.7;
    r = lerp(r, r * 0.78, rubber);
    g = lerp(g, g * 0.78, rubber);
    b = lerp(b, b * 0.8, rubber);

    const h = clamp01(grain * 0.36 + binder * 0.3 + macro * 0.2 - crack * 0.4);
    const rough = clamp01(
      0.93 - stain * 0.42 - rubber * 0.08 + (1 - grain) * 0.05 - macro * 0.04,
    );
    const aoV = clamp01(0.88 + grain * 0.12 - crack * 0.5);

    return { r, g, b, h, rough, ao: aoV };
  };

/** Short trimmed circuit grass with dry patches and soil showing through. */
export const grassField =
  (seed = 44): FieldFn =>
  (u, v) => {
    const P = 8;
    const x = u * P;
    const y = v * P;

    const blades = worley(x * 42, y * 42, P * 42, seed);
    const clumps = warpedFbm(x * 2.2, y * 2.2, P * 2.2, 4, seed + 19, 0.9);
    const dry = clamp01(warpedFbm(x * 1.3, y * 1.3, P * 1.3, 3, seed + 233, 1.2) * 2 - 1.05);
    const soil = clamp01(fbm(x * 0.8, y * 0.8, P * 0.8, 3, seed + 88) * 1.9 - 1.15);

    const lush = { r: 0.055, g: 0.115, b: 0.042 };
    const mid = { r: 0.085, g: 0.15, b: 0.052 };
    const dryC = { r: 0.2, g: 0.185, b: 0.085 };
    const soilC = { r: 0.12, g: 0.085, b: 0.055 };

    const t = clamp01(clumps * 1.15 + (1 - blades) * 0.25);
    let r = lerp(lush.r, mid.r, t);
    let g = lerp(lush.g, mid.g, t);
    let b = lerp(lush.b, mid.b, t);

    r = lerp(r, dryC.r, dry * 0.72);
    g = lerp(g, dryC.g, dry * 0.72);
    b = lerp(b, dryC.b, dry * 0.72);

    r = lerp(r, soilC.r, soil * 0.65);
    g = lerp(g, soilC.g, soil * 0.65);
    b = lerp(b, soilC.b, soil * 0.65);

    const h = clamp01(blades * 0.55 + clumps * 0.45);
    return {
      r,
      g,
      b,
      h,
      rough: clamp01(0.94 - dry * 0.06),
      ao: clamp01(0.7 + blades * 0.3 - clumps * 0.1),
    };
  };

/** Runoff gravel - thousands of small beige-grey stones. */
export const gravelField =
  (seed = 61): FieldFn =>
  (u, v) => {
    const P = 8;
    const x = u * P;
    const y = v * P;

    const stonesA = worley(x * 20, y * 20, P * 20, seed);
    const stonesB = worley(x * 46, y * 46, P * 46, seed + 71);
    const dust = fbm(x * 3, y * 3, P * 3, 4, seed + 17);
    const tint = valueNoise(x * 20, y * 20, P * 20, seed + 500);

    const stone = 1 - stonesA;
    const shade = 0.13 + stone * 0.12 + stonesB * 0.045 + dust * 0.035;

    const warm = 0.02 + tint * 0.07;
    const r = shade * (1 + warm);
    const g = shade * (1 + warm * 0.7);
    const b = shade * (1 - warm * 0.08);

    const h = clamp01(stone * 0.75 + (1 - stonesB) * 0.25);
    return {
      r,
      g,
      b,
      h,
      rough: clamp01(0.9 + dust * 0.08),
      ao: clamp01(0.55 + stonesA * 0.45),
    };
  };

/** Aged circuit concrete - pit lane, walls, service areas. */
export const concreteField =
  (seed = 88): FieldFn =>
  (u, v) => {
    const P = 8;
    const x = u * P;
    const y = v * P;

    const pores = worley(x * 60, y * 60, P * 60, seed);
    const macro = warpedFbm(x * 1.6, y * 1.6, P * 1.6, 4, seed + 41, 0.7);
    const dirt = clamp01(fbm(x * 2.4, y * 2.4, P * 2.4, 4, seed + 303) * 1.7 - 0.85);
    const crackField = worley(x * 3.4, y * 3.4, P * 3.4, seed + 909);
    const crack = clamp01(1 - Math.abs(crackField - 0.5) * 30);

    let base = 0.17 + macro * 0.055 + (1 - pores) * 0.02;
    base -= crack * 0.08;
    base = lerp(base, base * 0.68, dirt);

    return {
      r: base * 1.01,
      g: base,
      b: base * 0.97,
      h: clamp01(pores * 0.4 + macro * 0.55 - crack * 0.7),
      rough: clamp01(0.88 + dirt * 0.07 - macro * 0.05),
      ao: clamp01(0.9 - crack * 0.55 - dirt * 0.12),
    };
  };

/**
 * Painted motorsport curb. The `colorA`/`colorB` pair drives the red/white,
 * blue/white or yellow/black variants used by different circuits.
 */
export const curbField =
  (
    colorA: [number, number, number],
    colorB: [number, number, number],
    seed = 120,
  ): FieldFn =>
  (u, v) => {
    const P = 8;
    const x = u * P;
    const y = v * P;

    const band = Math.floor(u * 6) % 2 === 0;
    const [ar, ag, ab] = band ? colorA : colorB;

    const wear = clamp01(warpedFbm(x * 3.2, y * 3.2, P * 3.2, 4, seed, 0.9) * 1.6 - 0.55);
    const grit = worley(x * 34, y * 34, P * 34, seed + 17);
    const rubber = clamp01(fbm(x * 1.4, y * 5, P * 5, 3, seed + 55) * 1.9 - 1.0);

    // Paint edge chipping at the band boundary.
    const edge = Math.abs(((u * 6) % 1) - 0.5);
    const chip = clamp01(1 - edge * 14) * wear;

    let r = ar;
    let g = ag;
    let b = ab;

    // Worn paint reveals grey concrete beneath.
    const bare = clamp01(wear * 0.55 + chip * 0.6);
    r = lerp(r, 0.19, bare);
    g = lerp(g, 0.185, bare);
    b = lerp(b, 0.18, bare);

    // Rubber deposits.
    r = lerp(r, r * 0.55, rubber * 0.8);
    g = lerp(g, g * 0.55, rubber * 0.8);
    b = lerp(b, b * 0.58, rubber * 0.8);

    // Ribbed curb profile (sinusoidal ridges running across the strip).
    const rib = 0.5 + 0.5 * Math.sin(u * Math.PI * 12);

    return {
      r,
      g,
      b,
      h: clamp01(rib * 0.7 + grit * 0.2 + (1 - wear) * 0.1),
      rough: clamp01(0.42 + wear * 0.44 + rubber * 0.1),
      ao: clamp01(0.82 + rib * 0.18 - chip * 0.2),
    };
  };

/** Desert sand / dust runoff. */
export const sandField =
  (seed = 204): FieldFn =>
  (u, v) => {
    const P = 8;
    const x = u * P;
    const y = v * P;
    const ripples = 0.5 + 0.5 * Math.sin((x * 6 + fbm(x, y, P, 3, seed) * 5) * Math.PI);
    const grains = worley(x * 70, y * 70, P * 70, seed + 3);
    const macro = warpedFbm(x * 1.2, y * 1.2, P * 1.2, 3, seed + 90, 0.8);
    const base = 0.2 + macro * 0.08 + ripples * 0.035 + (1 - grains) * 0.02;
    return {
      r: base * 1.16,
      g: base * 0.98,
      b: base * 0.7,
      h: clamp01(ripples * 0.55 + grains * 0.25 + macro * 0.2),
      rough: 0.96,
      ao: clamp01(0.78 + grains * 0.22),
    };
  };

/** Packed snow with a faint icy crust - winter circuit runoff. */
export const snowField =
  (seed = 311): FieldFn =>
  (u, v) => {
    const P = 8;
    const x = u * P;
    const y = v * P;
    const drift = warpedFbm(x * 1.4, y * 1.4, P * 1.4, 4, seed, 0.9);
    const crystals = worley(x * 56, y * 56, P * 56, seed + 12);
    const ice = clamp01(fbm(x * 2.6, y * 2.6, P * 2.6, 3, seed + 44) * 1.8 - 0.95);
    const base = 0.66 + drift * 0.16 + (1 - crystals) * 0.08;
    return {
      r: base * 0.985,
      g: base * 0.995,
      b: base * 1.03,
      h: clamp01(drift * 0.6 + crystals * 0.4),
      rough: clamp01(0.82 - ice * 0.5),
      ao: clamp01(0.86 + crystals * 0.14),
    };
  };

/** Volcanic basalt / scoria with faint glowing fissures. */
export const basaltField =
  (seed = 402): FieldFn =>
  (u, v) => {
    const P = 8;
    const x = u * P;
    const y = v * P;
    const vesicles = worley(x * 38, y * 38, P * 38, seed);
    const flow = warpedFbm(x * 1.5, y * 1.5, P * 1.5, 4, seed + 77, 1.1);
    const ember = clamp01(fbm(x * 2.2, y * 2.2, P * 2.2, 4, seed + 909) * 1.9 - 1.28);
    const base = 0.035 + flow * 0.04 + vesicles * 0.02;
    return {
      r: base + ember * 0.5,
      g: base * 0.95 + ember * 0.14,
      b: base * 0.98 + ember * 0.02,
      h: clamp01(vesicles * 0.7 + flow * 0.3),
      rough: clamp01(0.95 - ember * 0.3),
      ao: clamp01(0.6 + vesicles * 0.4),
    };
  };

/** Anisotropic brushed metal - guard rails, barriers, structures. */
export const metalField =
  (seed = 500): FieldFn =>
  (u, v) => {
    const P = 8;
    const x = u * P;
    const y = v * P;
    const brush = valueNoise(x * 2, y * 140, P * 140, seed);
    const patina = warpedFbm(x * 1.8, y * 1.8, P * 1.8, 3, seed + 31, 0.8);
    const scuff = clamp01(fbm(x * 5, y * 1.2, P * 5, 3, seed + 63) * 1.7 - 0.8);
    const base = 0.3 + brush * 0.08 + patina * 0.05 - scuff * 0.06;
    return {
      r: base,
      g: base * 1.005,
      b: base * 1.02,
      h: clamp01(brush * 0.7 + scuff * 0.3),
      rough: clamp01(0.3 + brush * 0.16 + scuff * 0.25 + patina * 0.1),
      ao: clamp01(0.92 - scuff * 0.14),
    };
  };

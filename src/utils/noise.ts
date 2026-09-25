/**
 * Tileable value / gradient noise used to author the PBR texture set at runtime.
 * Everything here is seamless on a power-of-two period so textures tile cleanly
 * across the asphalt ribbon and terrain without visible repetition seams.
 */

const hash2 = (x: number, y: number, seed: number): number => {
  let h = x * 374761393 + y * 668265263 + seed * 2147483647;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);

/** Periodic value noise: repeats exactly every `period` units. */
export const valueNoise = (x: number, y: number, period: number, seed: number): number => {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const wrap = (v: number) => ((v % period) + period) % period;
  const x0 = wrap(xi);
  const y0 = wrap(yi);
  const x1 = wrap(xi + 1);
  const y1 = wrap(yi + 1);
  const u = fade(xf);
  const v = fade(yf);
  const a = hash2(x0, y0, seed);
  const b = hash2(x1, y0, seed);
  const c = hash2(x0, y1, seed);
  const d = hash2(x1, y1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
};

/** Periodic fractal brownian motion. */
export const fbm = (
  x: number,
  y: number,
  period: number,
  octaves: number,
  seed: number,
  gain = 0.5,
  lacunarity = 2,
): number => {
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise(x * freq, y * freq, period * freq, seed + i * 977);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
};

/** Periodic Worley/cellular noise — returns distance to the closest feature point. */
export const worley = (x: number, y: number, period: number, seed: number): number => {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  let best = 1e9;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const cx = xi + dx;
      const cy = yi + dy;
      const wx = ((cx % period) + period) % period;
      const wy = ((cy % period) + period) % period;
      const px = cx + hash2(wx, wy, seed);
      const py = cy + hash2(wx, wy, seed + 5501);
      const d = Math.hypot(px - x, py - y);
      if (d < best) best = d;
    }
  }
  return Math.min(1, best);
};

/** Domain-warped fbm — gives organic, non-repeating looking surfaces. */
export const warpedFbm = (
  x: number,
  y: number,
  period: number,
  octaves: number,
  seed: number,
  warp = 0.6,
): number => {
  const qx = fbm(x, y, period, 3, seed + 31) - 0.5;
  const qy = fbm(x, y, period, 3, seed + 67) - 0.5;
  return fbm(x + qx * warp, y + qy * warp, period, octaves, seed);
};

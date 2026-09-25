/** Shared math helpers used by the physics, track and trajectory systems. */

export const TAU = Math.PI * 2;

export const clamp = (v: number, min: number, max: number): number =>
  v < min ? min : v > max ? max : v;

export const clamp01 = (v: number): number => clamp(v, 0, 1);

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export const invLerp = (a: number, b: number, v: number): number =>
  a === b ? 0 : clamp01((v - a) / (b - a));

export const smoothstep = (t: number): number => {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
};

export const smootherstep = (t: number): number => {
  const x = clamp01(t);
  return x * x * x * (x * (x * 6 - 15) + 10);
};

/** Shortest signed angular difference between two angles, in (-PI, PI]. */
export const angleDelta = (from: number, to: number): number => {
  let d = (to - from) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
};

export const lerpAngle = (a: number, b: number, t: number): number =>
  a + angleDelta(a, b) * t;

/** Frame-rate independent exponential smoothing. */
export const damp = (current: number, target: number, lambda: number, dt: number): number =>
  lerp(current, target, 1 - Math.exp(-lambda * dt));

export const dampAngle = (current: number, target: number, lambda: number, dt: number): number =>
  lerpAngle(current, target, 1 - Math.exp(-lambda * dt));

export interface Vec2 {
  x: number;
  y: number;
}

export const v2 = (x = 0, y = 0): Vec2 => ({ x, y });
export const v2add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const v2sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const v2scale = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s });
export const v2dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
export const v2cross = (a: Vec2, b: Vec2): number => a.x * b.y - a.y * b.x;
export const v2len = (a: Vec2): number => Math.hypot(a.x, a.y);
export const v2dist = (a: Vec2, b: Vec2): number => Math.hypot(b.x - a.x, b.y - a.y);
export const v2lerp = (a: Vec2, b: Vec2, t: number): Vec2 => ({
  x: lerp(a.x, b.x, t),
  y: lerp(a.y, b.y, t),
});

export const v2norm = (a: Vec2): Vec2 => {
  const l = Math.hypot(a.x, a.y);
  return l > 1e-6 ? { x: a.x / l, y: a.y / l } : { x: 0, y: 0 };
};

export const v2perp = (a: Vec2): Vec2 => ({ x: -a.y, y: a.x });

/** Distance from `p` to segment `a`->`b`, plus the parametric position along it. */
export const pointSegment = (
  p: Vec2,
  a: Vec2,
  b: Vec2,
): { dist: number; t: number; closest: Vec2 } => {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lenSq = abx * abx + aby * aby;
  const t = lenSq < 1e-9 ? 0 : clamp01(((p.x - a.x) * abx + (p.y - a.y) * aby) / lenSq);
  const closest = { x: a.x + abx * t, y: a.y + aby * t };
  return { dist: Math.hypot(p.x - closest.x, p.y - closest.y), t, closest };
};

/** Catmull-Rom interpolation between p1 and p2 (p0/p3 are the neighbours). */
export const catmullRom = (
  p0: number,
  p1: number,
  p2: number,
  p3: number,
  t: number,
): number => {
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    0.5 *
    (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
  );
};

/** Deterministic pseudo-random generator (mulberry32). */
export const makeRng = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

export const randRange = (rng: () => number, min: number, max: number): number =>
  min + rng() * (max - min);

export const pick = <T,>(rng: () => number, arr: readonly T[]): T =>
  arr[Math.min(arr.length - 1, Math.floor(rng() * arr.length))];

/** mm:ss.mmm race clock formatting. */
export const formatTime = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds <= 0) return '--:--.---';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
};

export const formatDelta = (seconds: number): string => {
  const sign = seconds >= 0 ? '+' : '-';
  const abs = Math.abs(seconds);
  return `${sign}${abs.toFixed(3)}`;
};

export const formatCoins = (value: number): string => {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 10_000) return `${(value / 1000).toFixed(1)}K`;
  return Math.round(value).toLocaleString('en-US');
};

export const ordinal = (n: number): string => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
};

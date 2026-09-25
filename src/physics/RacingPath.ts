/**
 * A racing path is the contract between "what the player drew" and "what the
 * car tries to do". It is stored as a lateral-offset profile over the circuit
 * centreline plus a pace profile, which means:
 *
 *  - the path is always a valid closed lap, whatever the player scribbles;
 *  - the AI can be described with exactly the same structure;
 *  - curvature and the speed target are derived, not authored.
 *
 * The speed profile is solved in three passes: a desired profile from the
 * player's drawing pace, then a forward pass limited by engine acceleration
 * and a backward pass limited by braking. What survives is a target the car
 * could in principle achieve - whether it *actually* achieves it is decided by
 * the grip model in `VehiclePhysics`, which is where understeer comes from.
 */

import { TrackGeometry } from '@/tracks/TrackGeometry';
import { angleDelta, clamp, clamp01, lerp } from '@/utils/math';
import type { DrivetrainLimits } from './vehicleStats';

export interface PathPoint {
  x: number;
  z: number;
  y: number;
  /** Arc length along the path itself. */
  s: number;
  /** Unit tangent of the path. */
  tx: number;
  tz: number;
  /** Signed curvature of the path (1/m). */
  curvature: number;
  /** Target speed in m/s after the profile solve. */
  targetSpeed: number;
  /** Physical cornering limit at this point, for UI risk shading. */
  limitSpeed: number;
  /** Lateral offset from the centreline. */
  offset: number;
  /** Centreline station index this point corresponds to. */
  station: number;
}

export interface PathBuildOptions {
  /** Lateral offsets per centreline station, in metres. */
  offsets: Float32Array;
  /** Per-station pace multiplier (1 = the player's own average pace). */
  pace: Float32Array;
  limits: DrivetrainLimits;
  /** Global scale applied to the solved profile (AI skill, event modifiers). */
  speedScale?: number;
  /**
   * Ceiling on the target as a multiple of the physical cornering limit.
   *
   * The AI sits at or just under 1 - it drives within the grip available, which
   * is why it looks like a real driver rather than a car on rails. The player
   * gets a much looser cap (~1.6) so an over-committed line is *allowed* to be
   * drawn; the grip model then decides how badly it goes wrong.
   */
  respectLimits?: number;
}

export class RacingPath {
  readonly points: PathPoint[];
  readonly totalLength: number;
  private readonly track: TrackGeometry;

  constructor(track: TrackGeometry, opts: PathBuildOptions) {
    this.track = track;
    const n = track.sampleCount;
    const pts: PathPoint[] = new Array(n);

    for (let i = 0; i < n; i++) {
      const c = track.point(i);
      const o = opts.offsets[i];
      pts[i] = {
        x: c.x + c.nx * o,
        z: c.z + c.nz * o,
        y: c.y,
        s: 0,
        tx: c.tx,
        tz: c.tz,
        curvature: 0,
        targetSpeed: 0,
        limitSpeed: 0,
        offset: o,
        station: i,
      };
    }

    // Arc length + tangents of the actual offset path.
    let acc = 0;
    for (let i = 0; i < n; i++) {
      pts[i].s = acc;
      const a = pts[i];
      const b = pts[(i + 1) % n];
      acc += Math.hypot(b.x - a.x, b.z - a.z);
    }
    this.totalLength = acc;

    for (let i = 0; i < n; i++) {
      const prev = pts[(i - 1 + n) % n];
      const next = pts[(i + 1) % n];
      const dx = next.x - prev.x;
      const dz = next.z - prev.z;
      const l = Math.hypot(dx, dz) || 1;
      pts[i].tx = dx / l;
      pts[i].tz = dz / l;
    }

    // Curvature from heading change per unit length, then smoothed.
    const raw = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const prev = pts[(i - 1 + n) % n];
      const next = pts[(i + 1) % n];
      const h0 = Math.atan2(prev.tz, prev.tx);
      const h1 = Math.atan2(next.tz, next.tx);
      const ds = Math.hypot(next.x - prev.x, next.z - prev.z) || 1;
      raw[i] = angleDelta(h0, h1) / ds;
    }
    for (let i = 0; i < n; i++) {
      const a = raw[(i - 2 + n) % n];
      const b = raw[(i - 1 + n) % n];
      const c = raw[i];
      const d = raw[(i + 1) % n];
      const e = raw[(i + 2) % n];
      pts[i].curvature = (a + 2 * b + 3 * c + 2 * d + e) / 9;
    }

    this.points = pts;
    this.solveSpeedProfile(opts);
  }

  /* ---------------------------------------------------------------- */
  /* Speed profile                                                     */
  /* ---------------------------------------------------------------- */

  private solveSpeedProfile(opts: PathBuildOptions): void {
    const { limits } = opts;
    const n = this.points.length;
    const scale = opts.speedScale ?? 1;
    const vMax = limits.maxSpeed * scale;
    const ceiling = opts.respectLimits ?? 1.6;

    // Pass 0: physical cornering limit and the desired speed.
    for (let i = 0; i < n; i++) {
      const p = this.points[i];
      const k = Math.abs(p.curvature);
      // Downforce raises the lateral limit with speed; solve the implicit
      // relation once with a fixed-point iteration (2 steps is plenty).
      let v = Math.sqrt(limits.lateralGrip / Math.max(k, 1e-4));
      for (let it = 0; it < 2; it++) {
        const aLat = limits.lateralGrip + limits.downforceGain * v * v;
        v = Math.sqrt(aLat / Math.max(k, 1e-4));
      }
      p.limitSpeed = Math.min(v, limits.maxSpeed);

      const pace = clamp(opts.pace[i], 0.25, 1.35);
      const desired = Math.min(vMax * pace, p.limitSpeed * ceiling);
      p.targetSpeed = clamp(desired, limits.minSpeed, vMax);
    }

    // Pass 1: forward - you cannot accelerate faster than the engine allows.
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < n; i++) {
        const a = this.points[i];
        const b = this.points[(i + 1) % n];
        const ds = this.segmentLength(i);
        const reachable = Math.sqrt(a.targetSpeed * a.targetSpeed + 2 * limits.accel * ds);
        if (b.targetSpeed > reachable) b.targetSpeed = reachable;
      }
    }

    // Pass 2: backward - you must be able to slow down in time.
    for (let pass = 0; pass < 2; pass++) {
      for (let i = n - 1; i >= 0; i--) {
        const a = this.points[i];
        const b = this.points[(i + 1) % n];
        const ds = this.segmentLength(i);
        const reachable = Math.sqrt(b.targetSpeed * b.targetSpeed + 2 * limits.brake * ds);
        if (a.targetSpeed > reachable) a.targetSpeed = reachable;
      }
    }
  }

  private segmentLength(i: number): number {
    const n = this.points.length;
    const a = this.points[i];
    const b = this.points[(i + 1) % n];
    return Math.max(0.05, Math.hypot(b.x - a.x, b.z - a.z));
  }

  /* ---------------------------------------------------------------- */
  /* Sampling                                                          */
  /* ---------------------------------------------------------------- */

  point(index: number): PathPoint {
    const n = this.points.length;
    return this.points[((index % n) + n) % n];
  }

  get count(): number {
    return this.points.length;
  }

  /** Interpolated sample a given arc length ahead of a station index. */
  sampleAhead(index: number, distance: number): PathPoint {
    const n = this.points.length;
    let remaining = distance;
    let i = ((index % n) + n) % n;
    let guard = 0;
    while (remaining > 0 && guard < n) {
      const seg = this.segmentLength(i);
      if (seg >= remaining) {
        const t = remaining / seg;
        const a = this.points[i];
        const b = this.points[(i + 1) % n];
        return {
          ...a,
          x: lerp(a.x, b.x, t),
          z: lerp(a.z, b.z, t),
          y: lerp(a.y, b.y, t),
          targetSpeed: lerp(a.targetSpeed, b.targetSpeed, t),
          limitSpeed: lerp(a.limitSpeed, b.limitSpeed, t),
          curvature: lerp(a.curvature, b.curvature, t),
        };
      }
      remaining -= seg;
      i = (i + 1) % n;
      guard++;
    }
    return this.points[i];
  }

  /** Nearest path station to a world position, searching around a hint. */
  projectNear(x: number, z: number, hint: number, radius = 22): number {
    const n = this.points.length;
    let best = hint;
    let bestD = Infinity;
    for (let o = -radius; o <= radius; o++) {
      const i = ((hint + o) % n + n) % n;
      const p = this.points[i];
      const d = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  /** Highest risk factor over a window ahead - drives the "LOW GRIP" warning. */
  riskAhead(index: number, window = 18): number {
    let worst = 0;
    for (let o = 0; o < window; o++) {
      const p = this.point(index + o);
      if (p.limitSpeed <= 0.01) continue;
      worst = Math.max(worst, p.targetSpeed / p.limitSpeed);
    }
    return worst;
  }

  get geometry(): TrackGeometry {
    return this.track;
  }
}

/* ------------------------------------------------------------------ */
/* Offset / pace profile authoring                                     */
/* ------------------------------------------------------------------ */

export interface DrawnSample {
  x: number;
  z: number;
  /** Timestamp in seconds. */
  t: number;
}

export interface DrawnProfile {
  offsets: Float32Array;
  pace: Float32Array;
  /** Fraction of the lap the player actually drew, 0..1. */
  coverage: number;
}

/**
 * Converts one or more drawn strokes into an offset + pace profile.
 *
 * The player can draw the whole lap in one go or build it up section by
 * section. Any station left untouched falls back to the precomputed racing
 * line at a conservative pace, so a partial stroke still produces a complete,
 * drivable lap instead of a dead end.
 */
export const profileFromStrokes = (
  track: TrackGeometry,
  strokes: DrawnSample[][],
  fallbackPace = 0.72,
): DrawnProfile => {
  const n = track.sampleCount;
  const offsets = new Float32Array(n);
  const pace = new Float32Array(n);
  const covered = new Uint8Array(n);

  // Seed with the racing line so uncovered sections are still sensible.
  for (let i = 0; i < n; i++) {
    offsets[i] = track.racingLine[i];
    pace[i] = fallbackPace;
  }

  for (const samples of strokes) {
    if (samples.length < 2) continue;

    // Instantaneous drawing speed per sample (world metres / second).
    const speeds: number[] = new Array(samples.length).fill(0);
    for (let i = 1; i < samples.length; i++) {
      const dt = Math.max(1 / 240, samples[i].t - samples[i - 1].t);
      const d = Math.hypot(samples[i].x - samples[i - 1].x, samples[i].z - samples[i - 1].z);
      speeds[i] = d / dt;
    }
    speeds[0] = speeds[1] ?? 0;

    // Smooth the pace signal - finger jitter should not become a speed command.
    const smoothed = speeds.slice();
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 1; i < smoothed.length - 1; i++) {
        smoothed[i] = (smoothed[i - 1] + smoothed[i] * 2 + smoothed[i + 1]) / 4;
      }
    }

    // Normalise against this stroke's own median so the mapping is independent
    // of zoom level, screen size and how fast this player moves their hand.
    const sorted = smoothed.filter((v) => v > 1e-4).slice().sort((a, b) => a - b);
    const median = sorted.length ? sorted[Math.floor(sorted.length * 0.5)] : 1;

    let hint = track.project(samples[0].x, samples[0].z).index;
    let lastStation = hint;

    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      const proj = track.projectNear(s.x, s.z, hint, 36);
      hint = proj.index;

      // Ignore samples that move backwards along the circuit (hand wobble or a
      // deliberate doubling back) so the profile stays monotonic.
      const step = shortestStationDelta(proj.index, lastStation, n);
      if (step < -6) continue;

      const limit = proj.halfWidth + 2.2;
      const off = clamp(proj.lateral, -limit, limit);
      // Relative pace: 1 = this player's own median drawing speed, which maps
      // to a committed-but-sane 0.8 of the car's maximum. Drawing noticeably
      // faster than your own average asks for more than the car may have.
      const rel = median > 1e-4 ? smoothed[i] / median : 1;
      const p = clamp(0.28 + 0.52 * rel, 0.25, 1.18);

      // Fill every station between the previous one and this one.
      const gap = Math.min(n - 1, Math.max(0, step));
      for (let k = 0; k <= gap; k++) {
        const idx = ((lastStation + k) % n + n) % n;
        const t = gap === 0 ? 1 : k / gap;
        offsets[idx] = lerp(offsets[idx], off, covered[idx] ? 0.5 : t * 0.35 + 0.65);
        pace[idx] = covered[idx] ? (pace[idx] + p) * 0.5 : p;
        covered[idx] = 1;
      }
      lastStation = proj.index;
    }
  }

  let coveredCount = 0;
  for (let i = 0; i < n; i++) coveredCount += covered[i];
  const coverage = clamp01(coveredCount / n);

  // Blend the seams between drawn and fallback sections over a few stations so
  // the car does not get an instantaneous lateral step.
  smoothSeams(offsets, pace, covered, n);
  smoothArray(offsets, n, 2);
  smoothArray(pace, n, 3);

  return { offsets, pace, coverage };
};

export const profileFromStroke = (
  track: TrackGeometry,
  samples: DrawnSample[],
  fallbackPace = 0.72,
): DrawnProfile => profileFromStrokes(track, [samples], fallbackPace);

const shortestStationDelta = (a: number, b: number, n: number): number => {
  let d = (a - b) % n;
  if (d > n / 2) d -= n;
  if (d < -n / 2) d += n;
  return d;
};

const smoothSeams = (
  offsets: Float32Array,
  pace: Float32Array,
  covered: Uint8Array,
  n: number,
): void => {
  const blend = 10;
  for (let i = 0; i < n; i++) {
    if (covered[i] === covered[(i + 1) % n]) continue;
    for (let k = -blend; k <= blend; k++) {
      const idx = ((i + k) % n + n) % n;
      const w = 1 - Math.abs(k) / (blend + 1);
      const a = offsets[((i - blend) % n + n) % n];
      const b = offsets[((i + blend) % n + n) % n];
      offsets[idx] = lerp(offsets[idx], (a + b) * 0.5, w * 0.45);
      const pa = pace[((i - blend) % n + n) % n];
      const pb = pace[((i + blend) % n + n) % n];
      pace[idx] = lerp(pace[idx], (pa + pb) * 0.5, w * 0.35);
    }
  }
};

export const smoothArray = (arr: Float32Array, n: number, passes: number): void => {
  const tmp = new Float32Array(n);
  for (let p = 0; p < passes; p++) {
    for (let i = 0; i < n; i++) {
      const a = arr[(i - 1 + n) % n];
      const b = arr[i];
      const c = arr[(i + 1) % n];
      tmp[i] = (a + 2 * b + c) / 4;
    }
    arr.set(tmp);
  }
};

/** Builds an AI profile: the racing line with skill-driven imperfections. */
export const profileFromRacingLine = (
  track: TrackGeometry,
  rng: () => number,
  opts: { lineNoise: number; pace: number; paceNoise: number },
): DrawnProfile => {
  const n = track.sampleCount;
  const offsets = new Float32Array(n);
  const pace = new Float32Array(n);

  // Low-frequency wander so each opponent takes a visibly different line.
  const harmonics = 4;
  const amps: number[] = [];
  const phases: number[] = [];
  for (let h = 0; h < harmonics; h++) {
    amps.push((rng() * 2 - 1) * opts.lineNoise * (1 / (h + 1)));
    phases.push(rng() * Math.PI * 2);
  }

  for (let i = 0; i < n; i++) {
    const u = (i / n) * Math.PI * 2;
    let wander = 0;
    for (let h = 0; h < harmonics; h++) wander += amps[h] * Math.sin(u * (h + 2) + phases[h]);
    const limit = Math.max(0.3, track.point(i).halfWidth - 1.1);
    offsets[i] = clamp(track.racingLine[i] + wander, -limit, limit);

    let pw = 0;
    for (let h = 0; h < harmonics; h++) {
      pw += amps[h] * 0.5 * Math.sin(u * (h + 3) + phases[h] * 1.7);
    }
    pace[i] = clamp(opts.pace + pw * opts.paceNoise, 0.3, 1.3);
  }

  smoothArray(offsets, n, 2);
  smoothArray(pace, n, 2);
  return { offsets, pace, coverage: 1 };
};

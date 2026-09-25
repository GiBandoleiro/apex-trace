/**
 * Circuit geometry: turns a handful of authored control points into a fully
 * resampled centreline with tangents, normals, curvature and width, plus the
 * spatial queries every other system needs (projection, surface lookup,
 * racing-line solving and grid placement).
 */

import {
  angleDelta,
  catmullRom,
  clamp,
  clamp01,
  lerp,
  type Vec2,
} from '@/utils/math';
import type { CenterlinePoint, TrackDefinition } from './types';

export interface TrackProjection {
  /** Index of the nearest centreline sample. */
  index: number;
  /** Arc length along the circuit. */
  s: number;
  /** Signed lateral offset; positive = left of the centreline. */
  lateral: number;
  /** Local half-width at that station. */
  halfWidth: number;
  /** Squared distance to the centreline sample (for cheap comparisons). */
  distSq: number;
}

export type SurfaceKind = 'track' | 'curb' | 'runoff' | 'offTrack';

const DENSE_PER_SEGMENT = 26;

export class TrackGeometry {
  readonly points: CenterlinePoint[] = [];
  readonly length: number;
  readonly step: number;
  readonly definition: TrackDefinition;

  /** Axis-aligned bounds of the drivable surface plus runoff. */
  readonly bounds: { minX: number; maxX: number; minZ: number; maxZ: number };

  /** Precomputed optimal racing line as lateral offsets per centreline index. */
  readonly racingLine: Float32Array;

  /**
   * Which lateral direction points away from the infield (+1 = the left
   * normal, -1 = the right). Derived from the signed area of the closed
   * centreline, so trackside structures never end up stranded in the middle
   * of the circuit.
   */
  readonly outsideSign: 1 | -1;

  /**
   * 1 where the station is inside (or just outside) a corner. Gravel traps,
   * sand and tyre walls only exist where cars actually leave the road, so both
   * the mesh builder and the grip model read this instead of treating the
   * whole lap as one giant run-off area.
   */
  readonly cornerRunoff: Uint8Array;

  private grid = new Map<number, number[]>();
  private readonly cellSize: number;

  constructor(definition: TrackDefinition, step = 2.4) {
    this.definition = definition;
    this.step = step;
    this.cellSize = Math.max(10, definition.halfWidth * 3);

    const dense = this.densify(definition);
    this.points = this.resample(dense, step, definition);
    this.length = this.points.length * step;
    this.computeCurvature();
    this.bounds = this.computeBounds();
    this.buildGrid();
    this.outsideSign = this.computeOutsideSign();
    this.cornerRunoff = this.computeCornerRunoff();
    this.racingLine = this.solveRacingLine();
  }

  /* ---------------------------------------------------------------- */
  /* Construction                                                      */
  /* ---------------------------------------------------------------- */

  /** Dense Catmull-Rom sampling of the closed control polygon. */
  private densify(def: TrackDefinition): Array<Vec2 & { hw: number }> {
    const n = def.nodes.length;
    const out: Array<Vec2 & { hw: number }> = [];
    const at = (i: number) => def.nodes[((i % n) + n) % n];

    for (let i = 0; i < n; i++) {
      const p0 = at(i - 1);
      const p1 = at(i);
      const p2 = at(i + 1);
      const p3 = at(i + 2);
      const w1 = p1.width ?? def.halfWidth;
      const w2 = p2.width ?? def.halfWidth;
      for (let j = 0; j < DENSE_PER_SEGMENT; j++) {
        const t = j / DENSE_PER_SEGMENT;
        out.push({
          x: catmullRom(p0.x, p1.x, p2.x, p3.x, t),
          y: catmullRom(p0.z, p1.z, p2.z, p3.z, t),
          hw: lerp(w1, w2, t),
        });
      }
    }
    return out;
  }

  /** Walks the dense polyline at a fixed arc-length step. */
  private resample(
    dense: Array<Vec2 & { hw: number }>,
    step: number,
    def: TrackDefinition,
  ): CenterlinePoint[] {
    const n = dense.length;
    const segLen: number[] = new Array(n);
    let total = 0;
    for (let i = 0; i < n; i++) {
      const a = dense[i];
      const b = dense[(i + 1) % n];
      const l = Math.hypot(b.x - a.x, b.y - a.y);
      segLen[i] = l;
      total += l;
    }

    const count = Math.max(64, Math.round(total / step));
    const exactStep = total / count;
    const out: CenterlinePoint[] = new Array(count);

    let seg = 0;
    let segPos = 0;
    for (let i = 0; i < count; i++) {
      const targetLen = i * exactStep;
      while (segPos + segLen[seg] < targetLen && seg < n - 1) {
        segPos += segLen[seg];
        seg++;
      }
      const a = dense[seg];
      const b = dense[(seg + 1) % n];
      const t = segLen[seg] < 1e-6 ? 0 : clamp01((targetLen - segPos) / segLen[seg]);
      out[i] = {
        x: lerp(a.x, b.x, t),
        z: lerp(a.y, b.y, t),
        tx: 0,
        tz: 0,
        nx: 0,
        nz: 0,
        s: targetLen,
        curvature: 0,
        halfWidth: lerp(a.hw, b.hw, t),
        y: 0,
      };
    }

    // Gentle elevation profile so the circuit reads as a physical model rather
    // than a flat decal. Two low-frequency waves keyed off the seed.
    const seed = def.seed;
    for (let i = 0; i < count; i++) {
      const u = i / count;
      out[i].y =
        Math.sin(u * Math.PI * 2 + seed * 0.7) * 0.55 +
        Math.sin(u * Math.PI * 6 + seed * 1.3) * 0.22;
    }

    // Tangents / normals from neighbours (central difference).
    for (let i = 0; i < count; i++) {
      const prev = out[(i - 1 + count) % count];
      const next = out[(i + 1) % count];
      const dx = next.x - prev.x;
      const dz = next.z - prev.z;
      const l = Math.hypot(dx, dz) || 1;
      out[i].tx = dx / l;
      out[i].tz = dz / l;
      // Left normal in the XZ plane (y-up, clockwise-positive convention).
      out[i].nx = -out[i].tz;
      out[i].nz = out[i].tx;
    }

    return out;
  }

  private computeCurvature(): void {
    const n = this.points.length;
    const raw = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const prev = this.points[(i - 1 + n) % n];
      const next = this.points[(i + 1) % n];
      const h0 = Math.atan2(prev.tz, prev.tx);
      const h1 = Math.atan2(next.tz, next.tx);
      const ds = Math.hypot(next.x - prev.x, next.z - prev.z) || 1;
      raw[i] = angleDelta(h0, h1) / ds;
    }
    // Light smoothing removes sampling jitter without losing corner shape.
    for (let i = 0; i < n; i++) {
      const a = raw[(i - 2 + n) % n];
      const b = raw[(i - 1 + n) % n];
      const c = raw[i];
      const d = raw[(i + 1) % n];
      const e = raw[(i + 2) % n];
      this.points[i].curvature = (a + 2 * b + 3 * c + 2 * d + e) / 9;
    }
  }

  private computeBounds() {
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const p of this.points) {
      const r = p.halfWidth + 26;
      minX = Math.min(minX, p.x - r);
      maxX = Math.max(maxX, p.x + r);
      minZ = Math.min(minZ, p.z - r);
      maxZ = Math.max(maxZ, p.z + r);
    }
    return { minX, maxX, minZ, maxZ };
  }

  /** Signed area of the closed centreline decides which side is the infield. */
  private computeOutsideSign(): 1 | -1 {
    let area = 0;
    const n = this.points.length;
    for (let i = 0; i < n; i++) {
      const a = this.points[i];
      const b = this.points[(i + 1) % n];
      area += a.x * b.z - b.x * a.z;
    }
    // Our normal is the left-hand one: for a counter-clockwise loop that
    // points inward, so the outside is the opposite direction.
    return area > 0 ? -1 : 1;
  }

  /** Corner mask, dilated so a trap covers the entry and the exit too. */
  private computeCornerRunoff(): Uint8Array {
    const n = this.points.length;
    const raw = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      if (Math.abs(this.points[i].curvature) > 0.009) raw[i] = 1;
    }
    const spread = Math.max(4, Math.round(22 / this.step));
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      if (!raw[i]) continue;
      for (let k = -spread; k <= spread; k++) out[((i + k) % n + n) % n] = 1;
    }
    return out;
  }

  private cellKey(x: number, z: number): number {
    const cx = Math.floor(x / this.cellSize);
    const cz = Math.floor(z / this.cellSize);
    return cx * 73856093 + cz * 19349663;
  }

  private buildGrid(): void {
    for (let i = 0; i < this.points.length; i++) {
      const p = this.points[i];
      const key = this.cellKey(p.x, p.z);
      let list = this.grid.get(key);
      if (!list) {
        list = [];
        this.grid.set(key, list);
      }
      list.push(i);
    }
  }

  /* ---------------------------------------------------------------- */
  /* Queries                                                           */
  /* ---------------------------------------------------------------- */

  point(index: number): CenterlinePoint {
    const n = this.points.length;
    return this.points[((index % n) + n) % n];
  }

  /** Grid-accelerated nearest-station lookup for arbitrary world positions. */
  project(x: number, z: number): TrackProjection {
    let best = -1;
    let bestDist = Infinity;
    const cs = this.cellSize;
    const cx = Math.floor(x / cs);
    const cz = Math.floor(z / cs);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const list = this.grid.get((cx + dx) * 73856093 + (cz + dz) * 19349663);
        if (!list) continue;
        for (const i of list) {
          const p = this.points[i];
          const d = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z);
          if (d < bestDist) {
            bestDist = d;
            best = i;
          }
        }
      }
    }
    if (best < 0) {
      for (let i = 0; i < this.points.length; i++) {
        const p = this.points[i];
        const d = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z);
        if (d < bestDist) {
          bestDist = d;
          best = i;
        }
      }
    }
    return this.refine(x, z, best, bestDist);
  }

  /** Cheap local search when the caller already knows roughly where it is. */
  projectNear(x: number, z: number, hint: number, radius = 24): TrackProjection {
    const n = this.points.length;
    let best = hint;
    let bestDist = Infinity;
    for (let o = -radius; o <= radius; o++) {
      const i = ((hint + o) % n + n) % n;
      const p = this.points[i];
      const d = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    // If we landed on the edge of the search window the hint was stale.
    const drift = Math.abs(angleIndexDelta(best, hint, n));
    if (drift >= radius - 1) return this.project(x, z);
    return this.refine(x, z, best, bestDist);
  }

  private refine(x: number, z: number, index: number, distSq: number): TrackProjection {
    const p = this.point(index);
    const dx = x - p.x;
    const dz = z - p.z;
    const along = dx * p.tx + dz * p.tz;
    const lateral = dx * p.nx + dz * p.nz;
    return {
      index,
      s: p.s + along,
      lateral,
      halfWidth: p.halfWidth,
      distSq,
    };
  }

  /** Classifies the surface under a world position. */
  surfaceAt(proj: TrackProjection): SurfaceKind {
    const a = Math.abs(proj.lateral);
    const hw = proj.halfWidth;
    if (a <= hw) return 'track';
    if (a <= hw + 1.4) return 'curb';
    if (a <= hw + 14) return 'runoff';
    return 'offTrack';
  }

  /** World position for a station + lateral offset. */
  positionAt(index: number, lateral: number): { x: number; z: number; y: number } {
    const p = this.point(index);
    return {
      x: p.x + p.nx * lateral,
      z: p.z + p.nz * lateral,
      y: p.y,
    };
  }

  /** Heading (radians, atan2(tz, tx)) at a station. */
  headingAt(index: number): number {
    const p = this.point(index);
    return Math.atan2(p.tz, p.tx);
  }

  /** Signed forward distance from `fromS` to `toS` on the closed loop. */
  deltaS(fromS: number, toS: number): number {
    const L = this.totalLength;
    let d = (toS - fromS) % L;
    if (d > L / 2) d -= L;
    if (d < -L / 2) d += L;
    return d;
  }

  get totalLength(): number {
    const last = this.points[this.points.length - 1];
    return last.s + this.step;
  }

  get sampleCount(): number {
    return this.points.length;
  }

  /**
   * Solves an approximate minimum-curvature racing line by iteratively pulling
   * each station toward the midpoint of its neighbours while clamping inside a
   * safety margin of the track edges. Cheap, stable and produces a line that
   * uses the full width through corners and straightens the exits.
   */
  private solveRacingLine(): Float32Array {
    const n = this.points.length;
    const offsets = new Float32Array(n);
    const next = new Float32Array(n);
    const margin = 1.5;

    const px = (i: number, o: Float32Array) => {
      const p = this.point(i);
      return p.x + p.nx * o[((i % n) + n) % n];
    };
    const pz = (i: number, o: Float32Array) => {
      const p = this.point(i);
      return p.z + p.nz * o[((i % n) + n) % n];
    };

    for (let iter = 0; iter < 260; iter++) {
      for (let i = 0; i < n; i++) {
        const prevI = (i - 1 + n) % n;
        const nextI = (i + 1) % n;
        const p = this.point(i);
        // Midpoint of the neighbours projected onto the local normal gives the
        // lateral offset that would straighten this station.
        const mx = (px(prevI, offsets) + px(nextI, offsets)) * 0.5;
        const mz = (pz(prevI, offsets) + pz(nextI, offsets)) * 0.5;
        const target = (mx - p.x) * p.nx + (mz - p.z) * p.nz;
        const limit = Math.max(0.2, p.halfWidth - margin);
        next[i] = clamp(lerp(offsets[i], target, 0.42), -limit, limit);
      }
      offsets.set(next);
    }

    return offsets;
  }

  /** Racing-line world position at a station. */
  racingPoint(index: number): { x: number; z: number } {
    const n = this.points.length;
    const i = ((index % n) + n) % n;
    const p = this.points[i];
    const o = this.racingLine[i];
    return { x: p.x + p.nx * o, z: p.z + p.nz * o };
  }

  /**
   * Starting grid slots: staggered pairs behind the start/finish line,
   * returned in grid order (pole first).
   */
  startGrid(count: number): Array<{ x: number; z: number; heading: number }> {
    const out: Array<{ x: number; z: number; heading: number }> = [];
    const rowGap = 7.5;
    const lateral = Math.min(3.2, this.points[0].halfWidth * 0.45);
    for (let i = 0; i < count; i++) {
      const row = Math.floor(i / 2);
      const side = i % 2 === 0 ? 1 : -1;
      const back = 10 + row * rowGap;
      const idx = Math.round(-back / this.step);
      const p = this.point(idx);
      out.push({
        x: p.x + p.nx * lateral * side,
        z: p.z + p.nz * lateral * side,
        heading: Math.atan2(p.tz, p.tx),
      });
    }
    return out;
  }

  /** Number of corners above a curvature threshold - shown on the track card. */
  countCorners(threshold = 0.022): number {
    const n = this.points.length;
    let corners = 0;
    let inCorner = false;
    for (let i = 0; i < n; i++) {
      const k = Math.abs(this.points[i].curvature);
      if (!inCorner && k > threshold) {
        inCorner = true;
        corners++;
      } else if (inCorner && k < threshold * 0.55) {
        inCorner = false;
      }
    }
    return corners;
  }
}

const angleIndexDelta = (a: number, b: number, n: number): number => {
  let d = (a - b) % n;
  if (d > n / 2) d -= n;
  if (d < -n / 2) d += n;
  return d;
};

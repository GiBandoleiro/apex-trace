/**
 * Builds the 3D circuit: asphalt ribbon, painted edges, curbs, runoff aprons,
 * displaced terrain, barriers and the trackside environment.
 *
 * Everything repeated (trees, posts, banners, tyre stacks, buildings) goes
 * through InstancedMesh so a dense-looking world still costs only a handful of
 * draw calls, which is what keeps this at 60fps on a phone.
 */

import * as THREE from 'three';
import type { AssetLibrary, SurfaceId } from '@/assets/AssetLibrary';
import type { TrackDefinition, TrackTheme } from './types';
import { TrackGeometry } from './TrackGeometry';
import { clamp01, makeRng, randRange } from '@/utils/math';
import type { QualityProfile } from '@/systems/quality';

export interface TrackScene {
  group: THREE.Group;
  /** Emissive light sources placed for night circuits. */
  lights: THREE.Object3D[];
  dispose(): void;
}

const RUNOFF_WIDTH = 13.5;

/**
 * How far the surrounding land sits below the track platform, in metres.
 * Large enough that terrain tessellation can never z-fight or clip through the
 * racing surface, small enough to read as a kerbed venue rather than a mesa.
 */
const TERRAIN_DROP = 0.85;

const CURB_MATERIAL: Record<TrackDefinition['curbStyle'], SurfaceId> = {
  red: 'curbRed',
  blue: 'curbBlue',
  yellow: 'curbYellow',
};

const RUNOFF_MATERIAL: Record<TrackDefinition['runoff'], SurfaceId> = {
  gravel: 'gravel',
  grass: 'grass',
  concrete: 'concrete',
  sand: 'sand',
  snow: 'snow',
  basalt: 'basalt',
};

/** What lines the edge of the road for the whole lap, corners aside. */
const VERGE_MATERIAL: Record<TrackTheme, SurfaceId> = {
  city: 'concrete',
  coast: 'grass',
  desert: 'sand',
  alpine: 'grass',
  forest: 'grass',
  nightCity: 'concrete',
  industrial: 'concrete',
  grand: 'grass',
  winter: 'snow',
  volcanic: 'basalt',
};

const TERRAIN_MATERIAL: Record<TrackTheme, SurfaceId> = {
  city: 'concrete',
  coast: 'grass',
  desert: 'sand',
  alpine: 'grass',
  forest: 'grass',
  nightCity: 'concrete',
  industrial: 'concrete',
  grand: 'grass',
  winter: 'snow',
  volcanic: 'basalt',
};

/* ------------------------------------------------------------------ */
/* Ribbon helper                                                       */
/* ------------------------------------------------------------------ */

interface RibbonOptions {
  inner: (i: number) => number;
  outer: (i: number) => number;
  y: (i: number) => number;
  /** Height of the outer edge; defaults to `y`. Used to build embankments. */
  yOuter?: (i: number) => number;
  /** UV scale along the track (metres per tile). */
  vScale: number;
  /** UV scale across the track (metres per tile). */
  uScale: number;
  /** Swap the UV axes - used by curbs whose bands run along the strip. */
  swapUV?: boolean;
  /** Divisions across the strip. >1 enables per-vertex detail like the
   *  rubbered-in racing line. */
  crossSegments?: number;
}

const buildRibbon = (
  geo: TrackGeometry,
  stations: number[],
  closed: boolean,
  opts: RibbonOptions,
): THREE.BufferGeometry => {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const cross = Math.max(1, Math.round(opts.crossSegments ?? 1));
  const perStation = cross + 1;

  for (let k = 0; k < stations.length; k++) {
    const i = stations[k];
    const p = geo.point(i);
    let io = opts.inner(i);
    let oo = opts.outer(i);
    let yi = opts.y(i);
    let yo = opts.yOuter ? opts.yOuter(i) : yi;

    // Always emit from the smaller lateral offset to the larger one. Strips
    // built on the right-hand side of the track (where `outer` is more
    // negative than `inner`) would otherwise come out with reversed winding
    // and be discarded by backface culling.
    if (oo < io) {
      const to = io;
      io = oo;
      oo = to;
      const ty = yi;
      yi = yo;
      yo = ty;
    }

    const v = p.s / opts.vScale;
    for (let j = 0; j <= cross; j++) {
      const t = j / cross;
      const off = io + (oo - io) * t;
      const yy = yi + (yo - yi) * t;
      positions.push(p.x + p.nx * off, p.y + yy, p.z + p.nz * off);
      const u = off / opts.uScale;
      if (opts.swapUV) uvs.push(v, u);
      else uvs.push(u, v);
    }
  }

  const count = stations.length;
  const limit = closed ? count : count - 1;
  for (let k = 0; k < limit; k++) {
    const rowA = (k % count) * perStation;
    const rowB = ((k + 1) % count) * perStation;
    for (let j = 0; j < cross; j++) {
      const a = rowA + j;
      const b = a + 1;
      const c = rowB + j;
      const dIdx = c + 1;
      // Counter-clockwise seen from above, so the surface normal points at the
      // sky and the ribbon is lit and visible.
      indices.push(a, b, c, b, dIdx, c);
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute('uv2', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
};

/** Contiguous runs of stations where `test` holds, on a closed loop. */
const findRuns = (n: number, test: (i: number) => boolean, minLength = 4): number[][] => {
  const flags: boolean[] = [];
  for (let i = 0; i < n; i++) flags.push(test(i));

  const runs: number[][] = [];
  let start = -1;
  // Rotate so we never split a run across the wrap point.
  let offset = 0;
  while (offset < n && flags[offset]) offset++;
  if (offset === n) return [Array.from({ length: n }, (_, i) => i)];

  for (let k = 0; k <= n; k++) {
    const i = (offset + k) % n;
    const on = k < n ? flags[i] : false;
    if (on && start < 0) start = k;
    else if (!on && start >= 0) {
      if (k - start >= minLength) {
        runs.push(Array.from({ length: k - start }, (_, j) => (offset + start + j) % n));
      }
      start = -1;
    }
  }
  return runs;
};

/* ------------------------------------------------------------------ */
/* Sponsor banner texture                                              */
/* ------------------------------------------------------------------ */

const FICTIONAL_BRANDS = [
  'APEX FUEL', 'NOVAGRIP', 'HALDEN TYRES', 'ORLO', 'VANTIS',
  'KAROS OIL', 'TERRANOVA', 'DRIVELINE', 'ZENITH AERO', 'PULSE ENERGY',
  'MERIDIAN', 'NORVIK', 'CIRCUITO', 'AERIN RACING', 'STRATA',
];

const bannerTexture = (seed: number): THREE.CanvasTexture => {
  const w = 1024;
  const h = 128;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const rng = makeRng(seed);

  const panels = 6;
  const colors = ['#1d4ed8', '#dc2626', '#0f766e', '#ca8a04', '#111827', '#e5e7eb', '#7c3aed'];
  for (let i = 0; i < panels; i++) {
    const c = colors[Math.floor(rng() * colors.length)];
    ctx.fillStyle = c;
    ctx.fillRect((i * w) / panels, 0, w / panels, h);
    const brand = FICTIONAL_BRANDS[Math.floor(rng() * FICTIONAL_BRANDS.length)];
    ctx.fillStyle = c === '#e5e7eb' ? '#111827' : '#f8fafc';
    ctx.font = 'bold 42px "Barlow Condensed", Impact, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(brand, (i * w) / panels + w / panels / 2, h / 2);
  }
  // Grime so the boards do not look like flat UI.
  ctx.fillStyle = 'rgba(0,0,0,0.16)';
  for (let i = 0; i < 260; i++) {
    ctx.fillRect(rng() * w, rng() * h, rng() * 30, rng() * 3);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
};

const startLineTexture = (): THREE.CanvasTexture => {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#e8eaee';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#15171c';
  const cells = 8;
  const cs = size / cells;
  for (let y = 0; y < cells; y++) {
    for (let x = 0; x < cells; x++) {
      if ((x + y) % 2 === 0) ctx.fillRect(x * cs, y * cs, cs, cs);
    }
  }
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  for (let i = 0; i < 400; i++) {
    ctx.fillRect(Math.random() * size, Math.random() * size, 2, 2);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
};

/* ------------------------------------------------------------------ */
/* Builder                                                             */
/* ------------------------------------------------------------------ */

export const buildTrackScene = (
  geo: TrackGeometry,
  def: TrackDefinition,
  assets: AssetLibrary,
  quality: QualityProfile,
): TrackScene => {
  const group = new THREE.Group();
  group.name = `track:${def.id}`;
  const disposables: Array<{ dispose: () => void }> = [];
  const lights: THREE.Object3D[] = [];
  const rng = makeRng(def.seed);
  const n = geo.sampleCount;
  const all = Array.from({ length: n }, (_, i) => i);

  const track = (o: THREE.Object3D) => {
    group.add(o);
  };

  /* --- 1. Terrain ------------------------------------------------- */
  const terrainMat = assets.makeSurface(TERRAIN_MATERIAL[def.theme], [1, 1]);
  terrainMat.color = new THREE.Color(def.palette.terrainTint);
  disposables.push(terrainMat);

  const b = geo.bounds;
  const pad = 340;
  const minX = b.minX - pad;
  const maxX = b.maxX + pad;
  const minZ = b.minZ - pad;
  const maxZ = b.maxZ + pad;

  // Vertex spacing has to stay fine enough that the interpolated terrain can
  // never poke up through the track ribbon. Segment count therefore follows
  // the actual world size rather than being a fixed number.
  const spacing = quality.environmentDetail >= 2 ? 11 : 18;
  const gridX = Math.min(180, Math.max(32, Math.round((maxX - minX) / spacing)));
  const gridZ = Math.min(180, Math.max(32, Math.round((maxZ - minZ) / spacing)));

  const terrainGeo = new THREE.PlaneGeometry(maxX - minX, maxZ - minZ, gridX, gridZ);
  terrainGeo.rotateX(-Math.PI / 2);
  terrainGeo.translate((minX + maxX) / 2, 0, (minZ + maxZ) / 2);
  {
    const pos = terrainGeo.attributes.position as THREE.BufferAttribute;
    const uv = terrainGeo.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const proj = geo.project(x, z);
      const p = geo.point(proj.index);
      const dist = Math.abs(proj.lateral) - proj.halfWidth - RUNOFF_WIDTH;
      // Flat and clearly below the circuit nearby, rolling further out. The
      // track platform sits proud of the surrounding land, like a real venue.
      const away = clamp01((dist - 24) / 120);
      const rolling =
        Math.sin(x * 0.012 + def.seed) * 3.2 + Math.cos(z * 0.0095 - def.seed * 0.7) * 2.6;
      pos.setY(i, p.y - TERRAIN_DROP + rolling * away * away);
      uv.setXY(i, x / 7, z / 7);
    }
    terrainGeo.computeVertexNormals();
    terrainGeo.setAttribute('uv2', uv.clone());
  }
  disposables.push(terrainGeo);
  const terrain = new THREE.Mesh(terrainGeo, terrainMat);
  terrain.receiveShadow = quality.shadows;
  terrain.name = 'terrain';
  track(terrain);
  // A distant flat extension keeps portrait overview cameras on land.
  const horizonGeo = new THREE.PlaneGeometry(maxX - minX + 4000, maxZ - minZ + 4000);
  horizonGeo.rotateX(-Math.PI / 2);
  horizonGeo.translate((minX + maxX) / 2, -8, (minZ + maxZ) / 2);
  {
    const uv = horizonGeo.attributes.uv as THREE.BufferAttribute;
    const pos = horizonGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / 7, pos.getZ(i) / 7);
  }
  disposables.push(horizonGeo);
  const horizon = new THREE.Mesh(horizonGeo, terrainMat);
  horizon.name = 'distant terrain';
  track(horizon);

  /* --- 2. Verge, run-off traps and embankment ---------------------- */
  // The whole lap gets a verge in the local ground material; the authored
  // trap (gravel, sand, snow...) only appears at corners, which is where cars
  // actually go off. `TrackGeometry.cornerRunoff` drives both this mesh and
  // the grip model, so what you see is what you drive on.
  const vergeId = VERGE_MATERIAL[def.theme];
  const vergeMat = assets.makeSurface(vergeId, [1, 1]);
  vergeMat.color = new THREE.Color(def.palette.terrainTint);
  disposables.push(vergeMat);

  const runoffMat = assets.makeSurface(RUNOFF_MATERIAL[def.runoff], [1, 1], {
    // The trap sits on top of the verge; a depth bias keeps the two from
    // fighting over the same pixels at grazing angles.
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  });
  disposables.push(runoffMat);

  for (const side of [-1, 1]) {
    const verge = buildRibbon(geo, all, true, {
      inner: (i) => side * geo.point(i).halfWidth,
      outer: (i) => side * (geo.point(i).halfWidth + RUNOFF_WIDTH),
      y: () => 0.02,
      vScale: 10,
      uScale: 10,
    });
    disposables.push(verge);
    const vergeMesh = new THREE.Mesh(verge, vergeMat);
    vergeMesh.receiveShadow = quality.shadows;
    vergeMesh.name = `verge:${side}`;
    track(vergeMesh);

    // Sloped embankment closing the gap down to the surrounding land.
    const skirt = buildRibbon(geo, all, true, {
      inner: (i) => side * (geo.point(i).halfWidth + RUNOFF_WIDTH),
      outer: (i) => side * (geo.point(i).halfWidth + RUNOFF_WIDTH + 5),
      y: () => 0.02,
      yOuter: () => 0.02 - TERRAIN_DROP,
      vScale: 10,
      uScale: 10,
    });
    disposables.push(skirt);
    const skirtMesh = new THREE.Mesh(skirt, vergeMat);
    skirtMesh.receiveShadow = quality.shadows;
    track(skirtMesh);
  }

  if (vergeId !== RUNOFF_MATERIAL[def.runoff]) {
    const trapRuns = findRuns(n, (i) => geo.cornerRunoff[i] === 1, 6);
    for (const run of trapRuns) {
      for (const side of [-1, 1]) {
        const g = buildRibbon(geo, run, false, {
          inner: (i) => side * (geo.point(i).halfWidth + 1.4),
          outer: (i) => side * (geo.point(i).halfWidth + RUNOFF_WIDTH),
          y: () => 0.055,
          vScale: 10,
          uScale: 10,
        });
        disposables.push(g);
        const mesh = new THREE.Mesh(g, runoffMat);
        mesh.receiveShadow = quality.shadows;
        mesh.name = `trap:${side}`;
        track(mesh);
      }
    }
  }

  /* --- 3. Asphalt -------------------------------------------------- */
  const asphaltMat = assets.makeSurface('asphalt', [1, 1], {
    roughness: 0.94,
    vertexColors: true,
  });
  if (def.weather === 'rain' || def.timeOfDay === 'night') {
    // Damp/lit asphalt reflects far more - this is what sells a night circuit.
    asphaltMat.roughness = 0.52;
    asphaltMat.metalness = 0.12;
    asphaltMat.envMapIntensity = 1.5;
  }
  disposables.push(asphaltMat);

  const ASPHALT_CROSS = 10;
  const asphaltGeo = buildRibbon(geo, all, true, {
    inner: (i) => -geo.point(i).halfWidth - 0.3,
    outer: (i) => geo.point(i).halfWidth + 0.3,
    y: () => 0.03,
    vScale: 8,
    uScale: 8,
    crossSegments: ASPHALT_CROSS,
  });
  // Rubbered-in racing line: darken the band the field actually uses. Painted
  // per-vertex so it follows the solved line instead of tiling with the texture.
  {
    const pos = asphaltGeo.attributes.position as THREE.BufferAttribute;
    const perStation = ASPHALT_CROSS + 1;
    const colors = new Float32Array(pos.count * 3);
    for (let v = 0; v < pos.count; v++) {
      const station = Math.floor(v / perStation) % n;
      const j = v % perStation;
      const hw = geo.point(station).halfWidth + 0.3;
      const lateral = -hw + (2 * hw * j) / ASPHALT_CROSS;
      const d = Math.abs(lateral - geo.racingLine[station]);
      const rubber = clamp01(1 - d / 4.2);
      // A little extra grime right at the edges, where nobody drives.
      const edge = clamp01((Math.abs(lateral) - hw * 0.72) / (hw * 0.28));
      const shade = 1 - rubber * 0.3 + edge * 0.07;
      colors[v * 3] = shade;
      colors[v * 3 + 1] = shade;
      colors[v * 3 + 2] = shade * 1.01;
    }
    asphaltGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  }
  disposables.push(asphaltGeo);
  const asphalt = new THREE.Mesh(asphaltGeo, asphaltMat);
  asphalt.receiveShadow = quality.shadows;
  asphalt.name = 'asphalt';
  track(asphalt);

  /* --- 4. Painted edge lines --------------------------------------- */
  const lineMat = new THREE.MeshStandardMaterial({
    // Worn track paint, not a light source: keep it rough and slightly grey so
    // it does not bloom out under a low sun.
    color: 0xb9bdc6,
    roughness: 0.88,
    metalness: 0,
    envMapIntensity: 0.35,
    envMap: assets.environment,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  disposables.push(lineMat);
  for (const side of [-1, 1]) {
    const g = buildRibbon(geo, all, true, {
      inner: (i) => side * (geo.point(i).halfWidth - 0.18),
      outer: (i) => side * (geo.point(i).halfWidth + 0.02),
      y: () => 0.038,
      vScale: 4,
      uScale: 1,
    });
    disposables.push(g);
    track(new THREE.Mesh(g, lineMat));
  }

  /* --- 5. Curbs ---------------------------------------------------- */
  const curbMat = assets.makeSurface(CURB_MATERIAL[def.curbStyle], [1, 1], {
    roughness: 0.5,
  });
  disposables.push(curbMat);

  const curbRuns = findRuns(n, (i) => Math.abs(geo.point(i).curvature) > 0.011, 6);
  for (const run of curbRuns) {
    // Inside of the corner always gets a curb.
    const insideSign = Math.sign(geo.point(run[Math.floor(run.length / 2)]).curvature) || 1;
    const fade = (k: number) => {
      const t = k / Math.max(1, run.length - 1);
      return Math.min(1, Math.min(t, 1 - t) * 6);
    };
    const inner = buildRibbon(geo, run, false, {
      inner: (i) => insideSign * (geo.point(i).halfWidth + 0.02),
      outer: (i) => insideSign * (geo.point(i).halfWidth + 1.25),
      y: (i) => 0.042 + 0.03 * fade(run.indexOf(i)),
      vScale: 3.4,
      uScale: 1.25,
      swapUV: true,
    });
    disposables.push(inner);
    const m = new THREE.Mesh(inner, curbMat);
    m.receiveShadow = quality.shadows;
    track(m);

    // Faster corners also get an exit curb on the outside.
    const strength = Math.abs(geo.point(run[Math.floor(run.length / 2)]).curvature);
    if (strength > 0.024) {
      const exit = run.slice(Math.floor(run.length * 0.45));
      if (exit.length > 4) {
        const outer = buildRibbon(geo, exit, false, {
          inner: (i) => -insideSign * (geo.point(i).halfWidth + 0.02),
          outer: (i) => -insideSign * (geo.point(i).halfWidth + 1.15),
          y: () => 0.042,
          vScale: 3.4,
          uScale: 1.15,
          swapUV: true,
        });
        disposables.push(outer);
        const om = new THREE.Mesh(outer, curbMat);
        om.receiveShadow = quality.shadows;
        track(om);
      }
    }
  }

  /* --- 6. Start / finish line and grid boxes ----------------------- */
  {
    const tex = startLineTexture();
    disposables.push(tex);
    tex.repeat.set(1, 6);
    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      roughness: 0.85,
      metalness: 0,
      envMapIntensity: 0.35,
      envMap: assets.environment,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
    });
    disposables.push(mat);
    const span = Array.from({ length: 3 }, (_, k) => (k - 1 + n) % n);
    const g = buildRibbon(geo, span, false, {
      inner: (i) => -geo.point(i).halfWidth,
      outer: (i) => geo.point(i).halfWidth,
      y: () => 0.04,
      vScale: 2,
      uScale: 3,
    });
    disposables.push(g);
    track(new THREE.Mesh(g, mat));

    // Painted grid boxes behind the line.
    const gridMat = new THREE.MeshStandardMaterial({
      color: 0xb9bdc6,
      roughness: 0.88,
      envMapIntensity: 0.35,
      transparent: true,
      opacity: 0.72,
      envMap: assets.environment,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    disposables.push(gridMat);
    const slots = geo.startGrid(12);
    const boxGeo = new THREE.PlaneGeometry(2.6, 5);
    disposables.push(boxGeo);
    for (const slot of slots) {
      const m = new THREE.Mesh(boxGeo, gridMat);
      m.rotation.x = -Math.PI / 2;
      m.rotation.z = -slot.heading + Math.PI / 2;
      m.position.set(slot.x, 0.041, slot.z);
      track(m);
    }
  }

  /* --- 7. Barriers -------------------------------------------------- */
  const metalMat = assets.makeSurface('metal', [4, 1], { metalness: 0.85, roughness: 0.4 });
  disposables.push(metalMat);

  {
    const railGeo = new THREE.BoxGeometry(1, 0.62, 0.12);
    disposables.push(railGeo);
    const postGeo = new THREE.BoxGeometry(0.12, 1.0, 0.12);
    disposables.push(postGeo);

    const step = Math.max(2, Math.round(6 / geo.step));
    const segments: Array<{ x: number; z: number; y: number; len: number; rot: number }> = [];
    for (const side of [-1, 1]) {
      for (let i = 0; i < n; i += step) {
        const a = geo.point(i);
        const bPt = geo.point(i + step);
        const off = side * (a.halfWidth + RUNOFF_WIDTH + 0.6);
        const offB = side * (bPt.halfWidth + RUNOFF_WIDTH + 0.6);
        const ax = a.x + a.nx * off;
        const az = a.z + a.nz * off;
        const bx = bPt.x + bPt.nx * offB;
        const bz = bPt.z + bPt.nz * offB;
        const len = Math.hypot(bx - ax, bz - az);
        segments.push({
          x: (ax + bx) / 2,
          z: (az + bz) / 2,
          y: a.y,
          len,
          rot: Math.atan2(bz - az, bx - ax),
        });
      }
    }

    const rails = new THREE.InstancedMesh(railGeo, metalMat, segments.length);
    const posts = new THREE.InstancedMesh(postGeo, metalMat, segments.length);
    rails.castShadow = quality.shadows;
    rails.receiveShadow = quality.shadows;
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const euler = new THREE.Euler();
    segments.forEach((s, i) => {
      euler.set(0, -s.rot, 0);
      q.setFromEuler(euler);
      m4.compose(
        new THREE.Vector3(s.x, s.y + 0.62, s.z),
        q,
        new THREE.Vector3(s.len * 1.02, 1, 1),
      );
      rails.setMatrixAt(i, m4);
      m4.compose(new THREE.Vector3(s.x, s.y + 0.5, s.z), q, new THREE.Vector3(1, 1, 1));
      posts.setMatrixAt(i, m4);
    });
    rails.instanceMatrix.needsUpdate = true;
    posts.instanceMatrix.needsUpdate = true;
    track(rails);
    track(posts);
    disposables.push(rails, posts);
  }

  /* --- 8. Tyre barriers at the quickest corners --------------------- */
  {
    const tyreGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.34, 10);
    disposables.push(tyreGeo);
    const tyreMat = new THREE.MeshStandardMaterial({
      color: 0x15161a,
      roughness: 0.95,
      metalness: 0,
      envMap: assets.environment,
    });
    disposables.push(tyreMat);

    const spots: THREE.Matrix4[] = [];
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < n; i += 2) {
      const p = geo.point(i);
      if (Math.abs(p.curvature) < 0.02) continue;
      const side = -Math.sign(p.curvature) || 1;
      const off = side * (p.halfWidth + RUNOFF_WIDTH - 0.6);
      for (let layer = 0; layer < 2; layer++) {
        for (let stack = 0; stack < 2; stack++) {
          m4.makeTranslation(
            p.x + p.nx * (off - side * layer * 0.85) + p.tx * (layer * 0.1),
            p.y + 0.17 + stack * 0.34,
            p.z + p.nz * (off - side * layer * 0.85) + p.tz * (layer * 0.1),
          );
          spots.push(m4.clone());
        }
      }
    }
    if (spots.length > 0) {
      const stacks = new THREE.InstancedMesh(tyreGeo, tyreMat, spots.length);
      stacks.castShadow = quality.shadows;
      spots.forEach((m, i) => stacks.setMatrixAt(i, m));
      stacks.instanceMatrix.needsUpdate = true;
      track(stacks);
      disposables.push(stacks);
    }
  }

  /* --- 9. Advertising boards --------------------------------------- */
  {
    const tex = bannerTexture(def.seed);
    disposables.push(tex);
    tex.repeat.set(3, 1);
    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      roughness: 0.62,
      metalness: 0.05,
      side: THREE.DoubleSide,
      envMap: assets.environment,
    });
    disposables.push(mat);
    const geoBoard = new THREE.PlaneGeometry(1, 1.05);
    disposables.push(geoBoard);

    const step = Math.max(4, Math.round(14 / geo.step));
    const mats: THREE.Matrix4[] = [];
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const euler = new THREE.Euler();
    for (const side of [-1, 1]) {
      for (let i = 0; i < n; i += step) {
        if (rng() < 0.3) continue;
        const a = geo.point(i);
        const bPt = geo.point(i + step);
        const off = side * (a.halfWidth + RUNOFF_WIDTH + 0.8);
        const ax = a.x + a.nx * off;
        const az = a.z + a.nz * off;
        const bx = bPt.x + bPt.nx * off;
        const bz = bPt.z + bPt.nz * off;
        const len = Math.hypot(bx - ax, bz - az);
        euler.set(0, -Math.atan2(bz - az, bx - ax), 0);
        q.setFromEuler(euler);
        m4.compose(
          new THREE.Vector3((ax + bx) / 2, a.y + 0.95, (az + bz) / 2),
          q,
          new THREE.Vector3(len, 1, 1),
        );
        mats.push(m4.clone());
      }
    }
    const boards = new THREE.InstancedMesh(geoBoard, mat, mats.length);
    boards.receiveShadow = quality.shadows;
    mats.forEach((m, i) => boards.setMatrixAt(i, m));
    boards.instanceMatrix.needsUpdate = true;
    track(boards);
    disposables.push(boards);
  }

  /* --- 10. Environment props --------------------------------------- */
  if (quality.environmentDetail >= 1) {
    buildEnvironment(geo, def, group, disposables, lights, rng, quality, assets);
  }

  /* --- 11. Start gantry and pit structures -------------------------- */
  buildStartStructures(geo, def, group, disposables, quality, assets);

  return {
    group,
    lights,
    dispose() {
      for (const d of disposables) d.dispose();
      group.clear();
    },
  };
};

/* ------------------------------------------------------------------ */
/* Environment                                                         */
/* ------------------------------------------------------------------ */

interface PropPlacement {
  x: number;
  z: number;
  y: number;
  scale: number;
  rot: number;
}

const buildEnvironment = (
  geo: TrackGeometry,
  def: TrackDefinition,
  group: THREE.Group,
  disposables: Array<{ dispose: () => void }>,
  lights: THREE.Object3D[],
  rng: () => number,
  quality: QualityProfile,
  assets: AssetLibrary,
): void => {
  const n = geo.sampleCount;
  const density = quality.environmentDetail === 3 ? 1 : quality.environmentDetail === 2 ? 0.6 : 0.3;

  /** Candidate positions in the band just outside the barriers. */
  const scatter = (
    count: number,
    minDist: number,
    maxDist: number,
  ): PropPlacement[] => {
    const out: PropPlacement[] = [];
    const target = Math.round(count * density);
    let guard = 0;
    while (out.length < target && guard < target * 12) {
      guard++;
      const i = Math.floor(rng() * n);
      const p = geo.point(i);
      const side = rng() < 0.5 ? -1 : 1;
      const dist = p.halfWidth + RUNOFF_WIDTH + randRange(rng, minDist, maxDist);
      out.push({
        x: p.x + p.nx * side * dist,
        z: p.z + p.nz * side * dist,
        y: p.y,
        scale: randRange(rng, 0.8, 1.3),
        rot: rng() * Math.PI * 2,
      });
    }
    return out;
  };

  const addInstanced = (
    geoSrc: THREE.BufferGeometry,
    mat: THREE.Material,
    placements: PropPlacement[],
    yOffset = 0,
    castShadow = true,
  ): void => {
    if (placements.length === 0) return;
    const mesh = new THREE.InstancedMesh(geoSrc, mat, placements.length);
    mesh.castShadow = castShadow && quality.shadows;
    mesh.receiveShadow = quality.shadows;
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    placements.forEach((p, i) => {
      e.set(0, p.rot, 0);
      q.setFromEuler(e);
      m4.compose(
        new THREE.Vector3(p.x, p.y + yOffset * p.scale, p.z),
        q,
        new THREE.Vector3(p.scale, p.scale, p.scale),
      );
      mesh.setMatrixAt(i, m4);
    });
    mesh.instanceMatrix.needsUpdate = true;
    group.add(mesh);
    disposables.push(mesh, geoSrc, mat);
  };

  const env = assets.environment;
  const theme = def.theme;

  /* Trees --------------------------------------------------------- */
  if (theme === 'forest' || theme === 'alpine' || theme === 'coast' || theme === 'grand') {
    const conifer = theme === 'alpine' || theme === 'forest';
    const trunkGeo = new THREE.CylinderGeometry(0.16, 0.24, 2.4, 6);
    const trunkMat = new THREE.MeshStandardMaterial({
      color: 0x3a2b20,
      roughness: 0.95,
      envMap: env,
    });
    const canopyGeo = conifer
      ? new THREE.ConeGeometry(1.5, 5.2, 8)
      : new THREE.SphereGeometry(1.9, 8, 6);
    const canopyMat = new THREE.MeshStandardMaterial({
      color: conifer ? 0x1f3b26 : 0x2c5330,
      roughness: 0.92,
      flatShading: true,
      envMap: env,
    });
    const trees = scatter(theme === 'forest' ? 320 : 180, 4, 90);
    addInstanced(trunkGeo, trunkMat, trees, 1.2);
    addInstanced(canopyGeo, canopyMat, trees, conifer ? 4.4 : 3.4);
  }

  /* Buildings ----------------------------------------------------- */
  if (theme === 'city' || theme === 'nightCity' || theme === 'industrial') {
    const buildGeo = new THREE.BoxGeometry(1, 1, 1);
    const facade = new THREE.MeshStandardMaterial({
      color: theme === 'nightCity' ? 0x232a3a : 0x5a5f68,
      roughness: 0.76,
      metalness: 0.12,
      envMap: env,
    });
    const placements = scatter(theme === 'industrial' ? 90 : 150, 8, 120).map((p) => ({
      ...p,
      scale: randRange(rng, 8, theme === 'industrial' ? 16 : 30),
    }));
    // Non-uniform building masses.
    const mesh = new THREE.InstancedMesh(buildGeo, facade, placements.length);
    mesh.castShadow = quality.shadows;
    mesh.receiveShadow = quality.shadows;
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    placements.forEach((p, i) => {
      const w = randRange(rng, 8, 20);
      const d = randRange(rng, 8, 20);
      const h = p.scale;
      e.set(0, p.rot, 0);
      q.setFromEuler(e);
      m4.compose(new THREE.Vector3(p.x, p.y + h / 2, p.z), q, new THREE.Vector3(w, h, d));
      mesh.setMatrixAt(i, m4);
    });
    mesh.instanceMatrix.needsUpdate = true;
    group.add(mesh);
    disposables.push(mesh, buildGeo, facade);
  }

  /* Desert rocks / volcanic spires -------------------------------- */
  if (theme === 'desert' || theme === 'volcanic') {
    const rockGeo = new THREE.DodecahedronGeometry(1.6, 0);
    const rockMat = new THREE.MeshStandardMaterial({
      color: theme === 'desert' ? 0x9a7c52 : 0x2a2124,
      roughness: 0.95,
      flatShading: true,
      envMap: env,
    });
    const rocks = scatter(200, 4, 110).map((p) => ({ ...p, scale: randRange(rng, 0.6, 3.4) }));
    addInstanced(rockGeo, rockMat, rocks, 0.8);
  }

  /* Winter: snow-laden firs ---------------------------------------- */
  if (theme === 'winter') {
    const firGeo = new THREE.ConeGeometry(1.4, 4.8, 7);
    const firMat = new THREE.MeshStandardMaterial({
      color: 0x2a4034,
      roughness: 0.9,
      flatShading: true,
      envMap: env,
    });
    const capGeo = new THREE.ConeGeometry(1.0, 1.6, 7);
    const capMat = new THREE.MeshStandardMaterial({
      color: 0xdfe8f0,
      roughness: 0.7,
      envMap: env,
    });
    const firs = scatter(220, 4, 100);
    addInstanced(firGeo, firMat, firs, 2.4);
    addInstanced(capGeo, capMat, firs, 4.4);
  }

  /* Grandstands near the start straight ---------------------------- */
  {
    const standGeo = new THREE.BoxGeometry(26, 7, 11);
    const standMat = new THREE.MeshStandardMaterial({
      color: 0x8b93a2,
      roughness: 0.82,
      envMap: env,
    });
    const seatGeo = new THREE.BoxGeometry(25, 0.5, 9.4);
    const seatMat = new THREE.MeshStandardMaterial({
      color: 0x4d6a9e,
      roughness: 0.88,
      envMap: env,
    });
    const placements: PropPlacement[] = [];
    const seats: PropPlacement[] = [];
    const roofs: PropPlacement[] = [];
    // Along the start/finish straight, always on the spectator side.
    const stride = Math.max(6, Math.round(30 / geo.step));
    for (let k = 0; k < 4; k++) {
      const i = (n - stride + k * stride) % n;
      const p = geo.point(i);
      const side = geo.outsideSign;
      const dist = p.halfWidth + RUNOFF_WIDTH + 9;
      const rot = -Math.atan2(p.tz, p.tx);
      const at = (d: number): PropPlacement => ({
        x: p.x + p.nx * side * d,
        z: p.z + p.nz * side * d,
        y: p.y,
        scale: 1,
        rot,
      });
      placements.push(at(dist));
      seats.push(at(dist - 1.2));
      // The roof is pushed back so the seating deck still reads from above.
      roofs.push(at(dist + 2.4));
    }
    addInstanced(standGeo, standMat, placements, 3.5);
    addInstanced(seatGeo, seatMat, seats, 7.3);

    const roofGeo = new THREE.BoxGeometry(27, 0.4, 8);
    const roofMat = new THREE.MeshStandardMaterial({
      color: 0xc9cfd8,
      roughness: 0.42,
      metalness: 0.55,
      envMap: env,
    });
    addInstanced(roofGeo, roofMat, roofs, 11.4);
  }

  /* Floodlights ---------------------------------------------------- */
  if (def.timeOfDay === 'night' || quality.environmentDetail === 3) {
    const poleGeo = new THREE.CylinderGeometry(0.18, 0.26, 12, 6);
    const poleMat = new THREE.MeshStandardMaterial({
      color: 0x5c6270,
      roughness: 0.5,
      metalness: 0.7,
      envMap: env,
    });
    const headGeo = new THREE.BoxGeometry(2.6, 0.7, 0.5);
    const headMat = new THREE.MeshStandardMaterial({
      color: 0x20242c,
      emissive: new THREE.Color(0xfff2d0),
      emissiveIntensity: def.timeOfDay === 'night' ? 2.6 : 0.05,
      roughness: 0.3,
      envMap: env,
    });

    const poles: PropPlacement[] = [];
    const step = Math.max(6, Math.round(58 / geo.step));
    for (let i = 0; i < n; i += step) {
      const p = geo.point(i);
      const side = (i / step) % 2 === 0 ? 1 : -1;
      const dist = p.halfWidth + RUNOFF_WIDTH + 3.5;
      poles.push({
        x: p.x + p.nx * side * dist,
        z: p.z + p.nz * side * dist,
        y: p.y,
        scale: 1,
        rot: -Math.atan2(p.tz, p.tx),
      });
    }
    addInstanced(poleGeo, poleMat, poles, 6);
    addInstanced(headGeo, headMat, poles, 12.2, false);

    if (def.timeOfDay === 'night') {
      // A handful of real point lights, kept low for performance.
      const budget = quality.environmentDetail === 3 ? 6 : 3;
      for (let k = 0; k < Math.min(budget, poles.length); k++) {
        const p = poles[Math.floor((k * poles.length) / budget)];
        const light = new THREE.PointLight(0xffe9c4, 34, 78, 2);
        light.position.set(p.x, p.y + 12, p.z);
        group.add(light);
        lights.push(light);
      }
    }
  }

  /* Service vehicles and containers --------------------------------- */
  if (quality.environmentDetail >= 2) {
    const truckGeo = new THREE.BoxGeometry(2.4, 2.6, 7);
    const truckMat = new THREE.MeshStandardMaterial({
      color: 0xb8493a,
      roughness: 0.7,
      metalness: 0.15,
      envMap: env,
    });
    addInstanced(truckGeo, truckMat, scatter(14, 3, 22), 1.3);

    const containerGeo = new THREE.BoxGeometry(2.6, 2.6, 6.2);
    const containerMat = new THREE.MeshStandardMaterial({
      color: 0x2f6f8a,
      roughness: 0.82,
      metalness: 0.2,
      envMap: env,
    });
    addInstanced(containerGeo, containerMat, scatter(20, 3, 30), 1.3);
  }
};

/* ------------------------------------------------------------------ */
/* Start / finish structures                                           */
/* ------------------------------------------------------------------ */

const buildStartStructures = (
  geo: TrackGeometry,
  def: TrackDefinition,
  group: THREE.Group,
  disposables: Array<{ dispose: () => void }>,
  quality: QualityProfile,
  assets: AssetLibrary,
): void => {
  const p = geo.point(0);
  const heading = Math.atan2(p.tz, p.tx);
  const env = assets.environment;

  const holder = new THREE.Group();
  holder.position.set(p.x, p.y, p.z);
  holder.rotation.y = -heading;

  const steel = new THREE.MeshStandardMaterial({
    color: 0x3c424e,
    roughness: 0.45,
    metalness: 0.8,
    envMap: env,
  });
  disposables.push(steel);

  const legGeo = new THREE.BoxGeometry(0.7, 8.5, 0.7);
  disposables.push(legGeo);
  for (const side of [-1, 1]) {
    const leg = new THREE.Mesh(legGeo, steel);
    leg.position.set(0, 4.25, side * (p.halfWidth + 2.4));
    leg.castShadow = quality.shadows;
    holder.add(leg);
  }

  const beamGeo = new THREE.BoxGeometry(1.6, 1.4, (p.halfWidth + 2.4) * 2);
  disposables.push(beamGeo);
  const beam = new THREE.Mesh(beamGeo, steel);
  beam.position.set(0, 8.6, 0);
  beam.castShadow = quality.shadows;
  holder.add(beam);

  // Start lights.
  const lightGeo = new THREE.SphereGeometry(0.26, 10, 8);
  disposables.push(lightGeo);
  const lightMat = new THREE.MeshStandardMaterial({
    color: 0x2a0a0a,
    emissive: new THREE.Color(0xff2a18),
    emissiveIntensity: 0.4,
    roughness: 0.3,
    envMap: env,
  });
  disposables.push(lightMat);
  for (let i = 0; i < 5; i++) {
    const l = new THREE.Mesh(lightGeo, lightMat);
    l.position.set(0.85, 8.6, (i - 2) * 1.5);
    holder.add(l);
  }

  // Pit building alongside the start straight.
  const pitGeo = new THREE.BoxGeometry(34, 6.5, 9);
  disposables.push(pitGeo);
  const pitMat = new THREE.MeshStandardMaterial({
    color: def.timeOfDay === 'night' ? 0x252b39 : 0x9aa1ad,
    roughness: 0.78,
    metalness: 0.1,
    envMap: env,
  });
  disposables.push(pitMat);
  const pit = new THREE.Mesh(pitGeo, pitMat);
  pit.position.set(16, 3.25, -(p.halfWidth + 10));
  pit.castShadow = quality.shadows;
  pit.receiveShadow = quality.shadows;
  holder.add(pit);

  // Race control tower.
  const towerGeo = new THREE.BoxGeometry(8, 15, 8);
  disposables.push(towerGeo);
  const tower = new THREE.Mesh(towerGeo, pitMat);
  tower.position.set(-8, 7.5, -(p.halfWidth + 11));
  tower.castShadow = quality.shadows;
  holder.add(tower);

  group.add(holder);
};

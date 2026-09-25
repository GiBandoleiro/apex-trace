/**
 * Procedural car construction.
 *
 * Bodies are lofted from a set of cross-sections so every vehicle in the
 * catalogue has genuinely different proportions - nose taper, shoulder flare,
 * cabin position and roofline all come from its `CarDesign`. Nothing is a
 * scaled copy of anything else, and no external model files are needed.
 *
 * The body is UV-mapped with a planar projection from above so the livery
 * texture lands exactly where the top-down camera can see it.
 */

import * as THREE from 'three';
import type { CarCustomization, CarDefinition, CarDesign, WheelStyle } from './types';
import { buildLiveryTexture, finishParams } from './livery';
import { clamp01, lerp, smoothstep } from '@/utils/math';

/* ------------------------------------------------------------------ */
/* Lofting                                                             */
/* ------------------------------------------------------------------ */

interface Station {
  /** Position along the car, +Z = nose. */
  z: number;
  halfWidth: number
  bottom: number;
  top: number;
  /** Corner radius of the cross-section. */
  radius: number;
}

/** Rounded-rectangle cross-section sampled into `n` points, CCW. */
const crossSection = (st: Station, n: number): THREE.Vector2[] => {
  const pts: THREE.Vector2[] = [];
  const w = st.halfWidth;
  const h = (st.top - st.bottom) * 0.5;
  const cy = (st.top + st.bottom) * 0.5;
  const r = Math.min(st.radius, Math.min(w, h) * 0.95);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    // Superellipse gives a rounded-box silhouette with a single parameter.
    const k = 2 + (1 - clamp01(r / Math.max(0.001, Math.min(w, h)))) * 6;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const x = Math.sign(ca) * Math.pow(Math.abs(ca), 2 / k) * w;
    const y = Math.sign(sa) * Math.pow(Math.abs(sa), 2 / k) * h;
    pts.push(new THREE.Vector2(x, cy + y));
  }
  return pts;
};

/** Builds a closed lofted surface through the stations, with end caps. */
const loft = (stations: Station[], ringPoints: number, uvLength: number, uvWidth: number): THREE.BufferGeometry => {
  const rings = stations.map((st) => crossSection(st, ringPoints));
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const zFront = stations[0].z;

  for (let s = 0; s < stations.length; s++) {
    const ring = rings[s];
    const z = stations[s].z;
    for (let i = 0; i < ringPoints; i++) {
      const p = ring[i];
      positions.push(p.x, p.y, z);
      uvs.push(clamp01((zFront - z) / uvLength), clamp01((p.x + uvWidth * 0.5) / uvWidth));
    }
  }

  for (let s = 0; s < stations.length - 1; s++) {
    for (let i = 0; i < ringPoints; i++) {
      const a = s * ringPoints + i;
      const b = s * ringPoints + ((i + 1) % ringPoints);
      const c = (s + 1) * ringPoints + i;
      const d = (s + 1) * ringPoints + ((i + 1) % ringPoints);
      indices.push(a, c, b, b, c, d);
    }
  }

  // Caps: fan from a centre vertex at each end.
  const capFan = (stationIndex: number, flip: boolean) => {
    const base = positions.length / 3;
    const st = stations[stationIndex];
    positions.push(0, (st.top + st.bottom) * 0.5, st.z);
    uvs.push(clamp01((zFront - st.z) / uvLength), 0.5);
    const offset = stationIndex * ringPoints;
    for (let i = 0; i < ringPoints; i++) {
      const a = offset + i;
      const b = offset + ((i + 1) % ringPoints);
      if (flip) indices.push(base, b, a);
      else indices.push(base, a, b);
    }
  };
  capFan(0, false);
  capFan(stations.length - 1, true);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
};

/** Body cross-sections derived from the design descriptor. */
const bodyStations = (d: CarDesign, count: number): Station[] => {
  const out: Station[] = [];
  const halfLen = d.length * 0.5;
  const frontAxleZ = -d.frontAxle;
  const rearAxleZ = -d.rearAxle;

  for (let i = 0; i < count; i++) {
    const t = i / (count - 1); // 0 = nose, 1 = tail
    const z = halfLen - t * d.length;

    // Plan-view taper.
    let widthFactor = 1;
    if (t < 0.18) widthFactor = lerp(d.noseTaper, 1, smoothstep(t / 0.18));
    else if (t > 0.86) widthFactor = lerp(1, d.tailTaper, smoothstep((t - 0.86) / 0.14));

    // Shoulder flare over the wheel arches.
    const archFront = Math.exp(-Math.pow((z - frontAxleZ) / 0.62, 2));
    const archRear = Math.exp(-Math.pow((z - rearAxleZ) / 0.68, 2));
    widthFactor += d.flare * Math.max(archFront, archRear);

    // Side profile: low nose, shoulder line, slightly tapered tail.
    const shoulder = d.height * 0.52;
    let top: number;
    if (t < 0.22) top = lerp(d.height * 0.34, shoulder, smoothstep(t / 0.22));
    else if (t > 0.8) top = lerp(shoulder, d.height * 0.44, smoothstep((t - 0.8) / 0.2));
    else top = shoulder + Math.sin((t - 0.22) / 0.58 * Math.PI) * d.height * 0.045;

    const bottom = d.rideHeight + (t < 0.12 ? 0.02 : 0) + (t > 0.9 ? 0.03 : 0);

    out.push({
      z,
      halfWidth: (d.width * 0.5) * widthFactor,
      bottom,
      top,
      radius: 0.16,
    });
  }
  return out;
};

/** Greenhouse cross-sections. */
const cabinStations = (d: CarDesign, count: number): Station[] => {
  const out: Station[] = [];
  const centerZ = (0.5 - d.cabinCenter) * d.length;
  const front = centerZ + d.cabinLength * 0.5;
  const shoulder = d.height * 0.52;
  const roof = d.height * 0.52 + d.cabinRise;

  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    const z = front - t * d.cabinLength;

    // Windscreen rake at the front, backlight rake at the rear.
    let widthFactor: number;
    let top: number;
    if (d.canopy === 'bubble') {
      const bell = Math.sin(Math.PI * clamp01(t * 0.92 + 0.04));
      widthFactor = 0.52 + bell * 0.48;
      top = shoulder + (roof - shoulder) * bell;
    } else if (d.canopy === 'fastback') {
      widthFactor = t < 0.3 ? lerp(0.6, 1, smoothstep(t / 0.3)) : lerp(1, 0.72, smoothstep((t - 0.3) / 0.7));
      top = t < 0.34
        ? lerp(shoulder + 0.02, roof, smoothstep(t / 0.34))
        : lerp(roof, shoulder + 0.05, smoothstep((t - 0.34) / 0.66) * 0.88);
    } else {
      widthFactor = t < 0.24 ? lerp(0.66, 1, smoothstep(t / 0.24)) : t > 0.78 ? lerp(1, 0.78, smoothstep((t - 0.78) / 0.22)) : 1;
      top = t < 0.26
        ? lerp(shoulder + 0.02, roof, smoothstep(t / 0.26))
        : t > 0.74
          ? lerp(roof, shoulder + 0.04, smoothstep((t - 0.74) / 0.26))
          : roof;
    }

    out.push({
      z,
      halfWidth: d.cabinWidth * 0.5 * widthFactor,
      bottom: shoulder - 0.06,
      top,
      radius: 0.12,
    });
  }
  return out;
};

/* ------------------------------------------------------------------ */
/* Wheels                                                              */
/* ------------------------------------------------------------------ */

const wheelFaceTexture = (style: WheelStyle, color: string): THREE.CanvasTexture => {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const c = size / 2;

  ctx.fillStyle = '#0d0f13';
  ctx.fillRect(0, 0, size, size);

  // Brake disc showing through the spokes.
  ctx.fillStyle = '#2e3239';
  ctx.beginPath();
  ctx.arc(c, c, size * 0.42, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.09)';
  ctx.lineWidth = 1;
  for (let r = size * 0.16; r < size * 0.4; r += 4) {
    ctx.beginPath();
    ctx.arc(c, c, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';

  const spoke = (count: number, width: number, inner: number, outer: number, taper = 1) => {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      ctx.save();
      ctx.translate(c, c);
      ctx.rotate(a);
      ctx.beginPath();
      ctx.moveTo(-width * 0.5 * taper, inner);
      ctx.lineTo(width * 0.5 * taper, inner);
      ctx.lineTo(width * 0.5, outer);
      ctx.lineTo(-width * 0.5, outer);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  };

  switch (style) {
    case 'split5':
      spoke(10, size * 0.06, size * 0.1, size * 0.44, 0.5);
      break;
    case 'mesh':
      spoke(16, size * 0.035, size * 0.12, size * 0.45, 0.6);
      spoke(16, size * 0.03, size * 0.12, size * 0.45, 0.6);
      break;
    case 'turbine':
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2;
        ctx.save();
        ctx.translate(c, c);
        ctx.rotate(a);
        ctx.beginPath();
        ctx.moveTo(0, size * 0.1);
        ctx.quadraticCurveTo(size * 0.16, size * 0.26, size * 0.06, size * 0.45);
        ctx.lineTo(-size * 0.05, size * 0.45);
        ctx.quadraticCurveTo(size * 0.02, size * 0.26, -size * 0.04, size * 0.1);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
      break;
    case 'dish':
      ctx.beginPath();
      ctx.arc(c, c, size * 0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        ctx.beginPath();
        ctx.arc(c + Math.cos(a) * size * 0.26, c + Math.sin(a) * size * 0.26, size * 0.05, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    case 'multispoke':
      spoke(20, size * 0.028, size * 0.11, size * 0.45, 0.7);
      break;
  }

  // Hub and lug nuts.
  ctx.fillStyle = '#1a1d24';
  ctx.beginPath();
  ctx.arc(c, c, size * 0.11, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#5a6070';
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(c + Math.cos(a) * size * 0.065, c + Math.sin(a) * size * 0.065, size * 0.016, 0, Math.PI * 2);
    ctx.fill();
  }

  // Tyre sidewall ring.
  ctx.strokeStyle = '#0a0b0e';
  ctx.lineWidth = size * 0.1;
  ctx.beginPath();
  ctx.arc(c, c, size * 0.47, 0, Math.PI * 2);
  ctx.stroke();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
};

const tyreTexture = (): THREE.CanvasTexture => {
  const w = 64;
  const h = 64;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#131418';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 24; i++) {
    const x = (i / 24) * w;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + 3, h);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(4, 1);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
};

let sharedTyreTexture: THREE.CanvasTexture | null = null;
const getTyreTexture = (): THREE.CanvasTexture => {
  if (!sharedTyreTexture) sharedTyreTexture = tyreTexture();
  return sharedTyreTexture;
};

/* ------------------------------------------------------------------ */
/* Contact shadow                                                      */
/* ------------------------------------------------------------------ */

let sharedShadowTexture: THREE.CanvasTexture | null = null;
const contactShadowTexture = (): THREE.CanvasTexture => {
  if (sharedShadowTexture) return sharedShadowTexture;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(0,0,0,0.55)');
  g.addColorStop(0.55, 'rgba(0,0,0,0.28)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  sharedShadowTexture = new THREE.CanvasTexture(canvas);
  return sharedShadowTexture;
};

/* ------------------------------------------------------------------ */
/* Car visual                                                          */
/* ------------------------------------------------------------------ */

export interface CarVisualOptions {
  envMap?: THREE.Texture | null;
  castShadow?: boolean;
  /** Detail level: 2 = full, 1 = medium, 0 = distant. */
  detail?: 0 | 1 | 2;
  /** Headlights emissive by default (night circuits). */
  lightsOn?: boolean;
}

export class CarVisual {
  readonly root = new THREE.Group();
  readonly body: THREE.Mesh;
  private readonly wheels: THREE.Group[] = [];
  private readonly steerWheels: THREE.Group[] = [];
  private readonly brakeLights: THREE.MeshStandardMaterial[] = [];
  private readonly headLights: THREE.MeshStandardMaterial[] = [];
  private readonly chassis = new THREE.Group();
  private readonly disposables: Array<{ dispose: () => void }> = [];
  private readonly design: CarDesign;

  constructor(def: CarDefinition, custom: CarCustomization, opts: CarVisualOptions = {}) {
    const d = def.design;
    this.design = d;
    const detail = opts.detail ?? 2;
    const env = opts.envMap ?? null;

    const livery = buildLiveryTexture(d, custom);
    this.disposables.push(livery);
    const fp = finishParams(custom.finish);

    const paint = new THREE.MeshPhysicalMaterial({
      map: livery,
      roughness: fp.roughness,
      metalness: fp.metalness,
      clearcoat: fp.clearcoat,
      clearcoatRoughness: fp.clearcoatRoughness,
      envMap: env,
      envMapIntensity: 1.1,
    });
    this.disposables.push(paint);

    const glass = new THREE.MeshPhysicalMaterial({
      color: custom.tint ? 0x0a0d14 : 0x3a4a5c,
      roughness: 0.06,
      metalness: 0,
      transmission: 0,
      opacity: custom.tint ? 0.88 : 0.7,
      transparent: true,
      clearcoat: 1,
      clearcoatRoughness: 0.03,
      envMap: env,
      envMapIntensity: 1.6,
    });
    this.disposables.push(glass);

    const carbon = new THREE.MeshStandardMaterial({
      color: 0x15171d,
      roughness: 0.42,
      metalness: 0.35,
      envMap: env,
    });
    this.disposables.push(carbon);

    const darkTrim = new THREE.MeshStandardMaterial({
      color: 0x0c0e12,
      roughness: 0.78,
      metalness: 0.2,
      envMap: env,
    });
    this.disposables.push(darkTrim);

    const chrome = new THREE.MeshStandardMaterial({
      color: 0x9aa2ae,
      roughness: 0.22,
      metalness: 1,
      envMap: env,
    });
    this.disposables.push(chrome);

    /* --- body ------------------------------------------------------ */
    const ringPoints = detail === 2 ? 20 : detail === 1 ? 14 : 10;
    const stationCount = detail === 2 ? 26 : detail === 1 ? 16 : 9;
    const bodyGeo = loft(bodyStations(d, stationCount), ringPoints, d.length, d.width * (1 + d.flare));
    this.disposables.push(bodyGeo);
    this.body = new THREE.Mesh(bodyGeo, paint);
    this.body.castShadow = opts.castShadow ?? true;
    this.body.receiveShadow = true;
    this.chassis.add(this.body);

    /* --- greenhouse ------------------------------------------------ */
    const cabinGeo = loft(
      cabinStations(d, detail === 2 ? 18 : 10),
      ringPoints,
      d.length,
      d.width * (1 + d.flare),
    );
    this.disposables.push(cabinGeo);
    const cabin = new THREE.Mesh(cabinGeo, glass);
    cabin.castShadow = opts.castShadow ?? true;
    this.chassis.add(cabin);

    // Painted roof panel, except on bubble canopies.
    if (d.canopy !== 'bubble' && detail >= 1) {
      const centerZ = (0.5 - d.cabinCenter) * d.length;
      const roofGeo = new THREE.BoxGeometry(
        d.cabinWidth * 0.86,
        0.04,
        d.cabinLength * (d.canopy === 'fastback' ? 0.34 : 0.46),
      );
      this.disposables.push(roofGeo);
      const roof = new THREE.Mesh(roofGeo, paint);
      roof.position.set(0, d.height * 0.52 + d.cabinRise - 0.01, centerZ - d.cabinLength * 0.06);
      roof.castShadow = opts.castShadow ?? true;
      this.chassis.add(roof);
    }

    /* --- aero ------------------------------------------------------ */
    const wantWing = custom.spoiler ? Math.max(d.wing, 2) : d.wing;
    if (wantWing > 0) this.buildWing(d, wantWing as 1 | 2 | 3, carbon, paint, opts);
    if (d.splitter) {
      const g = new THREE.BoxGeometry(d.width * 0.98, 0.035, 0.34);
      this.disposables.push(g);
      const m = new THREE.Mesh(g, carbon);
      m.position.set(0, d.rideHeight + 0.01, d.length * 0.5 - 0.1);
      this.chassis.add(m);
    }
    if (d.diffuser && detail >= 1) {
      for (let i = -2; i <= 2; i++) {
        const g = new THREE.BoxGeometry(0.05, 0.14, 0.42);
        this.disposables.push(g);
        const fin = new THREE.Mesh(g, carbon);
        fin.position.set(i * d.width * 0.17, d.rideHeight + 0.07, -d.length * 0.46);
        this.chassis.add(fin);
      }
    }

    /* --- intakes, scoop, exhausts ---------------------------------- */
    if (d.sideIntakes && detail >= 1) {
      for (const side of [-1, 1]) {
        const g = new THREE.BoxGeometry(0.1, 0.2, 0.7);
        this.disposables.push(g);
        const m = new THREE.Mesh(g, darkTrim);
        m.position.set(side * d.width * 0.49, d.height * 0.38, -d.length * 0.06);
        this.chassis.add(m);
      }
    }
    if (d.roofScoop && detail >= 1) {
      const centerZ = (0.5 - d.cabinCenter) * d.length;
      const g = new THREE.BoxGeometry(0.26, 0.12, 0.46);
      this.disposables.push(g);
      const m = new THREE.Mesh(g, darkTrim);
      m.position.set(0, d.height * 0.52 + d.cabinRise + 0.04, centerZ + d.cabinLength * 0.1);
      this.chassis.add(m);
    }
    if (detail >= 1) {
      for (const side of [-1, 1]) {
        const g = new THREE.CylinderGeometry(0.055, 0.06, 0.16, 10);
        this.disposables.push(g);
        const pipe = new THREE.Mesh(g, chrome);
        pipe.rotation.x = Math.PI / 2;
        pipe.position.set(side * d.width * 0.24, d.rideHeight + 0.12, -d.length * 0.5 + 0.02);
        this.chassis.add(pipe);
      }
      // Mirrors.
      for (const side of [-1, 1]) {
        const g = new THREE.BoxGeometry(0.14, 0.06, 0.08);
        this.disposables.push(g);
        const mirror = new THREE.Mesh(g, paint);
        mirror.position.set(
          side * (d.cabinWidth * 0.5 + 0.12),
          d.height * 0.5,
          (0.5 - d.cabinCenter) * d.length + d.cabinLength * 0.42,
        );
        this.chassis.add(mirror);
      }
    }

    /* --- lights ---------------------------------------------------- */
    this.buildLights(d, opts, env);

    /* --- wheels ---------------------------------------------------- */
    const faceTex = wheelFaceTexture(custom.wheelStyle, custom.wheelColor);
    this.disposables.push(faceTex);
    const tyreMat = new THREE.MeshStandardMaterial({
      map: getTyreTexture(),
      color: 0x22242a,
      roughness: 0.92,
      metalness: 0,
      envMap: env,
    });
    this.disposables.push(tyreMat);
    const faceMat = new THREE.MeshStandardMaterial({
      map: faceTex,
      roughness: 0.34,
      metalness: 0.7,
      envMap: env,
    });
    this.disposables.push(faceMat);

    const frontZ = -d.frontAxle;
    const rearZ = -d.rearAxle;
    const trackWidth = d.width * 0.5 - d.wheelWidth * 0.42;

    for (const [z, isFront] of [[frontZ, true], [rearZ, false]] as Array<[number, boolean]>) {
      for (const side of [-1, 1]) {
        const wheel = this.makeWheel(d, tyreMat, faceMat, side, detail);
        wheel.position.set(side * trackWidth, d.wheelRadius, z);
        this.chassis.add(wheel);
        this.wheels.push(wheel);
        if (isFront) this.steerWheels.push(wheel);
      }
    }

    this.root.add(this.chassis);

    /* --- contact shadow -------------------------------------------- */
    const shadowGeo = new THREE.PlaneGeometry(d.length * 1.25, d.width * 1.7);
    this.disposables.push(shadowGeo);
    const shadowMat = new THREE.MeshBasicMaterial({
      map: contactShadowTexture(),
      transparent: true,
      depthWrite: false,
      opacity: 0.85,
    });
    this.disposables.push(shadowMat);
    const shadow = new THREE.Mesh(shadowGeo, shadowMat);
    shadow.rotation.x = -Math.PI / 2;
    shadow.rotation.z = Math.PI / 2;
    shadow.position.y = 0.012;
    shadow.renderOrder = -1;
    this.root.add(shadow);
  }

  private makeWheel(
    d: CarDesign,
    tyre: THREE.Material,
    face: THREE.Material,
    side: number,
    detail: number,
  ): THREE.Group {
    const g = new THREE.Group();
    const segments = detail === 2 ? 22 : detail === 1 ? 14 : 8;

    const tyreGeo = new THREE.CylinderGeometry(
      d.wheelRadius,
      d.wheelRadius,
      d.wheelWidth,
      segments,
      1,
      true,
    );
    this.disposables.push(tyreGeo);
    const tyreMesh = new THREE.Mesh(tyreGeo, tyre);
    tyreMesh.rotation.z = Math.PI / 2;
    tyreMesh.castShadow = true;
    g.add(tyreMesh);

    const faceGeo = new THREE.CircleGeometry(d.wheelRadius * 1.005, segments);
    this.disposables.push(faceGeo);
    const outer = new THREE.Mesh(faceGeo, face);
    outer.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2;
    outer.position.x = side * (d.wheelWidth * 0.5 + 0.001);
    g.add(outer);

    const inner = new THREE.Mesh(faceGeo, face);
    inner.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
    inner.position.x = -side * (d.wheelWidth * 0.5 + 0.001);
    g.add(inner);

    return g;
  }

  private buildWing(
    d: CarDesign,
    kind: 1 | 2 | 3,
    carbon: THREE.Material,
    paint: THREE.Material,
    opts: CarVisualOptions,
  ): void {
    const tailZ = -d.length * 0.47;
    if (kind === 1) {
      const g = new THREE.BoxGeometry(d.wingWidth, 0.05, 0.22);
      this.disposables.push(g);
      const lip = new THREE.Mesh(g, paint);
      lip.position.set(0, d.height * 0.5 + 0.03, tailZ + 0.06);
      lip.rotation.x = -0.12;
      lip.castShadow = opts.castShadow ?? true;
      this.chassis.add(lip);
      return;
    }

    const planeGeo = new THREE.BoxGeometry(d.wingWidth, 0.04, 0.3);
    this.disposables.push(planeGeo);
    const plane = new THREE.Mesh(planeGeo, carbon);
    plane.position.set(0, d.height * 0.5 + d.wingHeight, tailZ + 0.02);
    plane.rotation.x = -0.2;
    plane.castShadow = opts.castShadow ?? true;
    this.chassis.add(plane);

    const supportGeo = new THREE.BoxGeometry(0.05, d.wingHeight, 0.1);
    this.disposables.push(supportGeo);
    for (const side of [-1, 1]) {
      const s = new THREE.Mesh(supportGeo, carbon);
      s.position.set(side * d.wingWidth * 0.3, d.height * 0.5 + d.wingHeight * 0.5, tailZ + 0.04);
      this.chassis.add(s);
    }

    if (kind === 3) {
      const plateGeo = new THREE.BoxGeometry(0.03, 0.22, 0.42);
      this.disposables.push(plateGeo);
      for (const side of [-1, 1]) {
        const p = new THREE.Mesh(plateGeo, carbon);
        p.position.set(
          side * d.wingWidth * 0.5,
          d.height * 0.5 + d.wingHeight + 0.04,
          tailZ + 0.02,
        );
        this.chassis.add(p);
      }
      // Second element.
      const upperGeo = new THREE.BoxGeometry(d.wingWidth * 0.96, 0.03, 0.14);
      this.disposables.push(upperGeo);
      const upper = new THREE.Mesh(upperGeo, carbon);
      upper.position.set(0, d.height * 0.5 + d.wingHeight + 0.1, tailZ - 0.02);
      upper.rotation.x = -0.3;
      this.chassis.add(upper);
    }
  }

  private buildLights(d: CarDesign, opts: CarVisualOptions, env: THREE.Texture | null): void {
    const noseZ = d.length * 0.5 - 0.06;
    const tailZ = -d.length * 0.5 + 0.05;
    const y = d.height * 0.42;

    const headMat = new THREE.MeshStandardMaterial({
      color: 0xdfe6f2,
      emissive: new THREE.Color(0xfff0d0),
      emissiveIntensity: opts.lightsOn ? 2.4 : 0.25,
      roughness: 0.1,
      metalness: 0,
      envMap: env,
    });
    this.disposables.push(headMat);
    this.headLights.push(headMat);

    const tailMat = new THREE.MeshStandardMaterial({
      color: 0x7a1414,
      emissive: new THREE.Color(0xff2a18),
      emissiveIntensity: 0.6,
      roughness: 0.2,
      metalness: 0,
      envMap: env,
    });
    this.disposables.push(tailMat);
    this.brakeLights.push(tailMat);

    const headShape = (): THREE.BufferGeometry => {
      switch (d.lights) {
        case 'round':
          return new THREE.SphereGeometry(0.11, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2);
        case 'wide':
          return new THREE.BoxGeometry(0.42, 0.07, 0.1);
        case 'stacked':
          return new THREE.BoxGeometry(0.18, 0.16, 0.09);
        case 'slim':
        default:
          return new THREE.BoxGeometry(0.3, 0.05, 0.1);
      }
    };

    for (const side of [-1, 1]) {
      const g = headShape();
      this.disposables.push(g);
      const m = new THREE.Mesh(g, headMat);
      m.position.set(side * d.width * 0.3, y, noseZ);
      if (d.lights === 'round') m.rotation.x = Math.PI / 2;
      this.chassis.add(m);
    }

    const tailGeo = new THREE.BoxGeometry(d.width * 0.3, 0.07, 0.07);
    this.disposables.push(tailGeo);
    for (const side of [-1, 1]) {
      const m = new THREE.Mesh(tailGeo, tailMat);
      m.position.set(side * d.width * 0.3, y + 0.02, tailZ);
      this.chassis.add(m);
    }
  }

  /** Per-frame animation driven by the simulation state. */
  update(state: {
    speed: number;
    steerAngle: number;
    brakeLight: number;
    bodyRoll: number;
    bodyPitch: number;
    wheelSpin: number;
  }): void {
    const spin = state.wheelSpin;
    for (const w of this.wheels) w.rotation.x = spin;
    for (const w of this.steerWheels) w.rotation.y = state.steerAngle;

    this.chassis.rotation.z = state.bodyRoll;
    this.chassis.rotation.x = state.bodyPitch;
    this.chassis.position.y = -Math.abs(state.bodyPitch) * 0.08;

    for (const m of this.brakeLights) {
      m.emissiveIntensity = 0.35 + state.brakeLight * 3.4;
    }
  }

  setHeadlights(on: boolean): void {
    for (const m of this.headLights) m.emissiveIntensity = on ? 2.4 : 0.25;
  }

  get length(): number {
    return this.design.length;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
    this.root.clear();
  }
}

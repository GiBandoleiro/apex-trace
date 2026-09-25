/**
 * The drawn line, rendered into the world.
 *
 * The trajectory is not a flat 2D overlay - it is a ribbon laid on the track
 * surface with a soft glow, a bright core and per-vertex colour that encodes
 * how much grip the line is asking for. Green means the car can hold it, amber
 * is on the limit, red means it will run wide.
 */

import * as THREE from 'three';
import type { RacingPath } from '@/physics/RacingPath';
import { clamp01, lerp } from '@/utils/math';

const RIBBON_VERTEX = `
  attribute vec3 aColor;
  attribute float aEdge;
  attribute float aFlow;
  varying vec3 vColor;
  varying float vEdge;
  varying float vFlow;
  void main() {
    vColor = aColor;
    vEdge = aEdge;
    vFlow = aFlow;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const RIBBON_FRAGMENT = `
  varying vec3 vColor;
  varying float vEdge;
  varying float vFlow;
  uniform float uTime;
  uniform float uOpacity;
  void main() {
    float d = abs(vEdge);
    // Soft outer glow with a tight bright core.
    float glow = 1.0 - smoothstep(0.22, 1.0, d);
    float core = 1.0 - smoothstep(0.0, 0.42, d);
    // Energy flowing along the line in the direction of travel.
    float pulse = 0.5 + 0.5 * sin(vFlow * 6.2831 - uTime * 3.4);
    vec3 col = vColor * (0.85 + core * 0.95) + vec3(0.9, 0.95, 1.0) * core * 0.2;
    float a = (glow * 0.60 + core * 1.0) * uOpacity * (0.88 + pulse * 0.12);
    if (a <= 0.004) discard;
    gl_FragColor = vec4(col, a);
  }
`;

const speedColor = (ratio: number, out: THREE.Color): THREE.Color => {
  // Red marks slow/braking strokes, amber intermediate pace, green high speed.
  const t = clamp01(ratio);
  if (t < 0.55) {
    const k = t / 0.55;
    out.setRGB(1, lerp(0.20, 0.72, k), lerp(0.15, 0.17, k));
  } else {
    const k = (t - 0.55) / 0.45;
    out.setRGB(lerp(1, 0.15, k), lerp(0.72, 0.96, k), lerp(0.17, 0.45, k));
  }
  return out;
};

export class TrajectoryRenderer {
  readonly group = new THREE.Group();
  private ribbon: THREE.Mesh;
  private geometry: THREE.BufferGeometry;
  private material: THREE.ShaderMaterial;
  private nodeMesh: THREE.InstancedMesh;
  private nodeGeometry: THREE.BufferGeometry;
  private nodeMaterial: THREE.MeshBasicMaterial;
  private readonly maxSegments: number;
  private readonly color = new THREE.Color();
  private time = 0;

  constructor(maxSegments = 1400) {
    this.maxSegments = maxSegments;

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(maxSegments * 4 * 3), 3),
    );
    this.geometry.setAttribute(
      'aColor',
      new THREE.BufferAttribute(new Float32Array(maxSegments * 4 * 3), 3),
    );
    this.geometry.setAttribute(
      'aEdge',
      new THREE.BufferAttribute(new Float32Array(maxSegments * 4), 1),
    );
    this.geometry.setAttribute(
      'aFlow',
      new THREE.BufferAttribute(new Float32Array(maxSegments * 4), 1),
    );
    const indices = new Uint32Array(maxSegments * 6);
    for (let i = 0; i < maxSegments; i++) {
      const v = i * 4;
      const o = i * 6;
      indices[o] = v;
      indices[o + 1] = v + 2;
      indices[o + 2] = v + 1;
      indices[o + 3] = v + 1;
      indices[o + 4] = v + 2;
      indices[o + 5] = v + 3;
    }
    this.geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    this.geometry.setDrawRange(0, 0);

    this.material = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uOpacity: { value: 1 } },
      vertexShader: RIBBON_VERTEX,
      fragmentShader: RIBBON_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });

    this.ribbon = new THREE.Mesh(this.geometry, this.material);
    this.ribbon.frustumCulled = false;
    this.ribbon.renderOrder = 6;
    this.group.add(this.ribbon);

    // Control-point markers.
    this.nodeGeometry = new THREE.CircleGeometry(0.42, 12);
    this.nodeGeometry.rotateX(-Math.PI / 2);
    this.nodeMaterial = new THREE.MeshBasicMaterial({
      color: 0xdff3ff,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.nodeMesh = new THREE.InstancedMesh(this.nodeGeometry, this.nodeMaterial, 220);
    this.nodeMesh.count = 0;
    this.nodeMesh.frustumCulled = false;
    this.nodeMesh.renderOrder = 7;
    this.group.add(this.nodeMesh);
  }

  set visible(v: boolean) {
    this.group.visible = v;
  }

  set opacity(v: number) {
    this.material.uniforms.uOpacity.value = v;
    this.nodeMaterial.opacity = 0.55 * v;
  }

  update(dt: number): void {
    this.time += dt;
    this.material.uniforms.uTime.value = this.time;
  }

  clear(): void {
    this.geometry.setDrawRange(0, 0);
    this.nodeMesh.count = 0;
  }

  /**
   * Renders an arbitrary polyline (the live stroke while the player draws).
   * `risk` is optional and defaults to a neutral colour.
   */
  drawPolyline(
    pts: Array<{ x: number; z: number; y?: number }>,
    width = 2.4,
    risk?: number[],
  ): void {
    if (pts.length < 2) {
      this.clear();
      return;
    }
    const count = Math.min(pts.length - 1, this.maxSegments);
    const pos = this.geometry.attributes.position as THREE.BufferAttribute;
    const col = this.geometry.attributes.aColor as THREE.BufferAttribute;
    const edge = this.geometry.attributes.aEdge as THREE.BufferAttribute;
    const flow = this.geometry.attributes.aFlow as THREE.BufferAttribute;
    const posArr = pos.array as Float32Array;
    const colArr = col.array as Float32Array;
    const edgeArr = edge.array as Float32Array;
    const flowArr = flow.array as Float32Array;

    for (let i = 0; i < count; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      let dx = b.x - a.x;
      let dz = b.z - a.z;
      const l = Math.hypot(dx, dz) || 1;
      dx /= l;
      dz /= l;
      const nx = -dz * width;
      const nz = dx * width;
      const ay = (a.y ?? 0) + 0.34;
      const by = (b.y ?? 0) + 0.34;

      const v = i * 4 * 3;
      posArr[v] = a.x + nx; posArr[v + 1] = ay; posArr[v + 2] = a.z + nz;
      posArr[v + 3] = a.x - nx; posArr[v + 4] = ay; posArr[v + 5] = a.z - nz;
      posArr[v + 6] = b.x + nx; posArr[v + 7] = by; posArr[v + 8] = b.z + nz;
      posArr[v + 9] = b.x - nx; posArr[v + 10] = by; posArr[v + 11] = b.z - nz;

      speedColor(risk ? risk[i] ?? 0.5 : 0.5, this.color);
      for (let k = 0; k < 4; k++) {
        colArr[v + k * 3] = this.color.r;
        colArr[v + k * 3 + 1] = this.color.g;
        colArr[v + k * 3 + 2] = this.color.b;
      }

      const e = i * 4;
      edgeArr[e] = 1; edgeArr[e + 1] = -1; edgeArr[e + 2] = 1; edgeArr[e + 3] = -1;
      const f = i / 16;
      flowArr[e] = f; flowArr[e + 1] = f; flowArr[e + 2] = f; flowArr[e + 3] = f;
    }

    pos.needsUpdate = true;
    col.needsUpdate = true;
    edge.needsUpdate = true;
    flow.needsUpdate = true;
    this.geometry.setDrawRange(0, count * 6);
    this.nodeMesh.count = 0;
  }

  /** Renders a solved racing path with speed/risk colouring and nodes. */
  drawPath(path: RacingPath, width = 3.15, showNodes = true): void {
    const n = path.count;
    const count = Math.min(n, this.maxSegments);
    let slowest = Infinity;
    let fastest = 0;
    for (let i = 0; i < count; i++) {
      const speed = path.point(i).targetSpeed;
      slowest = Math.min(slowest, speed);
      fastest = Math.max(fastest, speed);
    }
    const pos = this.geometry.attributes.position as THREE.BufferAttribute;
    const col = this.geometry.attributes.aColor as THREE.BufferAttribute;
    const edge = this.geometry.attributes.aEdge as THREE.BufferAttribute;
    const flow = this.geometry.attributes.aFlow as THREE.BufferAttribute;
    const posArr = pos.array as Float32Array;
    const colArr = col.array as Float32Array;
    const edgeArr = edge.array as Float32Array;
    const flowArr = flow.array as Float32Array;

    for (let i = 0; i < count; i++) {
      const a = path.point(i);
      const b = path.point(i + 1);
      const nx = -a.tz * width;
      const nz = a.tx * width;
      const nbx = -b.tz * width;
      const nbz = b.tx * width;

      const v = i * 4 * 3;
      posArr[v] = a.x + nx; posArr[v + 1] = a.y + 0.28; posArr[v + 2] = a.z + nz;
      posArr[v + 3] = a.x - nx; posArr[v + 4] = a.y + 0.28; posArr[v + 5] = a.z - nz;
      posArr[v + 6] = b.x + nbx; posArr[v + 7] = b.y + 0.28; posArr[v + 8] = b.z + nbz;
      posArr[v + 9] = b.x - nbx; posArr[v + 10] = b.y + 0.28; posArr[v + 11] = b.z - nbz;

      const relativeSpeed = (a.targetSpeed - slowest) / Math.max(1, fastest - slowest);
      speedColor(0.08 + relativeSpeed * 0.92, this.color);
      for (let k = 0; k < 4; k++) {
        colArr[v + k * 3] = this.color.r;
        colArr[v + k * 3 + 1] = this.color.g;
        colArr[v + k * 3 + 2] = this.color.b;
      }

      const e = i * 4;
      edgeArr[e] = 1; edgeArr[e + 1] = -1; edgeArr[e + 2] = 1; edgeArr[e + 3] = -1;
      const f = a.s / 14;
      flowArr[e] = f; flowArr[e + 1] = f; flowArr[e + 2] = f; flowArr[e + 3] = f;
    }

    pos.needsUpdate = true;
    col.needsUpdate = true;
    edge.needsUpdate = true;
    flow.needsUpdate = true;
    this.geometry.setDrawRange(0, count * 6);

    if (showNodes) {
      const stride = Math.max(1, Math.floor(n / 90));
      const m4 = new THREE.Matrix4();
      let idx = 0;
      for (let i = 0; i < n && idx < 220; i += stride) {
        const p = path.point(i);
        m4.makeTranslation(p.x, p.y + 0.32, p.z);
        this.nodeMesh.setMatrixAt(idx++, m4);
      }
      this.nodeMesh.count = idx;
      this.nodeMesh.instanceMatrix.needsUpdate = true;
    } else {
      this.nodeMesh.count = 0;
    }
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.nodeGeometry.dispose();
    this.nodeMaterial.dispose();
    this.group.clear();
  }
}

/* ------------------------------------------------------------------ */
/* Danger markers                                                      */
/* ------------------------------------------------------------------ */

/** Floating "LOW GRIP" chevrons placed where the line is over the limit. */
export class DangerMarkers {
  readonly group = new THREE.Group();
  private readonly mesh: THREE.InstancedMesh;
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.MeshBasicMaterial;
  private pulse = 0;

  constructor(capacity = 48) {
    const shape = new THREE.Shape();
    shape.moveTo(-0.9, -0.5);
    shape.lineTo(0, 0.5);
    shape.lineTo(0.9, -0.5);
    shape.lineTo(0.55, -0.85);
    shape.lineTo(0, -0.18);
    shape.lineTo(-0.55, -0.85);
    shape.closePath();
    this.geometry = new THREE.ShapeGeometry(shape);
    this.geometry.rotateX(-Math.PI / 2);

    this.material = new THREE.MeshBasicMaterial({
      color: 0xff5a3c,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, capacity);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 8;
    this.group.add(this.mesh);
  }

  /** Places markers at path stations whose demand exceeds the grip limit. */
  update(path: RacingPath, dt: number): void {
    this.pulse += dt * 3.2;
    this.material.opacity = 0.55 + Math.sin(this.pulse) * 0.25;

    const n = path.count;
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    let idx = 0;
    let cooldown = 0;
    for (let i = 0; i < n && idx < this.mesh.count + 48; i++) {
      if (cooldown > 0) {
        cooldown--;
        continue;
      }
      const p = path.point(i);
      if (p.limitSpeed < 0.01) continue;
      const ratio = p.targetSpeed / p.limitSpeed;
      if (ratio <= 1.06) continue;
      e.set(0, -Math.atan2(p.tz, p.tx) + Math.PI / 2, 0);
      q.setFromEuler(e);
      const scale = 1 + Math.min(1.2, (ratio - 1) * 2.4);
      m4.compose(
        new THREE.Vector3(p.x, p.y + 0.2, p.z),
        q,
        new THREE.Vector3(scale, scale, scale),
      );
      this.mesh.setMatrixAt(idx++, m4);
      cooldown = 8;
      if (idx >= 48) break;
    }
    this.mesh.count = idx;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  clear(): void {
    this.mesh.count = 0;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.group.clear();
  }
}

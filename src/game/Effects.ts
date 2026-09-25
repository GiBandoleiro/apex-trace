/**
 * Track-side VFX: skid marks, tyre smoke, dust, sparks and speed lines.
 *
 * Everything is pooled into a small number of buffers that are written in
 * place - no allocations per frame, no per-particle objects created during a
 * race, and a single draw call per effect type.
 */

import * as THREE from 'three';
import { clamp01 } from '@/utils/math';

/* ------------------------------------------------------------------ */
/* Skid marks                                                          */
/* ------------------------------------------------------------------ */

/** Ring buffer of ground quads written as the tyres scrub. */
export class SkidMarks {
  readonly mesh: THREE.Mesh;
  private readonly positions: Float32Array;
  private readonly alphas: Float32Array;
  private readonly capacity: number;
  private cursor = 0;
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.ShaderMaterial;
  private lastPoint = new Map<string, { x: number; z: number }>();

  constructor(capacity: number) {
    this.capacity = capacity;
    this.positions = new Float32Array(capacity * 4 * 3);
    this.alphas = new Float32Array(capacity * 4);

    const indices = new Uint32Array(capacity * 6);
    for (let i = 0; i < capacity; i++) {
      const v = i * 4;
      const o = i * 6;
      indices[o] = v;
      indices[o + 1] = v + 1;
      indices[o + 2] = v + 2;
      indices[o + 3] = v + 1;
      indices[o + 4] = v + 3;
      indices[o + 5] = v + 2;
    }

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('aAlpha', new THREE.BufferAttribute(this.alphas, 1));
    this.geometry.setIndex(new THREE.BufferAttribute(indices, 1));

    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      vertexShader: `
        attribute float aAlpha;
        varying float vAlpha;
        void main() {
          vAlpha = aAlpha;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying float vAlpha;
        void main() {
          if (vAlpha <= 0.001) discard;
          gl_FragColor = vec4(0.02, 0.02, 0.025, vAlpha * 0.62);
        }
      `,
    });

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
  }

  /** Lays a segment of rubber for one car. */
  emit(id: string, x: number, z: number, y: number, heading: number, width: number, strength: number): void {
    const prev = this.lastPoint.get(id);
    if (!prev) {
      this.lastPoint.set(id, { x, z });
      return;
    }
    const dx = x - prev.x;
    const dz = z - prev.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.35) return;
    this.lastPoint.set(id, { x, z });

    const nx = -Math.sin(heading) * width * 0.5;
    const nz = Math.cos(heading) * width * 0.5;

    const v = this.cursor * 4 * 3;
    const a = this.cursor * 4;
    const yy = y + 0.045;

    this.positions[v] = prev.x + nx;
    this.positions[v + 1] = yy;
    this.positions[v + 2] = prev.z + nz;
    this.positions[v + 3] = prev.x - nx;
    this.positions[v + 4] = yy;
    this.positions[v + 5] = prev.z - nz;
    this.positions[v + 6] = x + nx;
    this.positions[v + 7] = yy;
    this.positions[v + 8] = z + nz;
    this.positions[v + 9] = x - nx;
    this.positions[v + 10] = yy;
    this.positions[v + 11] = z - nz;

    const alpha = clamp01(strength);
    this.alphas[a] = alpha;
    this.alphas[a + 1] = alpha;
    this.alphas[a + 2] = alpha;
    this.alphas[a + 3] = alpha;

    this.cursor = (this.cursor + 1) % this.capacity;
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.aAlpha.needsUpdate = true;
  }

  /** Slowly fades the oldest marks so the track never saturates. */
  fade(dt: number): void {
    const decay = dt * 0.035;
    let changed = false;
    for (let i = 0; i < this.alphas.length; i++) {
      if (this.alphas[i] > 0) {
        this.alphas[i] = Math.max(0, this.alphas[i] - decay);
        changed = true;
      }
    }
    if (changed) this.geometry.attributes.aAlpha.needsUpdate = true;
  }

  clear(): void {
    this.alphas.fill(0);
    this.positions.fill(0);
    this.cursor = 0;
    this.lastPoint.clear();
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.aAlpha.needsUpdate = true;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}

/* ------------------------------------------------------------------ */
/* Particles                                                           */
/* ------------------------------------------------------------------ */

const softSprite = (): THREE.CanvasTexture => {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
};

export type ParticleKind = 'smoke' | 'dust' | 'spark';

interface ParticleField {
  life: Float32Array;
  maxLife: Float32Array;
  vx: Float32Array;
  vy: Float32Array;
  vz: Float32Array;
  size0: Float32Array;
  size1: Float32Array;
  r: Float32Array;
  g: Float32Array;
  b: Float32Array;
}

/** One pooled Points cloud handling all particle kinds. */
export class ParticleSystem {
  readonly points: THREE.Points;
  private readonly capacity: number;
  private cursor = 0;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly sizes: Float32Array;
  private readonly alphas: Float32Array;
  private readonly field: ParticleField;
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.ShaderMaterial;
  private readonly texture: THREE.Texture;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.positions = new Float32Array(capacity * 3);
    this.colors = new Float32Array(capacity * 3);
    this.sizes = new Float32Array(capacity);
    this.alphas = new Float32Array(capacity);
    this.field = {
      life: new Float32Array(capacity),
      maxLife: new Float32Array(capacity),
      vx: new Float32Array(capacity),
      vy: new Float32Array(capacity),
      vz: new Float32Array(capacity),
      size0: new Float32Array(capacity),
      size1: new Float32Array(capacity),
      r: new Float32Array(capacity),
      g: new Float32Array(capacity),
      b: new Float32Array(capacity),
    };

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('aColor', new THREE.BufferAttribute(this.colors, 3));
    this.geometry.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1));
    this.geometry.setAttribute('aAlpha', new THREE.BufferAttribute(this.alphas, 1));

    this.texture = softSprite();

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTexture: { value: this.texture },
        uScale: { value: 480 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      vertexShader: `
        attribute vec3 aColor;
        attribute float aSize;
        attribute float aAlpha;
        varying vec3 vColor;
        varying float vAlpha;
        uniform float uScale;
        void main() {
          vColor = aColor;
          vAlpha = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * uScale / max(1.0, -mv.z);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        uniform sampler2D uTexture;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          if (vAlpha <= 0.002) discard;
          vec4 tex = texture2D(uTexture, gl_PointCoord);
          gl_FragColor = vec4(vColor, tex.a * vAlpha);
        }
      `,
    });

    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
  }

  spawn(
    kind: ParticleKind,
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    scale = 1,
    tint?: [number, number, number],
  ): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.capacity;
    const f = this.field;

    this.positions[i * 3] = x;
    this.positions[i * 3 + 1] = y;
    this.positions[i * 3 + 2] = z;
    f.vx[i] = vx;
    f.vy[i] = vy;
    f.vz[i] = vz;

    switch (kind) {
      case 'smoke':
        f.maxLife[i] = 1.1 + Math.random() * 0.7;
        f.size0[i] = 0.5 * scale;
        f.size1[i] = 2.6 * scale;
        f.r[i] = 0.74;
        f.g[i] = 0.74;
        f.b[i] = 0.76;
        break;
      case 'dust':
        f.maxLife[i] = 0.85 + Math.random() * 0.6;
        f.size0[i] = 0.4 * scale;
        f.size1[i] = 2.1 * scale;
        f.r[i] = tint ? tint[0] : 0.68;
        f.g[i] = tint ? tint[1] : 0.6;
        f.b[i] = tint ? tint[2] : 0.46;
        break;
      case 'spark':
        f.maxLife[i] = 0.32 + Math.random() * 0.25;
        f.size0[i] = 0.16 * scale;
        f.size1[i] = 0.03 * scale;
        f.r[i] = 1;
        f.g[i] = 0.72;
        f.b[i] = 0.3;
        break;
    }
    f.life[i] = f.maxLife[i];
  }

  update(dt: number): void {
    const f = this.field;
    let active = false;
    for (let i = 0; i < this.capacity; i++) {
      if (f.life[i] <= 0) {
        if (this.alphas[i] !== 0) {
          this.alphas[i] = 0;
          active = true;
        }
        continue;
      }
      active = true;
      f.life[i] -= dt;
      const t = 1 - f.life[i] / f.maxLife[i];

      // Drag + buoyancy differ per kind via the stored velocities only.
      f.vx[i] *= 1 - Math.min(0.9, dt * 1.6);
      f.vz[i] *= 1 - Math.min(0.9, dt * 1.6);
      f.vy[i] += dt * 0.6;

      this.positions[i * 3] += f.vx[i] * dt;
      this.positions[i * 3 + 1] += f.vy[i] * dt;
      this.positions[i * 3 + 2] += f.vz[i] * dt;

      this.sizes[i] = f.size0[i] + (f.size1[i] - f.size0[i]) * t;
      this.alphas[i] = Math.max(0, (1 - t) * (1 - t) * 0.85);
      this.colors[i * 3] = f.r[i];
      this.colors[i * 3 + 1] = f.g[i];
      this.colors[i * 3 + 2] = f.b[i];
    }
    if (active) {
      this.geometry.attributes.position.needsUpdate = true;
      this.geometry.attributes.aSize.needsUpdate = true;
      this.geometry.attributes.aAlpha.needsUpdate = true;
      this.geometry.attributes.aColor.needsUpdate = true;
    }
  }

  clear(): void {
    this.field.life.fill(0);
    this.alphas.fill(0);
    this.geometry.attributes.aAlpha.needsUpdate = true;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.texture.dispose();
  }
}

/* ------------------------------------------------------------------ */
/* Ambient motes                                                       */
/* ------------------------------------------------------------------ */

/** Slow-drifting atmosphere particles that give the world a sense of air. */
export class AmbientMotes {
  readonly points: THREE.Points;
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.PointsMaterial;
  private readonly basePositions: Float32Array;
  private readonly count: number;
  private time = 0;

  constructor(count: number, radius: number, color: number, size: number) {
    this.count = count;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * radius * 2;
      positions[i * 3 + 1] = Math.random() * 26 + 1.5;
      positions[i * 3 + 2] = (Math.random() - 0.5) * radius * 2;
    }
    this.basePositions = positions.slice();

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.material = new THREE.PointsMaterial({
      color,
      size,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
    });
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
  }

  update(dt: number, centerX: number, centerZ: number): void {
    this.time += dt;
    const attr = this.geometry.attributes.position as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    for (let i = 0; i < this.count; i++) {
      const bx = this.basePositions[i * 3];
      const bz = this.basePositions[i * 3 + 2];
      arr[i * 3] = centerX + bx + Math.sin(this.time * 0.22 + i) * 1.4;
      arr[i * 3 + 2] = centerZ + bz + Math.cos(this.time * 0.18 + i * 1.7) * 1.4;
    }
    attr.needsUpdate = true;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}

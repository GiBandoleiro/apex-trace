/**
 * Camera behaviour.
 *
 * Two modes share one rig:
 *  - `overview` frames the whole circuit for the drawing phase and supports
 *    pan / pinch-zoom;
 *  - `follow` tracks the player's car with speed-reactive distance, a lead
 *    offset so you see where you are going, and a very restrained shake.
 *
 * The tilt is kept at a fixed 2.5D angle so cars read as solid objects with
 * volume while the circuit layout stays legible.
 */

import * as THREE from 'three';
import { clamp, clamp01, damp, dampAngle, lerp } from '@/utils/math';

export type CameraMode = 'overview' | 'follow' | 'showcase';

export interface CameraBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  mode: CameraMode = 'overview';

  /** World point the camera orbits. */
  target = new THREE.Vector3();
  private desiredTarget = new THREE.Vector3();

  /** Horizontal rotation of the rig, radians. */
  yaw = 0;
  private desiredYaw = 0;
  /** Angle above the horizon, radians. */
  pitch = 1.06;
  /** Distance from the target. */
  distance = 120;
  private desiredDistance = 120;

  private shakeAmount = 0;
  private shakeTime = 0;
  private bounds: CameraBounds = { minX: -200, maxX: 200, minZ: -200, maxZ: 200 };
  private minDistance = 22;
  private maxDistance = 2200;

  shakeEnabled = true;
  yawFollow = true;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(42, aspect, 0.6, 3200);
    this.camera.position.set(0, 120, 120);
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }

  setBounds(bounds: CameraBounds): void {
    this.bounds = bounds;
  }

  /** Frames the whole circuit, accounting for the viewport aspect ratio. */
  frameBounds(bounds: CameraBounds, padding = 1.18, instant = true): void {
    this.bounds = bounds;
    this.yaw = 0;
    this.desiredYaw = 0;
    // Drawing needs a near-plan view: the layout has to be readable and the
    // line has to land where the finger is. Anything shallower distorts it.
    this.pitch = 1.28;
    const cx = (bounds.minX + bounds.maxX) / 2;
    const cz = (bounds.minZ + bounds.maxZ) / 2;
    const w = (bounds.maxX - bounds.minX) * padding;
    const h = (bounds.maxZ - bounds.minZ) * padding;

    const vFov = (this.camera.fov * Math.PI) / 180;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * this.camera.aspect);
    // The ground plane is compressed by the camera tilt along the view axis.
    const effectiveDepth = h / Math.max(0.35, Math.sin(this.pitch));
    const distV = effectiveDepth / 2 / Math.tan(vFov / 2);
    const distH = w / 2 / Math.tan(hFov / 2);
    const dist = Math.max(distV, distH);

    this.desiredTarget.set(cx, 0, cz);
    this.desiredDistance = clamp(dist, this.minDistance, 2200);
    this.maxDistance = this.desiredDistance * 1.35;
    this.minDistance = 18;
    if (instant) {
      this.target.copy(this.desiredTarget);
      this.distance = this.desiredDistance;
      this.applyTransform();
    }
  }

  /** Pan in screen space (pixels) during the overview phase. */
  pan(dxPixels: number, dyPixels: number, viewportHeight: number): void {
    const vFov = (this.camera.fov * Math.PI) / 180;
    const worldPerPixel = (2 * this.distance * Math.tan(vFov / 2)) / viewportHeight;
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const forward = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const scale = worldPerPixel;
    this.desiredTarget.addScaledVector(right, -dxPixels * scale);
    this.desiredTarget.addScaledVector(forward, -dyPixels * scale / Math.max(0.4, Math.sin(this.pitch)));
    this.clampTarget();
  }

  zoom(factor: number): void {
    this.desiredDistance = clamp(this.desiredDistance * factor, this.minDistance, this.maxDistance);
  }

  focusOverview(x: number, z: number): void {
    if (this.mode !== 'overview') return;
    this.desiredTarget.set(x, 0, z);
    this.clampTarget();
  }

  private clampTarget(): void {
    const margin = 40;
    this.desiredTarget.x = clamp(this.desiredTarget.x, this.bounds.minX - margin, this.bounds.maxX + margin);
    this.desiredTarget.z = clamp(this.desiredTarget.z, this.bounds.minZ - margin, this.bounds.maxZ + margin);
  }

  /** Switches to race follow mode. */
  startFollow(x: number, z: number, heading: number): void {
    this.mode = 'follow';
    this.desiredTarget.set(x, 0, z);
    this.target.copy(this.desiredTarget);
    this.desiredYaw = -heading + Math.PI / 2;
    this.yaw = this.desiredYaw;
    this.desiredDistance = 54;
    this.distance = 54;
  }

  /** Per-frame update for the follow camera. */
  follow(
    x: number,
    z: number,
    heading: number,
    speedRatio: number,
    curvature: number,
    dt: number,
  ): void {
    // Lead the car so more of the road ahead is visible at speed.
    const lead = 6 + speedRatio * 16;
    this.desiredTarget.set(x + Math.cos(heading) * lead, 0, z + Math.sin(heading) * lead);

    // Zoom out on the straights, in through the corners.
    const corner = clamp01(Math.abs(curvature) * 42);
    const base = lerp(54, 84, speedRatio);
    this.desiredDistance = lerp(base, base * 0.85, corner);

    if (this.yawFollow) {
      this.desiredYaw = -heading + Math.PI / 2;
      this.yaw = dampAngle(this.yaw, this.desiredYaw, 2.2, dt);
    }

    this.target.x = damp(this.target.x, this.desiredTarget.x, 6.5, dt);
    this.target.z = damp(this.target.z, this.desiredTarget.z, 6.5, dt);
    this.distance = damp(this.distance, this.desiredDistance, 3.2, dt);
    this.pitch = damp(this.pitch, lerp(1.16, 1.0, speedRatio), 2, dt);
  }

  /** Slow orbit used behind the main menu. */
  showcase(center: THREE.Vector3, radius: number, dt: number, time: number): void {
    this.mode = 'showcase';
    this.target.copy(center);
    this.yaw = time * 0.09;
    this.pitch = 0.58 + Math.sin(time * 0.16) * 0.07;
    this.distance = damp(this.distance, radius, 1.4, dt);
  }

  addShake(intensity: number): void {
    if (!this.shakeEnabled) return;
    this.shakeAmount = Math.min(1, this.shakeAmount + intensity);
  }

  update(dt: number): void {
    if (this.mode === 'overview') {
      this.target.x = damp(this.target.x, this.desiredTarget.x, 9, dt);
      this.target.z = damp(this.target.z, this.desiredTarget.z, 9, dt);
      this.distance = damp(this.distance, this.desiredDistance, 7, dt);
    }
    if (this.shakeAmount > 0) {
      this.shakeTime += dt * 34;
      this.shakeAmount = Math.max(0, this.shakeAmount - dt * 2.6);
    }
    this.applyTransform();
  }

  private applyTransform(): void {
    const cosP = Math.cos(this.pitch);
    const sinP = Math.sin(this.pitch);
    const ox = Math.sin(this.yaw) * cosP * this.distance;
    const oz = Math.cos(this.yaw) * cosP * this.distance;
    const oy = sinP * this.distance;

    let sx = 0;
    let sy = 0;
    if (this.shakeAmount > 0) {
      const a = this.shakeAmount * this.shakeAmount;
      sx = Math.sin(this.shakeTime * 1.7) * a * 0.55;
      sy = Math.cos(this.shakeTime * 2.3) * a * 0.42;
    }

    this.camera.position.set(
      this.target.x - ox + sx,
      this.target.y + oy + sy,
      this.target.z - oz,
    );
    this.camera.lookAt(this.target.x + sx * 0.3, this.target.y, this.target.z);
  }

  /** Projects a screen point onto the y=0 ground plane. */
  screenToGround(ndcX: number, ndcY: number, out = new THREE.Vector3()): THREE.Vector3 | null {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const hit = ray.ray.intersectPlane(plane, out);
    return hit ? out : null;
  }
}

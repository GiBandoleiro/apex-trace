/**
 * Vehicle simulation.
 *
 * The car does NOT teleport along the drawn line. It runs a pure-pursuit
 * controller toward its path and is then constrained by a friction budget:
 *
 *   required lateral acceleration = v^2 * kappa
 *   available lateral acceleration = grip + downforce*v^2, scaled by surface,
 *                                    and reduced by whatever the tyres are
 *                                    already spending on braking/traction.
 *
 * When the requirement exceeds what is available the controller simply cannot
 * turn hard enough - the car runs wide on its own. That is where understeer,
 * missed apexes and trips through the gravel come from; nothing is scripted.
 */

import { TrackGeometry, type SurfaceKind } from '@/tracks/TrackGeometry';
import { clamp, clamp01, angleDelta, damp } from '@/utils/math';
import type { RacingPath } from './RacingPath';
import type { DrivetrainLimits } from './vehicleStats';
import { SURFACE_DRAG, SURFACE_GRIP } from './vehicleStats';
import type { RunoffSurface } from '@/tracks/types';

export interface VehicleInit {
  id: string;
  isPlayer: boolean;
  limits: DrivetrainLimits;
  path: RacingPath;
  track: TrackGeometry;
  runoff: RunoffSurface;
  startX: number;
  startZ: number;
  startHeading: number;
  /** Grid slot, 0 = pole. */
  gridSlot: number;
}

export interface CollisionEvent {
  kind: 'barrier' | 'car';
  intensity: number;
  x: number;
  z: number;
}

export class Vehicle {
  readonly id: string;
  readonly isPlayer: boolean;
  readonly limits: DrivetrainLimits;
  readonly runoff: RunoffSurface;

  path: RacingPath;
  track: TrackGeometry;

  x: number;
  z: number;
  y = 0;
  heading: number;
  /** Direction the velocity vector points (radians). */
  velHeading: number;
  speed = 0;
  slipAngle = 0;
  yawRate = 0;

  /** 0..1+ - how much of the tyre's lateral budget the line is demanding. */
  gripUsage = 0;
  /** Smoothed value used for tyre smoke / audio. */
  slipIntensity = 0;
  /** Front-wheel steering angle for the visual model. */
  steerAngle = 0;
  /** Normalised brake pressure (drives the brake lights). */
  brakeLight = 0;
  /** Normalised throttle. */
  throttle = 0;
  /** Suspension load transfer for the visual body roll/pitch. */
  bodyRoll = 0;
  bodyPitch = 0;
  wheelSpin = 0;

  pathIndex = 0;
  trackIndex = 0;
  surface: SurfaceKind = 'track';

  /** Distance covered along the circuit, cumulative across laps. */
  progress = 0;
  lap = 0;
  lapStartTime = 0;
  lastLapTime = 0;
  bestLapTime = Infinity;
  lapTimes: number[] = [];
  finished = false;
  finishTime = 0;
  position = 1;

  /** Race-long cleanliness tracking for the CLEAN RACE bonus. */
  contacts = 0;
  offTrackTime = 0;

  /** AI knobs - ignored for the player. */
  paceMultiplier = 1;
  avoidanceOffset = 0;
  trafficSpeedCap = Infinity;
  mistakeTimer = 0;
  private mistakeSteer = 0;

  /** Nitro reserve, 0..1. Auto-deploys on long straights when fitted. */
  nitroCharge = 1;
  nitroActive = false;
  readonly hasNitro: boolean;

  private lastTrackS = 0;
  private collisionCooldown = 0;
  private stuckTimer = 0;

  constructor(init: VehicleInit, hasNitro: boolean) {
    this.id = init.id;
    this.isPlayer = init.isPlayer;
    this.limits = init.limits;
    this.path = init.path;
    this.track = init.track;
    this.runoff = init.runoff;
    this.x = init.startX;
    this.z = init.startZ;
    this.heading = init.startHeading;
    this.velHeading = init.startHeading;
    this.hasNitro = hasNitro;

    const proj = this.track.project(this.x, this.z);
    this.trackIndex = proj.index;
    this.lastTrackS = proj.s;
    this.pathIndex = this.path.projectNear(this.x, this.z, proj.index, 40);
    this.y = this.track.point(proj.index).y;
  }

  setPath(path: RacingPath): void {
    this.path = path;
    this.pathIndex = this.path.projectNear(this.x, this.z, this.trackIndex, 60);
  }

  /**
   * What is under the wheels off the road. Traps only exist at corners - along
   * a straight you land on the grass verge, which matches what is drawn.
   */
  private offTrackSurface(): RunoffSurface {
    return this.track.cornerRunoff[this.trackIndex] ? this.runoff : 'grass';
  }

  /** Surface grip multiplier under the car right now. */
  private surfaceGrip(): number {
    switch (this.surface) {
      case 'track':
        return 1;
      case 'curb':
        return 0.93;
      case 'runoff':
        return SURFACE_GRIP[this.offTrackSurface()];
      default:
        return SURFACE_GRIP[this.offTrackSurface()] * 0.8;
    }
  }

  private surfaceDrag(): number {
    switch (this.surface) {
      case 'track':
        return 0;
      case 'curb':
        return 0.6;
      case 'runoff':
        return SURFACE_DRAG[this.offTrackSurface()];
      default:
        return SURFACE_DRAG[this.offTrackSurface()] * 1.3;
    }
  }

  step(dt: number, raceTime: number, collisions: CollisionEvent[]): void {
    if (this.finished) {
      // Roll to a stop past the flag.
      this.speed = Math.max(0, this.speed - this.limits.brake * 0.35 * dt);
      this.integrate(dt);
      return;
    }

    const L = this.limits;

    // --- 1. Locate ourselves on the path and the circuit -----------------
    this.pathIndex = this.path.projectNear(this.x, this.z, this.pathIndex, 26);
    const trackProj = this.track.projectNear(this.x, this.z, this.trackIndex, 26);
    this.trackIndex = trackProj.index;
    this.surface = this.track.surfaceAt(trackProj);
    const gripScale = this.surfaceGrip();

    if (this.surface !== 'track' && this.surface !== 'curb') this.offTrackTime += dt;

    // --- 2. Pure-pursuit steering ---------------------------------------
    const lookahead = this.isPlayer
      ? clamp(2.5 + this.speed * 0.16, 3.5, 13)
      : clamp(3.6 + this.speed * (0.44 - L.steerResponse * 0.014), 4.5, 36);
    const target = this.path.sampleAhead(this.pathIndex, lookahead);

    let toX = target.x - this.x;
    let toZ = target.z - this.z;
    if (!this.isPlayer && this.avoidanceOffset !== 0) {
      toX -= Math.sin(this.heading) * this.avoidanceOffset;
      toZ += Math.cos(this.heading) * this.avoidanceOffset;
    }
    if (this.mistakeTimer > 0) {
      // A mistake nudges the aim point sideways for a moment.
      const nx = -Math.sin(this.heading);
      const nz = Math.cos(this.heading);
      toX += nx * this.mistakeSteer;
      toZ += nz * this.mistakeSteer;
      this.mistakeTimer -= dt;
    }

    const dist = Math.max(1e-3, Math.hypot(toX, toZ));
    const aimHeading = Math.atan2(toZ, toX);
    const alpha = angleDelta(this.velHeading, aimHeading);

    // Pure pursuit curvature command.
    const cmdCurvature = (2 * Math.sin(alpha)) / dist;

    // --- 3. Longitudinal demand -----------------------------------------
    // Look a little further ahead than we steer so braking starts in time.
    const speedTarget = Math.min(this.trafficSpeedCap,
      target.targetSpeed,
      this.path.sampleAhead(this.pathIndex, this.isPlayer ? Math.max(28, lookahead * 2) : lookahead * 1.9).targetSpeed,
    ) * this.paceMultiplier;

    const speedErr = speedTarget - this.speed;
    let longAccel: number;
    if (speedErr >= 0) {
      this.throttle = clamp01(speedErr / 6);
      longAccel = L.accel * this.throttle;
      this.brakeLight = damp(this.brakeLight, 0, 8, dt);
    } else {
      this.throttle = 0;
      const demand = clamp01(-speedErr / 8);
      longAccel = -L.brake * demand;
      this.brakeLight = damp(this.brakeLight, demand, 14, dt);
    }

    // Nitro: deploy when the road ahead is straight, we are near the target
    // and there is charge left. Purely automatic - it never steals control.
    this.nitroActive = false;
    if (this.hasNitro && this.nitroCharge > 0.02) {
      const straightAhead = Math.abs(this.path.sampleAhead(this.pathIndex, 60).curvature) < 0.004;
      if (straightAhead && this.speed > L.maxSpeed * 0.62 && this.surface === 'track') {
        this.nitroActive = true;
        longAccel += L.accel * 0.45;
        this.nitroCharge = Math.max(0, this.nitroCharge - dt * 0.14);
      }
    }
    if (!this.nitroActive) this.nitroCharge = Math.min(1, this.nitroCharge + dt * 0.045);

    // --- 4. Friction circle ---------------------------------------------
    const latCapacity = (L.lateralGrip + L.downforceGain * this.speed * this.speed) * gripScale;
    const longCapacity = (longAccel >= 0 ? L.accel : L.brake) * gripScale;
    const longUse = clamp01(Math.abs(longAccel) / Math.max(0.1, longCapacity));
    // Classic traction ellipse: spending on longitudinal leaves less for lateral.
    const latAvailable = latCapacity * Math.sqrt(Math.max(0.12, 1 - longUse * longUse * 0.72));

    const latDemand = this.speed * this.speed * cmdCurvature;
    this.gripUsage = Math.abs(latDemand) / Math.max(0.5, latAvailable);

    const latApplied = clamp(latDemand, -latAvailable, latAvailable);

    // --- 5. Rotation ------------------------------------------------------
    const vSafe = Math.max(3.5, this.speed);
    const velTurnRate = latApplied / vSafe;
    this.velHeading += velTurnRate * dt;

    // Oversteer: past the limit the rear steps out, scaled by the drift stat.
    const excess = Math.max(0, this.gripUsage - 1);
    const overRotate = Math.sign(latDemand) * excess * L.driftiness * 1.35;
    const targetSlip = clamp(overRotate * 0.45, -0.62, 0.62);
    this.slipAngle = damp(this.slipAngle, targetSlip, 5.5, dt);

    const newHeading = this.velHeading + this.slipAngle;
    this.yawRate = angleDelta(this.heading, newHeading) / Math.max(dt, 1e-4);
    this.heading = newHeading;

    // Visual steering angle: what the front wheels would be doing.
    const wheelbase = 2.7;
    const steerTarget = clamp(Math.atan(cmdCurvature * wheelbase), -0.62, 0.62);
    this.steerAngle = damp(this.steerAngle, steerTarget, 12, dt);

    // --- 6. Longitudinal integration -------------------------------------
    // Scrub: sliding sideways and exceeding grip both cost speed.
    const scrub =
      Math.abs(Math.sin(this.slipAngle)) * this.speed * 1.6 + excess * this.speed * 0.55;
    const drag = L.drag * this.speed * this.speed;
    const rolling = this.surfaceDrag() * clamp01(this.speed / 18);

    this.speed += (longAccel - drag - scrub - rolling) * dt;
    this.speed = clamp(this.speed, 0, L.maxSpeed * 1.08);

    this.slipIntensity = damp(
      this.slipIntensity,
      clamp01(excess * 1.5 + Math.abs(this.slipAngle) * 1.8),
      6,
      dt,
    );

    // Body attitude for the 3D model.
    this.bodyRoll = damp(this.bodyRoll, clamp(-latApplied / 26, -0.14, 0.14), 6, dt);
    this.bodyPitch = damp(this.bodyPitch, clamp(-longAccel / 60, -0.06, 0.06), 7, dt);
    this.wheelSpin += (this.speed / 0.34) * dt;

    this.integrate(dt);

    // --- 7. Barriers ------------------------------------------------------
    this.resolveBarriers(collisions, dt);

    // --- 8. Lap accounting ------------------------------------------------
    this.updateProgress(raceTime);

    if (this.collisionCooldown > 0) this.collisionCooldown -= dt;

    // Anti-stuck: if a car ends up pinned against a barrier, nudge it back on.
    if (this.speed < 2.5 && this.surface === 'offTrack') {
      this.stuckTimer += dt;
      if (this.stuckTimer > 2.2) {
        const p = this.track.point(this.trackIndex);
        this.x = p.x;
        this.z = p.z;
        this.heading = Math.atan2(p.tz, p.tx);
        this.velHeading = this.heading;
        this.slipAngle = 0;
        this.speed = 8;
        this.stuckTimer = 0;
      }
    } else {
      this.stuckTimer = 0;
    }
  }

  private integrate(dt: number): void {
    this.x += Math.cos(this.velHeading) * this.speed * dt;
    this.z += Math.sin(this.velHeading) * this.speed * dt;
    const p = this.track.point(this.trackIndex);
    this.y = damp(this.y, p.y, 8, dt);
  }

  private resolveBarriers(collisions: CollisionEvent[], _dt: number): void {
    const proj = this.track.projectNear(this.x, this.z, this.trackIndex, 20);
    const maxLateral = proj.halfWidth + 13.5;
    const a = Math.abs(proj.lateral);
    if (a <= maxLateral) return;

    const p = this.track.point(proj.index);
    const sign = Math.sign(proj.lateral) || 1;
    const overshoot = a - maxLateral;

    // Push back inside and scrub velocity along the barrier.
    this.x -= p.nx * sign * overshoot;
    this.z -= p.nz * sign * overshoot;

    const barrierHeading = Math.atan2(p.tz, p.tx);
    const angle = angleDelta(barrierHeading, this.velHeading);
    const impact = Math.abs(Math.sin(angle)) * this.speed;

    this.speed *= clamp(1 - Math.abs(Math.sin(angle)) * 0.55, 0.35, 0.98);
    this.velHeading = barrierHeading + angleDelta(barrierHeading, this.velHeading) * 0.18;
    this.heading = this.velHeading;
    this.slipAngle *= 0.4;

    if (impact > 4 && this.collisionCooldown <= 0) {
      this.collisionCooldown = 0.35;
      this.contacts++;
      collisions.push({
        kind: 'barrier',
        intensity: clamp01(impact / 28),
        x: this.x,
        z: this.z,
      });
    }
  }

  private updateProgress(raceTime: number): void {
    const proj = this.track.projectNear(this.x, this.z, this.trackIndex, 20);
    const delta = this.track.deltaS(this.lastTrackS, proj.s);
    // Ignore teleport-sized jumps from a bad projection.
    if (Math.abs(delta) < this.track.totalLength * 0.35) {
      this.progress += delta;
    }
    this.lastTrackS = proj.s;

    const lapLength = this.track.totalLength;
    const newLap = Math.floor(this.progress / lapLength);
    if (newLap > this.lap) {
      const lapTime = raceTime - this.lapStartTime;
      if (this.lap >= 0 && lapTime > 3) {
        this.lastLapTime = lapTime;
        this.lapTimes.push(lapTime);
        if (lapTime < this.bestLapTime) this.bestLapTime = lapTime;
      }
      this.lapStartTime = raceTime;
      this.lap = newLap;
    }
  }

  /** Called by the race sim when the chequered flag is taken. */
  finish(raceTime: number): void {
    if (this.finished) return;
    const lapTime = raceTime - this.lapStartTime;
    if (lapTime > 3) {
      this.lastLapTime = lapTime;
      this.lapTimes.push(lapTime);
      if (lapTime < this.bestLapTime) this.bestLapTime = lapTime;
    }
    this.finished = true;
    this.finishTime = raceTime;
    this.throttle = 0;
    this.brakeLight = 0.6;
  }

  /** Starts a brief driver error - used by the AI difficulty model. */
  triggerMistake(magnitude: number): void {
    this.mistakeTimer = 0.6 + magnitude * 1.1;
    this.mistakeSteer = (Math.random() < 0.5 ? -1 : 1) * magnitude * 7;
    this.paceMultiplier = Math.max(0.55, this.paceMultiplier - magnitude * 0.12);
  }

  get speedKmh(): number {
    return this.speed * 3.6;
  }
}

/** Resolves a light, arcade-friendly collision between two cars. */
export const resolveCarCollision = (
  a: Vehicle,
  b: Vehicle,
  collisions: CollisionEvent[],
): void => {
  const radius = 1.45;
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const distSq = dx * dx + dz * dz;
  const minDist = radius * 2;
  if (distSq > minDist * minDist || distSq < 1e-6) return;

  const dist = Math.sqrt(distSq);
  const nx = dx / dist;
  const nz = dz / dist;
  const overlap = minDist - dist;

  // Mass-weighted separation.
  const ma = a.limits.mass;
  const mb = b.limits.mass;
  const total = ma + mb;
  a.x -= nx * overlap * (mb / total);
  a.z -= nz * overlap * (mb / total);
  b.x += nx * overlap * (ma / total);
  b.z += nz * overlap * (ma / total);

  // Relative closing speed along the contact normal.
  const avx = Math.cos(a.velHeading) * a.speed;
  const avz = Math.sin(a.velHeading) * a.speed;
  const bvx = Math.cos(b.velHeading) * b.speed;
  const bvz = Math.sin(b.velHeading) * b.speed;
  const rel = (bvx - avx) * nx + (bvz - avz) * nz;
  if (rel > 0) return; // already separating

  // Normal impulse with mild restitution. Rebuild each velocity vector so a
  // side hit actually rotates the car instead of only reducing a speed scalar.
  const restitution = 0.18;
  const impulse = clamp(-(1 + restitution) * rel / (1 / ma + 1 / mb), 0, 26000);
  const nextAvx = avx - (impulse / ma) * nx;
  const nextAvz = avz - (impulse / ma) * nz;
  const nextBvx = bvx + (impulse / mb) * nx;
  const nextBvz = bvz + (impulse / mb) * nz;
  a.speed = Math.max(0, Math.hypot(nextAvx, nextAvz) * 0.94);
  b.speed = Math.max(0, Math.hypot(nextBvx, nextBvz) * 0.94);
  if (a.speed > 0.5) a.velHeading = Math.atan2(nextAvz, nextAvx);
  if (b.speed > 0.5) b.velHeading = Math.atan2(nextBvz, nextBvx);
  a.slipAngle = clamp(a.slipAngle - impulse / ma * 0.018, -0.7, 0.7);
  b.slipAngle = clamp(b.slipAngle + impulse / mb * 0.018, -0.7, 0.7);
  const impact = impulse / Math.min(ma, mb);

  if (impulse > 1.2) {
    a.contacts++;
    b.contacts++;
    collisions.push({
      kind: 'car',
      intensity: clamp01(impact / 10),
      x: (a.x + b.x) * 0.5,
      z: (a.z + b.z) * 0.5,
    });
  }
};

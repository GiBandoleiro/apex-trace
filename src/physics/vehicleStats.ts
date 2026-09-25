/**
 * Translates the 0-100 designer stat scale into SI quantities the simulation
 * actually integrates. Keeping the conversion in one place means the garage UI
 * and the physics can never disagree about what a stat point is worth.
 */

import type { CarStats } from '@/cars/types';
import type { RunoffSurface, Weather } from '@/tracks/types';

export interface DrivetrainLimits {
  /** m/s */
  maxSpeed: number;
  /** m/s - the car never targets less than this while racing. */
  minSpeed: number;
  /** m/s^2 available for acceleration at low speed. */
  accel: number;
  /** m/s^2 available under braking. */
  brake: number;
  /** m/s^2 of lateral grip at zero speed. */
  lateralGrip: number;
  /** Extra lateral m/s^2 per (m/s)^2 of speed, from downforce. */
  downforceGain: number;
  /** Quadratic drag coefficient (1/m) used to converge on top speed. */
  drag: number;
  /** How quickly the chassis can change yaw, in rad/s^2 terms. */
  steerResponse: number;
  /** 0..1 - how readily the rear steps out once grip is exceeded. */
  driftiness: number;
  mass: number;
}

/** Surface grip multipliers - the runoff type defines what leaving the road costs. */
export const SURFACE_GRIP: Record<RunoffSurface, number> = {
  gravel: 0.52,
  grass: 0.58,
  concrete: 0.86,
  sand: 0.44,
  snow: 0.4,
  basalt: 0.62,
};

/** Rolling resistance added when off the racing surface (m/s^2). */
export const SURFACE_DRAG: Record<RunoffSurface, number> = {
  gravel: 8.5,
  grass: 6.5,
  concrete: 1.2,
  sand: 10.5,
  snow: 9,
  basalt: 5.5,
};

export const WEATHER_GRIP: Record<Weather, number> = {
  clear: 1,
  rain: 0.78,
  fog: 0.96,
  snow: 0.72,
};

export const computeLimits = (stats: CarStats, weatherGrip = 1): DrivetrainLimits => {
  const massFactor = Math.pow(1400 / Math.max(700, stats.weight), 0.38);

  const maxSpeed = 26 + stats.topSpeed * 0.66;
  const accel = (3.4 + stats.acceleration * 0.098) * massFactor;
  const brake = (7.5 + stats.braking * 0.145) * (0.82 + massFactor * 0.22);
  const lateralGrip = (6.4 + stats.grip * 0.108) * weatherGrip * (0.88 + massFactor * 0.16);
  const downforceGain = (stats.downforce * 0.000115) * weatherGrip;

  return {
    maxSpeed,
    minSpeed: 6,
    accel,
    brake,
    lateralGrip,
    downforceGain,
    // Chosen so the car asymptotes on maxSpeed rather than overshooting it.
    drag: accel / (maxSpeed * maxSpeed),
    steerResponse: 2.2 + stats.handling * 0.052,
    driftiness: Math.min(1, stats.drift / 110),
    mass: stats.weight,
  };
};

/** Theoretical cornering speed for a radius, used by the UI preview. */
export const cornerSpeedFor = (limits: DrivetrainLimits, curvature: number): number => {
  const k = Math.abs(curvature);
  if (k < 1e-5) return limits.maxSpeed;
  let v = Math.sqrt(limits.lateralGrip / k);
  for (let i = 0; i < 2; i++) {
    v = Math.sqrt((limits.lateralGrip + limits.downforceGain * v * v) / k);
  }
  return Math.min(v, limits.maxSpeed);
};

export const msToKmh = (v: number): number => v * 3.6;

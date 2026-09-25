/**
 * Race orchestration: grid, countdown, lap counting, live standings and the
 * result payload. Purely headless - it owns no Three.js objects, which keeps
 * the simulation testable and lets the renderer be swapped independently.
 */

import { TrackGeometry } from '@/tracks/TrackGeometry';
import { profileFromRacingLine, RacingPath } from '@/physics/RacingPath';
import { Vehicle, resolveCarCollision, type CollisionEvent } from '@/physics/VehiclePhysics';
import { computeLimits, WEATHER_GRIP } from '@/physics/vehicleStats';
import { applyUpgrades, EMPTY_UPGRADES, getCar, performanceRating } from '@/cars/catalog';
import type { CarCustomization, CarStats, UpgradeId } from '@/cars/types';
import type { TrackDefinition } from '@/tracks/types';
import { buildGrid, type Difficulty, type OpponentPlan } from './ai';
import { makeRng } from '@/utils/math';

export type RacePhase = 'draw' | 'countdown' | 'racing' | 'finished';

export interface RaceEntrant {
  vehicle: Vehicle;
  name: string;
  carId: string;
  customization: CarCustomization;
  isPlayer: boolean;
  plan?: OpponentPlan;
}

export interface Standing {
  id: string;
  name: string;
  position: number;
  lap: number;
  isPlayer: boolean;
  gapToLeader: number;
  finished: boolean;
  bestLap: number;
  lastLap: number;
}

export interface RaceResult {
  position: number;
  entrants: number;
  totalTime: number;
  bestLap: number;
  laps: number;
  cleanRace: boolean;
  contacts: number;
  offTrackTime: number;
  newTrackRecord: boolean;
  previousBest: number;
  difficulty: Difficulty;
  trackId: string;
  standings: Standing[];
}

export interface RaceSetup {
  track: TrackDefinition;
  geometry: TrackGeometry;
  playerCarId: string;
  playerUpgrades: Record<UpgradeId, number>;
  playerCustomization: CarCustomization;
  playerName: string;
  difficulty: Difficulty;
  opponentCount: number;
  laps: number;
  seed: number;
  /** Previous personal best for this track, in seconds (Infinity if none). */
  previousBest: number;
  /** Event modifiers, e.g. time attack removes opponents. */
  modifiers?: RaceModifiers;
}

export interface RaceModifiers {
  /** Multiplier on the player's solved target speed. */
  playerSpeedScale?: number;
  /** Disables braking entirely (NO BRAKES event). */
  noBrakes?: boolean;
  /** Scales the whole field's pace. */
  fieldPaceScale?: number;
}

const COUNTDOWN_SECONDS = 3.6;

export class RaceSimulation {
  readonly setup: RaceSetup;
  readonly geometry: TrackGeometry;
  readonly entrants: RaceEntrant[] = [];
  readonly player: RaceEntrant;

  phase: RacePhase = 'draw';
  raceTime = 0;
  countdown = COUNTDOWN_SECONDS;
  collisions: CollisionEvent[] = [];
  result: RaceResult | null = null;

  private readonly lapLength: number;
  private readonly rng: () => number;
  private standingsCache: Standing[] = [];
  private standingsTimer = 0;

  constructor(setup: RaceSetup) {
    this.setup = setup;
    this.geometry = setup.geometry;
    this.lapLength = setup.geometry.totalLength;
    this.rng = makeRng(setup.seed);

    const weatherGrip = WEATHER_GRIP[setup.track.weather];
    const grid = setup.geometry.startGrid(setup.opponentCount + 1);

    // --- Player ---------------------------------------------------------
    const playerCar = getCar(setup.playerCarId);
    const playerStats = applyUpgrades(playerCar.stats, setup.playerUpgrades);
    const playerLimits = computeLimits(playerStats, weatherGrip);
    if (setup.modifiers?.noBrakes) playerLimits.brake *= 0.28;

    // Player starts last on the grid - the draw mechanic is how you make it up.
    const playerSlot = grid[grid.length - 1];
    const placeholderPath = this.makeFallbackPath(playerLimits, 0.8);

    const playerVehicle = new Vehicle(
      {
        id: 'player',
        isPlayer: true,
        limits: playerLimits,
        path: placeholderPath,
        track: setup.geometry,
        runoff: setup.track.runoff,
        startX: playerSlot.x,
        startZ: playerSlot.z,
        startHeading: playerSlot.heading,
        gridSlot: grid.length - 1,
      },
      playerStats.nitro > 0,
    );

    this.player = {
      vehicle: playerVehicle,
      name: setup.playerName,
      carId: setup.playerCarId,
      customization: setup.playerCustomization,
      isPlayer: true,
    };

    // --- Opponents ------------------------------------------------------
    const plans = buildGrid(
      setup.opponentCount,
      setup.difficulty,
      setup.playerCarId,
      performanceRating(playerStats),
      setup.seed,
    );

    const fieldScale = setup.modifiers?.fieldPaceScale ?? 1;

    plans.forEach((plan, i) => {
      const upgrades: Record<UpgradeId, number> = { ...EMPTY_UPGRADES };
      for (const key of Object.keys(upgrades) as UpgradeId[]) {
        upgrades[key] = plan.upgradeLevel;
      }
      const stats: CarStats = applyUpgrades(plan.car.stats, upgrades);
      const limits = computeLimits(stats, weatherGrip);

      const profile = profileFromRacingLine(setup.geometry, this.rng, {
        lineNoise: plan.lineNoise,
        pace: plan.pace * fieldScale,
        paceNoise: plan.paceNoise,
      });
      const path = new RacingPath(setup.geometry, {
        offsets: profile.offsets,
        pace: profile.pace,
        limits,
        // Opponents drive within the grip they actually have. Skill decides how
        // close to the limit they are willing to run - never beyond it by much.
        respectLimits: 0.86 + plan.profile.skill * 0.17,
      });

      const slot = grid[i];
      const vehicle = new Vehicle(
        {
          id: `ai-${i}`,
          isPlayer: false,
          limits,
          path,
          track: setup.geometry,
          runoff: setup.track.runoff,
          startX: slot.x,
          startZ: slot.z,
          startHeading: slot.heading,
          gridSlot: i,
        },
        stats.nitro > 0,
      );

      this.entrants.push({
        vehicle,
        name: plan.profile.name,
        carId: plan.car.id,
        customization: this.liveryFor(plan, i),
        isPlayer: false,
        plan,
      });
    });

    this.entrants.push(this.player);
    this.updateStandings(true);
  }

  /** Gives each opponent a distinct but on-brand livery. */
  private liveryFor(plan: OpponentPlan, index: number): CarCustomization {
    const palette = [
      '#e04b3a', '#2f7fd8', '#3fbf85', '#e0a52c', '#8c5bd8',
      '#d8508f', '#2fb8c8', '#e8e9ec', '#4a5160', '#c8562c',
    ];
    const secondary = ['#12151c', '#f2f4f8', '#1b2430', '#e8eaee'];
    return {
      ...plan.car.defaults,
      primary: palette[index % palette.length],
      secondary: secondary[index % secondary.length],
      raceNumber: 2 + ((index * 7) % 96),
    };
  }

  /** A conservative path used before the player has drawn anything. */
  private makeFallbackPath(
    limits: ReturnType<typeof computeLimits>,
    pace: number,
  ): RacingPath {
    const n = this.geometry.sampleCount;
    const offsets = new Float32Array(n);
    const paceArr = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      offsets[i] = this.geometry.racingLine[i];
      paceArr[i] = pace;
    }
    return new RacingPath(this.geometry, {
      offsets,
      pace: paceArr,
      limits,
      respectLimits: 1,
    });
  }

  /** Installs the path the player drew and arms the countdown. */
  commitPlayerPath(path: RacingPath): void {
    this.player.vehicle.setPath(path);
    this.phase = 'countdown';
    this.countdown = COUNTDOWN_SECONDS;
  }

  /** Integer shown by the countdown overlay: 3, 2, 1, 0 = GO. */
  get countdownNumber(): number {
    return Math.max(0, Math.ceil(this.countdown - 0.6));
  }

  update(dt: number): void {
    this.collisions.length = 0;

    if (this.phase === 'countdown') {
      this.countdown -= dt;
      if (this.countdown <= 0) {
        this.phase = 'racing';
        this.raceTime = 0;
        for (const e of this.entrants) e.vehicle.lapStartTime = 0;
      }
      return;
    }

    if (this.phase !== 'racing') return;

    this.raceTime += dt;

    // Fixed-step integration keeps the physics stable on any frame rate.
    const maxStep = 1 / 90;
    let remaining = dt;
    let guard = 0;
    while (remaining > 1e-5 && guard < 8) {
      const step = Math.min(maxStep, remaining);
      this.substep(step);
      remaining -= step;
      guard++;
    }

    this.standingsTimer -= dt;
    if (this.standingsTimer <= 0) {
      this.updateStandings(false);
      this.standingsTimer = 0.2;
    }

    this.checkFinish();
  }

  private substep(dt: number): void {
    const target = this.lapLength * this.setup.laps;

    for (const e of this.entrants) {
      const v = e.vehicle;

      if (!v.isPlayer && e.plan && !v.finished) {
        // Driver errors: a Poisson-ish chance per second, scaled by how hard
        // the car is currently working.
        const stress = Math.min(1.6, v.gripUsage);
        const chance = e.plan.profile.mistakeChance * dt * (0.6 + stress * 0.9);
        if (this.rng() < chance) {
          v.triggerMistake(0.25 + this.rng() * 0.45 * (1 - e.plan.profile.skill));
        }
        // Recover pace after a mistake.
        if (v.mistakeTimer <= 0 && v.paceMultiplier < 1) {
          v.paceMultiplier = Math.min(1, v.paceMultiplier + dt * 0.55);
        }
        // Aggression: close up to the car ahead on straights.
        this.applySlipstream(e, dt);
      }

      v.step(dt, this.raceTime, this.collisions);

      if (!v.finished && v.progress >= target) {
        v.finish(this.raceTime);
      }
    }

    // Car-to-car contact, O(n^2) over a field of <= 12 - trivially cheap.
    for (let i = 0; i < this.entrants.length; i++) {
      for (let j = i + 1; j < this.entrants.length; j++) {
        resolveCarCollision(
          this.entrants[i].vehicle,
          this.entrants[j].vehicle,
          this.collisions,
        );
      }
    }
  }

  /** Simple tow effect: cars in clean air behind a rival gain a little pace. */
  private applySlipstream(entrant: RaceEntrant, dt: number): void {
    const v = entrant.vehicle;
    let closest = Infinity;
    for (const other of this.entrants) {
      if (other === entrant) continue;
      const d = other.vehicle.progress - v.progress;
      if (d > 0 && d < closest) closest = d;
    }
    const inTow = closest < 26 && closest > 2;
    const target = inTow ? 1 + (entrant.plan?.profile.aggression ?? 0.5) * 0.045 : 1;
    if (v.mistakeTimer <= 0) {
      v.paceMultiplier += (target - v.paceMultiplier) * Math.min(1, dt * 1.5);
    }
  }

  private updateStandings(force: boolean): void {
    const sorted = [...this.entrants].sort((a, b) => {
      const av = a.vehicle;
      const bv = b.vehicle;
      if (av.finished && bv.finished) return av.finishTime - bv.finishTime;
      if (av.finished) return -1;
      if (bv.finished) return 1;
      return bv.progress - av.progress;
    });

    const leader = sorted[0];
    this.standingsCache = sorted.map((e, i) => {
      e.vehicle.position = i + 1;
      const gapDistance = leader.vehicle.progress - e.vehicle.progress;
      const refSpeed = Math.max(12, leader.vehicle.speed);
      return {
        id: e.vehicle.id,
        name: e.name,
        position: i + 1,
        lap: Math.min(this.setup.laps, e.vehicle.lap + 1),
        isPlayer: e.isPlayer,
        gapToLeader: i === 0 ? 0 : gapDistance / refSpeed,
        finished: e.vehicle.finished,
        bestLap: e.vehicle.bestLapTime,
        lastLap: e.vehicle.lastLapTime,
      };
    });
    if (force) this.standingsTimer = 0;
  }

  get standings(): Standing[] {
    return this.standingsCache;
  }

  private checkFinish(): void {
    if (this.phase !== 'racing') return;
    if (!this.player.vehicle.finished) return;

    // Give the rest of the field a short window to cross the line, then end.
    const allDone = this.entrants.every((e) => e.vehicle.finished);
    const grace = this.raceTime - this.player.vehicle.finishTime;
    if (!allDone && grace < 4) return;

    this.updateStandings(true);
    const pv = this.player.vehicle;
    const cleanRace = pv.contacts === 0 && pv.offTrackTime < 1.5;
    const best = pv.bestLapTime;

    this.result = {
      position: pv.position,
      entrants: this.entrants.length,
      totalTime: pv.finishTime,
      bestLap: Number.isFinite(best) ? best : 0,
      laps: this.setup.laps,
      cleanRace,
      contacts: pv.contacts,
      offTrackTime: pv.offTrackTime,
      newTrackRecord:
        Number.isFinite(best) && best < this.setup.previousBest,
      previousBest: this.setup.previousBest,
      difficulty: this.setup.difficulty,
      trackId: this.setup.track.id,
      standings: this.standingsCache,
    };
    this.phase = 'finished';
  }

  /** Player-facing live telemetry for the HUD. */
  get telemetry() {
    const v = this.player.vehicle;
    return {
      speedKmh: v.speedKmh,
      position: v.position,
      entrants: this.entrants.length,
      lap: Math.min(this.setup.laps, v.lap + 1),
      laps: this.setup.laps,
      time: this.raceTime,
      lapTime: this.raceTime - v.lapStartTime,
      bestLap: v.bestLapTime,
      lastLap: v.lastLapTime,
      gripUsage: v.gripUsage,
      slip: v.slipIntensity,
      surface: v.surface,
      nitro: v.nitroCharge,
      nitroActive: v.nitroActive,
      finished: v.finished,
    };
  }
}

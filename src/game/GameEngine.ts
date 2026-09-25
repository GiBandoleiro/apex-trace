/**
 * The game engine.
 *
 * Owns the renderer, the scene graph, the camera rig, the visual layer for the
 * simulation and the render loop. The React UI never touches Three.js - it
 * calls methods here and receives state through callbacks, which keeps game
 * logic completely out of the components.
 */

import * as THREE from 'three';
import { AssetLibrary } from '@/assets/AssetLibrary';
import { CarVisual } from '@/cars/CarBuilder';
import { getCar } from '@/cars/catalog';
import type { CarCustomization } from '@/cars/types';
import { profileFromStrokes, RacingPath, type DrawnSample } from '@/physics/RacingPath';
import { computeLimits, WEATHER_GRIP } from '@/physics/vehicleStats';
import { applyUpgrades } from '@/cars/catalog';
import { RaceSimulation, type RaceResult, type RaceSetup, type Standing } from '@/systems/RaceSimulation';
import { getProfile, lowerTier, PerformanceMonitor, type QualityProfile, type QualityTier } from '@/systems/quality';
import { getTrack, TRACKS } from '@/tracks/catalog';
import { TrackGeometry } from '@/tracks/TrackGeometry';
import { buildTrackScene, type TrackScene } from '@/tracks/TrackBuilder';
import type { TrackDefinition } from '@/tracks/types';
import { AmbientMotes, ParticleSystem, SkidMarks } from './Effects';
import { CameraRig } from './CameraRig';
import { DangerMarkers, TrajectoryRenderer } from './TrajectoryRenderer';
import { InputController, type StrokePoint } from './InputController';
import { audio } from '@/audio/AudioEngine';
import { clamp, clamp01, damp } from '@/utils/math';

export type EnginePhase = 'idle' | 'loading' | 'menu' | 'draw' | 'countdown' | 'racing' | 'finished';

/**
 * How far past the physical cornering limit the player's drawn line is allowed
 * to ask for. Above 1 the car will understeer wide instead of obeying - which
 * is the whole point of the mechanic - but an unbounded target would make an
 * over-drawn line unrecoverable rather than merely slow.
 */
const PLAYER_OVERDRIVE = 1.6;

/**
 * Peak grip demand and a realistic lap estimate for a solved path. The estimate
 * uses the *achievable* speed (target capped at the grip limit), so it reflects
 * what the car can actually do rather than what the line asked for.
 */
const estimatePath = (path: RacingPath): { peak: number; lapTime: number } => {
  let peak = 0;
  let lapTime = 0;
  for (let i = 0; i < path.count; i++) {
    const p = path.point(i);
    const next = path.point(i + 1);
    if (p.limitSpeed > 0.01) peak = Math.max(peak, p.targetSpeed / p.limitSpeed);
    const a = Math.min(p.targetSpeed, p.limitSpeed);
    const b = Math.min(next.targetSpeed, next.limitSpeed);
    const ds = Math.hypot(next.x - p.x, next.z - p.z);
    lapTime += ds / Math.max(4, (a + b) * 0.5);
  }
  return { peak, lapTime };
};

export interface DrawState {
  hasLine: boolean;
  coverage: number;
  strokes: number;
  /** Highest demand/limit ratio anywhere on the line. */
  peakRisk: number;
  /** Estimated lap time for the drawn line, seconds. */
  estimatedLap: number;
}

export interface Telemetry {
  speedKmh: number;
  position: number;
  entrants: number;
  lap: number;
  laps: number;
  time: number;
  lapTime: number;
  bestLap: number;
  lastLap: number;
  gripUsage: number;
  slip: number;
  nitro: number;
  nitroActive: boolean;
  surface: string;
  finished: boolean;
  countdown: number;
  standings: Standing[];
}

export interface EngineCallbacks {
  onLoadProgress?: (progress: number, label: string) => void;
  onPhase?: (phase: EnginePhase) => void;
  onDrawState?: (state: DrawState) => void;
  onTelemetry?: (t: Telemetry) => void;
  onResult?: (r: RaceResult) => void;
  onFps?: (fps: number) => void;
  onQualityDrop?: (tier: QualityTier) => void;
  onPause?: (paused: boolean) => void;
}

export class GameEngine {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private rig: CameraRig;
  private assets: AssetLibrary;
  private quality: QualityProfile;
  private input: InputController | null = null;
  private callbacks: EngineCallbacks = {};
  private paused = false;

  private trackScene: TrackScene | null = null;
  private geometry: TrackGeometry | null = null;
  private trackDef: TrackDefinition | null = null;

  private sun = new THREE.DirectionalLight(0xffffff, 2.6);
  private hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
  private fill = new THREE.DirectionalLight(0xffffff, 0.4);

  private sim: RaceSimulation | null = null;
  private carVisuals = new Map<string, CarVisual>();
  private showcaseCar: CarVisual | null = null;
  private showcaseYaw = 0;
  private showcaseDistance = 10;

  private skid: SkidMarks;
  private particles: ParticleSystem;
  private motes: AmbientMotes | null = null;
  private trajectory = new TrajectoryRenderer();
  private danger = new DangerMarkers();

  private phase: EnginePhase = 'idle';
  private rafId = 0;
  private lastTime = 0;
  private elapsed = 0;
  private running = false;
  private perf = new PerformanceMonitor();
  private fpsAccum = 0;
  private fpsFrames = 0;
  private autoQuality = true;
  private currentTier: QualityTier;

  // Drawing state.
  private strokes: DrawnSample[][] = [];
  private activeStroke: DrawnSample[] = [];
  private livePoints: Array<{ x: number; z: number; y: number }> = [];
  private pendingPath: RacingPath | null = null;
  private drawState: DrawState = {
    hasLine: false,
    coverage: 0,
    strokes: 0,
    peakRisk: 0,
    estimatedLap: 0,
  };
  private raycastPoint = new THREE.Vector3();

  constructor(canvas: HTMLCanvasElement, tier: QualityTier) {
    this.currentTier = tier;
    this.quality = getProfile(tier);

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: tier !== 'low',
      powerPreference: 'high-performance',
      alpha: false,
      stencil: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.quality.maxPixelRatio));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.shadowMap.enabled = this.quality.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.rig = new CameraRig(canvas.clientWidth / Math.max(1, canvas.clientHeight));
    this.assets = new AssetLibrary(this.quality);

    this.skid = new SkidMarks(this.quality.skidPoolSize);
    this.particles = new ParticleSystem(Math.round(1200 * this.quality.particleScale) + 120);

    this.scene.add(this.sun);
    this.scene.add(this.hemi);
    this.scene.add(this.fill);
    this.scene.add(this.skid.mesh);
    this.scene.add(this.particles.points);
    this.scene.add(this.trajectory.group);
    this.scene.add(this.danger.group);

    this.sun.castShadow = this.quality.shadows;
    this.configureShadow();
  }

  /* ---------------------------------------------------------------- */
  /* Lifecycle                                                         */
  /* ---------------------------------------------------------------- */

  setCallbacks(cb: EngineCallbacks): void {
    this.callbacks = cb;
  }

  get currentPhase(): EnginePhase {
    return this.phase;
  }

  get qualityTier(): QualityTier {
    return this.currentTier;
  }

  private setPhase(phase: EnginePhase): void {
    if (this.phase === phase) return;
    this.phase = phase;
    this.callbacks.onPhase?.(phase);
  }

  async init(): Promise<void> {
    this.setPhase('loading');
    await this.assets.build(this.renderer, (p, label) => {
      this.callbacks.onLoadProgress?.(p, label);
    });
    this.scene.environment = this.assets.environment;
    this.start();
  }

  attachInput(el: HTMLElement): void {
    this.input?.dispose();
    this.input = new InputController(el, {
      onFirstGesture: () => void audio.unlock(),
      onStrokeStart: (p) => this.onStrokeStart(p),
      onStrokeMove: (p) => this.onStrokeMove(p),
      onStrokeEnd: () => this.onStrokeEnd(),
      onPan: (dx, dy) => {
        if (this.phase === 'draw') this.rig.pan(dx, dy, this.renderer.domElement.clientHeight);
      },
      onZoom: (f) => {
        if (this.phase === 'draw') this.rig.zoom(f);
      },
      onKey: (code) => this.onKey(code),
    });
    this.input.drawMode = this.phase === 'draw';
  }

  setAutoQuality(auto: boolean): void {
    this.autoQuality = auto;
  }

  resize(width: number, height: number): void {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.quality.maxPixelRatio));
    this.renderer.setSize(width, height, false);
    this.rig.resize(width, height);
  }

  setCameraShake(enabled: boolean): void {
    this.rig.shakeEnabled = enabled;
  }

  setReduceMotion(reduce: boolean): void {
    this.rig.yawFollow = !reduce;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    const loop = (now: number) => {
      this.rafId = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - this.lastTime) / 1000);
      this.lastTime = now;
      this.update(dt);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  dispose(): void {
    this.stop();
    this.input?.dispose();
    this.clearRace();
    this.disposeShowcase();
    this.trackScene?.dispose();
    this.skid.dispose();
    this.particles.dispose();
    this.motes?.dispose();
    this.trajectory.dispose();
    this.danger.dispose();
    this.assets.dispose();
    this.renderer.dispose();
  }

  /* ---------------------------------------------------------------- */
  /* Track / scene management                                          */
  /* ---------------------------------------------------------------- */

  private configureShadow(): void {
    const s = this.sun.shadow;
    s.mapSize.set(this.quality.shadowMapSize, this.quality.shadowMapSize);
    s.camera.near = 1;
    s.camera.far = 420;
    s.camera.left = -110;
    s.camera.right = 110;
    s.camera.top = 110;
    s.camera.bottom = -110;
    s.bias = -0.0006;
    s.normalBias = 0.04;
  }

  private applyPalette(def: TrackDefinition): void {
    const p = def.palette;
    this.scene.background = new THREE.Color(p.sky);
    this.scene.fog = new THREE.FogExp2(new THREE.Color(p.fog), p.fogDensity);

    this.sun.color = new THREE.Color(p.sunColor);
    this.sun.intensity = p.sunIntensity;
    const d = p.sunDirection;
    this.sun.position.set(d[0] * 180, d[1] * 180, d[2] * 180);
    this.sun.target.position.set(0, 0, 0);
    this.scene.add(this.sun.target);

    this.hemi.color = new THREE.Color(p.ambientColor);
    this.hemi.groundColor = new THREE.Color(p.groundColor);
    this.hemi.intensity = p.ambientIntensity;

    this.fill.color = new THREE.Color(p.ambientColor);
    this.fill.intensity = def.timeOfDay === 'night' ? 0.1 : 0.32;
    this.fill.position.set(-d[0] * 120, 90, -d[2] * 120);

    this.renderer.toneMappingExposure = def.timeOfDay === 'night' ? 1.45 : 1.15;
  }

  /** Builds (or rebuilds) the 3D circuit for a track id. */
  async loadTrack(trackId: string): Promise<void> {
    const def = getTrack(trackId);
    if (this.trackDef?.id === def.id && this.trackScene) return;

    this.trackScene?.dispose();
    if (this.trackScene) this.scene.remove(this.trackScene.group);

    this.assets.buildEnvironment(this.renderer, def.timeOfDay);
    this.scene.environment = this.assets.environment;

    this.trackDef = def;
    this.geometry = new TrackGeometry(def, this.quality.trackSegmentLength);
    this.trackScene = buildTrackScene(this.geometry, def, this.assets, this.quality);
    this.scene.add(this.trackScene.group);
    this.applyPalette(def);

    this.motes?.dispose();
    if (this.motes) this.scene.remove(this.motes.points);
    const moteCount = Math.round(260 * this.quality.particleScale);
    if (moteCount > 20) {
      this.motes = new AmbientMotes(
        moteCount,
        160,
        def.timeOfDay === 'night' ? 0x9ab4e8 : 0xfff0d0,
        def.timeOfDay === 'night' ? 0.28 : 0.2,
      );
      this.scene.add(this.motes.points);
    }

    this.rig.setBounds(this.geometry.bounds);
    this.skid.clear();
    this.particles.clear();
  }

  get trackGeometry(): TrackGeometry | null {
    return this.geometry;
  }

  /* ---------------------------------------------------------------- */
  /* Menu showcase                                                     */
  /* ---------------------------------------------------------------- */

  private disposeShowcase(): void {
    if (this.showcaseCar) {
      this.scene.remove(this.showcaseCar.root);
      this.showcaseCar.dispose();
      this.showcaseCar = null;
    }
  }

  /** Parks a car on the circuit and starts the slow menu camera orbit. */
  async showcase(trackId: string, carId: string, custom: CarCustomization): Promise<void> {
    await this.loadTrack(trackId);
    this.clearRace();
    this.disposeShowcase();
    this.trajectory.clear();
    this.danger.clear();

    const def = getCar(carId);
    const visual = new CarVisual(def, custom, {
      envMap: this.assets.environment,
      castShadow: this.quality.shadows,
      detail: 2,
      lightsOn: this.trackDef?.timeOfDay === 'night',
    });
    const geo = this.geometry!;
    const p = geo.point(Math.floor(geo.sampleCount * 0.02));
    visual.root.position.set(p.x, p.y + 0.02, p.z);
    visual.root.rotation.y = Math.PI / 2 - Math.atan2(p.tz, p.tx);
    this.scene.add(visual.root);
    this.showcaseCar = visual;

    this.rig.showcase(new THREE.Vector3(p.x, 1.2, p.z), 16, 0, 0);
    this.setPhase('menu');
    if (this.input) this.input.drawMode = false;
    audio.startAmbience('menu', this.trackDef?.timeOfDay ?? 'day');
  }

  zoomTrack(factor: number): void {
    if (this.phase === 'draw') this.rig.zoom(factor);
  }

  rotateShowcase(delta: number): void {
    this.showcaseYaw += delta;
  }

  zoomShowcase(factor: number): void {
    this.showcaseDistance = Math.max(6, Math.min(28, this.showcaseDistance * factor));
  }

  /** Swaps the showcased car in place - used when browsing the garage. */
  updateShowcaseCar(carId: string, custom: CarCustomization): void {
    if (!this.geometry || this.phase !== 'menu') return;
    const prev = this.showcaseCar;
    const def = getCar(carId);
    const visual = new CarVisual(def, custom, {
      envMap: this.assets.environment,
      castShadow: this.quality.shadows,
      detail: 2,
      lightsOn: this.trackDef?.timeOfDay === 'night',
    });
    const geo = this.geometry;
    const p = geo.point(Math.floor(geo.sampleCount * 0.02));
    visual.root.position.set(p.x, p.y + 0.02, p.z);
    visual.root.rotation.y = Math.PI / 2 - Math.atan2(p.tz, p.tx);
    this.scene.add(visual.root);
    this.showcaseCar = visual;
    if (prev) {
      this.scene.remove(prev.root);
      prev.dispose();
    }
  }

  /* ---------------------------------------------------------------- */
  /* Race                                                              */
  /* ---------------------------------------------------------------- */

  private clearRace(): void {
    for (const v of this.carVisuals.values()) {
      this.scene.remove(v.root);
      v.dispose();
    }
    this.carVisuals.clear();
    this.sim = null;
    this.strokes = [];
    this.activeStroke = [];
    this.livePoints = [];
    this.pendingPath = null;
  }

  /** Builds the grid and enters the drawing phase. */
  async beginRace(setup: Omit<RaceSetup, 'geometry'>): Promise<void> {
    this.paused = false;
    this.callbacks.onPause?.(false);
    await this.loadTrack(setup.track.id);
    this.clearRace();
    this.disposeShowcase();

    const sim = new RaceSimulation({ ...setup, geometry: this.geometry! });
    this.sim = sim;

    const nightLights = this.trackDef?.timeOfDay === 'night';
    for (const e of sim.entrants) {
      const def = getCar(e.carId);
      const detail: 0 | 1 | 2 = e.isPlayer ? 2 : this.quality.environmentDetail >= 2 ? 1 : 0;
      const visual = new CarVisual(def, e.customization, {
        envMap: this.assets.environment,
        castShadow: this.quality.shadows && (e.isPlayer || this.quality.environmentDetail >= 2),
        detail,
        lightsOn: nightLights,
      });
      visual.root.position.set(e.vehicle.x, e.vehicle.y, e.vehicle.z);
      visual.root.rotation.y = Math.PI / 2 - e.vehicle.heading;
      this.scene.add(visual.root);
      this.carVisuals.set(e.vehicle.id, visual);
    }

    this.skid.clear();
    this.particles.clear();
    this.rig.mode = 'overview';
    this.rig.frameBounds(this.geometry!.bounds, 1.7, true);
    this.trajectory.clear();
    this.trajectory.visible = true;
    this.danger.clear();
    this.resetDrawState();
    this.setPhase('draw');
    if (this.input) this.input.drawMode = true;
    audio.startAmbience('track', this.trackDef?.timeOfDay ?? 'day', this.trackDef?.weather);
  }

  /* ---------------------------------------------------------------- */
  /* Drawing                                                           */
  /* ---------------------------------------------------------------- */

  private resetDrawState(): void {
    this.drawState = {
      hasLine: false,
      coverage: 0,
      strokes: 0,
      peakRisk: 0,
      estimatedLap: 0,
    };
    this.callbacks.onDrawState?.(this.drawState);
  }

  private onStrokeStart(p: StrokePoint): void {
    if (this.phase !== 'draw') return;
    this.activeStroke = [];
    this.livePoints = [];
    this.appendStrokeSample(p);
    const point = this.livePoints[0];
    if (point && this.geometry) {
      this.rig.focusOverview(point.x, point.z);
      this.rig.zoom(0.65);
    }
  }

  private onStrokeMove(p: StrokePoint): void {
    if (this.phase !== 'draw' || this.activeStroke.length === 0) return;
    this.appendStrokeSample(p);
    const speeds = this.activeStroke.slice(1).map((sample, i) => {
      const previous = this.activeStroke[i];
      return Math.hypot(sample.x - previous.x, sample.z - previous.z) / Math.max(1 / 120, sample.t - previous.t);
    });
    const sorted = [...speeds].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] || 1;
    this.trajectory.drawPolyline(this.livePoints, 3.5, speeds.map((speed) => Math.max(0.08, Math.min(1.2, 0.62 * speed / median))));
    const tail = this.livePoints[this.livePoints.length - 1];
    if (tail) this.rig.focusOverview(tail.x, tail.z);
  }

  private appendStrokeSample(p: StrokePoint): void {
    const hit = this.rig.screenToGround(p.ndcX, p.ndcY, this.raycastPoint);
    if (!hit) return;
    const last = this.activeStroke[this.activeStroke.length - 1];
    if (last && Math.hypot(hit.x - last.x, hit.z - last.z) < 0.9) return;
    this.activeStroke.push({ x: hit.x, z: hit.z, t: p.t });
    const station = this.geometry?.project(hit.x, hit.z).index;
    const height = station === undefined ? 0 : this.geometry!.point(station).y;
    this.livePoints.push({ x: hit.x, z: hit.z, y: height });
  }

  private onStrokeEnd(): void {
    if (this.phase !== 'draw') return;
    if (this.geometry) this.rig.frameBounds(this.geometry.bounds, 1.7, false);
    if (this.activeStroke.length < 3) {
      this.activeStroke = [];
      this.livePoints = [];
      if (this.pendingPath) this.trajectory.drawPath(this.pendingPath);
      else this.trajectory.clear();
      return;
    }
    this.strokes.push(this.activeStroke);
    this.activeStroke = [];
    this.livePoints = [];
    this.rebuildPath();
    audio.ui('click');
  }

  private rebuildPath(): void {
    if (!this.geometry || !this.sim) return;
    if (this.strokes.length === 0) {
      this.pendingPath = null;
      this.trajectory.clear();
      this.danger.clear();
      this.resetDrawState();
      return;
    }

    const profile = profileFromStrokes(this.geometry, this.strokes);
    const limits = this.sim.player.vehicle.limits;
    const path = new RacingPath(this.geometry, {
      offsets: profile.offsets,
      pace: profile.pace,
      limits,
      respectLimits: PLAYER_OVERDRIVE,
    });
    this.pendingPath = path;
    this.trajectory.drawPath(path);
    this.danger.update(path, 0);

    const { peak, lapTime } = estimatePath(path);

    this.drawState = {
      hasLine: true,
      coverage: profile.coverage,
      strokes: this.strokes.length,
      peakRisk: peak,
      estimatedLap: lapTime,
    };
    this.callbacks.onDrawState?.(this.drawState);
  }

  clearLine(): void {
    this.strokes = [];
    this.activeStroke = [];
    this.livePoints = [];
    this.rebuildPath();
    audio.ui('back');
  }

  undoLine(): void {
    if (this.strokes.length === 0) return;
    this.strokes.pop();
    this.rebuildPath();
    audio.ui('back');
  }

  /** Uses the computed ideal racing line - a one-tap assist. */
  useSuggestedLine(): void {
    if (!this.geometry || !this.sim) return;
    const n = this.geometry.sampleCount;
    const offsets = new Float32Array(n);
    const pace = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      offsets[i] = this.geometry.racingLine[i];
      pace[i] = 0.98;
    }
    const path = new RacingPath(this.geometry, {
      offsets,
      pace,
      limits: this.sim.player.vehicle.limits,
      respectLimits: 1,
    });
    this.pendingPath = path;
    this.trajectory.drawPath(path);
    this.danger.update(path, 0);

    const { peak, lapTime } = estimatePath(path);
    this.drawState = {
      hasLine: true,
      coverage: 1,
      strokes: 0,
      peakRisk: peak,
      estimatedLap: lapTime,
    };
    this.callbacks.onDrawState?.(this.drawState);
    audio.ui('confirm');
  }

  /** Locks the line in and triggers the countdown. */
  confirmLine(): boolean {
    if (!this.sim || !this.pendingPath) return false;
    this.sim.commitPlayerPath(this.pendingPath);
    this.trajectory.opacity = 0.55;
    const player = this.sim.player.vehicle;
    this.rig.startFollow(player.x, player.z, player.heading);
    this.setPhase('countdown');
    if (this.input) this.input.drawMode = false;
    audio.startEngine();
    audio.ui('confirm');
    return true;
  }

  private onKey(code: string): void {
    switch (code) {
      case 'KeyR':
        if (this.phase === 'draw') this.clearLine();
        break;
      case 'KeyP':
        this.togglePause();
        break;
      case 'KeyZ':
        if (this.phase === 'draw') this.undoLine();
        break;
      case 'Enter':
      case 'Space':
        if (this.phase === 'draw') this.confirmLine();
        break;
      default:
        break;
    }
  }

  togglePause(): void {
    if (this.phase !== 'racing' && this.phase !== 'countdown') return;
    this.paused = !this.paused;
    audio.setRacePaused(this.paused);
    this.callbacks.onPause?.(this.paused);
  }

  /* ---------------------------------------------------------------- */
  /* Frame                                                             */
  /* ---------------------------------------------------------------- */

  private update(dt: number): void {
    this.elapsed += dt;
    this.perf.sample(dt);
    this.fpsAccum += dt;
    this.fpsFrames++;
    if (this.fpsAccum >= 0.5) {
      this.callbacks.onFps?.(this.fpsFrames / this.fpsAccum);
      this.fpsAccum = 0;
      this.fpsFrames = 0;
    }
    if (this.autoQuality && this.perf.shouldDowngrade()) {
      const next = lowerTier(this.currentTier);
      if (next !== this.currentTier) {
        this.currentTier = next;
        this.quality = getProfile(next);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.quality.maxPixelRatio));
        this.renderer.shadowMap.enabled = this.quality.shadows;
        this.sun.castShadow = this.quality.shadows;
        this.callbacks.onQualityDrop?.(next);
      }
    }

    this.trajectory.update(dt);

    switch (this.phase) {
      case 'menu':
        this.updateMenu(dt);
        break;
      case 'draw':
        this.rig.update(dt);
        if (this.pendingPath) this.danger.update(this.pendingPath, dt);
        break;
      case 'countdown':
      case 'racing':
      case 'finished':
        this.updateRace(dt);
        break;
      default:
        this.rig.update(dt);
        break;
    }

    this.updateFog(dt);
    this.particles.update(dt);
    this.skid.fade(dt);
    this.motes?.update(dt, this.rig.target.x, this.rig.target.z);
    this.updateShadowFocus();

    this.renderer.render(this.scene, this.rig.camera);
  }

  /**
   * Atmospheric fog is lovely at car height and ruins a whole-circuit overview,
   * so the density follows the camera: almost clear while drawing, full during
   * the race.
   */
  private updateFog(dt: number): void {
    const fog = this.scene.fog as THREE.FogExp2 | null;
    if (!fog || !this.trackDef) return;
    const base = this.trackDef.palette.fogDensity;
    const target = this.phase === 'draw' || this.phase === 'menu' ? base * 0.1 : base;
    fog.density = damp(fog.density, target, 3.5, dt);
  }

  private updateShadowFocus(): void {
    if (!this.quality.shadows) return;
    // Keep the shadow frustum tight around whatever the camera is looking at.
    const t = this.rig.target;
    const d = this.trackDef?.palette.sunDirection ?? [0.4, 0.8, 0.4];
    this.sun.position.set(t.x + d[0] * 140, d[1] * 140, t.z + d[2] * 140);
    this.sun.target.position.set(t.x, 0, t.z);
    this.sun.target.updateMatrixWorld();
    const span = this.phase === 'draw' ? 200 : 70;
    const cam = this.sun.shadow.camera;
    if (cam.left !== -span) {
      cam.left = -span;
      cam.right = span;
      cam.top = span;
      cam.bottom = -span;
      cam.updateProjectionMatrix();
    }
  }

  private updateMenu(dt: number): void {
    if (!this.showcaseCar) {
      this.rig.update(dt);
      return;
    }
    const p = this.showcaseCar.root.position;
    this.rig.showcase(new THREE.Vector3(p.x, 1.1, p.z), this.showcaseDistance, dt, this.elapsed);
    this.rig.yaw += this.showcaseYaw;
    this.rig.update(dt);
    this.showcaseCar.update({
      speed: 0,
      steerAngle: Math.sin(this.elapsed * 0.4) * 0.12,
      brakeLight: 0,
      bodyRoll: 0,
      bodyPitch: 0,
      wheelSpin: 0,
    });
  }

  private updateRace(dt: number): void {
    const sim = this.sim;
    if (!sim) return;

    const prevCountdown = sim.countdownNumber;
    if (!this.paused) sim.update(dt);

    if (sim.phase === 'racing' && this.phase === 'countdown') this.setPhase('racing');
    if (sim.phase === 'countdown' && sim.countdownNumber !== prevCountdown) {
      audio.ui(sim.countdownNumber === 0 ? 'go' : 'countdown');
    }

    // Visuals.
    const runoffTint = this.runoffTint();
    for (const e of sim.entrants) {
      const v = e.vehicle;
      const visual = this.carVisuals.get(v.id);
      if (!visual) continue;
      visual.root.position.set(v.x, v.y, v.z);
      visual.root.rotation.y = Math.PI / 2 - v.heading;
      visual.update({
        speed: v.speed,
        steerAngle: v.steerAngle,
        brakeLight: v.brakeLight,
        bodyRoll: v.bodyRoll,
        bodyPitch: v.bodyPitch,
        wheelSpin: v.wheelSpin,
      });

      // Tyre smoke + skid marks when sliding.
      if (v.slipIntensity > 0.14 && v.speed > 6) {
        const strength = clamp01(v.slipIntensity);
        this.skid.emit(v.id, v.x, v.z, v.y, v.heading, 1.7, strength * 0.9);
        if (Math.random() < strength * this.quality.particleScale * 0.9) {
          this.particles.spawn(
            'smoke',
            v.x - Math.cos(v.heading) * 1.4,
            v.y + 0.25,
            v.z - Math.sin(v.heading) * 1.4,
            (Math.random() - 0.5) * 2,
            0.6 + Math.random(),
            (Math.random() - 0.5) * 2,
            0.8 + strength,
          );
        }
      }
      // Dust off the racing surface.
      if ((v.surface === 'runoff' || v.surface === 'offTrack') && v.speed > 8) {
        if (Math.random() < 0.7 * this.quality.particleScale) {
          this.particles.spawn(
            'dust',
            v.x - Math.cos(v.heading) * 1.2,
            v.y + 0.2,
            v.z - Math.sin(v.heading) * 1.2,
            (Math.random() - 0.5) * 3,
            1 + Math.random() * 1.5,
            (Math.random() - 0.5) * 3,
            1.1,
            runoffTint,
          );
        }
      }
    }

    // Collisions -> sparks, shake and audio.
    for (const c of sim.collisions) {
      audio.collision(c.intensity, c.kind);
      if (c.kind === 'barrier') {
        const count = Math.round(6 + c.intensity * 14 * this.quality.particleScale);
        for (let i = 0; i < count; i++) {
          this.particles.spawn(
            'spark',
            c.x,
            0.4,
            c.z,
            (Math.random() - 0.5) * 12,
            Math.random() * 5,
            (Math.random() - 0.5) * 12,
            1,
          );
        }
      }
      const player = sim.player.vehicle;
      const near = Math.hypot(player.x - c.x, player.z - c.z) < 12;
      if (near) this.rig.addShake(c.intensity * 0.55);
    }

    // Camera.
    const pv = sim.player.vehicle;
    const speedRatio = clamp01(pv.speed / pv.limits.maxSpeed);
    if (sim.phase === 'countdown') {
      this.rig.follow(pv.x, pv.z, pv.heading, 0, 0, dt);
    } else {
      const ahead = pv.path.sampleAhead(pv.pathIndex, 20);
      this.rig.follow(pv.x, pv.z, pv.heading, speedRatio, ahead.curvature, dt);
    }
    this.rig.update(dt);

    // Audio.
    if (!this.paused) audio.updateEngine(speedRatio, pv.throttle, pv.slipIntensity, dt);

    // Telemetry out to the HUD.
    const t = sim.telemetry;
    this.callbacks.onTelemetry?.({
      ...t,
      countdown: sim.phase === 'countdown' ? sim.countdownNumber : -1,
      standings: sim.standings,
    });

    if (sim.phase === 'finished' && this.phase !== 'finished') {
      this.setPhase('finished');
      audio.stopEngine();
      if (sim.result) {
        this.callbacks.onResult?.(sim.result);
        audio.ui(sim.result.position === 1 ? 'victory' : 'defeat');
      }
    }
  }

  private runoffTint(): [number, number, number] {
    switch (this.trackDef?.runoff) {
      case 'sand':
        return [0.82, 0.7, 0.48];
      case 'snow':
        return [0.9, 0.93, 0.97];
      case 'basalt':
        return [0.26, 0.23, 0.24];
      case 'grass':
        return [0.45, 0.5, 0.3];
      case 'concrete':
        return [0.62, 0.62, 0.62];
      default:
        return [0.6, 0.55, 0.45];
    }
  }

  /** Frames the whole circuit again - used by the "view track" button. */
  frameTrack(): void {
    if (!this.geometry) return;
    this.rig.mode = 'overview';
    this.rig.frameBounds(this.geometry.bounds, 1.7, false);
  }

  /** Cheap top-down snapshot of the circuit for the track-select cards. */
  static renderTrackThumbnail(trackId: string, size = 220): string {
    const def = getTrack(trackId);
    const geo = new TrackGeometry(def, 6);
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;

    const b = geo.bounds;
    const w = b.maxX - b.minX;
    const h = b.maxZ - b.minZ;
    const scale = (size * 0.84) / Math.max(w, h);
    const ox = size / 2 - ((b.minX + b.maxX) / 2) * scale;
    const oy = size / 2 - ((b.minZ + b.maxZ) / 2) * scale;

    ctx.clearRect(0, 0, size, size);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const trace = (width: number, color: string) => {
      ctx.beginPath();
      for (let i = 0; i <= geo.sampleCount; i++) {
        const p = geo.point(i);
        const x = p.x * scale + ox;
        const y = p.z * scale + oy;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.lineWidth = width;
      ctx.strokeStyle = color;
      ctx.stroke();
    };

    trace(Math.max(6, geo.point(0).halfWidth * scale * 2.4), 'rgba(255,255,255,0.10)');
    trace(Math.max(4, geo.point(0).halfWidth * scale * 1.7), '#2a2f3a');
    trace(1.2, 'rgba(255,255,255,0.35)');

    // Start/finish marker.
    const p0 = geo.point(0);
    ctx.fillStyle = '#ff8a3d';
    ctx.beginPath();
    ctx.arc(p0.x * scale + ox, p0.z * scale + oy, 4.5, 0, Math.PI * 2);
    ctx.fill();

    return canvas.toDataURL();
  }

  /** Static stats for the track-select cards. */
  static trackStats(trackId: string): { lengthM: number; corners: number } {
    const def = getTrack(trackId);
    const geo = new TrackGeometry(def, 5);
    return { lengthM: Math.round(geo.totalLength), corners: geo.countCorners() };
  }

  static allTrackIds(): string[] {
    return TRACKS.map((t) => t.id);
  }

  /** Recomputes drivetrain limits for the garage preview. */
  static previewLimits(carId: string, upgrades: Parameters<typeof applyUpgrades>[1]) {
    const car = getCar(carId);
    return computeLimits(applyUpgrades(car.stats, upgrades), WEATHER_GRIP.clear);
  }

  get simulation(): RaceSimulation | null {
    return this.sim;
  }

  get result(): RaceResult | null {
    return this.sim?.result ?? null;
  }

  /** Returns to the idle/menu state after a race. */
  exitRace(): void {
    this.paused = false;
    this.callbacks.onPause?.(false);
    audio.stopEngine();
    this.clearRace();
    this.trajectory.clear();
    this.trajectory.opacity = 1;
    this.danger.clear();
    this.setPhase('idle');
  }

  /** Utility used by the settings screen to preview a quality change. */
  applyQuality(tier: QualityTier): void {
    this.currentTier = tier;
    this.quality = getProfile(tier);
    this.assets.setProfile(this.quality);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.quality.maxPixelRatio));
    this.renderer.shadowMap.enabled = this.quality.shadows;
    this.sun.castShadow = this.quality.shadows;
    this.configureShadow();
    this.perf.reset();
  }

  get cameraDistance(): number {
    return this.rig.distance;
  }

  /** Exposed so the HUD can render a mini-map aligned with the world. */
  worldToScreen(x: number, z: number, y = 0): { x: number; y: number; visible: boolean } {
    const v = new THREE.Vector3(x, y, z).project(this.rig.camera);
    return {
      x: (v.x * 0.5 + 0.5) * this.renderer.domElement.clientWidth,
      y: (-v.y * 0.5 + 0.5) * this.renderer.domElement.clientHeight,
      visible: v.z < 1 && Math.abs(v.x) < 1.4 && Math.abs(v.y) < 1.4,
    };
  }

  /** Dev-only: describes the current scene graph for debugging. */
  debugScene(): Array<Record<string, unknown>> {
    const out: Array<Record<string, unknown>> = [];
    const box = new THREE.Box3();
    this.trackScene?.group.traverse((o) => {
      if (!(o as THREE.Mesh).isMesh && !(o as THREE.InstancedMesh).isInstancedMesh) return;
      box.setFromObject(o);
      const mat = (o as THREE.Mesh).material as THREE.MeshStandardMaterial;
      out.push({
        name: o.name || o.type,
        type: o.type,
        visible: o.visible,
        material: mat
          ? {
              color: `#${mat.color?.getHexString?.() ?? '??'}`,
              hasMap: !!mat.map,
              mapSize: mat.map?.image ? `${mat.map.image.width}x${mat.map.image.height}` : 'none',
              side: mat.side,
              repeat: mat.map ? [mat.map.repeat.x, mat.map.repeat.y] : null,
            }
          : null,
        box: [box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z].map((v) =>
          Math.round(v * 100) / 100,
        ),
      });
    });
    return out;
  }

  get elapsedTime(): number {
    return this.elapsed;
  }

  get gripHint(): number {
    return clamp(this.drawState.peakRisk, 0, 3);
  }
}

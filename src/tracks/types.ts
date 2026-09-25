/** Shared vocabulary for circuit authoring. */

export type TimeOfDay = 'day' | 'sunset' | 'night';

/** Weather is authored now; `rain`/`fog`/`snow` drive grip and VFX. */
export type Weather = 'clear' | 'rain' | 'fog' | 'snow';

export type CurbStyle = 'red' | 'blue' | 'yellow';

export type RunoffSurface = 'gravel' | 'grass' | 'concrete' | 'sand' | 'snow' | 'basalt';

export type TrackTheme =
  | 'city'
  | 'coast'
  | 'desert'
  | 'alpine'
  | 'forest'
  | 'nightCity'
  | 'industrial'
  | 'grand'
  | 'winter'
  | 'volcanic';

/** A control point of the circuit centreline, in world metres. */
export interface TrackNode {
  x: number;
  z: number;
  /** Optional local half-width override, in metres. */
  width?: number;
}

export interface EnvironmentPalette {
  /** Scene fog / horizon colour. */
  sky: string;
  fog: string;
  fogDensity: number;
  /** Key (sun / moon) light. */
  sunColor: string;
  sunIntensity: number;
  /** Direction of the key light as a unit-ish vector. */
  sunDirection: [number, number, number];
  ambientColor: string;
  ambientIntensity: number;
  /** Bounce light from the ground, tinted by the terrain. */
  groundColor: string;
  /** Base ground/terrain tint multiplier. */
  terrainTint: string;
}

export interface TrackDefinition {
  id: string;
  name: string;
  /** Fictional location - deliberately not a real circuit. */
  country: string;
  theme: TrackTheme;
  /** 1..5 stars. */
  difficulty: number;
  laps: number;
  timeOfDay: TimeOfDay;
  weather: Weather;
  curbStyle: CurbStyle;
  runoff: RunoffSurface;
  /** Half-width of the racing surface in metres (track is 2x this wide). */
  halfWidth: number;
  /** Closed loop of centreline control points. */
  nodes: TrackNode[];
  /** Player level required to unlock. 0 = available from the start. */
  unlockLevel: number;
  /** Coin price; 0 = free once the level requirement is met. */
  unlockCost: number;
  /** Baseline pace of the field, used to scale AI targets. */
  paceFactor: number;
  palette: EnvironmentPalette;
  /** Short flavour line shown on the track card. */
  tagline: string;
  /** Seed for deterministic prop scattering. */
  seed: number;
}

/** A single resampled point of the circuit centreline. */
export interface CenterlinePoint {
  x: number;
  z: number;
  /** Unit tangent. */
  tx: number;
  tz: number;
  /** Unit left-hand normal. */
  nx: number;
  nz: number;
  /** Arc length from the start/finish line. */
  s: number;
  /** Signed curvature (1/radius); positive = turning left. */
  curvature: number;
  /** Local half-width. */
  halfWidth: number;
  /** Track surface elevation, in metres. */
  y: number;
}

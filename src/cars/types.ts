/** Vehicle data model - stats, visual design language and customisation. */

export type CarClass =
  | 'city'
  | 'sport'
  | 'gt'
  | 'muscle'
  | 'rally'
  | 'super'
  | 'hyper'
  | 'track'
  | 'prototype';

export const CAR_CLASS_LABEL: Record<CarClass, string> = {
  city: 'City',
  sport: 'Sport',
  gt: 'GT',
  muscle: 'Muscle',
  rally: 'Rally',
  super: 'Super',
  hyper: 'Hypercar',
  track: 'Track',
  prototype: 'Prototype',
};

/** All stats are on a 0-100 designer scale; physics converts to SI. */
export interface CarStats {
  topSpeed: number;
  acceleration: number;
  braking: number;
  handling: number;
  grip: number;
  /** Kerb weight in kg - affects inertia and collision response. */
  weight: number;
  downforce: number;
  /** How readily the car rotates past the limit; high = playful, low = stable. */
  drift: number;
  /** 0 = no boost system fitted. */
  nitro: number;
}

export type UpgradeId =
  | 'engine'
  | 'transmission'
  | 'brakes'
  | 'tires'
  | 'suspension'
  | 'aero'
  | 'weight';

export interface UpgradeDefinition {
  id: UpgradeId;
  label: string;
  description: string;
  maxLevel: number;
  /** Coin cost of moving from level i to level i+1. */
  costs: number[];
  /** Stat deltas applied per level (index 0 = level 1). */
  effects: Array<Partial<CarStats>>;
}

/** Visual design descriptor consumed by the procedural car builder. */
export interface CarDesign {
  /** Overall body length / width in metres. */
  length: number;
  width: number;
  /** Roof height above the ground. */
  height: number;
  /** Ground clearance of the floor pan. */
  rideHeight: number;
  /** Where the cabin sits along the body, 0 = nose, 1 = tail. */
  cabinCenter: number;
  cabinLength: number;
  cabinWidth: number;
  /** Cabin roof height relative to the body shoulder line. */
  cabinRise: number;
  /** Nose and tail taper factors (1 = square, 0.4 = very pointed). */
  noseTaper: number;
  tailTaper: number;
  /** Shoulder flare over the wheel arches. */
  flare: number;
  wheelRadius: number;
  wheelWidth: number;
  /** Axle positions measured from the body centre (metres, +Z = rear). */
  frontAxle: number;
  rearAxle: number;
  /** Rear wing: 0 = none, 1 = lip, 2 = pedestal wing, 3 = swan-neck. */
  wing: 0 | 1 | 2 | 3;
  wingWidth: number;
  wingHeight: number;
  /** Side intake pods (GT / prototype look). */
  sideIntakes: boolean;
  /** Roof scoop (rally / prototype). */
  roofScoop: boolean;
  /** Exposed diffuser fins at the rear. */
  diffuser: boolean;
  /** Front splitter lip. */
  splitter: boolean;
  /** Headlight style. */
  lights: 'round' | 'slim' | 'wide' | 'stacked';
  /** Canopy style: bubble (prototype), fastback, notch (muscle/city). */
  canopy: 'bubble' | 'fastback' | 'notch';
  /** Livery stripe treatment used by the paint system. */
  stripe: 'none' | 'center' | 'dual' | 'wedge';
}

export type PaintFinish = 'gloss' | 'matte' | 'metallic' | 'pearl';

export type WheelStyle = 'split5' | 'mesh' | 'turbine' | 'dish' | 'multispoke';

export type DecalId =
  | 'none'
  | 'stripes'
  | 'arrow'
  | 'blocks'
  | 'flames'
  | 'carbon'
  | 'halftone';

export interface CarCustomization {
  primary: string;
  secondary: string;
  finish: PaintFinish;
  wheelStyle: WheelStyle;
  wheelColor: string;
  decal: DecalId;
  raceNumber: number;
  /** Extra rear wing fitted regardless of the base design. */
  spoiler: boolean;
  /** Tinted glass. */
  tint: boolean;
}

export interface CarDefinition {
  id: string;
  name: string;
  /** Fictional marque. */
  make: string;
  carClass: CarClass;
  price: number;
  unlockLevel: number;
  stats: CarStats;
  design: CarDesign;
  defaults: CarCustomization;
  /** Flavour copy on the garage card. */
  blurb: string;
}

/** Player-owned instance of a car. */
export interface OwnedCar {
  id: string;
  upgrades: Record<UpgradeId, number>;
  customization: CarCustomization;
}

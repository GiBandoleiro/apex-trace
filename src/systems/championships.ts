/** Championship series and one-off special events. */

import type { Difficulty } from './ai';
import type { RaceModifiers } from './RaceSimulation';

export interface ChampionshipDefinition {
  id: string;
  name: string;
  description: string;
  tier: number;
  unlockLevel: number;
  difficulty: Difficulty;
  /** Track ids, in running order. */
  races: string[];
  entryFee: number;
  prize: number;
  /** Class restriction, or null for open. */
  carClassFilter: string[] | null;
}

export const CHAMPIONSHIPS: ChampionshipDefinition[] = [
  {
    id: 'rookie-cup',
    name: 'Rookie Cup',
    description: 'Three rounds to learn the draw. Forgiving field, real rewards.',
    tier: 1,
    unlockLevel: 0,
    difficulty: 'easy',
    races: ['sunset-circuit', 'city-rush', 'coastline-gp'],
    entryFee: 0,
    prize: 3200,
    carClassFilter: null,
  },
  {
    id: 'coastal-series',
    name: 'Coastal Series',
    description: 'Fast, flowing circuits where a smooth line is everything.',
    tier: 2,
    unlockLevel: 4,
    difficulty: 'normal',
    races: ['coastline-gp', 'sunset-circuit', 'forest-run', 'dune-prospect'],
    entryFee: 900,
    prize: 9000,
    carClassFilter: null,
  },
  {
    id: 'night-league',
    name: 'Night League',
    description: 'City circuits after dark. Walls close, margins closer.',
    tier: 3,
    unlockLevel: 8,
    difficulty: 'hard',
    races: ['neon-district', 'city-rush', 'foundry-works', 'alpine-pass'],
    entryFee: 2200,
    prize: 22000,
    carClassFilter: null,
  },
  {
    id: 'apex-world-series',
    name: 'Apex World Series',
    description: 'The full calendar. Five rounds, no weak links, no second chances.',
    tier: 4,
    unlockLevel: 14,
    difficulty: 'expert',
    races: ['grand-circuit', 'caldera', 'frostline', 'neon-district', 'grand-circuit'],
    entryFee: 6000,
    prize: 68000,
    carClassFilter: null,
  },
];

export const getChampionship = (id: string): ChampionshipDefinition | undefined =>
  CHAMPIONSHIPS.find((c) => c.id === id);

/* ------------------------------------------------------------------ */
/* Events                                                              */
/* ------------------------------------------------------------------ */

export type EventKind =
  | 'timeAttack'
  | 'noBrakes'
  | 'highSpeed'
  | 'perfectLine'
  | 'endurance';

export interface EventDefinition {
  id: string;
  kind: EventKind;
  name: string;
  description: string;
  trackId: string;
  laps: number;
  opponents: number;
  difficulty: Difficulty;
  unlockLevel: number;
  reward: number;
  xp: number;
  modifiers: RaceModifiers;
  /** Objective text shown on the card and in the result screen. */
  objective: string;
}

export const EVENTS: EventDefinition[] = [
  {
    id: 'ta-sunset',
    kind: 'timeAttack',
    name: 'Sunset Time Attack',
    description: 'Empty circuit. Just you, the line and the clock.',
    trackId: 'sunset-circuit',
    laps: 3,
    opponents: 0,
    difficulty: 'normal',
    unlockLevel: 1,
    reward: 1600,
    xp: 320,
    modifiers: {},
    objective: 'Set the fastest lap you can with no traffic.',
  },
  {
    id: 'nb-city',
    kind: 'noBrakes',
    name: 'No Brakes: City Rush',
    description: 'Brakes are down to 28%. Your drawn line has to do the slowing.',
    trackId: 'city-rush',
    laps: 2,
    opponents: 5,
    difficulty: 'normal',
    unlockLevel: 3,
    reward: 2600,
    xp: 480,
    modifiers: { noBrakes: true },
    objective: 'Finish on the podium without functioning brakes.',
  },
  {
    id: 'hs-desert',
    kind: 'highSpeed',
    name: 'High Speed Run',
    description: 'The longest straight in the series, and a field that will not lift.',
    trackId: 'dune-prospect',
    laps: 3,
    opponents: 7,
    difficulty: 'hard',
    unlockLevel: 5,
    reward: 4200,
    xp: 640,
    modifiers: { fieldPaceScale: 1.03 },
    objective: 'Win against a field running maximum commitment.',
  },
  {
    id: 'pl-forest',
    kind: 'perfectLine',
    name: 'Perfect Line',
    description: 'Contact and off-track excursions are heavily penalised.',
    trackId: 'forest-run',
    laps: 3,
    opponents: 6,
    difficulty: 'hard',
    unlockLevel: 7,
    reward: 5200,
    xp: 720,
    modifiers: {},
    objective: 'Win with a completely clean race.',
  },
  {
    id: 'end-grand',
    kind: 'endurance',
    name: 'Grand Endurance',
    description: 'Eight laps of the flagship circuit. Consistency wins this one.',
    trackId: 'grand-circuit',
    laps: 8,
    opponents: 9,
    difficulty: 'expert',
    unlockLevel: 12,
    reward: 12000,
    xp: 1500,
    modifiers: {},
    objective: 'Survive eight laps and finish in the points.',
  },
];

export const getEvent = (id: string): EventDefinition | undefined =>
  EVENTS.find((e) => e.id === id);

export const EVENT_LABEL: Record<EventKind, string> = {
  timeAttack: 'Time Attack',
  noBrakes: 'No Brakes',
  highSpeed: 'High Speed',
  perfectLine: 'Perfect Line',
  endurance: 'Endurance',
};

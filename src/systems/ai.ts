/**
 * Opponent drivers.
 *
 * The AI does not cheat: every opponent is a `Vehicle` running the identical
 * physics and the identical `RacingPath` structure the player gets. Difficulty
 * changes the quality of the line they draw, the pace they commit to and how
 * often they make a mistake - never their grip or power.
 */

import type { CarDefinition } from '@/cars/types';
import { CARS } from '@/cars/catalog';
import { makeRng } from '@/utils/math';

export type Difficulty = 'easy' | 'normal' | 'hard' | 'expert';

export interface DriverProfile {
  name: string;
  /** 0..1 - overall quality of the line they take. */
  skill: number;
  /** 0..1 - willingness to lean on a rival and defend. */
  aggression: number;
  /** 0..1 - how late and how accurately they brake. */
  braking: number;
  /** 0..1 - commitment through corners. */
  cornering: number;
  /** Probability per second of a small error. */
  mistakeChance: number;
}

const FIRST_NAMES = [
  'Mika', 'Dario', 'Elena', 'Kai', 'Noor', 'Tomas', 'Ines', 'Rafa',
  'Lena', 'Yuki', 'Sven', 'Ada', 'Bruno', 'Zara', 'Otto', 'Nadia',
  'Luca', 'Petra', 'Imani', 'Soren',
];

const LAST_NAMES = [
  'Varga', 'Kessler', 'Moreau', 'Okonkwo', 'Halvorsen', 'Ferraz', 'Lindqvist',
  'Bellini', 'Novak', 'Aaltonen', 'Duarte', 'Sokolov', 'Marchetti', 'Rask',
  'Ibarra', 'Tanaka', 'Weiss', 'Cortez', 'Brennan', 'Adler',
];

export const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  easy: 'Easy',
  normal: 'Normal',
  hard: 'Hard',
  expert: 'Expert',
};

interface DifficultyBand {
  /** Base pace as a fraction of the car's maximum. */
  pace: number;
  paceSpread: number;
  skill: number;
  skillSpread: number;
  /** Lateral wander of their line, in metres. Lower = tidier. */
  lineNoise: number;
  mistakeChance: number;
  /** Multiplier on the opponent car's effective stats (kept at 1 - no cheating). */
  statScale: number;
}

const BANDS: Record<Difficulty, DifficultyBand> = {
  easy: {
    pace: 0.74,
    paceSpread: 0.06,
    skill: 0.42,
    skillSpread: 0.16,
    lineNoise: 2.6,
    mistakeChance: 0.055,
    statScale: 1,
  },
  normal: {
    pace: 0.85,
    paceSpread: 0.05,
    skill: 0.62,
    skillSpread: 0.14,
    lineNoise: 1.7,
    mistakeChance: 0.03,
    statScale: 1,
  },
  hard: {
    pace: 0.94,
    paceSpread: 0.04,
    skill: 0.8,
    skillSpread: 0.1,
    lineNoise: 1.0,
    mistakeChance: 0.014,
    statScale: 1,
  },
  expert: {
    pace: 1.0,
    paceSpread: 0.03,
    skill: 0.93,
    skillSpread: 0.06,
    lineNoise: 0.6,
    mistakeChance: 0.006,
    statScale: 1,
  },
};

export interface OpponentPlan {
  profile: DriverProfile;
  car: CarDefinition;
  /** Pace factor fed to the racing-path solver. */
  pace: number;
  paceNoise: number;
  lineNoise: number;
  /** Upgrade level applied uniformly, so opponents scale with the player. */
  upgradeLevel: number;
}

/**
 * Builds a grid of opponents. Cars are chosen from a performance band around
 * the player's own car so races stay competitive without rubber-banding.
 */
export const buildGrid = (
  count: number,
  difficulty: Difficulty,
  playerCarId: string,
  playerRating: number,
  seed: number,
): OpponentPlan[] => {
  const rng = makeRng(seed);
  const band = BANDS[difficulty];
  const out: OpponentPlan[] = [];

  // Candidate cars sorted by how close their base rating is to the player's.
  const candidates = CARS.filter((c) => c.id !== playerCarId);
  const ratingOf = (c: CarDefinition) =>
    c.stats.topSpeed * 0.3 + c.stats.acceleration * 0.3 + c.stats.handling * 0.2 + c.stats.grip * 0.2;
  candidates.sort((a, b) => Math.abs(ratingOf(a) - playerRating) - Math.abs(ratingOf(b) - playerRating));

  const pool = candidates.slice(0, Math.max(4, Math.min(candidates.length, count + 3)));
  const usedNames = new Set<string>();

  for (let i = 0; i < count; i++) {
    let name = '';
    let guard = 0;
    do {
      const f = FIRST_NAMES[Math.floor(rng() * FIRST_NAMES.length)];
      const l = LAST_NAMES[Math.floor(rng() * LAST_NAMES.length)];
      name = `${f} ${l}`;
      guard++;
    } while (usedNames.has(name) && guard < 20);
    usedNames.add(name);

    const skill = clampUnit(band.skill + (rng() * 2 - 1) * band.skillSpread);
    // Faster drivers start further up the grid.
    const pace = band.pace + (rng() * 2 - 1) * band.paceSpread;

    out.push({
      profile: {
        name,
        skill,
        aggression: clampUnit(0.35 + rng() * 0.5 + (difficulty === 'expert' ? 0.12 : 0)),
        braking: clampUnit(skill * 0.85 + rng() * 0.2),
        cornering: clampUnit(skill * 0.9 + rng() * 0.15),
        mistakeChance: band.mistakeChance * (1.6 - skill),
      },
      car: pool[i % pool.length],
      pace,
      paceNoise: 0.1 + (1 - skill) * 0.22,
      lineNoise: band.lineNoise * (1.25 - skill * 0.6),
      upgradeLevel: Math.round(clampUnit(skill) * 4 * band.statScale),
    });
  }

  // Grid order: quickest projected pace on pole.
  out.sort((a, b) => b.pace - a.pace);
  return out;
};

const clampUnit = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Reward multiplier for beating a harder field. */
export const DIFFICULTY_REWARD: Record<Difficulty, number> = {
  easy: 0.75,
  normal: 1,
  hard: 1.35,
  expert: 1.8,
};

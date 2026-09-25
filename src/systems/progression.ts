/** Player level curve, race payouts and unlock rules. */

import type { RaceResult } from './RaceSimulation';
import { DIFFICULTY_REWARD } from './ai';
import type { TrackDefinition } from '@/tracks/types';

/** XP required to go from `level` to `level + 1`. */
export const xpForLevel = (level: number): number =>
  Math.round(420 * Math.pow(level, 1.32));

export const totalXpForLevel = (level: number): number => {
  let sum = 0;
  for (let l = 1; l < level; l++) sum += xpForLevel(l);
  return sum;
};

export interface LevelState {
  level: number;
  xpIntoLevel: number;
  xpForNext: number;
  progress: number;
}

export const levelStateFromXp = (xp: number): LevelState => {
  let level = 1;
  let remaining = xp;
  let need = xpForLevel(level);
  while (remaining >= need && level < 99) {
    remaining -= need;
    level++;
    need = xpForLevel(level);
  }
  return {
    level,
    xpIntoLevel: remaining,
    xpForNext: need,
    progress: need > 0 ? remaining / need : 1,
  };
};

export interface RewardLine {
  label: string;
  coins: number;
  xp: number;
}

export interface RaceRewards {
  lines: RewardLine[];
  totalCoins: number;
  totalXp: number;
}

const POSITION_COINS = [900, 640, 480, 360, 290, 240, 200, 170, 150, 130, 120, 110];
const POSITION_XP = [260, 200, 160, 130, 110, 95, 85, 75, 68, 62, 58, 54];

export const computeRewards = (
  result: RaceResult,
  track: TrackDefinition,
  isFirstWin: boolean,
): RaceRewards => {
  const lines: RewardLine[] = [];
  const idx = Math.min(POSITION_COINS.length - 1, Math.max(0, result.position - 1));
  const diffMul = DIFFICULTY_REWARD[result.difficulty];
  const trackMul = 0.85 + track.difficulty * 0.12;

  const finishCoins = Math.round(POSITION_COINS[idx] * diffMul * trackMul);
  const finishXp = Math.round(POSITION_XP[idx] * diffMul);
  lines.push({
    label: result.position === 1 ? 'Victory' : `Finished P${result.position}`,
    coins: finishCoins,
    xp: finishXp,
  });

  if (result.cleanRace) {
    lines.push({
      label: 'Clean race',
      coins: Math.round(180 * diffMul),
      xp: Math.round(70 * diffMul),
    });
  }

  if (result.newTrackRecord) {
    lines.push({ label: 'New track record', coins: Math.round(320 * trackMul), xp: 120 });
  } else if (
    Number.isFinite(result.previousBest) &&
    result.bestLap > 0 &&
    result.bestLap < result.previousBest
  ) {
    lines.push({ label: 'Personal best improved', coins: 160, xp: 60 });
  }

  if (isFirstWin && result.position === 1) {
    lines.push({ label: 'First win here', coins: Math.round(500 * trackMul), xp: 200 });
  }

  // Finishing every lap of a longer race pays proportionally more.
  if (result.laps > 3) {
    lines.push({ label: 'Distance bonus', coins: (result.laps - 3) * 90, xp: (result.laps - 3) * 35 });
  }

  const totalCoins = lines.reduce((s, l) => s + l.coins, 0);
  const totalXp = lines.reduce((s, l) => s + l.xp, 0);
  return { lines, totalCoins, totalXp };
};

/** Championship points table (top 10 score). */
export const CHAMPIONSHIP_POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];

export const pointsForPosition = (position: number): number =>
  CHAMPIONSHIP_POINTS[position - 1] ?? 0;

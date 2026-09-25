import type { CarCustomization, UpgradeId } from '@/cars/types';
import type { Difficulty } from '@/systems/ai';
import type { QualityTier } from '@/systems/quality';

export interface SavedCar {
  id: string;
  upgrades: Record<UpgradeId, number>;
  customization: CarCustomization;
}

export interface TrackRecord {
  bestLap: number;
  bestTotal: number;
  wins: number;
  races: number;
}

export interface GameSettings {
  masterVolume: number;
  sfxVolume: number;
  musicVolume: number;
  quality: QualityTier | 'auto';
  difficulty: Difficulty;
  showRacingLine: boolean;
  cameraShake: boolean;
  reduceMotion: boolean;
  hapticFeedback: boolean;
  units: 'kmh' | 'mph';
}

export interface ChampionshipProgress {
  id: string;
  /** Index of the next race to run. */
  raceIndex: number;
  /** Points per entrant id, keyed by driver name for the AI. */
  points: Record<string, number>;
  completed: boolean;
}

export interface PlayerProfile {
  version: number;
  name: string;
  coins: number;
  xp: number;
  level: number;
  selectedCarId: string;
  ownedCars: SavedCar[];
  unlockedTracks: string[];
  records: Record<string, TrackRecord>;
  settings: GameSettings;
  championships: Record<string, ChampionshipProgress>;
  completedEvents: string[];
  totalRaces: number;
  totalWins: number;
  createdAt: number;
  updatedAt: number;
}

/** Storage backend contract - localStorage today, cloud save later. */
export interface ProfileRepository {
  load(): Promise<PlayerProfile | null>;
  save(profile: PlayerProfile): Promise<void>;
  clear(): Promise<void>;
}

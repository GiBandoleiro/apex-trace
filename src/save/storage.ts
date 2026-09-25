/**
 * Local persistence.
 *
 * Writes through a small repository interface so an online account backend can
 * be dropped in later without touching any caller. Saves are debounced and
 * versioned, and a corrupt or future-version payload degrades to a fresh
 * profile rather than crashing the game.
 */

import { CARS, DEFAULT_CAR_ID, EMPTY_UPGRADES, getCar } from '@/cars/catalog';
import { TRACKS } from '@/tracks/catalog';
import type { PlayerProfile, ProfileRepository, SavedCar } from './types';

export const SAVE_KEY = 'apex-trace.profile.v1';
export const SAVE_VERSION = 1;

export const createDefaultProfile = (): PlayerProfile => {
  const starter = getCar(DEFAULT_CAR_ID);
  const now = Date.now();
  return {
    version: SAVE_VERSION,
    name: 'Driver',
    coins: 6500,
    xp: 0,
    level: 1,
    selectedCarId: starter.id,
    ownedCars: [
      {
        id: starter.id,
        upgrades: { ...EMPTY_UPGRADES },
        customization: { ...starter.defaults },
      },
    ],
    unlockedTracks: TRACKS.filter((t) => t.unlockLevel === 0 && t.unlockCost === 0).map(
      (t) => t.id,
    ),
    records: {},
    settings: {
      masterVolume: 0.8,
      sfxVolume: 0.9,
      musicVolume: 0.45,
      quality: 'auto',
      difficulty: 'normal',
      showRacingLine: true,
      cameraShake: true,
      reduceMotion: false,
      hapticFeedback: true,
      units: 'kmh',
    },
    championships: {},
    completedEvents: [],
    totalRaces: 0,
    totalWins: 0,
    createdAt: now,
    updatedAt: now,
  };
};

/** Repairs a loaded profile so new content added in an update is valid. */
export const normalizeProfile = (raw: unknown): PlayerProfile | null => {
  if (!raw || typeof raw !== 'object') return null;
  const base = createDefaultProfile();
  const p = raw as Partial<PlayerProfile>;

  if (typeof p.version !== 'number' || p.version > SAVE_VERSION) return null;

  const validCarIds = new Set(CARS.map((c) => c.id));
  const ownedCars: SavedCar[] = Array.isArray(p.ownedCars)
    ? p.ownedCars
        .filter((c): c is SavedCar => !!c && typeof c.id === 'string' && validCarIds.has(c.id))
        .map((c) => {
          const def = getCar(c.id);
          return {
            id: c.id,
            upgrades: { ...EMPTY_UPGRADES, ...(c.upgrades ?? {}) },
            customization: { ...def.defaults, ...(c.customization ?? {}) },
          };
        })
    : base.ownedCars;

  if (ownedCars.length === 0) ownedCars.push(base.ownedCars[0]);

  const validTrackIds = new Set(TRACKS.map((t) => t.id));
  const unlockedTracks = Array.isArray(p.unlockedTracks)
    ? p.unlockedTracks.filter((t) => typeof t === 'string' && validTrackIds.has(t))
    : base.unlockedTracks;
  for (const t of base.unlockedTracks) {
    if (!unlockedTracks.includes(t)) unlockedTracks.push(t);
  }

  const selectedCarId = ownedCars.some((c) => c.id === p.selectedCarId)
    ? (p.selectedCarId as string)
    : ownedCars[0].id;

  return {
    version: SAVE_VERSION,
    name: typeof p.name === 'string' && p.name.trim() ? p.name.slice(0, 18) : base.name,
    coins: Number.isFinite(p.coins) ? Math.max(0, Math.floor(p.coins as number)) : base.coins,
    xp: Number.isFinite(p.xp) ? Math.max(0, Math.floor(p.xp as number)) : 0,
    level: Number.isFinite(p.level) ? Math.max(1, Math.floor(p.level as number)) : 1,
    selectedCarId,
    ownedCars,
    unlockedTracks,
    records: typeof p.records === 'object' && p.records ? p.records : {},
    settings: { ...base.settings, ...(p.settings ?? {}) },
    championships:
      typeof p.championships === 'object' && p.championships ? p.championships : {},
    completedEvents: Array.isArray(p.completedEvents) ? p.completedEvents : [],
    totalRaces: Number.isFinite(p.totalRaces) ? (p.totalRaces as number) : 0,
    totalWins: Number.isFinite(p.totalWins) ? (p.totalWins as number) : 0,
    createdAt: Number.isFinite(p.createdAt) ? (p.createdAt as number) : base.createdAt,
    updatedAt: Date.now(),
  };
};

export class LocalProfileRepository implements ProfileRepository {
  private readonly key: string;

  constructor(key = SAVE_KEY) {
    this.key = key;
  }

  async load(): Promise<PlayerProfile | null> {
    try {
      const raw = localStorage.getItem(this.key);
      if (!raw) return null;
      return normalizeProfile(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  async save(profile: PlayerProfile): Promise<void> {
    try {
      localStorage.setItem(this.key, JSON.stringify({ ...profile, updatedAt: Date.now() }));
    } catch {
      // Quota or private-mode failures must never break gameplay.
    }
  }

  async clear(): Promise<void> {
    try {
      localStorage.removeItem(this.key);
    } catch {
      /* ignore */
    }
  }
}

/** Debounced writer so rapid store mutations do not thrash localStorage. */
export class SaveScheduler {
  private timer: number | null = null;
  private pending: PlayerProfile | null = null;

  constructor(
    private readonly repo: ProfileRepository,
    private readonly delay = 400,
  ) {}

  schedule(profile: PlayerProfile): void {
    this.pending = profile;
    if (this.timer !== null) return;
    this.timer = window.setTimeout(() => {
      this.timer = null;
      if (this.pending) {
        void this.repo.save(this.pending);
        this.pending = null;
      }
    }, this.delay);
  }

  flush(): void {
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.pending) {
      void this.repo.save(this.pending);
      this.pending = null;
    }
  }
}

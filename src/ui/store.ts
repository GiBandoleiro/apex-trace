/**
 * Application state.
 *
 * Holds the player profile, the current screen and the race request. No
 * Three.js and no simulation code lives here - the store describes intent, the
 * engine carries it out.
 */

import { create } from 'zustand';
import {
  applyUpgrades,
  CARS,
  EMPTY_UPGRADES,
  getCar,
  performanceRating,
  upgradeCost,
} from '@/cars/catalog';
import type { CarCustomization, UpgradeId } from '@/cars/types';
import { TRACKS, getTrack } from '@/tracks/catalog';
import type { RaceModifiers, RaceResult } from '@/systems/RaceSimulation';
import type { Difficulty } from '@/systems/ai';
import { computeRewards, levelStateFromXp, pointsForPosition } from '@/systems/progression';
import { CHAMPIONSHIPS, EVENTS, getChampionship, getEvent } from '@/systems/championships';
import {
  createDefaultProfile,
  LocalProfileRepository,
  SaveScheduler,
} from '@/save/storage';
import type { GameSettings, PlayerProfile, SavedCar } from '@/save/types';
import { audio } from '@/audio/AudioEngine';
import type { QualityTier } from '@/systems/quality';

export type Screen =
  | 'boot'
  | 'menu'
  | 'garage'
  | 'customize'
  | 'tracks'
  | 'championship'
  | 'events'
  | 'settings'
  | 'race';

export interface RaceRequest {
  trackId: string;
  laps: number;
  opponents: number;
  difficulty: Difficulty;
  modifiers?: RaceModifiers;
  /** Set when the race is part of a series. */
  championshipId?: string;
  eventId?: string;
  seed: number;
}

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'success' | 'error';
}

interface GameState {
  profile: PlayerProfile;
  screen: Screen;
  previousScreen: Screen;
  booted: boolean;
  loadProgress: number;
  loadLabel: string;
  raceRequest: RaceRequest | null;
  lastResult: RaceResult | null;
  lastRewards: ReturnType<typeof computeRewards> | null;
  levelUp: number | null;
  toasts: Toast[];
  engineReady: boolean;
  fps: number;

  /* actions */
  boot: () => Promise<void>;
  setScreen: (screen: Screen) => void;
  goBack: () => void;
  setLoad: (progress: number, label: string) => void;
  setEngineReady: (ready: boolean) => void;
  setFps: (fps: number) => void;

  selectCar: (carId: string) => void;
  buyCar: (carId: string) => boolean;
  buyUpgrade: (carId: string, upgrade: UpgradeId) => boolean;
  customizeCar: (carId: string, patch: Partial<CarCustomization>) => void;

  unlockTrack: (trackId: string) => boolean;

  updateSettings: (patch: Partial<GameSettings>) => void;
  setPlayerName: (name: string) => void;
  resetProfile: () => void;

  requestRace: (req: RaceRequest) => void;
  completeRace: (result: RaceResult) => void;
  clearResult: () => void;

  pushToast: (text: string, kind?: Toast['kind']) => void;
  dismissToast: (id: number) => void;
}

const repo = new LocalProfileRepository();
const saver = new SaveScheduler(repo);
let toastId = 1;

const persist = (profile: PlayerProfile): PlayerProfile => {
  saver.schedule(profile);
  return profile;
};

export const useGame = create<GameState>((set, get) => ({
  profile: createDefaultProfile(),
  screen: 'boot',
  previousScreen: 'menu',
  booted: false,
  loadProgress: 0,
  loadLabel: 'Starting engine',
  raceRequest: null,
  lastResult: null,
  lastRewards: null,
  levelUp: null,
  toasts: [],
  engineReady: false,
  fps: 60,

  async boot() {
    const loaded = await repo.load();
    const profile = loaded ?? createDefaultProfile();
    set({ profile, booted: true });
    audio.setVolumes(
      profile.settings.masterVolume,
      profile.settings.sfxVolume,
      profile.settings.musicVolume,
    );
  },

  setScreen(screen) {
    const current = get().screen;
    if (current === screen) return;
    audio.ui(screen === 'menu' ? 'back' : 'click');
    set({ screen, previousScreen: current });
  },

  goBack() {
    const { screen } = get();
    const fallback: Record<Screen, Screen> = {
      boot: 'menu',
      menu: 'menu',
      garage: 'menu',
      customize: 'garage',
      tracks: 'menu',
      championship: 'menu',
      events: 'menu',
      settings: 'menu',
      race: 'menu',
    };
    audio.ui('back');
    set({ screen: fallback[screen], previousScreen: screen });
  },

  setLoad(loadProgress, loadLabel) {
    set({ loadProgress, loadLabel });
  },

  setEngineReady(engineReady) {
    set({ engineReady });
  },

  setFps(fps) {
    set({ fps });
  },

  selectCar(carId) {
    const profile = get().profile;
    if (!profile.ownedCars.some((c) => c.id === carId)) return;
    audio.ui('confirm');
    set({ profile: persist({ ...profile, selectedCarId: carId }) });
  },

  buyCar(carId) {
    const state = get();
    const profile = state.profile;
    const def = getCar(carId);
    const level = levelStateFromXp(profile.xp).level;

    if (profile.ownedCars.some((c) => c.id === carId)) return false;
    if (level < def.unlockLevel) {
      state.pushToast(`Reach level ${def.unlockLevel} to buy the ${def.name}`, 'error');
      audio.ui('error');
      return false;
    }
    if (profile.coins < def.price) {
      state.pushToast('Not enough coins', 'error');
      audio.ui('error');
      return false;
    }

    const owned: SavedCar = {
      id: carId,
      upgrades: { ...EMPTY_UPGRADES },
      customization: { ...def.defaults },
    };
    audio.ui('purchase');
    state.pushToast(`${def.make} ${def.name} added to your garage`, 'success');
    set({
      profile: persist({
        ...profile,
        coins: profile.coins - def.price,
        ownedCars: [...profile.ownedCars, owned],
        selectedCarId: carId,
      }),
    });
    return true;
  },

  buyUpgrade(carId, upgrade) {
    const state = get();
    const profile = state.profile;
    const car = profile.ownedCars.find((c) => c.id === carId);
    if (!car) return false;
    const level = car.upgrades[upgrade] ?? 0;
    const cost = upgradeCost(upgrade, level);
    if (cost === null) {
      state.pushToast('Already at maximum level', 'error');
      return false;
    }
    if (profile.coins < cost) {
      state.pushToast('Not enough coins', 'error');
      audio.ui('error');
      return false;
    }
    audio.ui('upgrade');
    set({
      profile: persist({
        ...profile,
        coins: profile.coins - cost,
        ownedCars: profile.ownedCars.map((c) =>
          c.id === carId
            ? { ...c, upgrades: { ...c.upgrades, [upgrade]: level + 1 } }
            : c,
        ),
      }),
    });
    return true;
  },

  customizeCar(carId, patch) {
    const profile = get().profile;
    set({
      profile: persist({
        ...profile,
        ownedCars: profile.ownedCars.map((c) =>
          c.id === carId ? { ...c, customization: { ...c.customization, ...patch } } : c,
        ),
      }),
    });
  },

  unlockTrack(trackId) {
    const state = get();
    const profile = state.profile;
    const def = getTrack(trackId);
    const level = levelStateFromXp(profile.xp).level;
    if (profile.unlockedTracks.includes(trackId)) return true;
    if (level < def.unlockLevel) {
      state.pushToast(`Reach level ${def.unlockLevel} to unlock ${def.name}`, 'error');
      audio.ui('error');
      return false;
    }
    if (profile.coins < def.unlockCost) {
      state.pushToast('Not enough coins', 'error');
      audio.ui('error');
      return false;
    }
    audio.ui('unlock');
    state.pushToast(`${def.name} unlocked`, 'success');
    set({
      profile: persist({
        ...profile,
        coins: profile.coins - def.unlockCost,
        unlockedTracks: [...profile.unlockedTracks, trackId],
      }),
    });
    return true;
  },

  updateSettings(patch) {
    const profile = get().profile;
    const settings = { ...profile.settings, ...patch };
    audio.setVolumes(settings.masterVolume, settings.sfxVolume, settings.musicVolume);
    set({ profile: persist({ ...profile, settings }) });
  },

  setPlayerName(name) {
    const profile = get().profile;
    set({ profile: persist({ ...profile, name: name.slice(0, 18) || 'Driver' }) });
  },

  resetProfile() {
    const fresh = createDefaultProfile();
    saver.flush();
    void repo.clear();
    set({ profile: persist(fresh), lastResult: null, lastRewards: null });
  },

  requestRace(req) {
    set({ raceRequest: req, lastResult: null, lastRewards: null, screen: 'race' });
  },

  completeRace(result) {
    const state = get();
    const profile = state.profile;
    const req = state.raceRequest;
    const track = getTrack(result.trackId);

    const record = profile.records[result.trackId] ?? {
      bestLap: Infinity,
      bestTotal: Infinity,
      wins: 0,
      races: 0,
    };
    const isFirstWin = record.wins === 0;

    const rewards = computeRewards(result, track, isFirstWin);

    // Event objectives pay their own bonus.
    let bonusCoins = 0;
    let bonusXp = 0;
    const completedEvents = [...profile.completedEvents];
    if (req?.eventId) {
      const event = getEvent(req.eventId);
      if (event) {
        const achieved =
          event.kind === 'perfectLine'
            ? result.position === 1 && result.cleanRace
            : event.kind === 'timeAttack'
              ? result.bestLap > 0
              : event.kind === 'endurance'
                ? result.position <= 10
                : result.position <= 3;
        if (achieved) {
          bonusCoins += event.reward;
          bonusXp += event.xp;
          if (!completedEvents.includes(event.id)) completedEvents.push(event.id);
        }
      }
    }

    const newRecord = {
      bestLap: Math.min(record.bestLap, result.bestLap > 0 ? result.bestLap : Infinity),
      bestTotal: Math.min(record.bestTotal, result.totalTime > 0 ? result.totalTime : Infinity),
      wins: record.wins + (result.position === 1 ? 1 : 0),
      races: record.races + 1,
    };

    // Championship standings.
    const championships = { ...profile.championships };
    if (req?.championshipId) {
      const champ = getChampionship(req.championshipId);
      if (champ) {
        const prog = championships[champ.id] ?? {
          id: champ.id,
          raceIndex: 0,
          points: {},
          completed: false,
        };
        const points = { ...prog.points };
        for (const s of result.standings) {
          const key = s.isPlayer ? '__player' : s.name;
          points[key] = (points[key] ?? 0) + pointsForPosition(s.position);
        }
        const raceIndex = prog.raceIndex + 1;
        const completed = raceIndex >= champ.races.length;
        championships[champ.id] = { ...prog, raceIndex, points, completed };
        if (completed) {
          const sorted = Object.entries(points).sort((a, b) => b[1] - a[1]);
          if (sorted[0]?.[0] === '__player') {
            bonusCoins += champ.prize;
            bonusXp += 800;
          } else {
            bonusCoins += Math.round(champ.prize * 0.3);
          }
        }
      }
    }

    const totalCoins = rewards.totalCoins + bonusCoins;
    const totalXp = rewards.totalXp + bonusXp;
    const beforeLevel = levelStateFromXp(profile.xp).level;
    const afterXp = profile.xp + totalXp;
    const afterLevel = levelStateFromXp(afterXp).level;

    // Level-ups automatically unlock anything that only needed the level.
    const unlockedTracks = [...profile.unlockedTracks];
    for (const t of TRACKS) {
      if (t.unlockCost === 0 && afterLevel >= t.unlockLevel && !unlockedTracks.includes(t.id)) {
        unlockedTracks.push(t.id);
      }
    }

    set({
      lastResult: result,
      lastRewards: {
        lines: [
          ...rewards.lines,
          ...(bonusCoins > 0 ? [{ label: 'Event bonus', coins: bonusCoins, xp: bonusXp }] : []),
        ],
        totalCoins,
        totalXp,
      },
      levelUp: afterLevel > beforeLevel ? afterLevel : null,
      profile: persist({
        ...profile,
        coins: profile.coins + totalCoins,
        xp: afterXp,
        level: afterLevel,
        records: { ...profile.records, [result.trackId]: newRecord },
        championships,
        completedEvents,
        unlockedTracks,
        totalRaces: profile.totalRaces + 1,
        totalWins: profile.totalWins + (result.position === 1 ? 1 : 0),
      }),
    });

    if (afterLevel > beforeLevel) audio.ui('unlock');
  },

  clearResult() {
    set({ lastResult: null, lastRewards: null, levelUp: null });
  },

  pushToast(text, kind = 'info') {
    const id = toastId++;
    set((s) => ({ toasts: [...s.toasts, { id, text, kind }] }));
    window.setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, 3200);
  },

  dismissToast(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
}));

/* ------------------------------------------------------------------ */
/* Selectors                                                           */
/* ------------------------------------------------------------------ */

export const selectOwnedCar = (profile: PlayerProfile, carId: string): SavedCar | undefined =>
  profile.ownedCars.find((c) => c.id === carId);

export const selectActiveCar = (profile: PlayerProfile): SavedCar =>
  selectOwnedCar(profile, profile.selectedCarId) ?? profile.ownedCars[0];

export const selectCarStats = (profile: PlayerProfile, carId: string) => {
  const owned = selectOwnedCar(profile, carId);
  const def = getCar(carId);
  return applyUpgrades(def.stats, owned?.upgrades ?? EMPTY_UPGRADES);
};

export const selectCarRating = (profile: PlayerProfile, carId: string): number =>
  performanceRating(selectCarStats(profile, carId));

export const selectLevel = (profile: PlayerProfile) => levelStateFromXp(profile.xp);

export const selectTrackUnlocked = (profile: PlayerProfile, trackId: string): boolean =>
  profile.unlockedTracks.includes(trackId);

export const selectAvailableEvents = (profile: PlayerProfile) => {
  const level = levelStateFromXp(profile.xp).level;
  return EVENTS.filter((e) => level >= e.unlockLevel);
};

export const selectAvailableChampionships = (profile: PlayerProfile) => {
  const level = levelStateFromXp(profile.xp).level;
  return CHAMPIONSHIPS.filter((c) => level >= c.unlockLevel);
};

export const selectAllCars = () => CARS;

export const resolvedQuality = (settings: GameSettings, auto: QualityTier): QualityTier =>
  settings.quality === 'auto' ? auto : settings.quality;

export const flushSave = (): void => saver.flush();

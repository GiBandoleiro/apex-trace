import React, { useMemo, useState } from 'react';
import {
  Button,
  LockIcon,
  Modal,
  Segmented,
  Stars,
  StatTile,
  TopBar,
  Wallet,
} from '../components';
import { selectLevel, useGame } from '../store';
import { TRACKS, getTrack } from '@/tracks/catalog';
import { GameEngine } from '@/game/GameEngine';
import { formatCoins, formatTime } from '@/utils/math';
import type { Difficulty } from '@/systems/ai';
import { DIFFICULTY_LABEL } from '@/systems/ai';

const thumbCache = new Map<string, string>();
const thumbFor = (id: string): string => {
  const hit = thumbCache.get(id);
  if (hit) return hit;
  const url = GameEngine.renderTrackThumbnail(id, 420);
  thumbCache.set(id, url);
  return url;
};

const statsCache = new Map<string, { lengthM: number; corners: number }>();
const statsFor = (id: string) => {
  const hit = statsCache.get(id);
  if (hit) return hit;
  const s = GameEngine.trackStats(id);
  statsCache.set(id, s);
  return s;
};

const WEATHER_LABEL: Record<string, string> = {
  clear: 'Clear',
  rain: 'Rain',
  fog: 'Fog',
  snow: 'Snow',
};

const TIME_LABEL: Record<string, string> = {
  day: 'Day',
  sunset: 'Sunset',
  night: 'Night',
};

export const TrackSelect: React.FC = () => {
  const profile = useGame((s) => s.profile);
  const goBack = useGame((s) => s.goBack);
  const unlockTrack = useGame((s) => s.unlockTrack);
  const requestRace = useGame((s) => s.requestRace);
  const updateSettings = useGame((s) => s.updateSettings);

  const level = selectLevel(profile);
  const [openId, setOpenId] = useState<string | null>(null);
  const [opponents, setOpponents] = useState(7);

  const difficulty = profile.settings.difficulty;
  const open = openId ? getTrack(openId) : null;
  const openStats = useMemo(() => (openId ? statsFor(openId) : null), [openId]);
  const record = openId ? profile.records[openId] : undefined;

  const launch = (trackId: string) => {
    const def = getTrack(trackId);
    requestRace({
      trackId,
      laps: def.laps,
      opponents,
      difficulty,
      seed: Math.floor(Math.random() * 1e9),
    });
  };

  return (
    <div className="screen screen--scrim">
      <TopBar
        title="Circuits"
        subtitle={`${profile.unlockedTracks.length} of ${TRACKS.length} unlocked`}
        onBack={goBack}
        right={<Wallet coins={profile.coins} level={level.level} xpProgress={level.progress} />}
      />

      <div className="row row--wrap" style={{ marginBottom: 'var(--gap)' }}>
        <div className="field">
          <span className="label">Difficulty</span>
          <Segmented
            value={difficulty}
            onChange={(v: Difficulty) => updateSettings({ difficulty: v })}
            options={(['easy', 'normal', 'hard', 'expert'] as Difficulty[]).map((d) => ({
              value: d,
              label: DIFFICULTY_LABEL[d],
            }))}
          />
        </div>
        <div className="field">
          <span className="label">Opponents</span>
          <Segmented
            value={String(opponents)}
            onChange={(v) => setOpponents(parseInt(v, 10))}
            options={[
              { value: '3', label: '3' },
              { value: '5', label: '5' },
              { value: '7', label: '7' },
              { value: '9', label: '9' },
            ]}
          />
        </div>
      </div>

      <div className="scroll">
        <div className="grid grid--wide">
          {TRACKS.map((t, i) => {
            const unlocked = profile.unlockedTracks.includes(t.id);
            const levelLocked = level.level < t.unlockLevel;
            const rec = profile.records[t.id];
            const s = statsFor(t.id);
            return (
              <button
                key={t.id}
                className={`card ${!unlocked && levelLocked ? 'card--locked' : ''}`}
                style={{ animationDelay: `${i * 35}ms` }}
                onClick={() => setOpenId(t.id)}
              >
                <div className="card__media">
                  <img src={thumbFor(t.id)} alt={t.name} />
                  <span className="badge" style={{ position: 'absolute', top: 10, left: 10 }}>
                    {TIME_LABEL[t.timeOfDay]}
                  </span>
                  {t.weather !== 'clear' && (
                    <span className="badge badge--accent" style={{ position: 'absolute', top: 40, left: 10 }}>
                      {WEATHER_LABEL[t.weather]}
                    </span>
                  )}
                  {!unlocked && (
                    <span
                      className={`badge ${levelLocked ? 'badge--lock' : 'badge--accent'}`}
                      style={{ position: 'absolute', top: 10, right: 10 }}
                    >
                      {levelLocked ? <LockIcon /> : null}
                      {levelLocked ? `LV ${t.unlockLevel}` : formatCoins(t.unlockCost)}
                    </span>
                  )}
                </div>
                <div className="card__body">
                  <div
                    className="row"
                    style={{ justifyContent: 'space-between', alignItems: 'baseline' }}
                  >
                    <h3 className="card__title">{t.name}</h3>
                    <Stars value={t.difficulty} />
                  </div>
                  <p className="label" style={{ margin: 0 }}>
                    {t.country}
                  </p>
                  <div className="card__meta">
                    <span>
                      {(s.lengthM / 1000).toFixed(2)} km · {s.corners} turns
                    </span>
                    <span className="num">{rec ? formatTime(rec.bestLap) : '--:--.---'}</span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <Modal open={!!open} onClose={() => setOpenId(null)}>
        {open && openStats && (
          <div className="col">
            <div className="row" style={{ alignItems: 'flex-start' }}>
              <div style={{ flex: 1 }}>
                <p className="label">{open.country}</p>
                <h2 className="display" style={{ fontSize: 'clamp(24px, 4vmin, 38px)' }}>
                  {open.name}
                </h2>
                <p className="muted" style={{ margin: '6px 0 0', fontSize: 14 }}>
                  {open.tagline}
                </p>
              </div>
              <img src={thumbFor(open.id)} alt="" style={{ width: 120, height: 120, opacity: 0.9 }} />
            </div>

            <div className="stat-grid">
              <StatTile label="Length" value={`${(openStats.lengthM / 1000).toFixed(2)} km`} />
              <StatTile label="Turns" value={openStats.corners} />
              <StatTile label="Laps" value={open.laps} />
              <StatTile label="Difficulty" value={<Stars value={open.difficulty} />} />
              <StatTile label="Time" value={TIME_LABEL[open.timeOfDay]} />
              <StatTile label="Weather" value={WEATHER_LABEL[open.weather]} />
              <StatTile label="Best lap" value={record ? formatTime(record.bestLap) : '--:--.---'} />
              <StatTile label="Wins" value={record?.wins ?? 0} />
            </div>

            <div className="row" style={{ marginTop: 6 }}>
              <Button variant="ghost" onClick={() => setOpenId(null)} style={{ flex: 1 }}>
                Close
              </Button>
              {profile.unlockedTracks.includes(open.id) ? (
                <Button variant="primary" onClick={() => launch(open.id)} style={{ flex: 2 }}>
                  Race
                </Button>
              ) : level.level < open.unlockLevel ? (
                <Button variant="ghost" disabled style={{ flex: 2 }}>
                  Reach level {open.unlockLevel}
                </Button>
              ) : (
                <Button
                  variant="primary"
                  style={{ flex: 2 }}
                  disabled={profile.coins < open.unlockCost}
                  onClick={() => unlockTrack(open.id)}
                >
                  Unlock · {formatCoins(open.unlockCost)}
                </Button>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};

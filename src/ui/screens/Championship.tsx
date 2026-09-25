import React, { useState } from 'react';
import { Button, LockIcon, Modal, Panel, Stars, TopBar, Wallet } from '../components';
import { selectLevel, useGame } from '../store';
import { CHAMPIONSHIPS } from '@/systems/championships';
import { getTrack } from '@/tracks/catalog';
import { DIFFICULTY_LABEL } from '@/systems/ai';
import { formatCoins } from '@/utils/math';
import { GameEngine } from '@/game/GameEngine';

const thumbCache = new Map<string, string>();
const thumbFor = (id: string): string => {
  const hit = thumbCache.get(id);
  if (hit) return hit;
  const url = GameEngine.renderTrackThumbnail(id, 240);
  thumbCache.set(id, url);
  return url;
};

export const Championship: React.FC = () => {
  const profile = useGame((s) => s.profile);
  const goBack = useGame((s) => s.goBack);
  const requestRace = useGame((s) => s.requestRace);
  const pushToast = useGame((s) => s.pushToast);
  const level = selectLevel(profile);
  const [openId, setOpenId] = useState<string | null>(null);

  const open = openId ? CHAMPIONSHIPS.find((c) => c.id === openId) : null;
  const progress = openId ? profile.championships[openId] : undefined;

  const start = () => {
    if (!open) return;
    const prog = profile.championships[open.id];
    const raceIndex = prog?.completed ? 0 : (prog?.raceIndex ?? 0);
    if (raceIndex === 0 && open.entryFee > 0 && profile.coins < open.entryFee) {
      pushToast('Not enough coins for the entry fee', 'error');
      return;
    }
    const trackId = open.races[Math.min(raceIndex, open.races.length - 1)];
    const track = getTrack(trackId);
    requestRace({
      trackId,
      laps: track.laps,
      opponents: 9,
      difficulty: open.difficulty,
      championshipId: open.id,
      seed: Math.floor(Math.random() * 1e9),
    });
  };

  const standings = progress
    ? Object.entries(progress.points).sort((a, b) => b[1] - a[1])
    : [];

  return (
    <div className="screen screen--scrim">
      <TopBar
        title="Championship"
        subtitle="Series racing, cumulative points"
        onBack={goBack}
        right={<Wallet coins={profile.coins} level={level.level} xpProgress={level.progress} />}
      />

      <div className="scroll">
        <div className="grid grid--wide">
          {CHAMPIONSHIPS.map((c, i) => {
            const locked = level.level < c.unlockLevel;
            const prog = profile.championships[c.id];
            const done = prog?.completed;
            return (
              <button
                key={c.id}
                className={`card ${locked ? 'card--locked' : ''}`}
                style={{ animationDelay: `${i * 40}ms` }}
                onClick={() => !locked && setOpenId(c.id)}
              >
                <div className="card__media" style={{ aspectRatio: '21 / 9' }}>
                  <div className="row" style={{ gap: 4, padding: 10 }}>
                    {c.races.slice(0, 5).map((r, k) => (
                      <img
                        key={`${r}-${k}`}
                        src={thumbFor(r)}
                        alt=""
                        style={{ width: 54, height: 54, opacity: 0.85 }}
                      />
                    ))}
                  </div>
                  <span className="badge" style={{ position: 'absolute', top: 10, left: 10 }}>
                    Tier {c.tier}
                  </span>
                  {locked && (
                    <span className="badge badge--lock" style={{ position: 'absolute', top: 10, right: 10 }}>
                      <LockIcon /> LV {c.unlockLevel}
                    </span>
                  )}
                  {done && (
                    <span className="badge badge--good" style={{ position: 'absolute', top: 10, right: 10 }}>
                      Complete
                    </span>
                  )}
                </div>
                <div className="card__body">
                  <h3 className="card__title">{c.name}</h3>
                  <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                    {c.description}
                  </p>
                  <div className="card__meta">
                    <span>
                      {c.races.length} rounds · {DIFFICULTY_LABEL[c.difficulty]}
                    </span>
                    <span className="num" style={{ color: 'var(--accent-soft)' }}>
                      {formatCoins(c.prize)}
                    </span>
                  </div>
                  {prog && !done && (
                    <span className="badge badge--accent" style={{ alignSelf: 'flex-start' }}>
                      Round {prog.raceIndex + 1} of {c.races.length}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <Modal open={!!open} onClose={() => setOpenId(null)}>
        {open && (
          <div className="col">
            <div>
              <p className="label">Tier {open.tier} · {DIFFICULTY_LABEL[open.difficulty]}</p>
              <h2 className="display" style={{ fontSize: 'clamp(22px, 3.6vmin, 34px)' }}>
                {open.name}
              </h2>
              <p className="muted" style={{ margin: '6px 0 0', fontSize: 14 }}>
                {open.description}
              </p>
            </div>

            <Panel pad={false} style={{ overflow: 'hidden' }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Circuit</th>
                    <th className="num-cell">Laps</th>
                    <th className="num-cell">Grade</th>
                  </tr>
                </thead>
                <tbody>
                  {open.races.map((r, i) => {
                    const t = getTrack(r);
                    const current = (progress?.raceIndex ?? 0) === i && !progress?.completed;
                    return (
                      <tr key={`${r}-${i}`} className={current ? 'is-player' : ''}>
                        <td className="num-cell">{i + 1}</td>
                        <td>{t.name}</td>
                        <td className="num-cell">{t.laps}</td>
                        <td className="num-cell">
                          <Stars value={t.difficulty} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Panel>

            {standings.length > 0 && (
              <Panel pad={false} style={{ overflow: 'hidden' }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Pos</th>
                      <th>Driver</th>
                      <th className="num-cell">Points</th>
                    </tr>
                  </thead>
                  <tbody>
                    {standings.slice(0, 10).map(([name, pts], i) => (
                      <tr key={name} className={name === '__player' ? 'is-player' : ''}>
                        <td className="num-cell">{i + 1}</td>
                        <td>{name === '__player' ? profile.name : name}</td>
                        <td className="num-cell">{pts}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Panel>
            )}

            <div className="row">
              <Button variant="ghost" onClick={() => setOpenId(null)} style={{ flex: 1 }}>
                Close
              </Button>
              <Button variant="primary" onClick={start} style={{ flex: 2 }}>
                {progress?.completed
                  ? 'Run again'
                  : progress
                    ? `Continue · Round ${progress.raceIndex + 1}`
                    : open.entryFee > 0
                      ? `Enter · ${formatCoins(open.entryFee)}`
                      : 'Enter'}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};

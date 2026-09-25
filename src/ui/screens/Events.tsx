import React from 'react';
import { Button, LockIcon, TopBar, Wallet } from '../components';
import { selectLevel, useGame } from '../store';
import { EVENTS, EVENT_LABEL } from '@/systems/championships';
import { getTrack } from '@/tracks/catalog';
import { DIFFICULTY_LABEL } from '@/systems/ai';
import { formatCoins } from '@/utils/math';
import { GameEngine } from '@/game/GameEngine';

const thumbCache = new Map<string, string>();
const thumbFor = (id: string): string => {
  const hit = thumbCache.get(id);
  if (hit) return hit;
  const url = GameEngine.renderTrackThumbnail(id, 360);
  thumbCache.set(id, url);
  return url;
};

export const Events: React.FC = () => {
  const profile = useGame((s) => s.profile);
  const goBack = useGame((s) => s.goBack);
  const requestRace = useGame((s) => s.requestRace);
  const level = selectLevel(profile);

  return (
    <div className="screen screen--scrim">
      <TopBar
        title="Events"
        subtitle="Special rules, bigger payouts"
        onBack={goBack}
        right={<Wallet coins={profile.coins} level={level.level} xpProgress={level.progress} />}
      />

      <div className="scroll">
        <div className="grid grid--wide">
          {EVENTS.map((e, i) => {
            const locked = level.level < e.unlockLevel;
            const done = profile.completedEvents.includes(e.id);
            const track = getTrack(e.trackId);
            return (
              <div
                key={e.id}
                className={`card ${locked ? 'card--locked' : ''}`}
                style={{ animationDelay: `${i * 40}ms`, cursor: 'default' }}
              >
                <div className="card__media">
                  <img src={thumbFor(e.trackId)} alt="" />
                  <span className="badge badge--accent" style={{ position: 'absolute', top: 10, left: 10 }}>
                    {EVENT_LABEL[e.kind]}
                  </span>
                  {locked && (
                    <span className="badge badge--lock" style={{ position: 'absolute', top: 10, right: 10 }}>
                      <LockIcon /> LV {e.unlockLevel}
                    </span>
                  )}
                  {done && (
                    <span className="badge badge--good" style={{ position: 'absolute', top: 10, right: 10 }}>
                      Cleared
                    </span>
                  )}
                </div>
                <div className="card__body">
                  <h3 className="card__title">{e.name}</h3>
                  <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                    {e.description}
                  </p>
                  <p style={{ margin: 0, fontSize: 12, color: 'var(--accent-soft)' }}>
                    Objective: {e.objective}
                  </p>
                  <div className="card__meta">
                    <span>
                      {track.name} · {e.laps} laps · {DIFFICULTY_LABEL[e.difficulty]}
                    </span>
                    <span className="num" style={{ color: 'var(--accent-soft)' }}>
                      {formatCoins(e.reward)}
                    </span>
                  </div>
                  <Button
                    variant="primary"
                    block
                    disabled={locked}
                    onClick={() =>
                      requestRace({
                        trackId: e.trackId,
                        laps: e.laps,
                        opponents: e.opponents,
                        difficulty: e.difficulty,
                        modifiers: e.modifiers,
                        eventId: e.id,
                        seed: Math.floor(Math.random() * 1e9),
                      })
                    }
                  >
                    {locked ? `Level ${e.unlockLevel} required` : 'Start event'}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

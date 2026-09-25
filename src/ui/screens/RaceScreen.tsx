import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button, CountUp, Panel, Stars, StatTile } from '../components';
import { selectActiveCar, useGame } from '../store';
import { useEngineState } from '../engineStore';
import { useEngine } from '../EngineContext';
import { getTrack } from '@/tracks/catalog';
import { getCar } from '@/cars/catalog';
import { GameEngine } from '@/game/GameEngine';
import { formatTime, clamp01, ordinal } from '@/utils/math';
import { DIFFICULTY_LABEL } from '@/systems/ai';
import { levelStateFromXp } from '@/systems/progression';
import { audio } from '@/audio/AudioEngine';

type Stage = 'preview' | 'draw' | 'race' | 'result';

export const RaceScreen: React.FC = () => {
  const engine = useEngine();
  const request = useGame((s) => s.raceRequest);
  const profile = useGame((s) => s.profile);
  const setScreen = useGame((s) => s.setScreen);
  const completeRace = useGame((s) => s.completeRace);
  const clearResult = useGame((s) => s.clearResult);
  const requestRace = useGame((s) => s.requestRace);
  const lastResult = useGame((s) => s.lastResult);
  const lastRewards = useGame((s) => s.lastRewards);
  const levelUp = useGame((s) => s.levelUp);

  const enginePhase = useEngineState((s) => s.phase);
  const engineResult = useEngineState((s) => s.result);
  const resetEngineState = useEngineState((s) => s.reset);

  const [stage, setStage] = useState<Stage>('preview');
  const [starting, setStarting] = useState(true);
  const startedRef = useRef<string | null>(null);
  const resultHandled = useRef(false);

  const track = request ? getTrack(request.trackId) : null;
  const activeCar = selectActiveCar(profile);
  const carDef = getCar(activeCar.id);
  const trackStats = useMemo(
    () => (request ? GameEngine.trackStats(request.trackId) : null),
    [request],
  );
  const record = request ? profile.records[request.trackId] : undefined;

  /* ---- Build the race once per request ---------------------------- */
  useEffect(() => {
    if (!engine || !request) return;
    const key = `${request.trackId}:${request.seed}`;
    if (startedRef.current === key) return;
    startedRef.current = key;
    resultHandled.current = false;
    resetEngineState();
    setStage('preview');
    setStarting(true);

    void engine
      .beginRace({
        track: getTrack(request.trackId),
        playerCarId: activeCar.id,
        playerUpgrades: activeCar.upgrades,
        playerCustomization: activeCar.customization,
        playerName: profile.name,
        difficulty: request.difficulty,
        opponentCount: request.opponents,
        laps: request.laps,
        seed: request.seed,
        previousBest: profile.records[request.trackId]?.bestLap ?? Infinity,
        modifiers: request.modifiers,
      })
      .then(() => setStarting(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, request]);

  /* ---- Follow the engine phase ------------------------------------ */
  useEffect(() => {
    if (enginePhase === 'countdown' || enginePhase === 'racing') setStage('race');
    if (enginePhase === 'finished') setStage('result');
  }, [enginePhase]);

  /* ---- Commit the result once -------------------------------------- */
  useEffect(() => {
    if (!engineResult || resultHandled.current) return;
    resultHandled.current = true;
    completeRace(engineResult);
  }, [engineResult, completeRace]);

  const leave = (to: 'menu' | 'tracks' | 'garage') => {
    engine?.exitRace();
    clearResult();
    resetEngineState();
    startedRef.current = null;
    setScreen(to);
  };

  const retry = () => {
    if (!request) return;
    clearResult();
    resetEngineState();
    resultHandled.current = false;
    startedRef.current = null;
    requestRace({ ...request, seed: Math.floor(Math.random() * 1e9) });
  };

  if (!request || !track) {
    return (
      <div className="screen screen--scrim">
        <Panel>
          <p>No race selected.</p>
          <Button onClick={() => setScreen('tracks')}>Choose a circuit</Button>
        </Panel>
      </div>
    );
  }

  return (
    <>
      {stage === 'preview' && trackStats && (
        <div className="screen screen--scrim">
          <div
            className="col"
            style={{ margin: 'auto', width: 'min(880px, 100%)', maxHeight: '100%' }}
          >
            <Panel>
              <div className="col">
                <div className="row" style={{ alignItems: 'flex-start' }}>
                  <div style={{ flex: 1 }}>
                    <p className="label">{track.country}</p>
                    <h1 className="display title">{track.name}</h1>
                    <p className="muted" style={{ margin: '6px 0 0' }}>{track.tagline}</p>
                  </div>
                  <img
                    src={GameEngine.renderTrackThumbnail(track.id, 200)}
                    alt=""
                    style={{ width: 120, height: 120 }}
                  />
                </div>

                <div className="stat-grid">
                  <StatTile label="Laps" value={request.laps} />
                  <StatTile label="Length" value={`${(trackStats.lengthM / 1000).toFixed(2)} km`} />
                  <StatTile label="Turns" value={trackStats.corners} />
                  <StatTile label="Weather" value={track.weather.toUpperCase()} />
                  <StatTile label="Opponents" value={request.opponents} />
                  <StatTile label="Grade" value={<Stars value={track.difficulty} />} />
                  <StatTile
                    label="Your best"
                    value={record ? formatTime(record.bestLap) : '--:--.---'}
                  />
                  <StatTile label="Field" value={DIFFICULTY_LABEL[request.difficulty]} />
                </div>

                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <span className="label">Car</span>
                  <strong style={{ fontFamily: 'var(--font-display)', letterSpacing: '0.08em' }}>
                    {carDef.make} {carDef.name}
                  </strong>
                </div>

                <div className="row">
                  <Button variant="ghost" onClick={() => leave('tracks')} style={{ flex: 1 }}>
                    Back
                  </Button>
                  <Button
                    variant="primary"
                    size="lg"
                    style={{ flex: 2 }}
                    disabled={starting}
                    onClick={() => {
                      void audio.unlock();
                      setStage('draw');
                    }}
                  >
                    {starting ? 'Preparing circuit…' : 'Draw your line'}
                  </Button>
                </div>
              </div>
            </Panel>
          </div>
        </div>
      )}

      {stage === 'draw' && <DrawOverlay onBack={() => leave('tracks')} />}
      {stage === 'race' && <RaceHud onExit={() => leave('tracks')} />}
      {stage === 'result' && lastResult && (
        <ResultOverlay
          onRetry={retry}
          onGarage={() => leave('garage')}
          onMenu={() => leave('menu')}
          onNext={() => leave('tracks')}
          levelUp={levelUp}
          rewards={lastRewards}
          result={lastResult}
          xp={profile.xp}
        />
      )}
    </>
  );
};

/* ------------------------------------------------------------------ */
/* Draw phase                                                          */
/* ------------------------------------------------------------------ */

const DrawOverlay: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  const engine = useEngine();
  const draw = useEngineState((s) => s.draw);
  const showSuggested = useGame((s) => s.profile.settings.showRacingLine);

  const riskLabel =
    draw.peakRisk > 1.25 ? 'Very aggressive' : draw.peakRisk > 1.05 ? 'On the limit' : 'Controlled';
  const riskColor =
    draw.peakRisk > 1.25 ? 'var(--bad)' : draw.peakRisk > 1.05 ? 'var(--warn)' : 'var(--good)';

  return (
    <div className="hud" style={{ pointerEvents: 'none' }}>
      <div className="hud__top" style={{ pointerEvents: 'auto' }}>
        <Button variant="ghost" size="sm" onClick={onBack}>
          Exit
        </Button>
      </div>

      {!draw.hasLine && (
        <div className="draw-hint">
          <h2 className="draw-hint__title">Draw your line</h2>
          <p className="draw-hint__text">
            Start at the finish line. Draw through the circuit in sections. Fast strokes accelerate;
            slow strokes brake. Complete at least 85% of the lap to race.
          </p>
        </div>
      )}

      {draw.hasLine && (
        <div className="draw-stats">
          <div className="hud-block" style={{ alignItems: 'flex-end' }}>
            <span className="hud-block__label">Est. lap</span>
            <span className="hud-block__value hud-block__value--sm">
              {formatTime(draw.estimatedLap)}
            </span>
          </div>
          <div className="hud-block" style={{ alignItems: 'flex-end' }}>
            <span className="hud-block__label">Line covered</span>
            <span className="hud-block__value hud-block__value--sm">
              {Math.round(draw.coverage * 100)}%
            </span>
          </div>
          <div className="hud-block" style={{ alignItems: 'flex-end' }}>
            <span className="hud-block__label">Commitment</span>
            <span
              className="hud-block__value hud-block__value--sm"
              style={{ color: riskColor, fontSize: 15 }}
            >
              {riskLabel}
            </span>
          </div>
        </div>
      )}

      <div className="spacer" />

      <div className="draw-legend"><span><i className="draw-legend__slow" />Brake / slow</span><span><i className="draw-legend__fast" />Fast / accelerate</span></div>

      <div className="draw-bar" style={{ pointerEvents: 'auto' }}>
        <div className="draw-zoom">
          <button type="button" aria-label="Aproximar pista" onClick={() => engine?.zoomTrack(0.78)}>+</button>
          <button type="button" aria-label="Afastar pista" onClick={() => engine?.zoomTrack(1.28)}>−</button>
        </div>
        <Button
          variant="ghost"
          size="sm"
          disabled={draw.strokes === 0}
          onClick={() => engine?.undoLine()}
        >
          Undo
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={!draw.hasLine}
          onClick={() => engine?.clearLine()}
        >
          Clear
        </Button>
        {showSuggested && (
          <Button variant="ghost" size="sm" onClick={() => engine?.useSuggestedLine()}>
            Ideal line
          </Button>
        )}
        <Button
          variant="primary"
          disabled={!draw.hasLine || draw.coverage < 0.85}
          onClick={() => engine?.confirmLine()}
        >
          {draw.hasLine && draw.coverage < 0.85 ? `${Math.round(draw.coverage * 100)}% / 85%` : 'Confirm'}
        </Button>
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Race HUD                                                            */
/* ------------------------------------------------------------------ */

const RaceHud: React.FC<{ onExit: () => void }> = ({ onExit }) => {
  const engine = useEngine();
  const t = useEngineState((s) => s.telemetry);
  const paused = useEngineState((s) => s.paused);
  const units = useGame((s) => s.profile.settings.units);
  const haptics = useGame((s) => s.profile.settings.hapticFeedback);
  const lastWarn = useRef(0);

  useEffect(() => {
    if (!t || !haptics) return;
    if (t.gripUsage > 1.25 && performance.now() - lastWarn.current > 900) {
      lastWarn.current = performance.now();
      navigator.vibrate?.(12);
    }
  }, [t, haptics]);

  if (!t) return null;

  const speed = units === 'mph' ? t.speedKmh * 0.621371 : t.speedKmh;
  const gripPct = clamp01(t.gripUsage) * 100;
  const gripColor =
    t.gripUsage > 1 ? 'var(--bad)' : t.gripUsage > 0.85 ? 'var(--warn)' : 'var(--good)';

  return (
    <div className="hud">
      <div className="hud__top">
        <div className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
          <div className="hud-block">
            <span className="hud-block__label">Pos</span>
            <span className="hud-block__value">
              {t.position}
              <span style={{ fontSize: '0.5em', color: 'var(--text-faint)' }}>/{t.entrants}</span>
            </span>
          </div>
          <div className="hud-block">
            <span className="hud-block__label">Lap</span>
            <span className="hud-block__value">
              {t.lap}
              <span style={{ fontSize: '0.5em', color: 'var(--text-faint)' }}>/{t.laps}</span>
            </span>
          </div>
        </div>

        <div className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
          <button type="button" className="hud-pause" onClick={() => engine?.togglePause()} aria-label={paused ? 'Resume race' : 'Pause race'}>{paused ? '▶' : 'Ⅱ'}</button>
          <div className="hud-block" style={{ alignItems: 'flex-end' }}>
            <span className="hud-block__label">Lap time</span>
            <span className="hud-block__value hud-block__value--sm">{formatTime(t.lapTime)}</span>
          </div>
          <div className="hud-block" style={{ alignItems: 'flex-end' }}>
            <span className="hud-block__label">Best</span>
            <span className="hud-block__value hud-block__value--sm">
              {Number.isFinite(t.bestLap) ? formatTime(t.bestLap) : '--:--.---'}
            </span>
          </div>
        </div>
      </div>

      {paused && <div className="pause-overlay"><div className="pause-card"><span className="label">RACE CONTROL</span><h2>Paused</h2><p>Take a breath. The race resumes exactly where you left it.</p><div className="row"><Button variant="primary" onClick={() => engine?.togglePause()}>Resume race</Button><Button variant="ghost" onClick={onExit}>Exit race</Button></div><small>Press P to resume</small></div></div>}

      <div className="spacer" />

      <div className="hud__bottom">
        <div>
          {t.gripUsage > 1.12 && <div className="warning-flash">Low grip</div>}
          {t.nitroActive && (
            <div className="warning-flash" style={{ color: 'var(--info)' }}>
              Boost
            </div>
          )}
          <div className="grip-meter" style={{ marginBottom: 8 }}>
            <div
              className="grip-meter__fill"
              style={{ width: `${gripPct}%`, background: gripColor }}
            />
          </div>
          <div className="hud-dynamics">
            <span>{t.surface === 'track' ? 'ON TRACK' : t.surface.toUpperCase()}</span>
            <span>GRIP {Math.round(gripPct)}%</span>
            {t.nitro > 0 && <span>BOOST {Math.round(t.nitro * 100)}%</span>}
          </div>
          <div className="speedo">
            <span className="speedo__value">{Math.round(speed)}</span>
            <span className="speedo__unit">{units === 'mph' ? 'mph' : 'km/h'}</span>
          </div>
        </div>

        <div className="standings">
          {t.standings.slice(0, 6).map((s) => (
            <div
              key={s.id}
              className={`standings__row ${s.isPlayer ? 'standings__row--player' : ''}`}
            >
              <span className="standings__pos">{s.position}</span>
              <span className="standings__name">{s.name}</span>
              <span className="standings__gap">
                {s.position === 1 ? 'LEADER' : `+${s.gapToLeader.toFixed(1)}`}
              </span>
            </div>
          ))}
        </div>
      </div>

      {t.countdown >= 0 && (
        <div className="countdown">
          <span className={`countdown__num ${t.countdown === 0 ? 'countdown__num--go' : ''}`} key={t.countdown}>
            {t.countdown === 0 ? 'GO' : t.countdown}
          </span>
        </div>
      )}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Results                                                             */
/* ------------------------------------------------------------------ */

const ResultOverlay: React.FC<{
  result: NonNullable<ReturnType<typeof useGame.getState>['lastResult']>;
  rewards: ReturnType<typeof useGame.getState>['lastRewards'];
  levelUp: number | null;
  xp: number;
  onRetry: () => void;
  onNext: () => void;
  onGarage: () => void;
  onMenu: () => void;
}> = ({ result, rewards, levelUp, xp, onRetry, onNext, onGarage, onMenu }) => {
  const level = levelStateFromXp(xp);
  const [barWidth, setBarWidth] = useState(0);

  useEffect(() => {
    const id = window.setTimeout(() => setBarWidth(level.progress * 100), 260);
    return () => window.clearTimeout(id);
  }, [level.progress]);

  const podium = result.position <= 3;

  return (
    <div className="screen screen--scrim">
      <div className="col" style={{ margin: 'auto', width: 'min(760px, 100%)', maxHeight: '100%' }}>
        <Panel>
          <div className="col">
            <div className="row" style={{ alignItems: 'center', gap: 20 }}>
              <div className="result-position">{ordinal(result.position)}</div>
              <div style={{ flex: 1 }}>
                <p className="label">Finished</p>
                <h2 className="display" style={{ fontSize: 'clamp(20px, 3.4vmin, 30px)' }}>
                  {podium ? (result.position === 1 ? 'Victory' : 'On the podium') : 'Race complete'}
                </h2>
                <div className="row row--wrap" style={{ gap: 8, marginTop: 10 }}>
                  {result.cleanRace && <span className="badge badge--good">Clean race</span>}
                  {result.newTrackRecord && <span className="badge badge--accent">Track record</span>}
                  <span className="badge">{result.contacts} contacts</span>
                </div>
              </div>
            </div>

            <div className="stat-grid">
              <StatTile label="Total time" value={formatTime(result.totalTime)} />
              <StatTile label="Best lap" value={formatTime(result.bestLap)} />
              <StatTile label="Laps" value={result.laps} />
              <StatTile label="Field" value={DIFFICULTY_LABEL[result.difficulty]} />
            </div>

            {rewards && (
              <div>
                <p className="label" style={{ marginBottom: 6 }}>Rewards</p>
                {rewards.lines.map((line, i) => (
                  <div className="reward-row" key={line.label} style={{ animationDelay: `${i * 90}ms` }}>
                    <span>{line.label}</span>
                    <span className="num" style={{ color: 'var(--accent-soft)' }}>
                      +{line.coins.toLocaleString('en-US')}
                      <span style={{ color: 'var(--info)', marginLeft: 12 }}>+{line.xp} XP</span>
                    </span>
                  </div>
                ))}
                <div className="row" style={{ justifyContent: 'space-between', marginTop: 12 }}>
                  <span className="label">Total</span>
                  <span className="num" style={{ fontSize: 22, color: 'var(--accent)' }}>
                    <CountUp value={rewards.totalCoins} /> coins
                  </span>
                </div>
              </div>
            )}

            <div>
              <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
                <span className="label">Level {level.level}</span>
                <span className="num" style={{ fontSize: 13 }}>
                  {Math.round(level.xpIntoLevel)} / {level.xpForNext} XP
                </span>
              </div>
              <div className="xp-bar">
                <div className="xp-bar__fill" style={{ width: `${barWidth}%` }} />
              </div>
              {levelUp && (
                <p style={{ color: 'var(--good)', marginTop: 8, fontFamily: 'var(--font-display)', letterSpacing: '0.12em' }}>
                  LEVEL UP — NEW CONTENT UNLOCKED
                </p>
              )}
            </div>

            <div className="row row--wrap">
              <Button variant="ghost" onClick={onMenu} style={{ flex: 1 }}>Menu</Button>
              <Button variant="ghost" onClick={onGarage} style={{ flex: 1 }}>Garage</Button>
              <Button variant="ghost" onClick={onRetry} style={{ flex: 1 }}>Retry</Button>
              <Button variant="primary" onClick={onNext} style={{ flex: 2 }}>Next race</Button>
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
};

import React, { useEffect, useRef, useState } from 'react';
import { GameEngine } from '@/game/GameEngine';
import { EngineContext } from './EngineContext';
import { useEngineState } from './engineStore';
import { flushSave, selectActiveCar, useGame } from './store';
import { detectQualityTier } from '@/systems/quality';
import { audio } from '@/audio/AudioEngine';
import { DEFAULT_TRACK_ID } from '@/tracks/catalog';
import { MainMenu } from './screens/MainMenu';
import { Garage } from './screens/Garage';
import { Customize } from './screens/Customize';
import { TrackSelect } from './screens/TrackSelect';
import { Championship } from './screens/Championship';
import { Events } from './screens/Events';
import { Settings } from './screens/Settings';
import { RaceScreen } from './screens/RaceScreen';

const SHOWCASE_SCREENS = new Set(['menu', 'garage', 'customize', 'tracks', 'championship', 'events', 'settings']);

export const App: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const [engine, setEngine] = useState<GameEngine | null>(null);

  const screen = useGame((s) => s.screen);
  const goBack = useGame((s) => s.goBack);
  const boot = useGame((s) => s.boot);
  const booted = useGame((s) => s.booted);
  const profile = useGame((s) => s.profile);
  const toasts = useGame((s) => s.toasts);
  const setFps = useGame((s) => s.setFps);

  const loadProgress = useEngineState((s) => s.loadProgress);
  const loadLabel = useEngineState((s) => s.loadLabel);
  const ready = useEngineState((s) => s.ready);

  /* ---- Load the saved profile first ------------------------------- */
  useEffect(() => {
    void boot();
  }, [boot]);

  /* ---- Create the engine once the profile is known ----------------- */
  useEffect(() => {
    if (!booted || !canvasRef.current || engineRef.current) return;

    const settings = useGame.getState().profile.settings;
    const tier = settings.quality === 'auto' ? detectQualityTier() : settings.quality;
    const eng = new GameEngine(canvasRef.current, tier);
    engineRef.current = eng;

    const es = useEngineState.getState();
    eng.setCallbacks({
      onLoadProgress: (p, label) => es.setLoad(p, label),
      onPhase: (phase) => useEngineState.getState().setPhase(phase),
      onDrawState: (d) => useEngineState.getState().setDraw(d),
      onTelemetry: (t) => useEngineState.getState().setTelemetry(t),
      onResult: (r) => useEngineState.getState().setResult(r),
      onFps: (fps) => setFps(fps),
      onQualityDrop: (t) =>
        useGame.getState().pushToast(`Graphics lowered to ${t} to keep the frame rate up`, 'info'),
    });
    eng.setAutoQuality(settings.quality === 'auto');
    eng.setCameraShake(settings.cameraShake);
    eng.setReduceMotion(settings.reduceMotion);

    const el = wrapRef.current;
    if (el) {
      eng.attachInput(el);
      eng.resize(el.clientWidth, el.clientHeight);
    }
    setEngine(eng);

    // Dev-only inspection hook: lets the browser console (and the automated
    // smoke test) walk the live scene graph. Stripped from production builds.
    if (import.meta.env.DEV) {
      (window as unknown as { __apex?: GameEngine }).__apex = eng;
    }

    void eng.init().then(async () => {
      const active = selectActiveCar(useGame.getState().profile);
      await eng.showcase(DEFAULT_TRACK_ID, active.id, active.customization);
      useEngineState.getState().setReady(true);
      useGame.getState().setScreen('menu');
      document.getElementById('boot')?.remove();
    });

    return () => {
      eng.dispose();
      engineRef.current = null;
    };
  }, [booted, setFps]);

  /* ---- Resize ------------------------------------------------------ */
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const apply = () => engineRef.current?.resize(el.clientWidth, el.clientHeight);
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    window.addEventListener('orientationchange', apply);
    return () => {
      ro.disconnect();
      window.removeEventListener('orientationchange', apply);
    };
  }, [engine]);

  /* ---- Return to the showcase when leaving a race ------------------- */
  useEffect(() => {
    const eng = engineRef.current;
    if (!eng || !ready) return;
    if (SHOWCASE_SCREENS.has(screen) && eng.currentPhase === 'idle') {
      const active = selectActiveCar(useGame.getState().profile);
      void eng.showcase(DEFAULT_TRACK_ID, active.id, active.customization);
    }
  }, [screen, ready]);

  /* ---- Keep the showcase car in sync with the selected car ---------- */
  useEffect(() => {
    const eng = engineRef.current;
    if (!eng || !ready || screen === 'race' || screen === 'garage') return;
    const active = selectActiveCar(profile);
    eng.updateShowcaseCar(active.id, active.customization);
  }, [profile.selectedCarId, ready, screen, profile]);

  /* ---- Global keys and lifecycle ------------------------------------ */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      if (e.key === 'Escape') goBack();
    };
    const onHide = () => {
      if (document.visibilityState === 'hidden') flushSave();
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', flushSave);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', flushSave);
    };
  }, [goBack]);

  /* ---- Unlock audio on the first interaction anywhere ---------------- */
  useEffect(() => {
    const unlock = () => void audio.unlock();
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  return (
    <EngineContext.Provider value={engine}>
      <div className="app">
        <div className="canvas-layer" ref={wrapRef}>
          <canvas ref={canvasRef} />
        </div>

        <div className="ui-layer">
          {screen === 'menu' && <MainMenu />}
          {screen === 'garage' && <Garage />}
          {screen === 'customize' && <Customize />}
          {screen === 'tracks' && <TrackSelect />}
          {screen === 'championship' && <Championship />}
          {screen === 'events' && <Events />}
          {screen === 'settings' && <Settings />}
          {screen === 'race' && <RaceScreen />}
        </div>

        <div className="toasts">
          {toasts.map((t) => (
            <div key={t.id} className={`toast toast--${t.kind}`}>
              {t.text}
            </div>
          ))}
        </div>

        <div className={`loader ${ready ? 'loader--out' : ''}`} aria-hidden={ready}>
          <div className="logo">
            APEX<span>TRACE</span>
            <span className="logo__sub">DRAW · RACE · WIN</span>
          </div>
          <div className="loader__bar">
            <div className="loader__fill" style={{ width: `${Math.round(loadProgress * 100)}%` }} />
          </div>
          <span className="loader__label">{loadLabel}</span>
        </div>
      </div>
    </EngineContext.Provider>
  );
};

export default App;

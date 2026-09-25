/**
 * Live engine state mirrored into React.
 *
 * The engine pushes here at most once per frame; components subscribe to the
 * slice they need so a HUD update never re-renders the whole app.
 */

import { create } from 'zustand';
import type { DrawState, EnginePhase, Telemetry } from '@/game/GameEngine';
import type { RaceResult } from '@/systems/RaceSimulation';

interface EngineState {
  phase: EnginePhase;
  telemetry: Telemetry | null;
  draw: DrawState;
  result: RaceResult | null;
  loadProgress: number;
  loadLabel: string;
  ready: boolean;
  paused: boolean;

  setPhase: (p: EnginePhase) => void;
  setTelemetry: (t: Telemetry) => void;
  setDraw: (d: DrawState) => void;
  setResult: (r: RaceResult | null) => void;
  setLoad: (p: number, label: string) => void;
  setReady: (r: boolean) => void;
  setPaused: (p: boolean) => void;
  reset: () => void;
}

const EMPTY_DRAW: DrawState = {
  hasLine: false,
  coverage: 0,
  strokes: 0,
  peakRisk: 0,
  estimatedLap: 0,
};

export const useEngineState = create<EngineState>((set) => ({
  phase: 'idle',
  telemetry: null,
  draw: EMPTY_DRAW,
  result: null,
  loadProgress: 0,
  loadLabel: 'Preparing',
  ready: false,
  paused: false,

  setPhase: (phase) => set({ phase }),
  setTelemetry: (telemetry) => set({ telemetry }),
  setDraw: (draw) => set({ draw }),
  setResult: (result) => set({ result }),
  setLoad: (loadProgress, loadLabel) => set({ loadProgress, loadLabel }),
  setReady: (ready) => set({ ready }),
  setPaused: (paused) => set({ paused }),
  reset: () => set({ telemetry: null, draw: EMPTY_DRAW, result: null, paused: false }),
}));

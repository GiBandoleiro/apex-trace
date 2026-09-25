import { createContext, useContext } from 'react';
import type { GameEngine } from '@/game/GameEngine';

export const EngineContext = createContext<GameEngine | null>(null);

export const useEngine = (): GameEngine | null => useContext(EngineContext);

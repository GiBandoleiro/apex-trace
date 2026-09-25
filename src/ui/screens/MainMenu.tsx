import React from 'react';
import { Wallet } from '../components';
import { selectActiveCar, selectLevel, useGame, type Screen } from '../store';
import { getCar } from '@/cars/catalog';
import { audio } from '@/audio/AudioEngine';

interface MenuEntry {
  label: string;
  hint: string;
  screen: Screen;
  primary?: boolean;
}

const ENTRIES: MenuEntry[] = [
  { label: 'Play', hint: 'Pick a circuit and draw your line', screen: 'tracks', primary: true },
  { label: 'Garage', hint: 'Upgrade and tune your car', screen: 'garage' },
  { label: 'Championship', hint: 'Multi-round series', screen: 'championship' },
  { label: 'Events', hint: 'Special rules, bigger payouts', screen: 'events' },
  { label: 'Settings', hint: 'Audio, graphics, controls', screen: 'settings' },
];

export const MainMenu: React.FC = () => {
  const profile = useGame((s) => s.profile);
  const setScreen = useGame((s) => s.setScreen);
  const level = selectLevel(profile);
  const active = selectActiveCar(profile);
  const car = getCar(active.id);

  return (
    <div className="screen">
      <header className="topbar">
        <div className="topbar__title">
          <div className="logo" style={{ textAlign: 'left', fontSize: 'clamp(30px, 6vmin, 56px)' }}>
            APEX<span>TRACE</span>
            <span className="logo__sub" style={{ letterSpacing: '0.42em' }}>
              DRAW · RACE · WIN
            </span>
          </div>
        </div>
        <Wallet coins={profile.coins} level={level.level} xpProgress={level.progress} />
      </header>

      <div className="menu">
        <nav className="menu__nav">
          {ENTRIES.map((e, i) => (
            <button
              key={e.screen}
              className={`menu-item ${e.primary ? 'menu-item--primary' : ''}`}
              style={{ animationDelay: `${i * 45}ms` }}
              onClick={() => setScreen(e.screen)}
              onPointerEnter={() => audio.ui('hover')}
            >
              <span className="menu-item__mark" />
              <span style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
                {e.label}
                <span
                  style={{
                    fontFamily: 'var(--font-body)',
                    fontSize: 11,
                    letterSpacing: 0,
                    textTransform: 'none',
                    color: e.primary ? 'rgba(255,255,255,0.75)' : 'var(--text-faint)',
                    fontWeight: 400,
                  }}
                >
                  {e.hint}
                </span>
              </span>
            </button>
          ))}
        </nav>

        <div className="menu__footer">
          <span className="label">Current car</span>
          <strong style={{ color: 'var(--text)', fontFamily: 'var(--font-display)', letterSpacing: '0.08em' }}>
            {car.make} {car.name}
          </strong>
          <span>·</span>
          <span>
            {profile.totalWins} win{profile.totalWins === 1 ? '' : 's'} / {profile.totalRaces} races
          </span>
        </div>
      </div>
    </div>
  );
};

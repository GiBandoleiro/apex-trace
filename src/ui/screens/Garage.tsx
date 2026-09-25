import React, { useEffect, useMemo, useState } from 'react';
import {
  Button,
  LockIcon,
  Panel,
  StatBar,
  TopBar,
  Wallet,
} from '../components';
import {
  selectActiveCar,
  selectCarRating,
  selectLevel,
  selectOwnedCar,
  useGame,
} from '../store';
import {
  applyUpgrades,
  CARS,
  EMPTY_UPGRADES,
  getCar,
  performanceRating,
  UPGRADES,
  upgradeCost,
} from '@/cars/catalog';
import { CAR_CLASS_LABEL, type CarStats, type UpgradeId } from '@/cars/types';
import { carThumbnail } from '@/cars/carThumbnail';
import { formatCoins } from '@/utils/math';
import { useEngine } from '../EngineContext';
import { msToKmh, computeLimits } from '@/physics/vehicleStats';

type Tab = 'cars' | 'upgrades';

export const Garage: React.FC = () => {
  const profile = useGame((s) => s.profile);
  const goBack = useGame((s) => s.goBack);
  const setScreen = useGame((s) => s.setScreen);
  const selectCar = useGame((s) => s.selectCar);
  const buyCar = useGame((s) => s.buyCar);
  const buyUpgrade = useGame((s) => s.buyUpgrade);
  const engine = useEngine();

  const level = selectLevel(profile);
  const active = selectActiveCar(profile);
  const [viewId, setViewId] = useState(active.id);
  const [tab, setTab] = useState<Tab>('cars');
  const [hoverUpgrade, setHoverUpgrade] = useState<UpgradeId | null>(null);

  const def = getCar(viewId);
  const owned = selectOwnedCar(profile, viewId);
  const isOwned = !!owned;
  const upgrades = owned?.upgrades ?? EMPTY_UPGRADES;
  const stats = applyUpgrades(def.stats, upgrades);
  const rating = performanceRating(stats);
  const limits = useMemo(() => computeLimits(stats), [stats]);

  // Preview stats for the upgrade the player is considering.
  const previewStats: CarStats | null = useMemo(() => {
    if (!hoverUpgrade || !owned) return null;
    const lvl = owned.upgrades[hoverUpgrade] ?? 0;
    const up = UPGRADES.find((u) => u.id === hoverUpgrade)!;
    if (lvl >= up.maxLevel) return null;
    return applyUpgrades(def.stats, { ...owned.upgrades, [hoverUpgrade]: lvl + 1 });
  }, [hoverUpgrade, owned, def]);

  // Keep the 3D showcase in sync with what the player is looking at.
  useEffect(() => {
    const custom = owned?.customization ?? def.defaults;
    engine?.updateShowcaseCar(viewId, custom);
  }, [engine, viewId, owned, def]);

  const canBuy = !isOwned && level.level >= def.unlockLevel && profile.coins >= def.price;

  return (
    <div className="screen screen--scrim">
      <TopBar
        title="Garage"
        subtitle={`${CAR_CLASS_LABEL[def.carClass]} · PR ${rating}`}
        onBack={goBack}
        right={<Wallet coins={profile.coins} level={level.level} xpProgress={level.progress} />}
      />

      <div className="garage">
        {/* The 3D showcase car is rendered behind this panel by the engine. */}
        <div className="garage__stage">
          <img
            src={carThumbnail(def, owned?.customization ?? def.defaults, 560, 300)}
            alt={`${def.make} ${def.name}`}
            style={{ width: '86%', maxWidth: 560, filter: 'drop-shadow(0 22px 34px rgba(0,0,0,0.55))' }}
          />
          <div style={{ position: 'absolute', left: 18, bottom: 16 }}>
            <p className="label" style={{ marginBottom: 4 }}>{def.make}</p>
            <h2 className="display" style={{ fontSize: 'clamp(22px, 3.6vmin, 36px)' }}>
              {def.name}
            </h2>
            <p className="muted" style={{ fontSize: 13, margin: '6px 0 0', maxWidth: 380 }}>
              {def.blurb}
            </p>
          </div>
          <div style={{ position: 'absolute', right: 16, top: 14, display: 'flex', gap: 8 }}>
            <span className="badge badge--accent">PR {rating}</span>
            <span className="badge">{CAR_CLASS_LABEL[def.carClass]}</span>
          </div>
        </div>

        <div className="garage__side">
          <Panel>
            <div className="col" style={{ gap: 10 }}>
              <StatBar label="Speed" value={stats.topSpeed} preview={previewStats?.topSpeed} />
              <StatBar label="Accel" value={stats.acceleration} preview={previewStats?.acceleration} />
              <StatBar label="Handling" value={stats.handling} preview={previewStats?.handling} />
              <StatBar label="Grip" value={stats.grip} preview={previewStats?.grip} />
              <StatBar label="Braking" value={stats.braking} preview={previewStats?.braking} />
              <StatBar label="Downforce" value={stats.downforce} max={140} preview={previewStats?.downforce} />
              <div className="row" style={{ justifyContent: 'space-between', marginTop: 4 }}>
                <span className="label">Top speed</span>
                <span className="num">{Math.round(msToKmh(limits.maxSpeed))} km/h</span>
              </div>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span className="label">Weight</span>
                <span className="num">{Math.round(stats.weight)} kg</span>
              </div>
            </div>
          </Panel>

          <div className="row">
            {isOwned ? (
              <>
                <Button
                  variant={profile.selectedCarId === viewId ? 'ghost' : 'primary'}
                  onClick={() => selectCar(viewId)}
                  disabled={profile.selectedCarId === viewId}
                  style={{ flex: 1 }}
                >
                  {profile.selectedCarId === viewId ? 'Selected' : 'Select'}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    selectCar(viewId);
                    setScreen('customize');
                  }}
                  style={{ flex: 1 }}
                >
                  Customize
                </Button>
              </>
            ) : (
              <Button
                variant="primary"
                block
                disabled={!canBuy}
                onClick={() => {
                  if (buyCar(viewId)) setTab('upgrades');
                }}
              >
                {level.level < def.unlockLevel
                  ? `Level ${def.unlockLevel} required`
                  : `Buy · ${formatCoins(def.price)}`}
              </Button>
            )}
          </div>

          <div className="segmented" style={{ alignSelf: 'flex-start' }}>
            <button
              className={`segmented__item ${tab === 'cars' ? 'segmented__item--active' : ''}`}
              onClick={() => setTab('cars')}
            >
              Cars
            </button>
            <button
              className={`segmented__item ${tab === 'upgrades' ? 'segmented__item--active' : ''}`}
              onClick={() => setTab('upgrades')}
              disabled={!isOwned}
            >
              Upgrades
            </button>
          </div>

          <div className="scroll">
            {tab === 'cars' ? (
              <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
                {CARS.map((c, i) => {
                  const ownedCar = selectOwnedCar(profile, c.id);
                  const locked = !ownedCar && level.level < c.unlockLevel;
                  const custom = ownedCar?.customization ?? c.defaults;
                  return (
                    <button
                      key={c.id}
                      className={`card ${viewId === c.id ? 'card--active' : ''} ${locked ? 'card--locked' : ''}`}
                      style={{ animationDelay: `${i * 30}ms` }}
                      onClick={() => setViewId(c.id)}
                    >
                      <div className="card__media">
                        <img src={carThumbnail(c, custom, 320, 180)} alt={c.name} />
                        {!ownedCar && (
                          <span
                            className={`badge ${locked ? 'badge--lock' : 'badge--accent'}`}
                            style={{ position: 'absolute', top: 8, right: 8 }}
                          >
                            {locked ? <LockIcon /> : null}
                            {locked ? `LV ${c.unlockLevel}` : formatCoins(c.price)}
                          </span>
                        )}
                        {profile.selectedCarId === c.id && (
                          <span
                            className="badge badge--good"
                            style={{ position: 'absolute', top: 8, left: 8 }}
                          >
                            In use
                          </span>
                        )}
                      </div>
                      <div className="card__body" style={{ gap: 4 }}>
                        <h3 className="card__title" style={{ fontSize: 15 }}>
                          {c.name}
                        </h3>
                        <div className="card__meta">
                          <span>{CAR_CLASS_LABEL[c.carClass]}</span>
                          <span className="num">PR {selectCarRating(profile, c.id)}</span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="col" style={{ gap: 10, paddingBottom: 12 }}>
                {UPGRADES.map((u) => {
                  const lvl = upgrades[u.id] ?? 0;
                  const cost = upgradeCost(u.id, lvl);
                  const maxed = cost === null;
                  return (
                    <div
                      key={u.id}
                      className="upgrade-row"
                      onPointerEnter={() => setHoverUpgrade(u.id)}
                      onPointerLeave={() => setHoverUpgrade(null)}
                    >
                      <div>
                        <div className="row" style={{ gap: 8, alignItems: 'baseline' }}>
                          <strong
                            style={{
                              fontFamily: 'var(--font-display)',
                              letterSpacing: '0.08em',
                              textTransform: 'uppercase',
                              fontSize: 15,
                            }}
                          >
                            {u.label}
                          </strong>
                          <span className="label">
                            LV {lvl}/{u.maxLevel}
                          </span>
                        </div>
                        <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-faint)' }}>
                          {u.description}
                        </p>
                        <div className="pips">
                          {Array.from({ length: u.maxLevel }, (_, i) => (
                            <span key={i} className={`pip ${i < lvl ? 'pip--on' : ''}`} />
                          ))}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant={maxed ? 'ghost' : 'primary'}
                        disabled={maxed || !isOwned || profile.coins < (cost ?? 0)}
                        onClick={() => buyUpgrade(viewId, u.id)}
                        onFocus={() => setHoverUpgrade(u.id)}
                      >
                        {maxed ? 'Max' : formatCoins(cost ?? 0)}
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

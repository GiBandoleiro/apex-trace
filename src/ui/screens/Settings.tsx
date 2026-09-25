import React, { useState } from 'react';
import { Button, Modal, Panel, Segmented, Slider, Toggle, TopBar } from '../components';
import { useGame } from '../store';
import { audio } from '@/audio/AudioEngine';
import type { QualityTier } from '@/systems/quality';
import { detectDeviceClass, detectQualityTier } from '@/systems/quality';
import { useEngine } from '../EngineContext';

export const Settings: React.FC = () => {
  const profile = useGame((s) => s.profile);
  const goBack = useGame((s) => s.goBack);
  const updateSettings = useGame((s) => s.updateSettings);
  const setPlayerName = useGame((s) => s.setPlayerName);
  const resetProfile = useGame((s) => s.resetProfile);
  const fps = useGame((s) => s.fps);
  const engine = useEngine();
  const [confirmReset, setConfirmReset] = useState(false);

  const s = profile.settings;
  const autoTier = detectQualityTier();
  const device = detectDeviceClass();

  const applyQuality = (value: QualityTier | 'auto') => {
    updateSettings({ quality: value });
    engine?.setAutoQuality(value === 'auto');
    engine?.applyQuality(value === 'auto' ? autoTier : value);
  };

  return (
    <div className="screen screen--scrim">
      <TopBar title="Settings" subtitle={`${device} · running ${Math.round(fps)} fps`} onBack={goBack} />

      <div className="scroll">
        <div
          className="grid"
          style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))' }}
        >
          <Panel>
            <div className="col" style={{ gap: 16 }}>
              <h3 className="subtitle" style={{ margin: 0 }}>Audio</h3>
              <Slider
                label="Master"
                value={s.masterVolume}
                onChange={(v) => {
                  updateSettings({ masterVolume: v });
                  audio.ui('hover');
                }}
              />
              <Slider
                label="Effects"
                value={s.sfxVolume}
                onChange={(v) => updateSettings({ sfxVolume: v })}
              />
              <Slider
                label="Ambience"
                value={s.musicVolume}
                onChange={(v) => updateSettings({ musicVolume: v })}
              />
              <Button variant="ghost" size="sm" onClick={() => audio.ui('victory')}>
                Test sound
              </Button>
            </div>
          </Panel>

          <Panel>
            <div className="col" style={{ gap: 16 }}>
              <h3 className="subtitle" style={{ margin: 0 }}>Graphics</h3>
              <div className="field">
                <span className="label">Quality</span>
                <Segmented
                  value={s.quality}
                  onChange={applyQuality}
                  options={[
                    { value: 'auto', label: `Auto (${autoTier})` },
                    { value: 'low', label: 'Low' },
                    { value: 'medium', label: 'Med' },
                    { value: 'high', label: 'High' },
                    { value: 'ultra', label: 'Ultra' },
                  ]}
                />
              </div>
              <Toggle
                label="Camera shake"
                hint="Subtle impulse on contact"
                value={s.cameraShake}
                onChange={(v) => {
                  updateSettings({ cameraShake: v });
                  engine?.setCameraShake(v);
                }}
              />
              <Toggle
                label="Reduce motion"
                hint="Locks the camera rotation during a race"
                value={s.reduceMotion}
                onChange={(v) => {
                  updateSettings({ reduceMotion: v });
                  engine?.setReduceMotion(v);
                }}
              />
              <Toggle
                label="Show suggested line"
                hint="Offers the computed ideal line while drawing"
                value={s.showRacingLine}
                onChange={(v) => updateSettings({ showRacingLine: v })}
              />
            </div>
          </Panel>

          <Panel>
            <div className="col" style={{ gap: 16 }}>
              <h3 className="subtitle" style={{ margin: 0 }}>Gameplay</h3>
              <div className="field">
                <span className="label">Driver name</span>
                <input
                  className="text-input"
                  value={profile.name}
                  maxLength={18}
                  onChange={(e) => setPlayerName(e.target.value)}
                />
              </div>
              <div className="field">
                <span className="label">Speed units</span>
                <Segmented
                  value={s.units}
                  onChange={(v) => updateSettings({ units: v })}
                  options={[
                    { value: 'kmh', label: 'km/h' },
                    { value: 'mph', label: 'mph' },
                  ]}
                />
              </div>
              <Toggle
                label="Haptics"
                hint="Vibrate on impacts (supported devices)"
                value={s.hapticFeedback}
                onChange={(v) => updateSettings({ hapticFeedback: v })}
              />
            </div>
          </Panel>

          <Panel>
            <div className="col" style={{ gap: 14 }}>
              <h3 className="subtitle" style={{ margin: 0 }}>Controls</h3>
              <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--text-dim)', fontSize: 14, lineHeight: 1.9 }}>
                <li><strong>Drag</strong> — draw the racing line</li>
                <li><strong>Two fingers / right-drag</strong> — pan the camera</li>
                <li><strong>Pinch / scroll</strong> — zoom</li>
                <li><strong>R</strong> — clear the line</li>
                <li><strong>Z</strong> — undo the last stroke</li>
                <li><strong>Enter / Space</strong> — confirm and start</li>
                <li><strong>Esc</strong> — back</li>
              </ul>
            </div>
          </Panel>

          <Panel>
            <div className="col" style={{ gap: 14 }}>
              <h3 className="subtitle" style={{ margin: 0 }}>Profile</h3>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span className="label">Races</span>
                <span className="num">{profile.totalRaces}</span>
              </div>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span className="label">Wins</span>
                <span className="num">{profile.totalWins}</span>
              </div>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span className="label">Cars owned</span>
                <span className="num">{profile.ownedCars.length}</span>
              </div>
              <Button variant="danger" onClick={() => setConfirmReset(true)}>
                Reset progress
              </Button>
              <p style={{ fontSize: 12, color: 'var(--text-faint)', margin: 0 }}>
                Progress is stored locally in this browser. Clearing site data removes it.
              </p>
            </div>
          </Panel>
        </div>
      </div>

      <Modal open={confirmReset} onClose={() => setConfirmReset(false)}>
        <div className="col">
          <h2 className="display" style={{ fontSize: 26 }}>Reset everything?</h2>
          <p className="muted" style={{ margin: 0 }}>
            This deletes your coins, level, cars, upgrades, unlocked circuits and lap records.
            It cannot be undone.
          </p>
          <div className="row">
            <Button variant="ghost" style={{ flex: 1 }} onClick={() => setConfirmReset(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              style={{ flex: 1 }}
              onClick={() => {
                resetProfile();
                setConfirmReset(false);
              }}
            >
              Reset
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};

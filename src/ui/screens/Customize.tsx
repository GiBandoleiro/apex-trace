import React, { useEffect, useState } from 'react';
import { Button, Panel, Segmented, Toggle, TopBar } from '../components';
import { selectActiveCar, useGame } from '../store';
import { getCar } from '@/cars/catalog';
import type { DecalId, PaintFinish, WheelStyle } from '@/cars/types';
import { carThumbnail } from '@/cars/carThumbnail';
import { useEngine } from '../EngineContext';
import { audio } from '@/audio/AudioEngine';

const PALETTE = [
  '#e04b3a', '#d95f16', '#e0a52c', '#f0c419', '#7bc043', '#3fbf85',
  '#2fb8c8', '#18b0d8', '#2f7fd8', '#1c3f8f', '#7c5bd8', '#c8508f',
  '#f2f4f8', '#b7bdc9', '#4a5160', '#20242c', '#0f1116', '#c9a227',
];

const FINISHES: Array<{ value: PaintFinish; label: string }> = [
  { value: 'gloss', label: 'Gloss' },
  { value: 'matte', label: 'Matte' },
  { value: 'metallic', label: 'Metallic' },
  { value: 'pearl', label: 'Pearl' },
];

const WHEELS: Array<{ value: WheelStyle; label: string }> = [
  { value: 'split5', label: 'Split 5' },
  { value: 'mesh', label: 'Mesh' },
  { value: 'turbine', label: 'Turbine' },
  { value: 'dish', label: 'Dish' },
  { value: 'multispoke', label: 'Multi' },
];

const DECALS: Array<{ value: DecalId; label: string }> = [
  { value: 'none', label: 'None' },
  { value: 'stripes', label: 'Stripes' },
  { value: 'arrow', label: 'Arrow' },
  { value: 'blocks', label: 'Blocks' },
  { value: 'flames', label: 'Flames' },
  { value: 'carbon', label: 'Carbon' },
  { value: 'halftone', label: 'Halftone' },
];

type Slot = 'primary' | 'secondary' | 'wheelColor';

export const Customize: React.FC = () => {
  const profile = useGame((s) => s.profile);
  const goBack = useGame((s) => s.goBack);
  const customizeCar = useGame((s) => s.customizeCar);
  const engine = useEngine();

  const owned = selectActiveCar(profile);
  const def = getCar(owned.id);
  const custom = owned.customization;
  const [slot, setSlot] = useState<Slot>('primary');

  useEffect(() => {
    engine?.updateShowcaseCar(owned.id, custom);
  }, [engine, owned.id, custom]);

  const patch = (p: Parameters<typeof customizeCar>[1]) => {
    customizeCar(owned.id, p);
  };

  return (
    <div className="screen screen--scrim">
      <TopBar
        title="Customize"
        subtitle={`${def.make} ${def.name}`}
        onBack={goBack}
        right={
          <Button
            variant="ghost"
            onClick={() => {
              audio.ui('back');
              patch({ ...def.defaults });
            }}
          >
            Reset
          </Button>
        }
      />

      <div className="detail" style={{ flex: 1, minHeight: 0 }}>
        <div className="garage__stage">
          <img
            src={carThumbnail(def, custom, 640, 340)}
            alt="Car preview"
            style={{ width: '88%', maxWidth: 640, filter: 'drop-shadow(0 24px 36px rgba(0,0,0,0.6))' }}
          />
        </div>

        <div className="scroll">
          <div className="col">
            <Panel>
              <div className="col" style={{ gap: 12 }}>
                <span className="label">Paint</span>
                <Segmented
                  value={slot}
                  onChange={setSlot}
                  options={[
                    { value: 'primary', label: 'Body' },
                    { value: 'secondary', label: 'Accent' },
                    { value: 'wheelColor', label: 'Wheels' },
                  ]}
                />
                <div className="swatches">
                  {PALETTE.map((c) => (
                    <button
                      key={c}
                      className={`swatch ${custom[slot] === c ? 'swatch--active' : ''}`}
                      style={{ background: c }}
                      aria-label={`Colour ${c}`}
                      onClick={() => {
                        audio.ui('click');
                        patch({ [slot]: c });
                      }}
                    />
                  ))}
                </div>
                <label className="row" style={{ justifyContent: 'space-between' }}>
                  <span className="label">Custom colour</span>
                  <input
                    type="color"
                    value={custom[slot]}
                    onChange={(e) => patch({ [slot]: e.target.value })}
                    style={{
                      width: 56,
                      height: 36,
                      border: '1px solid var(--line)',
                      borderRadius: 10,
                      background: 'transparent',
                      padding: 2,
                    }}
                  />
                </label>
              </div>
            </Panel>

            <Panel>
              <div className="col" style={{ gap: 14 }}>
                <div className="field">
                  <span className="label">Finish</span>
                  <Segmented
                    value={custom.finish}
                    onChange={(v) => patch({ finish: v })}
                    options={FINISHES}
                  />
                </div>
                <div className="field">
                  <span className="label">Wheels</span>
                  <Segmented
                    value={custom.wheelStyle}
                    onChange={(v) => patch({ wheelStyle: v })}
                    options={WHEELS}
                  />
                </div>
                <div className="field">
                  <span className="label">Decal</span>
                  <Segmented
                    value={custom.decal}
                    onChange={(v) => patch({ decal: v })}
                    options={DECALS}
                  />
                </div>
              </div>
            </Panel>

            <Panel>
              <div className="col" style={{ gap: 4 }}>
                <div className="field">
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <span className="label">Race number</span>
                    <span className="num" style={{ fontSize: 20 }}>
                      {custom.raceNumber}
                    </span>
                  </div>
                  <input
                    className="slider"
                    type="range"
                    min={1}
                    max={99}
                    step={1}
                    value={custom.raceNumber}
                    onChange={(e) => patch({ raceNumber: parseInt(e.target.value, 10) })}
                  />
                </div>
                <Toggle
                  label="Rear wing"
                  hint="Fits an aero wing regardless of the base body"
                  value={custom.spoiler}
                  onChange={(v) => patch({ spoiler: v })}
                />
                <Toggle
                  label="Tinted glass"
                  value={custom.tint}
                  onChange={(v) => patch({ tint: v })}
                />
              </div>
            </Panel>
          </div>
        </div>
      </div>
    </div>
  );
};

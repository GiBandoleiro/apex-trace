/**
 * Fully procedural audio.
 *
 * Every sound in the game is synthesised with the Web Audio API - there are no
 * audio files to download, nothing to license, and the engine note tracks the
 * simulation continuously instead of crossfading between samples.
 *
 * Layout:
 *   master -> [sfxBus, musicBus, engineBus] -> destination
 * The context is created lazily and resumed on the first user gesture, which
 * is what every mobile browser requires.
 */

import { clamp, clamp01, damp } from '@/utils/math';

export type UiSound =
  | 'click'
  | 'back'
  | 'hover'
  | 'confirm'
  | 'purchase'
  | 'upgrade'
  | 'unlock'
  | 'victory'
  | 'defeat'
  | 'countdown'
  | 'go'
  | 'error';

interface EngineVoice {
  osc: OscillatorNode[];
  gain: GainNode;
  filter: BiquadFilterNode;
  noise: AudioBufferSourceNode;
  noiseGain: GainNode;
  noiseFilter: BiquadFilterNode;
}

const NOISE_SECONDS = 2;

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private engineBus: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;

  private engineVoice: EngineVoice | null = null;
  private tireGain: GainNode | null = null;
  private tireFilter: BiquadFilterNode | null = null;
  private windGain: GainNode | null = null;
  private ambienceGain: GainNode | null = null;
  private ambienceNodes: AudioNode[] = [];

  private started = false;
  private muted = false;

  private volumes = { master: 0.8, sfx: 0.9, music: 0.45 };
  private smoothedRpm = 0.12;
  private smoothedLoad = 0;

  /* ---------------------------------------------------------------- */
  /* Lifecycle                                                         */
  /* ---------------------------------------------------------------- */

  /** Must be called from a user gesture. Safe to call repeatedly. */
  async unlock(): Promise<void> {
    if (!this.ctx) this.init();
    if (this.ctx && this.ctx.state === 'suspended') {
      try {
        await this.ctx.resume();
      } catch {
        /* the browser will let us try again on the next gesture */
      }
    }
  }

  private init(): void {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;

    const ctx = new Ctor();
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = this.volumes.master;
    this.master.connect(ctx.destination);

    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = this.volumes.sfx;
    this.sfxBus.connect(this.master);

    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = this.volumes.music;
    this.musicBus.connect(this.master);

    this.engineBus = ctx.createGain();
    this.engineBus.gain.value = 0;
    this.engineBus.connect(this.master);

    // Shared white-noise buffer used by tyres, wind and ambience.
    const length = ctx.sampleRate * NOISE_SECONDS;
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      // Slight brown tilt reads as more "physical" than pure white.
      last = (last + 0.02 * white) / 1.02;
      data[i] = white * 0.75 + last * 3.2;
    }
    this.noiseBuffer = buffer;
    this.started = true;
  }

  setVolumes(master: number, sfx: number, music: number): void {
    this.volumes = { master, sfx, music };
    if (this.master) this.master.gain.value = this.muted ? 0 : master;
    if (this.sfxBus) this.sfxBus.gain.value = sfx;
    if (this.musicBus) this.musicBus.gain.value = music;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master) this.master.gain.value = muted ? 0 : this.volumes.master;
  }

  get isRunning(): boolean {
    return this.started && this.ctx?.state === 'running';
  }

  dispose(): void {
    this.stopEngine();
    this.stopAmbience();
    try {
      void this.ctx?.close();
    } catch {
      /* ignore */
    }
    this.ctx = null;
    this.started = false;
  }

  /* ---------------------------------------------------------------- */
  /* Engine                                                            */
  /* ---------------------------------------------------------------- */

  /**
   * Starts the engine voice: three detuned saw oscillators for the firing
   * order plus filtered noise for induction and exhaust turbulence.
   */
  startEngine(): void {
    if (!this.ctx || !this.engineBus || !this.noiseBuffer || this.engineVoice) return;
    const ctx = this.ctx;

    const gain = ctx.createGain();
    gain.gain.value = 0;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 900;
    filter.Q.value = 0.9;

    const oscs: OscillatorNode[] = [];
    const ratios = [1, 2.02, 3.01];
    const levels = [0.5, 0.26, 0.14];
    ratios.forEach((ratio, i) => {
      const osc = ctx.createOscillator();
      osc.type = i === 0 ? 'sawtooth' : 'square';
      osc.frequency.value = 60 * ratio;
      const g = ctx.createGain();
      g.gain.value = levels[i];
      osc.connect(g);
      g.connect(filter);
      osc.start();
      oscs.push(osc);
    });

    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    noise.loop = true;
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.value = 700;
    noiseFilter.Q.value = 0.7;
    const noiseGain = ctx.createGain();
    noiseGain.gain.value = 0;
    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(gain);
    noise.start();

    filter.connect(gain);
    gain.connect(this.engineBus);
    this.engineBus.gain.value = 0.55;

    this.engineVoice = { osc: oscs, gain, filter, noise, noiseGain, noiseFilter };

    // Tyre scrub layer.
    const tire = ctx.createBufferSource();
    tire.buffer = this.noiseBuffer;
    tire.loop = true;
    const tFilter = ctx.createBiquadFilter();
    tFilter.type = 'bandpass';
    tFilter.frequency.value = 2600;
    tFilter.Q.value = 3.5;
    const tGain = ctx.createGain();
    tGain.gain.value = 0;
    tire.connect(tFilter);
    tFilter.connect(tGain);
    tGain.connect(this.engineBus);
    tire.start();
    this.tireGain = tGain;
    this.tireFilter = tFilter;

    // Wind layer.
    const wind = ctx.createBufferSource();
    wind.buffer = this.noiseBuffer;
    wind.loop = true;
    const wFilter = ctx.createBiquadFilter();
    wFilter.type = 'lowpass';
    wFilter.frequency.value = 1100;
    const wGain = ctx.createGain();
    wGain.gain.value = 0;
    wind.connect(wFilter);
    wFilter.connect(wGain);
    wGain.connect(this.engineBus);
    wind.start();
    this.windGain = wGain;
  }

  stopEngine(): void {
    const v = this.engineVoice;
    if (!v || !this.ctx) return;
    const now = this.ctx.currentTime;
    v.gain.gain.cancelScheduledValues(now);
    v.gain.gain.setTargetAtTime(0, now, 0.12);
    const oscs = v.osc;
    const noise = v.noise;
    const tire = this.tireGain;
    const wind = this.windGain;
    window.setTimeout(() => {
      try {
        oscs.forEach((o) => o.stop());
        noise.stop();
      } catch {
        /* already stopped */
      }
      tire?.disconnect();
      wind?.disconnect();
    }, 400);
    this.engineVoice = null;
    this.tireGain = null;
    this.windGain = null;
  }

  /**
   * Drives the engine note.
   * @param speedRatio 0..1 of top speed
   * @param throttle 0..1
   * @param slip 0..1 tyre slip intensity
   * @param dt frame delta, for smoothing
   */
  updateEngine(speedRatio: number, throttle: number, slip: number, dt: number): void {
    const v = this.engineVoice;
    if (!v || !this.ctx) return;
    const now = this.ctx.currentTime;

    // Fake a gearbox: RPM sweeps up within a gear then drops on the shift.
    const gears = 6;
    const gearSpan = 1 / gears;
    const gear = Math.min(gears - 1, Math.floor(speedRatio / gearSpan));
    const withinGear = (speedRatio - gear * gearSpan) / gearSpan;
    const rpm = clamp01(0.18 + withinGear * 0.78 + speedRatio * 0.08);

    this.smoothedRpm = damp(this.smoothedRpm, rpm, 14, dt);
    this.smoothedLoad = damp(this.smoothedLoad, throttle, 9, dt);

    const base = 44 + this.smoothedRpm * 170;
    v.osc[0].frequency.setTargetAtTime(base, now, 0.03);
    v.osc[1].frequency.setTargetAtTime(base * 2.02, now, 0.03);
    v.osc[2].frequency.setTargetAtTime(base * 3.01, now, 0.03);

    const loudness = 0.07 + this.smoothedRpm * 0.2 + this.smoothedLoad * 0.12;
    v.gain.gain.setTargetAtTime(loudness, now, 0.05);
    v.filter.frequency.setTargetAtTime(
      420 + this.smoothedRpm * 2600 + this.smoothedLoad * 900,
      now,
      0.06,
    );
    v.noiseGain.gain.setTargetAtTime(0.04 + this.smoothedRpm * 0.1, now, 0.08);
    v.noiseFilter.frequency.setTargetAtTime(500 + this.smoothedRpm * 2200, now, 0.08);

    if (this.tireGain && this.tireFilter) {
      this.tireGain.gain.setTargetAtTime(clamp01(slip) * 0.16, now, 0.05);
      this.tireFilter.frequency.setTargetAtTime(1800 + clamp01(slip) * 2400, now, 0.08);
    }
    if (this.windGain) {
      this.windGain.gain.setTargetAtTime(Math.pow(clamp01(speedRatio), 2) * 0.09, now, 0.12);
    }
  }

  /* ---------------------------------------------------------------- */
  /* Ambience                                                          */
  /* ---------------------------------------------------------------- */

  /** Layered trackside ambience: air, distant crowd and a soft pad. */
  startAmbience(kind: 'menu' | 'track', timeOfDay: 'day' | 'sunset' | 'night' = 'day'): void {
    if (!this.ctx || !this.musicBus || !this.noiseBuffer) return;
    this.stopAmbience();
    const ctx = this.ctx;

    const out = ctx.createGain();
    out.gain.value = 0;
    out.connect(this.musicBus);
    out.gain.setTargetAtTime(kind === 'menu' ? 0.5 : 0.32, ctx.currentTime, 1.2);
    this.ambienceGain = out;

    // Air / crowd bed.
    const air = ctx.createBufferSource();
    air.buffer = this.noiseBuffer;
    air.loop = true;
    const airFilter = ctx.createBiquadFilter();
    airFilter.type = 'bandpass';
    airFilter.frequency.value = timeOfDay === 'night' ? 320 : 520;
    airFilter.Q.value = 0.55;
    const airGain = ctx.createGain();
    airGain.gain.value = kind === 'track' ? 0.09 : 0.05;
    air.connect(airFilter);
    airFilter.connect(airGain);
    airGain.connect(out);
    air.start();
    this.ambienceNodes.push(air, airFilter, airGain);

    // Slow harmonic pad - a low fifth with gentle detune.
    const roots: Record<string, number> = { day: 110, sunset: 98, night: 82.4 };
    const root = roots[timeOfDay] ?? 110;
    const intervals = [1, 1.5, 2, 3];
    intervals.forEach((interval, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = root * interval;
      osc.detune.value = (i - 1.5) * 6;
      const g = ctx.createGain();
      g.gain.value = 0.045 / (i + 1);
      const lfo = ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = 0.05 + i * 0.021;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 0.022 / (i + 1);
      lfo.connect(lfoGain);
      lfoGain.connect(g.gain);
      osc.connect(g);
      g.connect(out);
      osc.start();
      lfo.start();
      this.ambienceNodes.push(osc, g, lfo, lfoGain);
    });
  }

  stopAmbience(): void {
    if (!this.ctx) return;
    const gain = this.ambienceGain;
    const nodes = this.ambienceNodes;
    this.ambienceGain = null;
    this.ambienceNodes = [];
    if (!gain) return;
    gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.35);
    window.setTimeout(() => {
      nodes.forEach((n) => {
        try {
          if ('stop' in n && typeof (n as OscillatorNode).stop === 'function') {
            (n as OscillatorNode).stop();
          }
        } catch {
          /* already stopped */
        }
        n.disconnect();
      });
      gain.disconnect();
    }, 900);
  }

  /* ---------------------------------------------------------------- */
  /* One-shots                                                         */
  /* ---------------------------------------------------------------- */

  private tone(
    freq: number,
    duration: number,
    type: OscillatorType,
    peak: number,
    sweepTo?: number,
    delay = 0,
  ): void {
    if (!this.ctx || !this.sfxBus) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (sweepTo !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, sweepTo), t0 + duration);
    }
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(gain);
    gain.connect(this.sfxBus);
    osc.start(t0);
    osc.stop(t0 + duration + 0.05);
  }

  private noiseBurst(
    duration: number,
    peak: number,
    freq: number,
    q: number,
    delay = 0,
    type: BiquadFilterType = 'bandpass',
  ): void {
    if (!this.ctx || !this.sfxBus || !this.noiseBuffer) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(freq, t0);
    filter.frequency.exponentialRampToValueAtTime(Math.max(60, freq * 0.35), t0 + duration);
    filter.Q.value = q;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxBus);
    src.start(t0);
    src.stop(t0 + duration + 0.05);
  }

  ui(sound: UiSound): void {
    if (!this.isRunning) return;
    switch (sound) {
      case 'hover':
        this.tone(1180, 0.05, 'sine', 0.035);
        break;
      case 'click':
        this.tone(760, 0.07, 'triangle', 0.09, 560);
        this.noiseBurst(0.05, 0.03, 2600, 2);
        break;
      case 'back':
        this.tone(460, 0.09, 'triangle', 0.08, 320);
        break;
      case 'confirm':
        this.tone(620, 0.09, 'triangle', 0.1);
        this.tone(930, 0.12, 'triangle', 0.08, undefined, 0.06);
        break;
      case 'purchase':
        this.tone(540, 0.1, 'sine', 0.1);
        this.tone(810, 0.12, 'sine', 0.09, undefined, 0.07);
        this.tone(1080, 0.18, 'sine', 0.07, undefined, 0.14);
        break;
      case 'upgrade':
        this.tone(420, 0.08, 'square', 0.055, 620);
        this.noiseBurst(0.16, 0.05, 1800, 1.4, 0.03);
        break;
      case 'unlock':
        [523, 659, 784, 1047].forEach((f, i) =>
          this.tone(f, 0.26, 'triangle', 0.085, undefined, i * 0.075),
        );
        break;
      case 'victory':
        [523, 659, 784, 1047, 1319].forEach((f, i) =>
          this.tone(f, 0.45, 'triangle', 0.1, undefined, i * 0.1),
        );
        this.noiseBurst(0.7, 0.05, 3200, 1, 0.1);
        break;
      case 'defeat':
        [392, 349, 294].forEach((f, i) =>
          this.tone(f, 0.4, 'sine', 0.09, undefined, i * 0.14),
        );
        break;
      case 'countdown':
        this.tone(760, 0.16, 'square', 0.1);
        break;
      case 'go':
        this.tone(1180, 0.42, 'square', 0.13);
        this.tone(1570, 0.42, 'triangle', 0.08, undefined, 0.02);
        break;
      case 'error':
        this.tone(220, 0.16, 'sawtooth', 0.07, 150);
        break;
    }
  }

  /** Impact sound; `intensity` 0..1. */
  collision(intensity: number, kind: 'barrier' | 'car'): void {
    if (!this.isRunning) return;
    const i = clamp(intensity, 0.05, 1);
    if (kind === 'barrier') {
      this.noiseBurst(0.18 + i * 0.22, 0.09 * i + 0.02, 900 + i * 900, 1.1, 0, 'lowpass');
      this.tone(90 + i * 60, 0.22, 'square', 0.06 * i);
    } else {
      this.noiseBurst(0.12 + i * 0.14, 0.06 * i + 0.015, 1500, 2.2);
      this.tone(160, 0.14, 'triangle', 0.04 * i);
    }
  }

  /** Short spark/scrape used when a car grinds along a barrier. */
  scrape(intensity: number): void {
    if (!this.isRunning) return;
    this.noiseBurst(0.09, 0.03 * clamp01(intensity), 4200, 6);
  }
}

export const audio = new AudioEngine();

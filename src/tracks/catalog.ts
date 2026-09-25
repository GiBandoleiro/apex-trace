/**
 * The circuit catalogue.
 *
 * Every layout is original: control points were authored by hand so each one
 * has a distinct rhythm (long straights, hairpins, sweepers, chicanes) rather
 * than being procedurally generated noise.
 */

import type { EnvironmentPalette, TrackDefinition, TrackNode } from './types';

const DAY: EnvironmentPalette = {
  sky: '#8fb6dd',
  fog: '#9db9d4',
  fogDensity: 0.0026,
  sunColor: '#fff3dc',
  sunIntensity: 2.8,
  sunDirection: [0.42, 0.82, 0.38],
  ambientColor: '#9dc0e8',
  ambientIntensity: 1.05,
  groundColor: '#4a4f46',
  terrainTint: '#ffffff',
};

const SUNSET: EnvironmentPalette = {
  sky: '#f5a25c',
  fog: '#e08c5a',
  fogDensity: 0.0032,
  sunColor: '#ffd3ab',
  sunIntensity: 3.2,
  sunDirection: [-0.62, 0.54, 0.42],
  ambientColor: '#6f86c0',
  ambientIntensity: 1.0,
  groundColor: '#5a3a2c',
  terrainTint: '#f4ece6',
};

const NIGHT: EnvironmentPalette = {
  sky: '#0a0e1a',
  fog: '#0b1020',
  fogDensity: 0.0045,
  sunColor: '#9db6e4',
  sunIntensity: 0.7,
  sunDirection: [-0.3, 0.9, -0.28],
  ambientColor: '#39496f',
  ambientIntensity: 0.72,
  groundColor: '#12161f',
  terrainTint: '#9fb4d8',
};

const tint = (base: EnvironmentPalette, over: Partial<EnvironmentPalette>): EnvironmentPalette => ({
  ...base,
  ...over,
});

const n = (x: number, z: number, width?: number): TrackNode =>
  width === undefined ? { x, z } : { x, z, width };

/* ------------------------------------------------------------------ */
/* 01 - Sunset Circuit (reference layout used to validate the systems)  */
/* ------------------------------------------------------------------ */

const SUNSET_CIRCUIT_NODES: TrackNode[] = [
  n(0, 0, 8.6), // start / finish
  n(70, 0, 8.6),
  n(140, 0, 8.2),
  n(200, 2, 8),
  n(240, 18, 7.4), // T1 entry - 90 degrees right
  n(258, 58, 7.2),
  n(262, 110, 7.6),
  n(268, 152, 7),
  n(274, 186, 6.4), // hairpin
  n(258, 212, 6),
  n(222, 212, 6.2),
  n(204, 186, 6.8),
  n(204, 168, 7.4),
  n(170, 176, 7.2), // S curves
  n(136, 158, 7),
  n(104, 150, 7),
  n(70, 168, 7.4),
  n(30, 180, 8),
  n(-30, 182, 8.6), // long back straight
  n(-100, 176, 8.6),
  n(-160, 160, 8),
  n(-206, 124, 7.2), // fast sweeper
  n(-226, 74, 7),
  n(-214, 26, 7.2), // final corner
  n(-176, -6, 7.8),
  n(-120, -18, 8.2),
  n(-60, -12, 8.6),
  n(-22, -4, 8.6),
];

/* ------------------------------------------------------------------ */
/* 02 - City Rush                                                      */
/* ------------------------------------------------------------------ */

const CITY_RUSH_NODES: TrackNode[] = [
  n(0, 0, 7.4),
  n(60, 0, 7.4),
  n(130, -2, 7.2),
  n(178, 4, 6.4),
  n(196, 36, 6.2), // tight street right
  n(192, 82, 6.4),
  n(186, 126, 6.2),
  n(164, 156, 6),
  n(122, 162, 6.4), // 90 left
  n(96, 140, 6.2),
  n(92, 108, 6.4), // short chicane
  n(64, 96, 6.2),
  n(36, 116, 6.4),
  n(6, 140, 6.6),
  n(-40, 156, 7),
  n(-96, 156, 7.2),
  n(-140, 140, 6.8),
  n(-162, 104, 6.4), // hairpin around the block
  n(-152, 66, 6.2),
  n(-124, 46, 6.6),
  n(-96, 30, 7),
  n(-96, 2, 7),
  n(-120, -18, 6.6),
  n(-112, -44, 6.4),
  n(-72, -50, 6.8),
  n(-34, -30, 7.2),
];

/* ------------------------------------------------------------------ */
/* 03 - Coastline GP                                                   */
/* ------------------------------------------------------------------ */

const COASTLINE_NODES: TrackNode[] = [
  n(0, 0, 9),
  n(90, -4, 9),
  n(180, -6, 8.6),
  n(250, 6, 8), // long coastal straight
  n(296, 44, 7.4),
  n(310, 100, 7.6),
  n(296, 154, 7.4), // fast right-hander
  n(252, 186, 7.2),
  n(196, 190, 7.6),
  n(146, 174, 7.4),
  n(112, 142, 7), // cliffside esses
  n(70, 136, 7),
  n(32, 162, 7.2),
  n(-16, 186, 7.6),
  n(-76, 192, 8),
  n(-138, 178, 7.6),
  n(-184, 146, 7.2),
  n(-206, 100, 7), // hairpin at the marina
  n(-192, 56, 6.8),
  n(-152, 36, 7.2),
  n(-118, 20, 7.6),
  n(-104, -16, 7.4),
  n(-76, -42, 7.8),
  n(-30, -30, 8.6),
];

/* ------------------------------------------------------------------ */
/* 04 - Dune Prospect (desert)                                         */
/* ------------------------------------------------------------------ */

const DESERT_NODES: TrackNode[] = [
  n(0, 0, 9.4),
  n(110, 0, 9.4),
  n(220, 4, 9), // very long straight
  n(300, 26, 8),
  n(340, 76, 7.6),
  n(336, 134, 7.8),
  n(300, 176, 7.4),
  n(240, 192, 8),
  n(178, 182, 7.8),
  n(132, 154, 7.4), // triple apex
  n(96, 168, 7.2),
  n(56, 190, 7.6),
  n(0, 200, 8.2),
  n(-64, 196, 8.2),
  n(-124, 172, 7.8),
  n(-162, 130, 7.4),
  n(-170, 82, 7.2), // hairpin
  n(-146, 44, 7.4),
  n(-108, 34, 8),
  n(-82, 6, 8.4),
  n(-60, -26, 8),
  n(-16, -22, 9),
];

/* ------------------------------------------------------------------ */
/* 05 - Alpine Pass                                                    */
/* ------------------------------------------------------------------ */

const ALPINE_NODES: TrackNode[] = [
  n(0, 0, 7.6),
  n(56, -6, 7.6),
  n(116, -4, 7.2),
  n(160, 16, 6.6),
  n(172, 60, 6.4), // mountain switchbacks
  n(146, 92, 6),
  n(108, 94, 6.2),
  n(84, 122, 6),
  n(96, 158, 6.2),
  n(136, 176, 6.6),
  n(182, 174, 7),
  n(214, 146, 6.6),
  n(216, 106, 6.4),
  n(240, 78, 6.8),
  n(272, 96, 7),
  n(282, 140, 6.8),
  n(260, 184, 6.6),
  n(206, 210, 7),
  n(140, 216, 7.2),
  n(74, 208, 7),
  n(16, 186, 6.8),
  n(-26, 152, 6.6),
  n(-44, 108, 6.8),
  n(-40, 62, 7),
  n(-58, 26, 6.8),
  n(-52, -18, 7.2),
  n(-18, -28, 7.6),
];

/* ------------------------------------------------------------------ */
/* 06 - Forest Run                                                     */
/* ------------------------------------------------------------------ */

const FOREST_NODES: TrackNode[] = [
  n(0, 0, 8),
  n(76, -2, 8),
  n(150, 6, 7.6),
  n(198, 38, 7.2),
  n(210, 88, 7.4),
  n(188, 132, 7),
  n(146, 148, 7.2), // woodland esses
  n(112, 128, 6.8),
  n(78, 140, 7),
  n(52, 172, 7.2),
  n(8, 190, 7.6),
  n(-46, 194, 7.8),
  n(-102, 180, 7.4),
  n(-144, 148, 7),
  n(-158, 104, 6.8), // tightening hairpin
  n(-140, 66, 7),
  n(-104, 52, 7.4),
  n(-80, 74, 7.2),
  n(-56, 52, 7.4),
  n(-62, 14, 7.6),
  n(-88, -14, 7.4),
  n(-70, -46, 7.6),
  n(-24, -40, 8),
];

/* ------------------------------------------------------------------ */
/* 07 - Neon District (night city)                                     */
/* ------------------------------------------------------------------ */

const NIGHT_CITY_NODES: TrackNode[] = [
  n(0, 0, 7.6),
  n(84, 0, 7.6),
  n(166, 2, 7.2),
  n(206, 26, 6.8),
  n(214, 72, 6.6),
  n(196, 112, 6.4), // downtown right-angles
  n(154, 124, 6.6),
  n(146, 160, 6.4),
  n(112, 182, 6.6),
  n(62, 184, 7),
  n(20, 166, 6.8),
  n(-8, 132, 6.6), // underpass chicane
  n(-44, 128, 6.4),
  n(-72, 158, 6.6),
  n(-118, 172, 7),
  n(-166, 158, 6.8),
  n(-192, 118, 6.6),
  n(-188, 72, 6.8), // riverside hairpin
  n(-156, 44, 7),
  n(-120, 40, 7.2),
  n(-104, 8, 7.2),
  n(-118, -28, 6.8),
  n(-82, -50, 7),
  n(-32, -34, 7.6),
];

/* ------------------------------------------------------------------ */
/* 08 - Foundry Works (industrial)                                     */
/* ------------------------------------------------------------------ */

const INDUSTRIAL_NODES: TrackNode[] = [
  n(0, 0, 8.2),
  n(92, 0, 8.2),
  n(176, -4, 7.8),
  n(236, 14, 7.2),
  n(258, 60, 7),
  n(244, 104, 7.2),
  n(200, 118, 7),
  n(178, 150, 6.8), // loading-bay chicane
  n(210, 178, 6.6),
  n(196, 214, 6.8),
  n(148, 226, 7.2),
  n(90, 222, 7.4),
  n(36, 206, 7.2),
  n(-16, 200, 7.6),
  n(-76, 196, 7.8),
  n(-128, 176, 7.4),
  n(-158, 138, 7),
  n(-156, 92, 7.2), // long constant-radius left
  n(-134, 52, 7.4),
  n(-98, 32, 7.8),
  n(-92, -4, 7.8),
  n(-116, -36, 7.2),
  n(-76, -56, 7.6),
  n(-28, -34, 8.2),
];

/* ------------------------------------------------------------------ */
/* 09 - Grand Circuit (the flagship)                                   */
/* ------------------------------------------------------------------ */

const GRAND_NODES: TrackNode[] = [
  n(0, 0, 10),
  n(120, 0, 10),
  n(250, 0, 9.4), // pit straight
  n(340, 16, 8.6),
  n(392, 62, 8.2),
  n(400, 124, 8.4),
  n(370, 176, 8),
  n(312, 200, 8.2), // fast complex
  n(250, 198, 8),
  n(200, 172, 7.6),
  n(168, 136, 7.4), // hairpin
  n(126, 130, 7.2),
  n(92, 156, 7.4),
  n(84, 198, 7.8),
  n(40, 224, 8.2),
  n(-30, 232, 8.6),
  n(-104, 226, 8.4),
  n(-172, 206, 8),
  n(-226, 170, 7.6),
  n(-256, 118, 7.4), // long left sweeper
  n(-260, 62, 7.6),
  n(-238, 18, 8),
  n(-196, -8, 8.4),
  n(-140, -20, 8.8),
  n(-70, -16, 9.4),
  n(-24, -6, 10),
];

/* ------------------------------------------------------------------ */
/* 10 - Frostline (winter)                                             */
/* ------------------------------------------------------------------ */

const WINTER_NODES: TrackNode[] = [
  n(0, 0, 9),
  n(82, -4, 9),
  n(162, 0, 8.6),
  n(214, 28, 8),
  n(228, 80, 8.2),
  n(204, 128, 7.8),
  n(156, 148, 8),
  n(104, 140, 7.6), // long icy sweeper
  n(58, 156, 7.8),
  n(20, 190, 8.2),
  n(-38, 204, 8.6),
  n(-100, 198, 8.2),
  n(-150, 172, 7.8),
  n(-176, 128, 7.4),
  n(-172, 80, 7.6),
  n(-142, 48, 8),
  n(-104, 44, 8.2),
  n(-92, 8, 8.4),
  n(-112, -28, 8),
  n(-74, -50, 8.2),
  n(-26, -34, 8.8),
];

/* ------------------------------------------------------------------ */
/* 11 - Caldera (volcanic)                                             */
/* ------------------------------------------------------------------ */

const VOLCANIC_NODES: TrackNode[] = [
  n(0, 0, 8.2),
  n(88, -6, 8.2),
  n(174, 2, 7.8),
  n(232, 36, 7.2),
  n(250, 92, 7.4),
  n(232, 148, 7),
  n(186, 180, 7.2),
  n(132, 186, 7),
  n(96, 158, 6.6), // crater hairpin
  n(64, 172, 6.8),
  n(48, 208, 7.2),
  n(0, 228, 7.6),
  n(-62, 228, 7.8),
  n(-124, 208, 7.4),
  n(-166, 170, 7),
  n(-180, 122, 7.2),
  n(-166, 76, 7),
  n(-134, 50, 7.4),
  n(-98, 52, 7.2),
  n(-84, 18, 7.6),
  n(-104, -22, 7.2),
  n(-64, -48, 7.6),
  n(-22, -32, 8.2),
];

export const TRACKS: TrackDefinition[] = [
  {
    id: 'sunset-circuit',
    name: 'Sunset Circuit',
    country: 'Verano Coast',
    theme: 'coast',
    difficulty: 2,
    laps: 3,
    timeOfDay: 'sunset',
    weather: 'clear',
    curbStyle: 'red',
    runoff: 'gravel',
    halfWidth: 8,
    nodes: SUNSET_CIRCUIT_NODES,
    unlockLevel: 0,
    unlockCost: 0,
    paceFactor: 1,
    palette: SUNSET,
    tagline: 'Golden hour, one perfect line.',
    seed: 101,
  },
  {
    id: 'city-rush',
    name: 'City Rush',
    country: 'Arden Bay',
    theme: 'city',
    difficulty: 3,
    laps: 3,
    timeOfDay: 'day',
    weather: 'clear',
    curbStyle: 'red',
    runoff: 'concrete',
    halfWidth: 6.8,
    nodes: CITY_RUSH_NODES,
    unlockLevel: 0,
    unlockCost: 0,
    paceFactor: 0.94,
    palette: tint(DAY, { fogDensity: 0.0035, groundColor: '#3c3f45' }),
    tagline: 'Concrete walls. Zero margin.',
    seed: 202,
  },
  {
    id: 'coastline-gp',
    name: 'Coastline GP',
    country: 'Mira Peninsula',
    theme: 'coast',
    difficulty: 2,
    laps: 3,
    timeOfDay: 'day',
    weather: 'clear',
    curbStyle: 'blue',
    runoff: 'sand',
    halfWidth: 8,
    nodes: COASTLINE_NODES,
    unlockLevel: 2,
    unlockCost: 0,
    paceFactor: 1.04,
    palette: tint(DAY, { sky: '#7fb8e0', fog: '#a8cbe4', groundColor: '#57544a' }),
    tagline: 'Sea breeze and fifth-gear sweepers.',
    seed: 303,
  },
  {
    id: 'dune-prospect',
    name: 'Dune Prospect',
    country: 'Kharan Flats',
    theme: 'desert',
    difficulty: 3,
    laps: 3,
    timeOfDay: 'day',
    weather: 'clear',
    curbStyle: 'yellow',
    runoff: 'sand',
    halfWidth: 8.6,
    nodes: DESERT_NODES,
    unlockLevel: 4,
    unlockCost: 2500,
    paceFactor: 1.08,
    palette: tint(DAY, {
      sky: '#d9b481',
      fog: '#d8bc94',
      fogDensity: 0.0038,
      sunIntensity: 3.1,
      groundColor: '#8a7250',
      terrainTint: '#ffe6c2',
    }),
    tagline: 'Heat haze on the longest straight in the series.',
    seed: 404,
  },
  {
    id: 'alpine-pass',
    name: 'Alpine Pass',
    country: 'Val Terrano',
    theme: 'alpine',
    difficulty: 4,
    laps: 3,
    timeOfDay: 'day',
    weather: 'clear',
    curbStyle: 'red',
    runoff: 'grass',
    halfWidth: 7,
    nodes: ALPINE_NODES,
    unlockLevel: 6,
    unlockCost: 4200,
    paceFactor: 0.9,
    palette: tint(DAY, {
      sky: '#9dc4e6',
      fog: '#b9cfe0',
      sunDirection: [0.28, 0.72, -0.62],
      groundColor: '#4c5443',
    }),
    tagline: 'Switchbacks carved into the mountainside.',
    seed: 505,
  },
  {
    id: 'forest-run',
    name: 'Forest Run',
    country: 'Elden Vale',
    theme: 'forest',
    difficulty: 3,
    laps: 3,
    timeOfDay: 'day',
    weather: 'clear',
    curbStyle: 'red',
    runoff: 'grass',
    halfWidth: 7.4,
    nodes: FOREST_NODES,
    unlockLevel: 3,
    unlockCost: 1800,
    paceFactor: 0.97,
    palette: tint(DAY, {
      sky: '#8fb0c8',
      fog: '#7e9b84',
      fogDensity: 0.0042,
      ambientColor: '#86a884',
      groundColor: '#38452f',
    }),
    tagline: 'Dappled light, blind apexes.',
    seed: 606,
  },
  {
    id: 'neon-district',
    name: 'Neon District',
    country: 'Arden Bay',
    theme: 'nightCity',
    difficulty: 4,
    laps: 3,
    timeOfDay: 'night',
    weather: 'clear',
    curbStyle: 'blue',
    runoff: 'concrete',
    halfWidth: 7,
    nodes: NIGHT_CITY_NODES,
    unlockLevel: 8,
    unlockCost: 6500,
    paceFactor: 0.92,
    palette: NIGHT,
    tagline: 'Wet asphalt under a thousand signs.',
    seed: 707,
  },
  {
    id: 'foundry-works',
    name: 'Foundry Works',
    country: 'Port Halden',
    theme: 'industrial',
    difficulty: 3,
    laps: 3,
    timeOfDay: 'sunset',
    weather: 'clear',
    curbStyle: 'yellow',
    runoff: 'concrete',
    halfWidth: 7.6,
    nodes: INDUSTRIAL_NODES,
    unlockLevel: 5,
    unlockCost: 3400,
    paceFactor: 1,
    palette: tint(SUNSET, { fog: '#8a7060', ambientColor: '#7a6a80' }),
    tagline: 'Steel, steam and a nasty chicane.',
    seed: 808,
  },
  {
    id: 'grand-circuit',
    name: 'Grand Circuit',
    country: 'Verano Coast',
    theme: 'grand',
    difficulty: 5,
    laps: 4,
    timeOfDay: 'day',
    weather: 'clear',
    curbStyle: 'red',
    runoff: 'gravel',
    halfWidth: 9.2,
    nodes: GRAND_NODES,
    unlockLevel: 10,
    unlockCost: 9000,
    paceFactor: 1.12,
    palette: tint(DAY, { sunIntensity: 2.8 }),
    tagline: 'The championship decider. Full commitment.',
    seed: 909,
  },
  {
    id: 'frostline',
    name: 'Frostline',
    country: 'Norhavn',
    theme: 'winter',
    difficulty: 4,
    laps: 3,
    timeOfDay: 'day',
    weather: 'snow',
    curbStyle: 'blue',
    runoff: 'snow',
    halfWidth: 8.4,
    nodes: WINTER_NODES,
    unlockLevel: 12,
    unlockCost: 11000,
    paceFactor: 0.88,
    palette: tint(DAY, {
      sky: '#cddfec',
      fog: '#d5e2ec',
      fogDensity: 0.0052,
      sunIntensity: 2.1,
      ambientColor: '#c8d8e8',
      ambientIntensity: 1.1,
      groundColor: '#b9c6d0',
    }),
    tagline: 'Grip is a suggestion, not a promise.',
    seed: 1010,
  },
  {
    id: 'caldera',
    name: 'Caldera',
    country: 'Isla Fuego',
    theme: 'volcanic',
    difficulty: 5,
    laps: 3,
    timeOfDay: 'sunset',
    weather: 'clear',
    curbStyle: 'yellow',
    runoff: 'basalt',
    halfWidth: 7.8,
    nodes: VOLCANIC_NODES,
    unlockLevel: 15,
    unlockCost: 15000,
    paceFactor: 1.02,
    palette: tint(SUNSET, {
      sky: '#3a1f28',
      fog: '#5a2a24',
      fogDensity: 0.0048,
      sunColor: '#ff8f5a',
      ambientColor: '#8a3a30',
      groundColor: '#2a1c18',
      terrainTint: '#ffb896',
    }),
    tagline: 'Black rock, orange sky, no run-off.',
    seed: 1111,
  },
];

export const getTrack = (id: string): TrackDefinition =>
  TRACKS.find((t) => t.id === id) ?? TRACKS[0];

export const DEFAULT_TRACK_ID = TRACKS[0].id;

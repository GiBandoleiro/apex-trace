# Apex Trace

**Draw the line. Manage the speed. Win the race.**

A complete, original draw-to-race game for the browser. You do not steer the car
— before the lights go out you draw the trajectory you want it to take, and how
fast you draw becomes how fast it tries to go. The car then has to *physically*
achieve that line: ask for more grip than the tyres have and it will run wide,
scrub speed and cost you the corner.

Plays on phone, tablet and desktop. No install, no downloads, no plugins.

---

## The core mechanic

```
you draw  →  waypoints + a speed profile  →  the car attempts it  →  physics decides
```

Every drawn stroke becomes a lateral-offset and pace profile over the circuit
centreline. From that the engine solves a speed target in three passes:

1. **Desired** — from your drawing pace, normalised against your own median so
   the mapping works identically on a 6" phone and a 34" monitor.
2. **Forward** — capped by what the engine can actually accelerate to.
3. **Backward** — capped by what the brakes can actually shed in time.

At runtime the car runs a pure-pursuit controller toward that line, constrained
by a friction budget:

```
required lateral acceleration = v² · κ
available                     = grip + downforce·v² , scaled by surface,
                                minus whatever braking/traction is already using
```

When the requirement exceeds what is available, the controller simply *cannot*
turn hard enough — so the car runs wide on its own. Understeer, missed apexes
and trips through the gravel are emergent, not scripted.

## What is in it

| | |
|---|---|
| **Circuits** | 11 hand-authored layouts — hairpins, esses, long straights, fast sweepers — across day, sunset and night |
| **Cars** | 10 original vehicles across 9 classes (City → Prototype), each with its own lofted bodywork |
| **Tuning** | 7 upgrade lines × 5 levels, with live stat preview |
| **Paint** | Body / accent / wheel colours, 4 finishes, 5 wheel styles, 7 decals, race number, wing, tint |
| **Modes** | Quick race, 4 championships with points tables, 5 special events |
| **Progression** | Coins, XP, driver level, unlockable cars and circuits, per-track lap records |
| **AI** | 4 difficulty bands. Opponents run the *same* physics and the *same* path structure as you — they never cheat, they just drive closer to the limit |

## Everything is generated at runtime

There is not a single texture, model or audio file in this repository.

- **Surfaces** — asphalt, grass, gravel, concrete, curbs, sand, snow, basalt and
  metal are authored as noise fields and baked into seamless PBR sets (albedo,
  height-derived normal, roughness, AO) sized to the device class.
- **Cars** — bodies are lofted through cross-sections driven by each car's
  design descriptor, then UV-mapped with a planar projection from directly
  above, which is exactly where the camera is. The livery (stripes, decals,
  race number, panel gaps) is painted onto that top view.
- **Circuits** — asphalt ribbon, painted edges, curbs at corners, grass verge,
  corner-only gravel traps, embankments, guard rails, tyre walls, advertising
  boards, grandstands, pit lane and control tower, all instanced.
- **Audio** — the engine note is three detuned oscillators plus filtered noise
  with a simulated gearbox; tyre scrub, wind, impacts, ambience and every UI
  sound are synthesised by the Web Audio API.

## Controls

| Action | Touch | Desktop |
|---|---|---|
| Draw the line | One finger drag | Left-click drag |
| Pan | Two fingers | Right-drag, middle-drag or space+drag |
| Zoom | Pinch | Scroll wheel |
| Clear / Undo | On-screen buttons | `R` / `Z` |
| Start the race | Confirm button | `Enter` or `Space` |
| Back | On-screen | `Esc` |

## Performance

Device class and GPU are detected on boot and mapped to one of four quality
tiers, which govern texture resolution, shadows, pixel ratio, particle budget,
environment density and track tessellation. A frame-rate watchdog drops a tier
if the device sustains a low frame rate, and the player can override the tier
from Settings. Trackside props are instanced, particles and skid marks are
pooled with zero per-frame allocation, and physics runs on a fixed 90 Hz
substep so behaviour is identical at any frame rate.

## Running it

```bash
npm install
npm run dev        # development server
npm run build      # type-check + production build into dist/
npm run preview    # serve the production build
```

Requires Node 18+.

## Architecture

Game logic never touches React, and React never touches Three.js.

```
src/
  assets/      procedural PBR texture authoring + the material registry
  audio/       Web Audio synthesis (engine, tyres, ambience, UI)
  cars/        catalogue, upgrade tables, 3D body builder, livery painting
  game/        renderer, camera rig, input, VFX, trajectory rendering
  physics/     racing path solver, speed profile, vehicle simulation
  save/        versioned local persistence behind a repository interface
  systems/     race orchestration, AI, progression, championships, quality
  tracks/      circuit catalogue, geometry solver, 3D track builder
  ui/          React screens, design system, state stores
  utils/       math and noise
```

The save layer sits behind a `ProfileRepository` interface, so an online
account backend can replace `LocalProfileRepository` without touching a single
caller.

## Originality

Every circuit layout, car design, marque, driver name, trackside brand, texture
and sound in this project is original to it. The inspiration is conceptual only
— top-down racing with a drawn trajectory and speed management. No assets,
names, logos or artwork are taken from any existing game.

## Licence

All rights reserved. © 2026

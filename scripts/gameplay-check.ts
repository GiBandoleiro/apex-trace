import { TRACKS } from '../src/tracks/catalog';
import { TrackGeometry } from '../src/tracks/TrackGeometry';
import { RaceSimulation } from '../src/systems/RaceSimulation';
import { RacingPath } from '../src/physics/RacingPath';
import { resolveCarCollision, type Vehicle } from '../src/physics/VehiclePhysics';
import { EMPTY_UPGRADES, getCar } from '../src/cars/catalog';

const car = getCar('kestrel-rs');
const check = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message);
};

const makeRace = (id: string, collisionMode: 'solid' | 'ghost') => {
  const track = TRACKS.find((item) => item.id === id)!;
  const geometry = new TrackGeometry(track);
  const sim = new RaceSimulation({
    track, geometry, playerCarId: car.id, playerUpgrades: { ...EMPTY_UPGRADES },
    playerCustomization: car.defaults, playerName: 'Test Driver', difficulty: 'normal',
    opponentCount: 3, laps: 1, seed: 12345, previousBest: Infinity, collisionMode,
  });
  return { geometry, sim };
};

const overlapping = (a: Vehicle, b: Vehicle) => {
  const af = [Math.cos(a.heading), Math.sin(a.heading)];
  const ar = [-af[1], af[0]];
  const bf = [Math.cos(b.heading), Math.sin(b.heading)];
  const br = [-bf[1], bf[0]];
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  return [af, ar, bf, br].every((axis) => {
    const dot = (v: number[]) => axis[0] * v[0] + axis[1] * v[1];
    const radiusA = a.collisionHalfLength * Math.abs(dot(af)) + a.collisionHalfWidth * Math.abs(dot(ar));
    const radiusB = b.collisionHalfLength * Math.abs(dot(bf)) + b.collisionHalfWidth * Math.abs(dot(br));
    return Math.abs(dx * axis[0] + dz * axis[1]) < radiusA + radiusB - 0.005;
  });
};

for (const { id } of TRACKS) {
  const { geometry, sim } = makeRace(id, 'solid');
  check(geometry.totalLength > 1200, `${id}: circuit too short`);
  const n = geometry.sampleCount;
  const offsets = new Float32Array(n).fill(5);
  const pace = new Float32Array(n).fill(0.78);
  const drawn = new RacingPath(geometry, {
    offsets, pace, limits: sim.player.vehicle.limits, respectLimits: 0.98,
  });
  const launch = sim.commitPlayerPath(drawn);
  const player = sim.player.vehicle;
  const lane = geometry.project(player.x, player.z).lateral;
  check(Math.abs(launch.point(player.trackIndex).offset - lane) < 0.5,
    `${id}: player must begin aligned with the start lane`);
  check(Math.abs(launch.point(Math.round(120 / geometry.step)).offset - 5) < 0.1,
    `${id}: authored line must be preserved beyond the start`);
  sim.update(3.7);
  player.nitroRequested = true;
  sim.update(1 / 60);
  check(player.nitroActive && player.nitroCharge < 1, `${id}: nitro control did not engage`);
  player.nitroRequested = false;
  sim.update(1 / 60);
  check(!player.nitroActive, `${id}: nitro did not release`);
  for (let i = 0; i < 180; i++) sim.update(1 / 60);
  check(Number.isFinite(player.x) && Number.isFinite(player.z), `${id}: invalid vehicle position`);
  check(player.progress > 10, `${id}: vehicle failed to launch`);
  if (id === 'sunset-circuit') {
    for (let tick = 0; tick < 10_800 && !player.finished; tick++) sim.update(1 / 60);
    check(player.finished, `${id}: player failed to finish a complete lap`);
    check(player.lapTimes.length === 1, `${id}: lap was not recorded`);
  }
  console.log(`${id}: launch, trajectory, nitro and race integration OK`);
}

{
  const { sim } = makeRace('sunset-circuit', 'solid');
  const a = sim.player.vehicle;
  const b = sim.entrants[0].vehicle;
  a.x = b.x; a.z = b.z; a.heading = b.heading = 0;
  check(overlapping(a, b), 'collision test must start with overlapping cars');
  resolveCarCollision(a, b, []);
  check(!overlapping(a, b), 'solid car bodies still overlap');
  console.log('oriented body collision OK');
}

{
  const { geometry, sim } = makeRace('sunset-circuit', 'ghost');
  const a = sim.player.vehicle;
  const b = sim.entrants[0].vehicle;
  a.x = b.x; a.z = b.z; a.heading = b.heading = 0;
  const pace = new Float32Array(geometry.sampleCount).fill(0.75);
  sim.commitPlayerPath(new RacingPath(geometry, {
    offsets: new Float32Array(geometry.sampleCount), pace, limits: a.limits,
  }));
  sim.update(3.7);
  sim.update(1 / 90);
  check(overlapping(a, b), 'ghost mode unexpectedly separated the cars');
  console.log('ghost mode OK');
}

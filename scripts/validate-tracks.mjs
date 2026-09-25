import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../src/tracks/layouts.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { TRACK_LAYOUTS } = await import(`data:text/javascript,${encodeURIComponent(compiled)}`);

const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const intersects = (a, b, c, d) =>
  cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0;
const catmull = (p0, p1, p2, p3, t) => {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t +
    (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
    (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
};
const curved = (points) => {
  const result = [];
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const [p0, p1, p2, p3] = [-1, 0, 1, 2].map((offset) => points[(i + offset + n) % n]);
    for (let j = 0; j < 12; j++) {
      const t = j / 12;
      result.push([catmull(p0[0], p1[0], p2[0], p3[0], t),
        catmull(p0[1], p1[1], p2[1], p3[1], t)]);
    }
  }
  return result;
};

let failures = 0;
for (const [id, points] of Object.entries(TRACK_LAYOUTS)) {
  const n = points.length;
  let length = 0;
  let crossings = 0;
  for (let i = 0; i < n; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    length += Math.hypot(a[0] - b[0], a[1] - b[1]);
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (intersects(a, b, points[j], points[(j + 1) % n])) crossings++;
    }
  }
  const startStraight = points[0][1] === 0 && points[1][1] === 0 && points[2][1] === 0;
  const rendered = curved(points);
  let curvedCrossings = 0;
  for (let i = 0; i < rendered.length; i++) {
    for (let j = i + 2; j < rendered.length; j++) {
      if (i === 0 && j === rendered.length - 1) continue;
      if (intersects(rendered[i], rendered[(i + 1) % rendered.length],
        rendered[j], rendered[(j + 1) % rendered.length])) curvedCrossings++;
    }
  }
  const ok = length >= 1000 && crossings === 0 && curvedCrossings === 0 && startStraight;
  if (!ok) failures++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${id.padEnd(20)} ${(length / 1000).toFixed(2)} km  ${crossings + curvedCrossings} crossings`);
}
if (Object.keys(TRACK_LAYOUTS).length !== 20) {
  console.error(`Expected 20 layouts; found ${Object.keys(TRACK_LAYOUTS).length}`);
  failures++;
}
if (failures) process.exitCode = 1;

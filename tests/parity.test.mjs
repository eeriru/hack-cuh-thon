// Checks that the browser reproduces the Python model exactly.
// 1) python3 training/train_solar_haze_model.py --synthetic --out <dir>/model.json --parity <dir>/parity.json
// 2) node tests/parity.test.mjs <dir>/model.json <dir>/parity.json
import { readFileSync } from 'node:fs';
import { evalTrees, makeTreeEngine } from '../src/lib/model.js';
import { solarPosition, hourGeometry } from '../src/lib/solar.js';

const [modelPath, casesPath] = process.argv.slice(2);
const model = JSON.parse(readFileSync(modelPath, 'utf8'));
const cases = JSON.parse(readFileSync(casesPath, 'utf8'));
makeTreeEngine(model); // validates format

let worstTree = 0;
cases.rows.forEach((row, i) => {
  const r = row.map((v) => (v === null ? NaN : v));
  worstTree = Math.max(worstTree, Math.abs(evalTrees(model, r) - cases.expected[i]));
});
let worstSun = 0;
for (const c of cases.sun) {
  worstSun = Math.max(worstSun, Math.abs(solarPosition(c.t, c.lat, c.lon).cosZenith - c.cos_zenith));
  const g = hourGeometry(c.t, c.lat, c.lon);
  worstSun = Math.max(worstSun, Math.abs(g.cosZenith - c.hour_cos), Math.abs(g.clearGhi - c.hour_clear) / 1000);
}
console.log(`trees: ${cases.rows.length} rows, max |JS - Python| = ${worstTree.toExponential(2)}`);
console.log(`sun:   ${cases.sun.length} cases, max difference = ${worstSun.toExponential(2)}`);
if (worstTree > 1e-9 || worstSun > 1e-9) {
  console.error('PARITY FAILED');
  process.exit(1);
}
console.log('Parity OK');

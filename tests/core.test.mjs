// Run with: node tests/core.test.mjs
import assert from 'node:assert/strict';
import { solarPosition, hourGeometry, pvEnergyKwh } from '../src/lib/solar.js';
import { computeHazeLoss, physicsKc, PHYSICS_ENGINE, evalTrees } from '../src/lib/model.js';
import { planDay, hourRanges } from '../src/lib/battery.js';
import { aqiFromPm25 } from '../src/lib/aqi.js';
import { makeDemoData } from '../src/lib/demo.js';
import { dayModelHours, addDays, todayMY } from '../src/lib/api.js';

let passed = 0;
const test = (name, fn) => {
  fn();
  passed++;
  console.log('✓', name);
};

test('sun is nearly overhead at KL solar noon on the March equinox', () => {
  // 2026-03-20, KL (101.69E). Solar noon ≈ 12:00 - 101.69*4min + ~7min (eq. of time) local mean → ~05:20 UTC
  let best = { cos: -1, t: 0 };
  const base = Date.UTC(2026, 2, 20, 3, 0) / 1000;
  for (let m = 0; m < 240; m++) {
    const t = base + m * 60;
    const { cosZenith } = solarPosition(t, 3.139, 101.687);
    if (cosZenith > best.cos) best = { cos: cosZenith, t };
  }
  assert.ok(best.cos > 0.995, `cosZ ${best.cos}`);
  const utcH = new Date(best.t * 1000).getUTCHours() + new Date(best.t * 1000).getUTCMinutes() / 60;
  assert.ok(utcH > 5.0 && utcH < 5.5, `noon at ${utcH} UTC`);
});

test('night hours have no clear-sky sunlight', () => {
  const t = Date.UTC(2026, 9, 15, 15, 0) / 1000; // 11pm in Malaysia
  assert.equal(hourGeometry(t, 3.1, 101.5).clearGhi, 0);
});

test('panel output rises with sunlight and falls with heat', () => {
  assert.ok(pvEnergyKwh(800, 30) > pvEnergyKwh(400, 30));
  assert.ok(pvEnergyKwh(800, 25) > pvEnergyKwh(800, 35));
  assert.ok(pvEnergyKwh(1000, 25) < 4.5 && pvEnergyKwh(1000, 25) > 3.5);
});

test('thicker haze lowers predicted sunlight; clouds lower it too', () => {
  const x = { cos_zenith: 0.9, cloud_low: 10, cloud_mid: 0, cloud_high: 10, rh: 70, temp: 31 };
  const clean = physicsKc({ ...x, aod: 0.3 });
  const hazy = physicsKc({ ...x, aod: 1.5 });
  const cloudy = physicsKc({ ...x, aod: 0.3, cloud_low: 90 });
  assert.ok(hazy < clean && cloudy < clean);
  const lossPct = (1 - hazy / clean) * 100;
  assert.ok(lossPct > 10 && lossPct < 35, `noon haze loss ${lossPct}`);
});

test('haze matters less under thick cloud (little direct beam left)', () => {
  const x = { cos_zenith: 0.9, cloud_mid: 0, cloud_high: 0, rh: 70, temp: 31 };
  const lossClear = 1 - physicsKc({ ...x, cloud_low: 0, aod: 1.5 }) / physicsKc({ ...x, cloud_low: 0, aod: 0.3 });
  const lossCloud = 1 - physicsKc({ ...x, cloud_low: 95, aod: 1.5 }) / physicsKc({ ...x, cloud_low: 95, aod: 0.3 });
  assert.ok(lossCloud < lossClear);
});

test('demo haze day loses more solar than a clean day; loss is never negative', () => {
  const place = { lat: 3.17, lon: 101.47 };
  const today = todayMY();
  const data = makeDemoData(place, addDays(today, -4), addDays(today, 3));
  const peak = computeHazeLoss(dayModelHours(data, addDays(today, -1)), { ...place, engine: PHYSICS_ENGINE });
  const clean = computeHazeLoss(dayModelHours(data, addDays(today, 3)), { ...place, engine: PHYSICS_ENGINE });
  assert.equal(dayModelHours(data, today).length, 24);
  assert.ok(peak.lossPct > clean.lossPct, `${peak.lossPct} vs ${clean.lossPct}`);
  assert.ok(peak.lossPct > 7, `peak loss ${peak.lossPct}`);
  assert.ok(peak.kwhClean > 8 && peak.kwhClean < 30, `clean-sky kWh ${peak.kwhClean}`);
  assert.ok(peak.rows.every((r) => r.lossKwh >= 0));
});

test('haze-aware plan costs no more than the standard plan', () => {
  const place = { lat: 3.17, lon: 101.47 };
  const today = todayMY();
  const data = makeDemoData(place, addDays(today, -2), today);
  for (const d of [addDays(today, -1), today]) {
    const loss = computeHazeLoss(dayModelHours(data, d), { ...place, engine: PHYSICS_ENGINE });
    const pv = new Array(24).fill(0);
    const pm = new Array(24).fill(0);
    loss.rows.forEach((r) => {
      pv[r.localHour] = r.kwhHaze;
      pm[r.localHour] = r.pm2_5;
    });
    const plan = planDay(pv, pm);
    assert.ok(plan.hazeAware.costRm <= plan.standard.costRm + 1e-9, `${plan.hazeAware.costRm} > ${plan.standard.costRm}`);
    assert.equal(plan.flexHours.length, 2);
    assert.ok(plan.hazeAware.soc.every((s) => s >= -1e-9 && s <= 100 + 1e-9));
  }
});

test('hour ranges read naturally', () => {
  assert.equal(hourRanges([11, 12]), '11am–1pm');
  assert.equal(hourRanges([9, 13]), '9am–10am, 1pm–2pm');
});

test('US AQI from PM2.5 matches EPA breakpoints', () => {
  assert.equal(aqiFromPm25(9.0), 50);
  assert.equal(aqiFromPm25(35.4), 100);
  assert.equal(aqiFromPm25(55.5), 151);
});

test('tree evaluator walks left/right/missing correctly', () => {
  const model = {
    baseline: 0.5,
    trees: [
      { f: [0, 0, 0], t: [1, 0, 0], l: [1, 0, 0], r: [2, 0, 0], m: [1, 0, 0], leaf: [0, 1, 1], v: [0, -0.1, 0.2] },
    ],
  };
  assert.equal(evalTrees(model, [0.5]), 0.4);
  assert.equal(evalTrees(model, [2]), 0.7);
  assert.equal(evalTrees(model, [NaN]), 0.4);
});

console.log(`\n${passed} tests passed`);

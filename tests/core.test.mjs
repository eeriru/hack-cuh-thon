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


// ---------- DOE official readings ----------
import { readFileSync } from 'node:fs';
import { parseDoe, parseDoeApi, parseDoeTime, nearestStation, doeLevel } from '../src/lib/doe.js';
import handler from '../api/doe.js';

const sample = JSON.parse(readFileSync(new URL('./fixtures/doe_sample.json', import.meta.url)));
const sampleNow = Date.parse('2026-10-20T10:20:00+08:00') / 1000;

test('DOE times are Malaysia local time', () => {
  assert.equal(parseDoeTime('2026-10-20T10:00:00'), Date.parse('2026-10-20T02:00:00Z') / 1000);
});

test('DOE API values: numbers kept, flags and blanks dropped', () => {
  assert.equal(parseDoeApi('55'), 55);
  assert.equal(parseDoeApi(148), 148);
  assert.equal(parseDoeApi('&'), null);
  assert.equal(parseDoeApi(''), null);
  assert.equal(parseDoeApi('-'), null);
});

test('DOE payload parses into stations with 24 ordered readings', () => {
  const st = parseDoe(sample);
  assert.equal(st.length, 8);
  const shah = st.find((s) => s.id === 'CA22B');
  assert.equal(shah.name, 'Shah Alam');
  assert.equal(shah.state, 'Selangor');
  assert.equal(shah.readings.length, 24);
  assert.ok(shah.readings.every((r, i, a) => i === 0 || r.t > a[i - 1].t));
  const newest = sample.api_table_hourly.find((r) => r.STATION_ID === 'CA22B' && r.DATETIME === '2026-10-20T10:00:00');
  assert.equal(shah.latest.api, Number(newest.API));
  assert.equal(shah.readings.filter((r) => r.api === null).length, 1);
  assert.equal(shah.latest.symbol, '**');
  assert.throws(() => parseDoe({ nope: 1 }));
});

test('nearest station skips stale stations and picks the closest', () => {
  const st = parseDoe(sample);
  const elmina = { lat: 3.17, lon: 101.47 };
  const near = nearestStation(st, elmina, { now: sampleNow });
  assert.equal(near.station.id, 'CA22B');
  assert.ok(near.distanceKm > 5 && near.distanceKm < 15, `${near.distanceKm}`);
  const kuantan = { lat: 3.81, lon: 103.33 };
  assert.equal(nearestStation(st, kuantan, { now: sampleNow }), null); // only a stale station within 60 km
});

test('DOE status bands', () => {
  assert.equal(doeLevel(50).label, 'Good');
  assert.equal(doeLevel(51).label, 'Moderate');
  assert.equal(doeLevel(150).label, 'Unhealthy');
  assert.equal(doeLevel(250).label, 'Very unhealthy');
  assert.equal(doeLevel(301).label, 'Hazardous');
});

const fakeRes = () => {
  const r = { headers: {}, code: 0, body: null };
  r.setHeader = (k, v) => (r.headers[k.toLowerCase()] = v);
  r.status = (c) => ((r.code = c), r);
  r.send = (b) => ((r.body = b), r);
  r.json = (b) => ((r.body = JSON.stringify(b)), r);
  return r;
};

await (async () => {
  // async test
  const name = 'server function passes DOE data through with caching';
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify(sample), { status: 200 });
  const res = fakeRes();
  await handler({ method: 'GET' }, res);
  assert.equal(res.code, 200);
  assert.match(res.headers['cache-control'], /s-maxage=600/);
  assert.equal(JSON.parse(res.body).api_table_hourly.length, 192);
  globalThis.fetch = async () => new Response('down', { status: 503 });
  const res2 = fakeRes();
  await handler({ method: 'GET' }, res2);
  assert.equal(res2.code, 502);
  globalThis.fetch = realFetch;
  passed++;
  console.log('✓', name);
})();


// ---------- IQAir server function ----------
import iqHandler from '../api/iqair.js';
await (async () => {
  const name = 'IQAir function: hides key, reshapes data, explains errors';
  const realFetch = globalThis.fetch;
  let calledUrl = '';
  delete process.env.IQAIR_API_KEY;
  let res = fakeRes();
  await iqHandler({ method: 'GET', query: { lat: '3.17', lon: '101.47' } }, res);
  assert.equal(res.code, 501);

  process.env.IQAIR_API_KEY = 'secret-key';
  globalThis.fetch = async (url) => {
    calledUrl = url;
    return new Response(JSON.stringify({ status: 'success', data: { city: 'Shah Alam', state: 'Selangor', country: 'Malaysia',
      location: { type: 'Point', coordinates: [101.53, 3.07] },
      current: { pollution: { ts: '2026-10-20T06:00:00.000Z', aqius: 161, mainus: 'p2', aqicn: 95, maincn: 'p2' },
        weather: { ts: '2026-10-20T06:00:00.000Z', tp: 32, pr: 1008, hu: 62, ws: 2.1, wd: 220, ic: '50d' } } } }), { status: 200 });
  };
  res = fakeRes();
  await iqHandler({ method: 'GET', query: { lat: '3.1712345', lon: '101.4698765' } }, res);
  assert.equal(res.code, 200);
  assert.match(calledUrl, /lat=3\.17&lon=101\.47&key=secret-key/);
  const body = JSON.parse(res.body);
  assert.equal(body.aqius, 161);
  assert.equal(body.city, 'Shah Alam');
  assert.equal(body.weather.tempC, 32);
  assert.ok(!res.body.includes('secret-key'));
  assert.match(res.headers['cache-control'], /s-maxage=900/);

  globalThis.fetch = async () => new Response(JSON.stringify({ status: 'fail', data: { message: 'call_limit_reached' } }), { status: 200 });
  res = fakeRes();
  await iqHandler({ method: 'GET', query: { lat: '3.17', lon: '101.47' } }, res);
  assert.equal(res.code, 429);
  assert.match(JSON.parse(res.body).error, /limit/);

  res = fakeRes();
  await iqHandler({ method: 'GET', query: {} }, res);
  assert.equal(res.code, 400);
  globalThis.fetch = realFetch;
  delete process.env.IQAIR_API_KEY;
  passed++;
  console.log('✓', name);
})();
console.log(`\n${passed} tests passed`);
